// A size typed into a card's config, e.g. a popup's `width: 700px` (#58).
// Only plain lengths pass: a number (pixels) or a number with a unit. Anything
// else — a typo, calc(), a stray semicolon — is dropped, so the card keeps its
// own size rather than writing text it does not understand into a style.

const UNITS = ["px", "%", "vw", "vh", "dvw", "dvh", "svw", "svh", "lvw", "lvh", "rem", "em"];
const LENGTH = new RegExp(`^(\\d+(?:\\.\\d+)?)(${UNITS.join("|")})?$`);

export function cssLength(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? `${value}px` : undefined;
  if (typeof value !== "string") return undefined;
  const m = LENGTH.exec(value.trim().toLowerCase());
  if (!m || !(Number(m[1]) > 0)) return undefined;
  return `${m[1]}${m[2] ?? "px"}`;
}

/** The popup's sizes per layout, as CSS custom properties take them. */
export interface PopupSize {
  /** Where the sheet stands centred: tablet, desktop. */
  width?: string;
  height?: string;
  /** The phone's bottom sheet. */
  mobileWidth?: string;
  mobileHeight?: string;
}

/**
 * `width` and `height` size the centred sheet. On a phone the height carries
 * over unless `mobile_height` says otherwise — `auto` hands it back to the
 * content — and the width does not: a phone's sheet is the full width unless
 * `mobile_width` narrows it.
 */
export function popupSize(cfg: { width?: unknown; height?: unknown; mobile_width?: unknown; mobile_height?: unknown }): PopupSize {
  const auto = (v: unknown) => typeof v === "string" && v.trim().toLowerCase() === "auto";
  const height = cssLength(cfg.height);
  return {
    width: cssLength(cfg.width),
    height,
    mobileWidth: cssLength(cfg.mobile_width),
    mobileHeight: auto(cfg.mobile_height) ? undefined : (cssLength(cfg.mobile_height) ?? height),
  };
}
