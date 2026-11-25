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

/** A name short enough for its node's width: about eleven characters. */
export function shortName(name: string, max = 11): string {
  const trimmed = name.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
