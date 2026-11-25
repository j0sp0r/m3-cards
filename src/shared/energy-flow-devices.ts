// Consumer nodes on the energy flow card (`devices`): a wallbox, a heat pump.
//
// They hang in a row under the diagram, fed from the home: a trunk runs down
// from under the home node's label to a bus, and a branch drops from the bus
// into each node. The rightmost node sits straight under the home, so with one
// device the line is a single drop. Everything here is in the diagram's
// viewBox units.

export interface DeviceRowLayout {
  /** Centre x of each node, left to right. */
  xs: number[];
  /** Where the trunk starts (under the home node's label). */
  trunkTop: number;
  /** The horizontal bus the branches leave from. */
  busY: number;
  /** Centre y of the nodes. */
  nodeY: number;
  /** Baseline of the name under each node. */
  labelY: number;
  /** The diagram's height with the row. */
  viewHeight: number;
}

/** Room between the node centres; four fit a 320-wide diagram with a margin. */
const SPACING = 76;
/** From the bus down to a node's top. */
const DROP = 22;
const CORNER = 10;

export function deviceRowLayout(
  count: number,
  homeX: number,
  homeLabelBottom: number,
  baseHeight: number,
  nodeSize: number,
): DeviceRowLayout {
  const xs = Array.from({ length: count }, (_, i) => homeX - (count - 1 - i) * SPACING);
  // The bus clears both the home's label and everything else above it.
  const busY = Math.max(baseHeight + 8, homeLabelBottom + 16);
  const nodeY = busY + DROP + nodeSize / 2;
  const labelY = nodeY + nodeSize / 2 + 14;
  return { xs, trunkTop: homeLabelBottom + 10, busY, nodeY, labelY, viewHeight: labelY + 10 };
}

/** The trunk, home down to the bus. */
export function trunkPath(layout: DeviceRowLayout, homeX: number): string {
  return `M ${homeX} ${layout.trunkTop} L ${homeX} ${layout.busY}`;
}

/** One branch: along the bus from the trunk, then down into the node at `x`. */
export function branchPath(layout: DeviceRowLayout, homeX: number, x: number, nodeSize: number): string {
  const top = layout.nodeY - nodeSize / 2;
  if (x === homeX) return `M ${homeX} ${layout.busY} L ${x} ${top}`;
  const dir = x < homeX ? -1 : 1;
  return `M ${homeX} ${layout.busY} L ${x - dir * CORNER} ${layout.busY} Q ${x} ${layout.busY} ${x} ${layout.busY + CORNER} L ${x} ${top}`;
}

export interface DeviceFlowLine {
  key: string;
  path: string;
  value: number;
  /** The device a drop feeds; undefined for the trunk and the bus between nodes. */
  device?: number;
}

/**
 * The lines as a network rather than one line per device: the trunk carries
 * the total down from the home, the bus runs left from there and gets
 * thinner past each node — each stretch carries only what the devices further
 * left still use — and a short drop leads into each node. Stacked lines of
 * different widths along the same bus looked like a smear.
 */
export function deviceFlowLines(
  layout: DeviceRowLayout,
  homeX: number,
  nodeSize: number,
  values: readonly number[],
): DeviceFlowLine[] {
  const v = values.map((x) => Math.max(0, x ?? 0));
  const total = v.reduce((s, x) => s + x, 0);
  const top = layout.nodeY - nodeSize / 2;
  const n = layout.xs.length;
  const lines: DeviceFlowLine[] = [];
  if (total > 0) lines.push({ key: "trunk", path: trunkPath(layout, homeX), value: total });
  // What is still flowing left of node i: the devices before it.
  const leftOf = (i: number) => v.slice(0, i).reduce((s, x) => s + x, 0);
  for (let i = n - 1; i >= 1; i--) {
    const x = layout.xs[i];
    const prevX = layout.xs[i - 1];
    // Into node i: straight down from the bus (or from the trunk, for the node under the home).
    if (v[i] > 0) lines.push({ key: `drop-${i}`, path: `M ${x} ${layout.busY} L ${x} ${top}`, value: v[i], device: i });
    const onward = leftOf(i);
    if (onward <= 0) continue;
    if (i === 1) {
      // The last stretch and the drop into the leftmost node carry the same: one line round the corner.
      lines.push({
        key: "drop-0",
        path: `M ${x} ${layout.busY} L ${prevX + CORNER} ${layout.busY} Q ${prevX} ${layout.busY} ${prevX} ${layout.busY + CORNER} L ${prevX} ${top}`,
        value: onward,
        device: 0,
      });
    } else {
      lines.push({ key: `bus-${i}`, path: `M ${x} ${layout.busY} L ${prevX} ${layout.busY}`, value: onward });
    }
  }
  if (n === 1 && v[0] > 0) lines.push({ key: "drop-0", path: `M ${homeX} ${layout.busY} L ${homeX} ${top}`, value: v[0], device: 0 });
  return lines;
}

/** A name short enough for its node's width: about eleven characters. */
export function shortName(name: string, max = 11): string {
  const trimmed = name.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
