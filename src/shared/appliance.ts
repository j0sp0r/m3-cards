// Pure logic behind m3-appliance-card, kept out of the element so it can be
// tested: the suite has no DOM, so anything that needs `hass` or a render root
// is untestable here by design (docs/TESTING.md). What is left — reading a
// number entity's range, turning "when will it be done" into minutes — is
// exactly the part that is worth a test, because every one of these has a
// wrong answer that looks plausible on screen.

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

export interface SliderRangeOverrides {
  min?: number;
  max?: number;
  step?: number;
}

/** Fallback range for an entity that reports none, which some templates do not. */
export const SLIDER_RANGE_FALLBACK: SliderRange = { min: 0, max: 100, step: 1 };

/**
 * The range a slider row works over.
 *
 * The entity's own `min`/`max`/`step` are the source of truth — a `number`
 * entity publishes all three — and the config only overrides them, so a card
 * cannot silently offer an oven a temperature its integration would reject.
 * An inverted or degenerate range (max <= min) falls back rather than
 * rendering a slider whose handle has nowhere to go.
 */
export function resolveSliderRange(
  attributes: Record<string, unknown> | undefined,
  overrides: SliderRangeOverrides = {},
): SliderRange {
  const attr = (key: string): number | undefined => {
    const value = attributes?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const min = overrides.min ?? attr("min") ?? SLIDER_RANGE_FALLBACK.min;
  const max = overrides.max ?? attr("max") ?? SLIDER_RANGE_FALLBACK.max;
  const step = overrides.step ?? attr("step") ?? SLIDER_RANGE_FALLBACK.step;
  const usableStep = Number.isFinite(step) && step > 0 ? step : SLIDER_RANGE_FALLBACK.step;
  if (!(max > min)) return { ...SLIDER_RANGE_FALLBACK, step: usableStep };
  return { min, max, step: usableStep };
}

/** Snaps a raw value onto the range's own grid, clamped to its ends. */
export function snapToRange(value: number, range: SliderRange): number {
  const stepped = Math.round((value - range.min) / range.step) * range.step + range.min;
  const clamped = Math.min(range.max, Math.max(range.min, stepped));
  // Floating-point steps (0.5, 0.1) accumulate visible dirt — 21.500000000000004
  // reaches the service call and, worse, the label above the slider.
  return Math.round(clamped * 1e6) / 1e6;
}

/**
 * How many minutes are left, from whatever shape the integration chose.
 *
 * There is no agreement on this at all. Home Connect gives a duration in
 * seconds, a Shelly template gives whole minutes, LG's integration gives an
 * absolute completion timestamp, and a Tuya washer gives "01:24:00". All four
 * are the same fact, and a card that understood only one of them would work for
 * a quarter of the appliances it is meant for.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the timestamp case
 * is testable; the card passes the real clock.
 */
export function remainingMinutes(
  raw: string | undefined,
  attributes: Record<string, unknown> | undefined,
  now: number,
): number | undefined {
  if (raw === undefined) return undefined;
  const state = raw.trim();
  if (!state) return undefined;

  const deviceClass = attributes?.device_class;
  const unit = String(attributes?.unit_of_measurement ?? "").toLowerCase();

  // A duration written as a clock: "1:24:00" (h:mm:ss) or "24:00" (mm:ss when
  // it came from a timer, h:mm when it came from a template). Two fields are
  // read as h:mm, because that is what an appliance means by "1:24" — a washing
  // machine has never had 84 seconds left.
  const clock = state.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    const seconds = clock[3] === undefined ? 0 : Number(clock[3]);
    return hours * 60 + minutes + seconds / 60;
  }

  const numeric = Number(state);
  if (Number.isFinite(numeric) && /^-?[\d.]+$/.test(state)) {
    const minutes =
      unit.startsWith("s") ? numeric / 60 : unit.startsWith("h") ? numeric * 60 : numeric;
    return Math.max(0, minutes);
  }

  // An absolute completion time. Accepted whenever it parses, not only when the
  // entity declares `device_class: timestamp`, because plenty of template
  // sensors publish an ISO string and declare nothing.
  if (deviceClass === "timestamp" || /\d{4}-\d{2}-\d{2}/.test(state)) {
    const at = Date.parse(state);
    if (Number.isFinite(at)) return Math.max(0, (at - now) / 60000);
  }

  return undefined;
}

/** Whole hours and minutes, for a caption the card assembles in its own language. */
export function splitDuration(totalMinutes: number): { hours: number; minutes: number } {
  const rounded = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(rounded / 60), minutes: rounded % 60 };
}

/**
 * Title-cases a raw option/state string when no label was configured for it.
 *
 * Integration option strings are `heavy_duty`, `Mixed-Load`, `spin_1400`; none
 * of them belong on a pill as written.
 */
