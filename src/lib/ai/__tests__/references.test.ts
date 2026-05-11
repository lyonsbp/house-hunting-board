import { describe, expect, it } from "vitest";

import {
  buildRefMetadata,
  MAX_REFERENCES,
  validateRefInputs,
} from "../references";
import { formatRefHint, ROLE_HINT } from "../role-hints";

const SAMPLE_ARTIFACT_ID = "a1f3c9c2-4b1e-4f4b-8c11-1a2b3c4d5e6f";
const OTHER_ARTIFACT_ID = "b2e4d8d3-5c2f-4a5c-9d22-2b3c4d5e6f70";
const SAMPLE_USER_ID = "c3d5e9e4-6d3a-4b6d-ae33-3c4d5e6f7081";

describe("validateRefInputs", () => {
  it("returns [] for null / undefined / empty string", () => {
    expect(validateRefInputs(null)).toEqual([]);
    expect(validateRefInputs(undefined)).toEqual([]);
    expect(validateRefInputs("")).toEqual([]);
  });

  it("parses a JSON-encoded array of artifact + upload refs", () => {
    const payload = JSON.stringify([
      { source: "artifact", artifactId: SAMPLE_ARTIFACT_ID, index: 1 },
      {
        source: "upload",
        path: `ref_uploads/${SAMPLE_USER_ID}/abc.jpg`,
        role: "color",
        index: 2,
      },
    ]);
    const out = validateRefInputs(payload);
    expect(out).toHaveLength(2);
    expect(out[0].source).toBe("artifact");
    expect(out[1].source).toBe("upload");
    if (out[1].source === "upload") expect(out[1].role).toBe("color");
  });

  it(`rejects more than ${MAX_REFERENCES} references`, () => {
    const four = Array.from({ length: 4 }, (_v, i) => ({
      source: "artifact" as const,
      artifactId: SAMPLE_ARTIFACT_ID,
      index: ((i % 3) + 1) as 1 | 2 | 3,
    }));
    expect(() => validateRefInputs(four)).toThrow();
  });

  it("rejects unknown role values", () => {
    const bad = [
      {
        source: "artifact",
        artifactId: SAMPLE_ARTIFACT_ID,
        role: "vibes",
        index: 1,
      },
    ];
    expect(() => validateRefInputs(bad)).toThrow();
  });

  it("rejects duplicate slot indexes", () => {
    const dup = [
      { source: "artifact", artifactId: SAMPLE_ARTIFACT_ID, index: 1 },
      { source: "artifact", artifactId: OTHER_ARTIFACT_ID, index: 1 },
    ];
    expect(() => validateRefInputs(dup)).toThrow(/Duplicate/);
  });

  it("rejects upload paths outside ref_uploads/<uuid>/", () => {
    const bad = [
      {
        source: "upload",
        path: "boards/abc/leak.jpg",
        index: 1,
      },
    ];
    expect(() => validateRefInputs(bad)).toThrow();
  });

  it("rejects malformed JSON strings", () => {
    expect(() => validateRefInputs("{not json")).toThrow(/JSON/);
  });
});

describe("buildRefMetadata", () => {
  it("flattens artifact refs to id_or_path", () => {
    const out = buildRefMetadata([
      {
        source: "artifact",
        artifactId: SAMPLE_ARTIFACT_ID,
        role: "style",
        index: 1,
      },
      {
        source: "upload",
        path: `ref_uploads/${SAMPLE_USER_ID}/abc.jpg`,
        index: 2,
      },
    ]);
    expect(out).toEqual([
      {
        source: "artifact",
        id_or_path: SAMPLE_ARTIFACT_ID,
        role: "style",
        index: 1,
      },
      {
        source: "upload",
        id_or_path: `ref_uploads/${SAMPLE_USER_ID}/abc.jpg`,
        role: undefined,
        index: 2,
      },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(buildRefMetadata([])).toEqual([]);
  });
});

describe("formatRefHint", () => {
  it("includes role suffix and the canonical phrasing for each role", () => {
    expect(formatRefHint(2, "color")).toBe(
      `Reference 2 (color): ${ROLE_HINT.color}.`,
    );
    expect(formatRefHint(1, "materials")).toBe(
      `Reference 1 (materials): ${ROLE_HINT.materials}.`,
    );
  });

  it("falls back to the 'other' phrasing without a role suffix", () => {
    expect(formatRefHint(3, undefined)).toBe(
      `Reference 3: ${ROLE_HINT.other}.`,
    );
  });

  it("covers every defined role with a non-empty hint", () => {
    for (const role of Object.keys(ROLE_HINT)) {
      expect(ROLE_HINT[role as keyof typeof ROLE_HINT].length).toBeGreaterThan(
        0,
      );
    }
  });
});
