// Shared M3-Expressive sine-wave math, used by every wavy slider/bar in
// this project (progress-card's indicator, the light-card's brightness and
// color-temperature sliders).

// Builds an SVG path string for a horizontal sine wave, offset by startX so
// it can be positioned anywhere along a longer logical wave (keeps the
// pattern continuous across active/track splits).
//
// The wave is sampled every `step` px, but consecutive samples are joined
// with cubic Béziers rather than straight lines: each segment is a Hermite
// curve built from the sine's analytic slope at both ends, so the path
// matches the true curve instead of faceting into visible chords.
export function buildWavePath(
  startX: number,
  widthPx: number,
  amplitude: number,
  wavelength: number,
  phase: number,
  midY: number,
  step = 4,
): string {
  if (widthPx <= 0) return "";
  const k = (2 * Math.PI) / wavelength;
  const yAt = (absX: number) => midY + amplitude * Math.sin(absX * k + phase);
  const slopeAt = (absX: number) => amplitude * k * Math.cos(absX * k + phase);

  const parts: string[] = [`M${startX.toFixed(2)},${yAt(startX).toFixed(2)}`];
  for (let x = 0; x < widthPx; ) {
    const nextX = Math.min(x + step, widthPx);
    // A cubic's control points sit a third of the span in, displaced by the
    // endpoint slope — that reproduces a sine arc to well under a pixel.
    const third = (nextX - x) / 3;
    const a = startX + x;
    const b = startX + nextX;
    const c1y = yAt(a) + slopeAt(a) * third;
    const c2y = yAt(b) - slopeAt(b) * third;
    parts.push(
      `C${(a + third).toFixed(2)},${c1y.toFixed(2)} ` +
        `${(b - third).toFixed(2)},${c2y.toFixed(2)} ` +
        `${b.toFixed(2)},${yAt(b).toFixed(2)}`,
    );
    x = nextX;
  }
  return parts.join(" ");
}

// Exponential lerp step, used to smoothly animate wave amplitude toward a
// target (e.g. collapsing to 0 when a card goes idle/off).
export function lerpStep(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}
