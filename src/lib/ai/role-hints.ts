import type { ReferenceRole } from "./types";

/**
 * Phrasing for the structured prompt hint we generate per reference image.
 * Shared between the Gemini editor (and any future backend) and the
 * server-side resolver, so changing the wording in one place flows
 * everywhere.
 */
export const ROLE_HINT: Record<ReferenceRole, string> = {
  style: "guidance only — apply the overall style and aesthetic from this image to the SOURCE",
  color: "guidance only — apply the color palette and tones from this image to the SOURCE",
  materials: "guidance only — apply the materials, textures, and finishes from this image to the SOURCE",
  scale: "guidance only — apply the scale and proportions from this image to the SOURCE",
  placement: "guidance only — use this image as a placement and composition reference for the SOURCE",
  other: "guidance only — use this image as a visual reference; do not copy it",
};

/**
 * Format the per-reference hint that gets folded into the prompt.
 * Example: `Reference 2 (color): match the color palette ...`
 */
export function formatRefHint(index: number, role: ReferenceRole | undefined): string {
  const r = role ?? "other";
  const suffix = role ? ` (${role})` : "";
  return `Reference ${index}${suffix}: ${ROLE_HINT[r]}.`;
}