export function prettifyOption(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * A raw state turned into something readable — but only when it is actually a
 * slug.
 *
 * `prettifyOption` exists for integration option strings, where every `_` and
 * `-` is a word separator. A status entity's state is not that: it is whatever
 * the integration or a template sensor decided to publish, and running it
 * through the same rule eats real characters. A fridge reporting
 * `8 °C · -16 °C` came out as `8 °C · 16 °C` — the minus read as a separator
 * and the freezer looked like it was above freezing.
 *
 * So free-form text is returned untouched, and only a slug-shaped state
 * (`run`, `heavy_duty`, `delayed-start`) is prettified.
 */
export function prettifyState(raw: string): string {
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/i.test(raw.trim()) ? prettifyOption(raw) : raw;
}

/**
 * The options a select row shows: the entity's own, narrowed and reordered by
 * an `options` allow-list when one is given.
 *
 * An allow-list entry the entity does not offer is dropped rather than shown —
 * a pill that calls `select_option` with an option the entity rejects is worse
 * than a pill that is not there.
 */
export function visibleOptions(
  entityOptions: unknown,
  allowList: string[] | undefined,
): string[] {
  const available = Array.isArray(entityOptions)
    ? entityOptions.filter((o): o is string => typeof o === "string")
    : [];
  if (!allowList?.length) return available;
  return allowList.filter((o) => available.includes(o));
}

/** Where the wave ends, where the track resumes, and where the dot sits. */
export interface WaveBarGeometry {
  /** Width of the wavy, filled portion. 0 when nothing is done yet. */
  activeWidth: number;
  /** Where the remaining flat track starts. */
  trackStartX: number;
  /** Where the track — and its end dot — stops. */
  trackEndX: number;
}

/**
 * Splits a progress bar into its wave, its gap, and its remaining track.
 *
 * The gap and the end dot are the progress card's, so a wavy appliance bar and
 * a wavy progress bar read as the same component. Pulled out as a pure
 * function because it is the part worth testing: the SVG around it is
 * geometry-free.
 */
export function waveBarGeometry(
  widthPx: number,
  percentage: number,
  gap: number,
  dotRadius: number,
): WaveBarGeometry {
  const trackEndX = Math.max(0, widthPx - dotRadius);
  // The dot needs its own diameter of room, and the gap only exists between a
  // wave and a track — so both come off the width before the split.
  const available = Math.max(0, widthPx - gap - dotRadius * 2);
  const clamped = Math.min(100, Math.max(0, percentage));
  const activeWidth = available * (clamped / 100);
  const hasActive = activeWidth > 1;
  return {
    activeWidth: hasActive ? activeWidth : 0,
    trackStartX: hasActive ? activeWidth + gap : 0,
    trackEndX,
  };
}

/** Where the wave ends and the track resumes, on either side of a handle. */
export interface WaveSliderGeometry {
  handleX: number;
  activeEnd: number;
  trackStart: number;
}

/**
 * Places a slider's handle and splits the rail around it.
 *
 * Half the gap sits on each side of the handle, which is what keeps the wave
 * from appearing to grow out of it — the humidifier card's arrangement, and
 * the reason this card's slider looked like its slider even before the wave.
 */
export function waveSliderGeometry(
  widthPx: number,
  fraction: number,
  handleWidth: number,
  gap: number,
): WaveSliderGeometry {
  const clamped = Math.min(1, Math.max(0, fraction));
  const handleX = handleWidth / 2 + clamped * Math.max(0, widthPx - handleWidth);
  const gapHalf = gap / 2;
  return {
    handleX,
    activeEnd: Math.max(0, handleX - gapHalf - handleWidth / 2),
    trackStart: Math.min(widthPx, handleX + gapHalf + handleWidth / 2),
  };
}

/**
 * The moment a run will end, from what the remaining-time sensor says: a
 * completion timestamp is the end itself, every other form is now plus the
 * minutes left. Undefined when there is nothing to go by. Rounded to the
 * minute, so the time on the card does not flicker between 15:17 and 15:18
 * as seconds of a countdown pass.
 */
export function endTimeOf(
  raw: string | undefined,
  attributes: Record<string, unknown> | undefined,
  now: number,
): number | undefined {
  const minutes = remainingMinutes(raw, attributes, now);
  if (minutes === undefined) return undefined;
  const state = (raw ?? "").trim();
  const at =
    attributes?.device_class === "timestamp" || /\d{4}-\d{2}-\d{2}/.test(state)
      ? Date.parse(state)
      : now + minutes * 60000;
  if (!Number.isFinite(at)) return undefined;
  return Math.round(at / 60000) * 60000;
}

/**
 * How long ago something happened, for "Done 12 min ago": whole minutes below
 * an hour, whole hours from there. `{ m }` or `{ h }`, so the caller words it.
 */
export function sinceParts(since: number, now: number): { m: number } | { h: number } {
  const minutes = Math.max(0, Math.floor((now - since) / 60000));
  return minutes < 60 ? { m: minutes } : { h: Math.floor(minutes / 60) };
}
