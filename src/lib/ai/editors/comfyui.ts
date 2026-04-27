import type {
  ImageEditModel,
  ImageEditRequest,
  ImageEditResult,
  ImageEditor,
} from "../types";

export type ComfyUIWorkflow = "flux-kontext" | "qwen-image-edit";

const MODEL_BY_WORKFLOW: Record<ComfyUIWorkflow, ImageEditModel> = {
  "flux-kontext": "comfyui-flux-kontext",
  "qwen-image-edit": "comfyui-qwen-image-edit",
};

/**
 * Talks to a local ComfyUI server (typically reached via a LiteLLM proxy
 * exposing an OpenAI-compatible endpoint). One class, one workflow per
 * instance — pick the workflow at construction time.
 */
export class ComfyUIEditor implements ImageEditor {
  readonly model: ImageEditModel;

  constructor(workflow: ComfyUIWorkflow) {
    this.model = MODEL_BY_WORKFLOW[workflow];
  }

  async edit(_req: ImageEditRequest): Promise<ImageEditResult[]> {
    throw new Error(`ComfyUIEditor (${this.model}) not implemented (M3)`);
  }
}
