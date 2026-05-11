import { formatRefHint } from "../role-hints";
import type {
  ImageEditModel,
  ImageEditRequest,
  ImageEditResult,
  ImageEditor,
  ReferenceImage,
} from "../types";

/**
 * FLUX.1 Kontext (Black Forest Labs) — strongest "edit this exact photo"
 * fidelity in the M3 model lineup, used as the structural-fidelity
 * fallback when Gemini's output drifts. We hit the `flux-kontext-max`
 * endpoint specifically because it accepts up to four input images
 * (1 source + 3 references), which matches the M8 reference-row cap.
 *
 * The BFL API is async: POST returns a task id + poll URL, we poll until
 * the task reports `Ready`, then download the resulting sample image.
 * One submit-and-poll cycle per variant (Kontext returns a single image
 * per call); the caller fans out parallel calls for Remix.
 *
 * Set `FLUX_API_KEY` via `wrangler secret put` for production, or in
 * .env.development.local for local dev. The model variant is overridable
 * via `FLUX_MODEL_NAME` so we can swap to a newer build without a code
 * change.
 */

const DEFAULT_MODEL_NAME = "flux-kontext-max";
const API_BASE = "https://api.bfl.ai/v1";

// PRD §5.3 ballpark: $0.05–0.08 per image. Use the upper end as a safe
// estimate until we surface real billing data.
const COST_CENTS_PER_IMAGE = 7;

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 120_000;
// 4s, not 1.5s — with 4 concurrent variants polling, the tighter
// interval bursts subrequests and racks up worker wallclock waiting on
// I/O slots without changing time-to-result meaningfully.
const POLL_INTERVAL_MS = 4_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export class FluxKontextEditor implements ImageEditor {
  readonly model: ImageEditModel = "flux-kontext";

  async edit(req: ImageEditRequest): Promise<ImageEditResult[]> {
    if (req.variants < 1) {
      throw new Error("FluxKontextEditor: variants must be >= 1");
    }
    const apiKey = process.env.FLUX_API_KEY;
    if (!apiKey) {
      throw new Error("FLUX_API_KEY is not set");
    }
    const modelName = process.env.FLUX_MODEL_NAME ?? DEFAULT_MODEL_NAME;

    const sourceB64 = await loadSourceB64(req.source);
    const refs = await Promise.all((req.references ?? []).map(encodeRef));
    if (refs.length > 3) {
      // flux-kontext-max accepts input_image + 2/3/4. We cap at 3 refs
      // up the stack already, but defend here too.
      throw new Error("FluxKontextEditor: at most 3 references supported");
    }

    // Same role-hint scaffolding as the Gemini path so role pills work
    // uniformly across backends.
    const sortedRefs = refs.slice().sort((a, b) => a.index - b.index);
    const refHints = sortedRefs
      .map((r) => formatRefHint(r.index, r.role))
      .join("\n");
    const fullPrompt = refHints
      ? `${req.prompt}\n\nReference guidance (do not output the references; edit the SOURCE):\n${refHints}`
      : req.prompt;

    const settled = await Promise.allSettled(
      Array.from({ length: req.variants }, (_unused, i) =>
        runOne({
          apiKey,
          modelName,
          sourceB64,
          refs: sortedRefs,
          prompt: fullPrompt,
          variantIndex: i,
          seed: req.seed,
        }),
      ),
    );

    const results: ImageEditResult[] = [];
    const errors: string[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value);
      else
        errors.push(
          r.reason instanceof Error ? r.reason.message : String(r.reason),
        );
    }
    if (results.length === 0) {
      throw new Error(
        `All ${req.variants} variant${req.variants === 1 ? "" : "s"} failed${errors[0] ? `: ${errors[0]}` : ""}`,
      );
    }
    return results;
  }
}

type EncodedRef = {
  index: number;
  role?: ReferenceImage["role"];
  b64: string;
};

