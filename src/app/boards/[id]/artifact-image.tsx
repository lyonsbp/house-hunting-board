"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Image surface that reserves space before the image loads.
 *
 * The wrapper takes a known `aspectRatio` (from
 * `metadata.width / metadata.height`, set at upload time) so the grid
 * lays out fully on first paint — no CLS, no top-to-bottom scanline
 * reflow as cards finish loading.
 *
 * Behind the `<img>` we render:
 *   1. A solid stone-100 fill (the rest state).
 *   2. The LQIP data URL if present, scaled-up with a blur — a single
 *      ~1-3KB JPEG that hides the placeholder seam.
 *   3. A subtle shimmer when no LQIP exists (server-generated images:
 *      AI edits and scrapes — we don't synthesize a placeholder for
 *      those; the shimmer is the fallback).
 *
 * The image itself starts at opacity 0 and fades in on `load`. We also
 * honor the cached path: if the `<img>` is already complete by the time
 * the effect runs (browser cache hit), we skip the transition.
 */
export function ArtifactImage({
  src,
  srcSet,
  sizes,
  alt,
  aspectRatio,
  lqip,
  className,
  imgClassName,
  fit = "fill-width",
  draggable,
  fetchPriority,
}: {
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  /** width / height ratio; falls back to 4/3 when omitted. */
  aspectRatio?: number;
  /** Tiny base64 data URL used as a blur backdrop. */
  lqip?: string;
  /** Classes applied to the outer aspect-ratio wrapper. */
  className?: string;
  /** Classes applied directly to the `<img>`. */
  imgClassName?: string;
  /** `fill-width` (object-fit unset, image's natural height fills width)
   *  or `cover` (crop to fill the box). Default is fill-width to match
   *  the existing card behavior where caption height adapts. */
  fit?: "fill-width" | "cover";
  draggable?: boolean;
  fetchPriority?: "high" | "low" | "auto";
}) {
  const [loaded, setLoaded] = useState(false);
  // React's canonical "reset state on prop change" pattern: store the
  // last seen src in state and compare during render. Doing this in a
  // conditional setState (vs. an effect) avoids a frame of mismatched
  // src/loaded — see react.dev/learn/you-might-not-need-an-effect.
  const [seenSrc, setSeenSrc] = useState(src);
  if (seenSrc !== src) {
    setSeenSrc(src);
    setLoaded(false);
  }
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // Cache hit on first mount: the image is already complete before
    // our effect runs and `onLoad` never fires. Skip the fade.
    if (imgRef.current?.complete) setLoaded(true);
  }, []);

  // Two layout modes:
  //  - fill-width (default): we own the box's aspect ratio. The grid
  //    needs this so the page lays out before pixels arrive.
  //  - cover: the parent already has explicit dimensions (e.g.
  //    absolutely-positioned fan-deck thumbs). The wrapper just fills
  //    the parent and the img is `object-cover`.
  const useAspectStyle = fit !== "cover";
  const ratio = aspectRatio && aspectRatio > 0 ? aspectRatio : 4 / 3;
  const wrapperStyle = useAspectStyle ? { aspectRatio: ratio } : undefined;

  const imgFit =
    fit === "cover"
      ? "absolute inset-0 h-full w-full object-cover"
      : "block h-auto w-full";

  return (
    <div
      className={`relative overflow-hidden bg-stone-100 ${className ?? ""}`}
      style={wrapperStyle}
    >
      {lqip ? (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${lqip})`,
            // Blur the up-scaled LQIP and overshoot the box so the
            // gaussian falloff at the edges doesn't reveal stone-100.
            filter: "blur(20px)",
            transform: "scale(1.1)",
          }}
        />
      ) : (
        <div
          aria-hidden
          className={`absolute inset-0 ${loaded ? "" : "shimmer"}`}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        className={`${fit === "cover" ? "" : "relative"} ${imgFit} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${imgClassName ?? ""}`}
        loading="lazy"
        decoding="async"
        draggable={draggable}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        {...(fetchPriority ? { fetchPriority } : {})}
      />
    </div>
  );
}
