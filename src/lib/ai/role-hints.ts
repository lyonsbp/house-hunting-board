import type { ReferenceRole } from "./types";

/**
 * Phrasing for the structured prompt hint we generate per reference image.
 * Shared between the Gemini editor (and any future backend) and the
 * server-side resolver, so changing the wording in one place flows
 * everywhere.
 */
export const ROLE_HINT: Record<ReferenceRole, string> = {
  style: "match the overall style and aesthetic of this image",
  color: "match the color palette and tones shown in this image",
  materials: "match the materials, textures, and finishes shown here",
  scale: "match the scale and proportions shown here",
  placement: "use this image as a guide for placement and composition",
  other: "use this image as a visual reference",
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
