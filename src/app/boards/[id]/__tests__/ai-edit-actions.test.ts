/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect called — user not signed in");
  },
}));

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));

const userClient = {
  from: vi.fn(),
  storage: { from: vi.fn() },
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => userClient),
}));

const editorEdit = vi.fn();
vi.mock("@/lib/ai/registry", () => ({
  DEFAULT_MODEL: "gemini-2.5-flash-image",
  getEditor: () => ({
    model: "gemini-2.5-flash-image",
    edit: (...args: unknown[]) => editorEdit(...args),
  }),
}));

const BOARD_ID = "12345678-1234-4abc-8def-1234567890ab";
const PARENT_ID = "abcdef12-3456-4789-89ab-cdef01234567";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  getCurrentUser.mockResolvedValue({
    sub: "user-1",
    email: "user-1@example.com",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function setupHappySupabase(opts: { quotaUsed: number; existingCategories?: string[] } = { quotaUsed: 0 }) {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const downloadBlob = new Blob([new Uint8Array([1, 2, 3])], {
    type: "image/jpeg",
  });
  const download = vi.fn().mockResolvedValue({ data: downloadBlob, error: null });
  const createSignedUrl = vi
    .fn()
    .mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
  userClient.storage.from.mockReturnValue({
    upload,
    remove,
    download,
    createSignedUrl,
  });

  let nextChildId = 999;
  let nextEditId = 50;
  userClient.from.mockImplementation((table: string) => {
    if (table === "board_members") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { role: "owner" },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    if (table === "artifacts") {
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: `child-${nextChildId++}` },
            error: null,
          }),
        }),
      });
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: PARENT_ID,
                board_id: BOARD_ID,
                kind: "image",
                storage_path: `boards/${BOARD_ID}/source.jpg`,
              },
              error: null,
            }),
          }),
        }),
        insert,
      };
    }
    if (table === "ai_edits") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              gte: vi.fn().mockResolvedValue({
                count: opts.quotaUsed,
                error: null,
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: `edit-${nextEditId++}` },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    }
    if (table === "artifact_categories") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: (opts.existingCategories ?? []).map((id) => ({
              category_id: id,
            })),
            error: null,
          }),
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }
    throw new Error(`unexpected user table ${table}`);
  });

  return { upload, remove };
}

describe("editImageArtifact", () => {
  it("runs the editor and inserts a child artifact on success", async () => {
    setupHappySupabase({ quotaUsed: 0 });
    editorEdit.mockResolvedValue([
      {
        variantIndex: 0,
        image: { mimeType: "image/png", bytes: new Uint8Array([10, 20, 30]) },
        costCents: 4,
        providerMeta: {},
      },
    ]);

    const { editImageArtifact } = await import("../ai-edit-actions");
    const fd = new FormData();
    fd.set("boardId", BOARD_ID);
    fd.set("artifactId", PARENT_ID);
    fd.set("prompt", "Add a pool");

    const out = await editImageArtifact({ status: "idle" }, fd);
    expect(out.status).toBe("done");
    expect(editorEdit).toHaveBeenCalledOnce();
  });

  it("returns a quota error when the user has used their weekly limit", async () => {
    vi.stubEnv("AI_INVOCATION_LIMIT", "5");
    setupHappySupabase({ quotaUsed: 5 });
    const { editImageArtifact } = await import("../ai-edit-actions");
    const fd = new FormData();
    fd.set("boardId", BOARD_ID);
    fd.set("artifactId", PARENT_ID);
    fd.set("prompt", "Add a pool");

    const out = await editImageArtifact({ status: "idle" }, fd);
    expect(out.status).toBe("error");
    if (out.status === "error") {
      expect(out.code).toBe("quota");
    }
    expect(editorEdit).not.toHaveBeenCalled();
  });

  it("lets a superadmin past the quota check", async () => {
    vi.stubEnv("AI_INVOCATION_LIMIT", "1");
    vi.stubEnv("SUPERADMIN_EMAILS", "owner@example.com");
    getCurrentUser.mockResolvedValue({
      sub: "user-2",
      email: "owner@example.com",
    });

    // Even with the quota exhausted, the count query path should be skipped
    // for superadmins. Make it throw so we'd notice if it ran.
    setupHappySupabase({ quotaUsed: 99 });
    userClient.storage.from.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
      download: vi.fn().mockResolvedValue({
        data: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
        error: null,
      }),
      createSignedUrl: vi
        .fn()
        .mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null }),
    });
    userClient.from.mockImplementation((table: string) => {
      if (table === "board_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: "owner" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: PARENT_ID,
                  board_id: BOARD_ID,
                  kind: "image",
                  storage_path: `boards/${BOARD_ID}/source.jpg`,
                },
                error: null,
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "child-x" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "ai_edits") {
        return {
          select: vi.fn().mockImplementation(() => {
            throw new Error("superadmin should not run the count query");
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "edit-x" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "artifact_categories") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      throw new Error(`unexpected user table ${table}`);
    });

    editorEdit.mockResolvedValue([
      {
        variantIndex: 0,
        image: { mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) },
        costCents: 4,
        providerMeta: {},
      },
    ]);

    const { editImageArtifact } = await import("../ai-edit-actions");
    const fd = new FormData();
    fd.set("boardId", BOARD_ID);
    fd.set("artifactId", PARENT_ID);
    fd.set("prompt", "Make it sunset");

    const out = await editImageArtifact({ status: "idle" }, fd);
    expect(out.status).toBe("done");
  });

  it("rejects non-image parents", async () => {
    userClient.storage.from.mockReturnValue({
      upload: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
    });
    userClient.from.mockImplementation((table: string) => {
      if (table === "board_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: "editor" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: PARENT_ID,
                  board_id: BOARD_ID,
                  kind: "note",
                  storage_path: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected user table ${table}`);
    });

    const { editImageArtifact } = await import("../ai-edit-actions");
    const fd = new FormData();
    fd.set("boardId", BOARD_ID);
    fd.set("artifactId", PARENT_ID);
    fd.set("prompt", "edit me");

    const out = await editImageArtifact({ status: "idle" }, fd);
    expect(out.status).toBe("error");
    if (out.status === "error") {
      expect(out.code).toBe("wrong-kind");
    }
  });
});
