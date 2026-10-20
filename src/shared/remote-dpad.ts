// Geometry for the directional ring.
//
// The standard remote card draws a 3x3 grid, which spends two corners on
// nothing and leaves four buttons that do not look related. A ring says what
// the control is before it is read: one shape, four ways out of the middle.

/** The four directions, in the order they are drawn. */
export const DPAD_DIRECTIONS = ["up", "right", "down", "left"] as const;
export type DpadDirection = (typeof DPAD_DIRECTIONS)[number];

/** Where each sector's centre points, in degrees, with 0 = east. */
export const DIRECTION_ANGLE: Record<DpadDirection, number> = {
  up: -90,
  right: 0,
  down: 90,
  left: 180,
};

export interface RingGeometry {
  /** Side of the square viewBox. */
  size: number;
  innerRadius: number;
  outerRadius: number;
  /** Degrees each sector covers, gaps already subtracted. */
  sweep: number;
}

/**
 * Scales the ring to a given box.
 *
 * The three radii are kept as ratios of the 168px reference rather than fixed
 * numbers, so `dpad_size` scales the whole control instead of leaving a
 * 62px OK button marooned in a 220px ring.
 */
export function ringGeometry(size: number, gapDegrees = 8): RingGeometry {
  const outerRadius = size / 2;
  return {
    size,
    outerRadius,
    innerRadius: outerRadius * (37 / 84),
    sweep: 90 - gapDegrees,
  };
}

function polar(cx: number, cy: number, r: number, degrees: number): [number, number] {
  const rad = (degrees * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/**
 * One sector of the ring, as a closed donut wedge.
 *
 * Drawn outer-arc clockwise, straight in, inner-arc back, straight out. The
 * two arcs must sweep in opposite directions (1 then 0) or the shape folds
 * through itself and fills as an hourglass.
 */
export function sectorPath(g: RingGeometry, direction: DpadDirection): string {
  const c = g.size / 2;
  const centre = DIRECTION_ANGLE[direction];
  const from = centre - g.sweep / 2;
  const to = centre + g.sweep / 2;
  // Under 180 degrees always, since a quarter minus its gap cannot reach it —
  // but computed rather than hard-coded, so a gap of 0 on a two-way ring would
  // still draw correctly.
  const largeArc = g.sweep > 180 ? 1 : 0;

  const [ox1, oy1] = polar(c, c, g.outerRadius, from);
  const [ox2, oy2] = polar(c, c, g.outerRadius, to);
  const [ix2, iy2] = polar(c, c, g.innerRadius, to);
  const [ix1, iy1] = polar(c, c, g.innerRadius, from);

  const f = (n: number) => n.toFixed(2);
  return [
    `M${f(ox1)} ${f(oy1)}`,
    `A${f(g.outerRadius)} ${f(g.outerRadius)} 0 ${largeArc} 1 ${f(ox2)} ${f(oy2)}`,
    `L${f(ix2)} ${f(iy2)}`,
    `A${f(g.innerRadius)} ${f(g.innerRadius)} 0 ${largeArc} 0 ${f(ix1)} ${f(iy1)}`,
    "Z",
  ].join("");
}

/**
 * Where a direction's arrow icon sits, as a percentage of the box.
 *
 * Placed on the band's midline rather than at its outer edge: an arrow pushed
 * to the rim reads as pointing at the card's border instead of out of the
 * centre.
 */
export function arrowPosition(g: RingGeometry, direction: DpadDirection): { left: string; top: string } {
  const mid = (g.innerRadius + g.outerRadius) / 2;
  const [x, y] = polar(g.size / 2, g.size / 2, mid, DIRECTION_ANGLE[direction]);
  return {
    left: `${((x / g.size) * 100).toFixed(2)}%`,
    top: `${((y / g.size) * 100).toFixed(2)}%`,
  };
}

/**
 * The OK button's diameter for a given ring.
 *
 * Deliberately **smaller** than the hole, so a band of background shows all
 * the way round it. Overlapping the ring instead welds the two into one blob
 * and loses the thing that makes the control readable at a glance: that the
 * middle is a different button from the four around it.
 *
 * 62px in the 168px reference, kept as that ratio so `dpad_size` scales both.
 */
export function centerSize(g: RingGeometry): number {
  return Math.round(g.size * (62 / 168));
}

/**
 * Turns a keyboard event into a direction, or "ok".
 *
 * Returns undefined for everything else so the caller can leave the event
 * alone — swallowing Tab or a shortcut would trap the focus on the card.
 */
export function keyToDirection(key: string): DpadDirection | "ok" | undefined {
  switch (key) {
    case "ArrowUp": return "up";
    case "ArrowDown": return "down";
    case "ArrowLeft": return "left";
    case "ArrowRight": return "right";
    case "Enter":
    case " ":
      return "ok";
    default:
      return undefined;
  }
}
