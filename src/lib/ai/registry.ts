import { ComfyUIEditor } from "./editors/comfyui";
import { FluxKontextEditor } from "./editors/flux-kontext";
import { GeminiImageEditor } from "./editors/gemini";
import type { ImageEditModel, ImageEditor } from "./types";

export function getEditor(model: ImageEditModel): ImageEditor {
  switch (model) {
    case "gemini-2.5-flash-image":
      return new GeminiImageEditor();
    case "flux-kontext":
      return new FluxKontextEditor();
    case "comfyui-flux-kontext":
      return new ComfyUIEditor("flux-kontext");
    case "comfyui-qwen-image-edit":
      return new ComfyUIEditor("qwen-image-edit");
  }
}

export const DEFAULT_MODEL: ImageEditModel = "gemini-2.5-flash-image";
