// A smooth line through measured points that never claims a value nobody
// measured.
//
// Catmull-Rom is the usual way to round off a polyline and it overshoots: past
// a sharp step it swings beyond the higher reading and back, so a humidity
// curve that peaked at 70.4 % is drawn peaking at 71. On a graph whose only
// scale is a ring on the maximum, that ring would sit below the line. The
// monotone cubic of Fritsch and Carlson rounds the same corners and keeps every
// stretch between two points inside the range of those two points, so the
// drawn extremes are the measured ones.

export interface XY {
  x: number;
  y: number;
}

/**
 * SVG path data for one unbroken run of points, x ascending.
 *
 * Returns "" for an empty run and a dot-sized line for a single point, so a
 * lone reading between two outages still shows up.
 */
export function monotonePath(points: readonly XY[]): string {
  const n = points.length;
  if (n === 0) return "";
  const f = (v: number) => v.toFixed(2);
  if (n === 1) return `M${f(points[0].x)} ${f(points[0].y)}h0.01`;
  if (n === 2) return `M${f(points[0].x)} ${f(points[0].y)}L${f(points[1].x)} ${f(points[1].y)}`;

  const tangents = monotoneTangents(points);
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const h = (q.x - p.x) / 3;
    d +=
      `C${f(p.x + h)} ${f(p.y + h * tangents[i])}` +
      ` ${f(q.x - h)} ${f(q.y - h * tangents[i + 1])}` +
      ` ${f(q.x)} ${f(q.y)}`;
  }
  return d;
}

/** The same line, closed down to `baseline` — the fill under it. */
export function monotoneArea(points: readonly XY[], baseline: number): string {
  if (points.length < 2) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${monotonePath(points)}L${last.x.toFixed(2)} ${baseline.toFixed(2)}L${first.x.toFixed(2)} ${baseline.toFixed(2)}Z`;
}

/**
 * Slopes at each point, limited so no segment leaves its own y range.
 *
 * Exported for the tests, which check exactly that property.
 */
export function monotoneTangents(points: readonly XY[]): number[] {
  const n = points.length;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    secants.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }
  const m: number[] = new Array(n);
  m[0] = secants[0];
  m[n - 1] = secants[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // A turning point or a flat stretch gets a flat tangent: that is what
    // keeps a peak at the height it was measured at.
    m[i] = secants[i - 1] * secants[i] <= 0 ? 0 : (secants[i - 1] + secants[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const s = secants[i];
    if (s === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / s;
    const b = m[i + 1] / s;
    const r = a * a + b * b;
    if (r > 9) {
      const t = 3 / Math.sqrt(r);
      m[i] = t * a * s;
      m[i + 1] = t * b * s;
    }
  }
  return m;
}
