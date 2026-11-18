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