async function encodeRef(ref: ReferenceImage): Promise<EncodedRef> {
  if (ref.source.kind === "bytes") {
    return { index: ref.index, role: ref.role, b64: bytesToBase64(ref.source.bytes) };
  }
  const res = await fetch(ref.source.url);
  if (!res.ok) {
    throw new Error(`Failed to fetch reference ${ref.index}: ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return { index: ref.index, role: ref.role, b64: bytesToBase64(buf) };
}

async function runOne(args: {
  apiKey: string;
  modelName: string;
  sourceB64: string;
  refs: EncodedRef[];
  prompt: string;
  variantIndex: number;
  seed?: number;
}): Promise<ImageEditResult> {
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    input_image: args.sourceB64,
    output_format: "png",
    safety_tolerance: 2,
  };
  // BFL spec: secondary inputs are input_image_2 / _3 / _4. We allocate
  // them in slot order so a user's "Reference 1" is always BFL's
  // input_image_2, "Reference 2" → input_image_3, etc.
  args.refs.forEach((r, i) => {
    body[`input_image_${i + 2}`] = r.b64;
  });
  if (typeof args.seed === "number") body.seed = args.seed;

  // Submit
  const submit = await postJsonWithTimeout(
    `${API_BASE}/${args.modelName}`,
    args.apiKey,
    body,
    SUBMIT_TIMEOUT_MS,
  );
  if (!submit.ok) {
    const detail = await submit.text().catch(() => "");
    throw new Error(
      `BFL ${args.modelName} submit returned ${submit.status}${detail ? `: ${truncate(detail, 300)}` : ""}`,
    );
  }
  const submitJson = (await submit.json()) as {
    id?: string;
    polling_url?: string;
  };
  const taskId = submitJson.id;
  if (!taskId) throw new Error("BFL submit response had no task id");

  // Poll
  const sample = await pollUntilReady({
    apiKey: args.apiKey,
    pollingUrl:
      submitJson.polling_url ??
      `${API_BASE}/get_result?id=${encodeURIComponent(taskId)}`,
    deadlineMs: Date.now() + POLL_TIMEOUT_MS,
  });

  // Download
  const dl = await fetchWithTimeout(sample.url, {}, DOWNLOAD_TIMEOUT_MS);
  if (!dl.ok) {
    throw new Error(`BFL sample download failed: ${dl.status}`);
  }
  const mimeType = dl.headers.get("content-type") ?? "image/png";
  const bytes = new Uint8Array(await dl.arrayBuffer());

  return {
    variantIndex: args.variantIndex,
    image: { mimeType, bytes },
    costCents: COST_CENTS_PER_IMAGE,
    providerMeta: {
      model: args.modelName,
      task_id: taskId,
    },
  };
}

type PollSample = { url: string };

async function pollUntilReady(args: {
  apiKey: string;
  pollingUrl: string;
  deadlineMs: number;
}): Promise<PollSample> {
  while (Date.now() < args.deadlineMs) {
    const res = await fetchWithTimeout(
      args.pollingUrl,
      { headers: { "x-key": args.apiKey, accept: "application/json" } },
      10_000,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `BFL poll returned ${res.status}${detail ? `: ${truncate(detail, 200)}` : ""}`,
      );
    }
    const json = (await res.json()) as {
      status?: string;
      result?: { sample?: string };
    };
    const status = (json.status ?? "").toLowerCase();
    if (status === "ready" || status === "succeeded") {
      const sample = json.result?.sample;
      if (!sample) throw new Error("BFL ready but no sample url");
      return { url: sample };
    }
    if (
      status === "error" ||
      status === "failed" ||
      status === "content_moderated" ||
      status === "request_moderated"
    ) {
      throw new Error(`BFL task failed (${status})`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("BFL task timed out");
}

async function postJsonWithTimeout(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  return fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "x-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

async function loadSourceB64(src: ImageEditRequest["source"]): Promise<string> {
  if (src.kind === "bytes") return bytesToBase64(src.bytes);
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`Failed to fetch source image: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return bytesToBase64(buf);
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
