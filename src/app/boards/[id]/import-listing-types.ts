import type { ListingPreview } from "@/lib/listings/types";

export type PreviewListingState =
  | { status: "idle" }
  | {
      status: "ready";
      preview: ListingPreview;
      boardId: string;
      url: string;
    }
  | {
      status: "error";
      code:
        | "unsupported"
        | "blocked"
        | "timeout"
        | "parse"
        | "http"
        | "not-html"
        | "rate-limit";
      message: string;
    };

export type CommitListingState =
  | { status: "idle" }
  | {
      status: "done";
      succeeded: number;
      failed: number;
      /** Already-on-this-board images that we linked instead of re-downloading. */
      deduped: number;
      errors: string[];
      boardId: string;
    }
  | { status: "error"; message: string };
