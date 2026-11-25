// Swing on the climate card: which way an air conditioner's vanes move.
//
// Home Assistant keeps two axes apart. `swing_mode` (feature SWING_MODE) is
// the classic one — on, off, vertical, horizontal, both, or an integration's
// own values — and `swing_horizontal_mode` (feature SWING_HORIZONTAL_MODE) is
// the left/right axis for units that set it separately. Each has its list in
// the attributes, its current value, and a service of its own.

export type SwingAxis = "vertical" | "horizontal";

export interface SwingAxisSpec {
  /** Attribute with the offered values. */
  list: string;
  /** Attribute with the current value. */
  current: string;
  /** `ClimateEntityFeature` bit. */
  feature: number;
  /** climate.<service> that sets it, and the field it takes. */
  service: string;
  field: string;
  /** Translation key for the axis' name. */
  titleKey: "swing_mode" | "swing_horizontal_mode";
  /** The axis' own glyph: the button's icon, and the fallback for a value without one. */
  icon: string;
}

export const SWING_AXES: Record<SwingAxis, SwingAxisSpec> = {
  vertical: {
    list: "swing_modes",
    current: "swing_mode",
    feature: 32,
    service: "set_swing_mode",
    field: "swing_mode",
    titleKey: "swing_mode",
    icon: "mdi:arrow-up-down",
  },
  horizontal: {
    list: "swing_horizontal_modes",
    current: "swing_horizontal_mode",
    feature: 512,
    service: "set_swing_horizontal_mode",
    field: "swing_horizontal_mode",
    titleKey: "swing_horizontal_mode",
    icon: "mdi:arrow-left-right",
  },
};

/** Icons for the values Home Assistant defines; anything else is shown by name. */
export const SWING_MODE_ICONS: Record<string, string> = {
  on: "mdi:arrow-oscillating",
  off: "mdi:arrow-oscillating-off",
  both: "mdi:arrow-all",
  vertical: "mdi:arrow-up-down",
  horizontal: "mdi:arrow-left-right",
  auto: "mdi:autorenew",
};

/**
 * The values an entity offers on one axis, or none when it does not support
 * that axis: the feature bit is checked as well as the list, so an integration
 * that lists values it then refuses does not get a row of dead buttons.
 */
export function swingModes(attrs: Record<string, unknown>, axis: SwingAxis): string[] {
  const spec = SWING_AXES[axis];
  const list = attrs[spec.list];
  if (!Array.isArray(list)) return [];
  const supported = ((Number(attrs.supported_features) || 0) & spec.feature) !== 0;
  return supported ? list.filter((m): m is string => typeof m === "string" && m !== "") : [];
}

/** The axis' current value, if the entity reports one. */
export function currentSwingMode(attrs: Record<string, unknown>, axis: SwingAxis): string | undefined {
  const value = attrs[SWING_AXES[axis].current];
  return typeof value === "string" ? value : undefined;
}

export function swingModeIcon(mode: string | undefined): string | undefined {
  return mode ? SWING_MODE_ICONS[mode.toLowerCase()] : undefined;
}
