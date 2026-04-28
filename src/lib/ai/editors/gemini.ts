import type {
  ImageEditModel,
  ImageEditRequest,
  ImageEditResult,
  ImageEditor,
} from "../types";

/**
 * Gemini 2.5 Flash Image ("nano-banana"). Direct REST call — no SDK so we
 * keep the worker bundle small and avoid the moving-target compatibility
 * matrix between `@google/genai`, `@google/generative-ai`, and the v1
 * vs v1beta endpoints.
 *
 * Set `GEMINI_API_KEY` via `wrangler secret put` for production, or in
 * .env.development.local for local dev. The model name is overridable via
 * `GEMINI_IMAGE_MODEL` so we can swap to a newer build without a code
 * change when Google deprecates the preview suffix.
 */
const DEFAULT_MODEL = "gemini-2.5-flash-image";

// PRD §5.3 ballpark — refined later when we surface real billing data.
const COST_CENTS_PER_IMAGE = 4;

const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 60_000;

export class GeminiImageEditor implements ImageEditor {
  readonly model: ImageEditModel = "gemini-2.5-flash-image";

  async edit(req: ImageEditRequest): Promise<ImageEditResult[]> {
    if (req.variants !== 1) {
      // Remix (variants > 1) is wired separately so we can fan out in
      // parallel and surface partial-failure UX. For now keep the editor
      // contract one-call-per-variant.
      throw new Error(
        `GeminiImageEditor: variants=${req.variants} not supported here; call edit() once per variant.`,
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    const modelName = process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;

    const sourceBytes = await loadSourceBytes(req.source);
    const sourceMime = await loadSourceMime(req.source);

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: req.prompt },
            {
              inline_data: {
                mime_type: sourceMime,
                data: bytesToBase64(sourceBytes),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(
        `${ENDPOINT_BASE}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
    } catch (cause) {
      clearTimeout(timer);
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new Error("Gemini request timed out");
      }
      throw cause;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Gemini ${modelName} returned ${res.status}${detail ? `: ${truncate(detail, 300)}` : ""}`,
      );
    }

    const json = (await res.json()) as GeminiResponse;
    const candidate = json.candidates?.[0];
    if (!candidate) {
      throw new Error("Gemini response had no candidates");
    }

    const imagePart = candidate.content?.parts?.find(isInlinePart);
    if (!imagePart) {
      // The API blocked or returned text-only. Surface the text so the user
      // sees *why* — common when the prompt trips a safety filter.
      const textPart = candidate.content?.parts?.find(isTextPart);
      const reason = candidate.finishReason ?? "no image returned";
      const detail = textPart?.text ? `: ${truncate(textPart.text, 200)}` : "";
      throw new Error(`Gemini returned no image (${reason})${detail}`);
    }

    const mimeType = imagePart.inlineData.mimeType ?? "image/png";
    const bytes = base64ToBytes(imagePart.inlineData.data);

    return [
      {
        variantIndex: 0,
        image: { mimeType, bytes },
        costCents: COST_CENTS_PER_IMAGE,
        providerMeta: {
          model: modelName,
          finishReason: candidate.finishReason,
        },
      },
    ];
  }
}

async function loadSourceBytes(src: ImageEditRequest["source"]): Promise<Uint8Array> {
  if (src.kind === "bytes") return src.bytes;
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`Failed to fetch source image: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function loadSourceMime(src: ImageEditRequest["source"]): Promise<string> {
  if (src.kind === "bytes") return src.mimeType;
  // For URL sources we'd HEAD the URL, but the bytes loader already fetched;
  // callers that want a precise MIME should pass `kind: "bytes"`.
  return "image/jpeg";
}

function bytesToBase64(bytes: Uint8Array): string {
  // btoa is available in Workers + Node 20+; chunk to avoid call-stack
  // overflows on large images.
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

type GeminiInlinePart = {
  inlineData: { mimeType?: string; data: string };
};
type GeminiTextPart = { text: string };
type GeminiPart = GeminiInlinePart | GeminiTextPart | Record<string, unknown>;

function isInlinePart(p: GeminiPart): p is GeminiInlinePart {
  return (
    typeof (p as GeminiInlinePart).inlineData === "object" &&
    (p as GeminiInlinePart).inlineData !== null &&
    typeof (p as GeminiInlinePart).inlineData.data === "string"
  );
}

function isTextPart(p: GeminiPart): p is GeminiTextPart {
  return typeof (p as GeminiTextPart).text === "string";
}

type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};
