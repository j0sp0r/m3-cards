// Geometry and motion for the gauge card's `style: needle` (#56): a 270° arc
// open at the bottom, coloured ranges with a small gap between them, a
// needle, and a spring that carries the needle to a new value with a slight
// overshoot. Pure functions, so the boundaries can be tested without a DOM.

/** The arc runs from -135° to +135°, 0° pointing straight up, clockwise. */
export const NEEDLE_START_DEG = -135;
export const NEEDLE_SWEEP_DEG = 270;

export interface NeedleSegment {
  from: number;
  color: string;
  label?: string;
}

export interface ResolvedSegment {
  from: number;
  to: number;
  color: string;
  label?: string;
}

/** Where `value` sits on the scale, 0–1, clamped: past either end the needle rests at the stop. */
export function fractionOf(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function angleOf(fraction: number): number {
  return NEEDLE_START_DEG + NEEDLE_SWEEP_DEG * fraction;
}

export function pointAt(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

/** An SVG arc path along the circle from one angle to another, clockwise. */
export function arcPathDeg(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  if (toDeg - fromDeg < 0.01) return "";
  const a = pointAt(cx, cy, r, fromDeg);
  const b = pointAt(cx, cy, r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/**
 * The configured ranges as closed intervals over [min, max], sorted. A range
 * that starts below min begins at min; one past max is dropped; without any,
 * the whole scale is one range in `fallbackColor`.
 */
export function resolveSegments(
  segments: NeedleSegment[] | undefined,
  min: number,
  max: number,
  fallbackColor: string,
): ResolvedSegment[] {
  const sorted = [...(segments ?? [])].filter((s) => Number.isFinite(s.from)).sort((a, b) => a.from - b.from);
  if (!sorted.length) return [{ from: min, to: max, color: fallbackColor }];
  const out: ResolvedSegment[] = [];
  // Below the first range's start the scale belongs to the first range.
  for (let i = 0; i < sorted.length; i++) {
    const from = i === 0 ? min : Math.max(min, sorted[i].from);
    const to = i + 1 < sorted.length ? Math.min(max, sorted[i + 1].from) : max;
    if (to <= from) continue;
    out.push({ from, to, color: sorted[i].color, label: sorted[i].label });
  }
  return out.length ? out : [{ from: min, to: max, color: sorted[sorted.length - 1].color, label: sorted[sorted.length - 1].label }];
}

/** The range the value falls in; past the ends, the first or last. */
export function segmentFor(value: number, segs: ResolvedSegment[]): ResolvedSegment | undefined {
  if (!segs.length || !Number.isFinite(value)) return undefined;
  if (value < segs[0].from) return segs[0];
  for (const s of segs) if (value < s.to) return s;
  return segs[segs.length - 1];
}

export interface ArcPiece {
  /** Angles of the drawn stroke, gaps and round caps already allowed for. */
  fromDeg: number;
  toDeg: number;
  color: string;
}

/**
 * Track and fill pieces for each range. A round cap reaches half the stroke
 * past the end of its path, so the gap between two ranges is widened by that
 * on both sides — otherwise a 2° gap would be covered by the caps.
 */
export function arcPieces(
  segs: ResolvedSegment[],
  min: number,
  max: number,
  fillFraction: number,
  gapDeg: number,
  capDeg: number,
): { track: ArcPiece[]; fill: ArcPiece[] } {
  const track: ArcPiece[] = [];
  const fill: ArcPiece[] = [];
  const fillDeg = angleOf(fillFraction);
  segs.forEach((s, i) => {
    const a0 = angleOf(fractionOf(s.from, min, max));
    const a1 = angleOf(fractionOf(s.to, min, max));
    const inset = gapDeg / 2 + capDeg;
    const from = i === 0 ? a0 + capDeg : a0 + inset;
    const to = i === segs.length - 1 ? a1 - capDeg : a1 - inset;
    if (to - from < 0.5) return;
    track.push({ fromDeg: from, toDeg: to, color: s.color });
    if (fillDeg > from) fill.push({ fromDeg: from, toDeg: Math.min(to, fillDeg), color: s.color });
  });
  return { track, fill };
}

/** Evenly spaced tick values from min to max. */
export function tickValues(min: number, max: number, count: number): number[] {
  const n = Math.max(2, Math.round(count));
  return Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));
}

/** "0", "1k", "2.5k", "1M" — compact tick text, decimals in the given locale. */
export function compactTick(value: number, language: string): string {
  const abs = Math.abs(value);
  const fmt = (v: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(v);
  if (abs >= 1_000_000) return `${fmt(value / 1_000_000)}M`;
  if (abs >= 1000) return `${fmt(value / 1000)}k`;
  return fmt(value);
}

/**
 * A damped spring: one step of `dt` seconds toward `target`. Slightly under-
 * damped, so the needle passes the value a little and settles back. A new
 * target simply changes where it is pulled — animations never stack.
 */
export function springStep(
  pos: number,
  vel: number,
  target: number,
  dt: number,
  stiffness = 170,
  damping = 20,
): { pos: number; vel: number } {
  const accel = stiffness * (target - pos) - damping * vel;
  const nextVel = vel + accel * dt;
  return { pos: pos + nextVel * dt, vel: nextVel };
}

export function springSettled(pos: number, vel: number, target: number): boolean {
  return Math.abs(target - pos) < 0.0005 && Math.abs(vel) < 0.0005;
}
