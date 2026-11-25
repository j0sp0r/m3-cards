// Consumers on the energy flow card (`devices`): a wallbox, a heat pump.
//
// Two ways to show them. `layout: flow` puts the sources in a column on the
// left, the home large in the middle and the consumers in a column on the
// right, joined by curves. The classic diamond keeps its shape and lists the
// consumers underneath, with a bar of their shares. Both add "Other" for
// what the home uses that no device accounts for.

/** A colour per device, in order, unless the config gives one. */
export const DEVICE_PALETTE = ["#7fd1c0", "#f2a48c", "#b9a2ef", "#e9c46a"] as const;
/** "Other": the rest of the home. */
export const OTHER_COLOR = "#c5ccc3";

export interface ConsumerShare {
  /** Index into `devices`, or -1 for "Other". */
  index: number;
  value: number;
  /** Share of the home, 0–1. */
  share: number;
}

/**
 * Each device's share of the home, and "Other" for the rest when asked for
 * and there is any. The home is never taken as less than the devices add up
 * to, so a share never exceeds the whole.
 */
export function consumerShares(home: number, values: readonly number[], showOther: boolean): ConsumerShare[] {
  const v = values.map((x) => Math.max(0, Number.isFinite(x) ? x : 0));
  const sum = v.reduce((s, x) => s + x, 0);
  const whole = Math.max(home, sum);
  const out: ConsumerShare[] = v.map((value, index) => ({ index, value, share: whole > 0 ? value / whole : 0 }));
  const other = whole - sum;
  if (showOther && other > whole * 0.005 && other > 0) out.push({ index: -1, value: other, share: whole > 0 ? other / whole : 0 });
  return out;
}

export interface FlowColumnsLayout {
  /** Centre x of the left column, the home and the right column. */
  xLeft: number;
  xHome: number;
  xRight: number;
  /** Node sizes: the columns' and the home's. */
  side: number;
  home: number;
  yLeft: number[];
  yRight: number[];
  yHome: number;
  /** Baseline of the column headings. */
  headingY: number;
  viewHeight: number;
}

const ROW = 96;
const TOP = 26;

/** Where the nodes of `layout: flow` sit for `left` sources and `right` consumers. */
export function flowColumns(left: number, right: number, width = 320): FlowColumnsLayout {
  const rows = Math.max(left, right, 2);
  const height = rows * ROW;
  const spread = (n: number) => Array.from({ length: n }, (_, i) => TOP + (i + 0.5) * (height / Math.max(n, 1)) - 8);
  return {
    xLeft: 50,
    xHome: width / 2,
    xRight: width - 50,
    side: 60,
    home: 84,
    yLeft: spread(left),
    yRight: spread(right),
    yHome: TOP + height / 2 - 12,
    headingY: 12,
    viewHeight: TOP + height + 4,
  };
}

/** A smooth S from one point to another, level at both ends. */
export function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

/**
 * Where the i-th of n lines meets the home's edge: spread a little along it,
 * so the curves do not all run into one point.
 */
export function homeAnchorY(yHome: number, i: number, n: number, gap = 12): number {
  return yHome + (i - (n - 1) / 2) * gap;
}

/** A name short enough for its node's width: about eleven characters. */
export function shortName(name: string, max = 11): string {
  const trimmed = name.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
