import { html, css, nothing, unsafeCSS, type TemplateResult } from "lit";
import { stopSwipe } from "./swipe";
import { sliderPointer, capturePointer, SLIDER_TOUCH_ACTION } from "./slider-intent";

// A Material 3 Expressive discrete slider, for the case this suite keeps
// running into: a short, *ordered* list of named steps.
//
// WHY NOT PILLS
//
// A row of pills says "these are alternatives". Suction is not that — quiet,
// balanced, turbo, max, max+ is a scale, and drawing it as five equal buttons
// throws away the one thing the user already knows about it. It also does not
// fit: a seven-step vacuum on a phone gives each pill about 45px, at which
// point the labels are gone anyway.
//
// The Expressive slider is the shape Material gives this: a thick track with a
// gap either side of the handle, stop indicators marking the steps, and a
// straight-line handle rather than a circle, which widens while pressed.
//
// WHY IT TAKES ITS OWN DRAG HANDLING
//
// `input[type=range]` cannot draw the gap or the stop dots, and styling the
// thumb per browser is worse than the 40 lines below. The drag is pointer
// based with capture, the same pattern the light card's brightness slider uses.

export interface LevelStep {
  /** The value handed back to the caller — a `fan_speed`, a `mop_intensity`. */
  value: string;
  /** What the reader sees. Shown in full above the track, never truncated. */
  label: string;
}

export interface LevelSliderOptions {
  steps: LevelStep[];
  /** The step currently selected, by value. Unknown values select nothing. */
  current: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Announced to screen readers as the control's purpose. */
  label: string;
  /**
   * Shown instead of the step's label when the vacuum is on a value that is
   * not on the scale at all — Roborock's `custom`, which the app defines and
   * the card cannot place between two steps.
   */
  offScaleLabel?: string;
}

/** Geometry, in px. Exported so the card's own CSS can line up against it. */
export const LEVEL_TRACK_HEIGHT = 16;
export const LEVEL_TRACK_RADIUS = 8;
export const LEVEL_HANDLE_WIDTH = 4;
export const LEVEL_HANDLE_WIDTH_PRESSED = 6;
export const LEVEL_HANDLE_HEIGHT = 28;
export const LEVEL_HANDLE_RADIUS = 2;
/** Either side of the handle. The gap is what makes it read as Expressive. */
export const LEVEL_TRACK_GAP = 6;
/**
 * How far the handle's travel is pulled in from each end.
 *
 * Without it the handle is centred on 0% and 100%, so at either extreme half
 * of it hangs outside the track — which is exactly where a slider spends most
 * of its time on a vacuum that is set to max. Half the *pressed* width, so it
 * stays inside in both states.
 */
export const LEVEL_EDGE_INSET = LEVEL_HANDLE_WIDTH_PRESSED / 2;
export const LEVEL_STOP_SIZE = 4;
export const LEVEL_ROW_HEIGHT = 44;

/**
 * Which step a pointer at `fraction` (0..1) of the track's width lands on.
 *
 * Pure, and separate from the DOM so it can be tested: the rounding is the
 * part that decides whether a drag feels accurate or one step behind.
 */
export function stepAtFraction(fraction: number, count: number): number {
  if (count <= 1) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * (count - 1));
}

/** Where a step's centre sits along the track, as a fraction. */
export function fractionOfStep(index: number, count: number): number {
  if (count <= 1) return 0;
  return index / (count - 1);
}

/**
 * Renders the control. The host owns the pressed state so that a re-render
 * mid-drag does not drop it — pass it in and let the handlers set it.
 */
export function renderLevelSlider(
  opts: LevelSliderOptions & {
    pressed: boolean;
    setPressed: (pressed: boolean) => void;
  },
): TemplateResult {
  const { steps, current, onChange, disabled, label, pressed, setPressed } = opts;
  const count = steps.length;
  const index = steps.findIndex((s) => s.value === current);
  const offScale = index < 0;
  // An off-scale value parks the handle at the start rather than nowhere: the
  // control still has to have a position, and the label says what is going on.
  const active = offScale ? 0 : index;
  const fraction = fractionOfStep(active, count);
  const valueLabel = offScale ? (opts.offScaleLabel ?? current ?? "") : steps[active].label;

  const commit = (fromFraction: number) => {
    const next = stepAtFraction(fromFraction, count);
    if (steps[next] && steps[next].value !== current) onChange(steps[next].value);
  };

  const fractionFromEvent = (e: PointerEvent, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return (e.clientX - rect.left) / rect.width;
  };

  // Only a drag along the track or a tap reaches these (#27): a touch that
  // turns out to be a vertical scroll leaves the value alone.
  const slide = sliderPointer({
    down: (e) => {
      if (disabled) return;
      capturePointer(e.currentTarget as HTMLElement, e);
      setPressed(true);
      commit(fractionFromEvent(e, e.currentTarget as HTMLElement));
    },
    move: (e) => {
      if (disabled) return;
      commit(fractionFromEvent(e, e.currentTarget as HTMLElement));
    },
    up: (e) => {
      if (disabled) return;
      const el = e.currentTarget as HTMLElement;
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      setPressed(false);
    },
  });

  return html`
    <div class="level" ?data-disabled=${disabled}>
      <div class="level-head">
        <span class="level-name">${label}</span>
        <span class="level-value ${offScale ? "off-scale" : ""}">${valueLabel}</span>
      </div>
      <div
        class="level-track-wrap ${pressed ? "pressed" : ""}"
        role="slider"
        tabindex=${disabled ? -1 : 0}
        aria-label=${label}
        aria-valuemin="0"
        aria-valuemax=${count - 1}
        aria-valuenow=${active}
        aria-valuetext=${valueLabel}
        aria-disabled=${disabled ? "true" : "false"}
        @touchstart=${stopSwipe}
        @touchmove=${stopSwipe}
        @touchend=${stopSwipe}
        @mousedown=${stopSwipe}
        @mousemove=${stopSwipe}
        @mouseup=${stopSwipe}
        @pointerdown=${slide.down}
        @pointermove=${slide.move}
        @pointerup=${slide.up}
        @pointercancel=${slide.cancel}
        @keydown=${(e: KeyboardEvent) => {
          if (disabled) return;
          const step = (delta: number) => {
            e.preventDefault();
            const next = Math.min(count - 1, Math.max(0, active + delta));
            if (steps[next] && steps[next].value !== current) onChange(steps[next].value);
          };
          if (e.key === "ArrowRight" || e.key === "ArrowUp") step(1);
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") step(-1);
          else if (e.key === "Home") step(-count);
          else if (e.key === "End") step(count);
        }}
      >
        ${renderTrack(fraction, count, active, pressed)}
      </div>
    </div>
  `;
}

/**
 * Two absolutely positioned halves rather than one element with a gradient:
 * the gap has to be cut out of both at a position that moves with the handle,
 * and `calc()` on their facing edges does that with no measurement — the
 * control is correct on its first paint, before any ResizeObserver could run.
 */
function renderTrack(fraction: number, count: number, active: number, pressed: boolean) {
  const handleW = pressed ? LEVEL_HANDLE_WIDTH_PRESSED : LEVEL_HANDLE_WIDTH;
  return html`
    <div class="level-track" style=${`--level-fraction: ${fraction};`}>
      <div class="level-fill"></div>
      <div class="level-rest"></div>
      <div class="level-stops">
        ${Array.from({ length: count }, (_, i) =>
          // The dot under the handle is left out: drawing a marker beneath the
          // thing that marks the position reads as a rendering fault.
          i === active
            ? nothing
            : html`<span
                class="level-stop ${i < active ? "on-fill" : ""}"
                style=${`--level-stop-fraction: ${fractionOfStep(i, count)};`}
              ></span>`,
        )}
      </div>
      <div class="level-handle" style=${`width: ${handleW}px;`}></div>
    </div>
  `;
}

export const levelSliderStyles = css`
  .level {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .level[data-disabled] {
    opacity: 0.4;
    pointer-events: none;
  }

  .level-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .level-name {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.55;
  }

  /* The whole point of the slider: the current step gets real type, instead of
     nine pixels squeezed into a pill. */
  .level-value {
    font-size: 13px;
    font-weight: 700;
    color: var(--level-accent, var(--primary-color));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .level-value.off-scale {
    /* A value the scale cannot place — shown, but not dressed up as a step. */
    color: var(--secondary-text-color);
    font-weight: 600;
  }

  .level-track-wrap {
    height: ${LEVEL_ROW_HEIGHT}px;
    display: flex;
    align-items: center;
    cursor: pointer;
    /* The browser must not pan the page while this is being dragged; the
       dashboard's swipe-navigation is shielded separately, via stopSwipe.
       Vertical panning stays the browser's, so a scroll that starts here
       still scrolls (#27; shared/slider-intent.ts). */
    touch-action: ${unsafeCSS(SLIDER_TOUCH_ACTION)};
  }

  .level-track-wrap:focus-visible {
    outline: 2px solid var(--level-accent, var(--primary-color));
    outline-offset: 4px;
    border-radius: ${LEVEL_TRACK_RADIUS}px;
  }

  .level-track {
    position: relative;
    flex: 1;
    height: ${LEVEL_TRACK_HEIGHT}px;
    /* Everything that follows a value positions itself with this, so the
       handle, the two track halves and the stop dots cannot drift apart. */
    --level-x: calc(
      ${LEVEL_EDGE_INSET}px + var(--level-fraction) * (100% - ${LEVEL_EDGE_INSET * 2}px)
    );
  }

  .level-fill,
  .level-rest {
    position: absolute;
    top: 0;
    height: 100%;
    border-radius: ${LEVEL_TRACK_RADIUS}px;
    transition: right 0.18s ease, left 0.18s ease;
  }

  /* Active half: from the start to the handle, minus the gap. */
  .level-fill {
    left: 0;
    right: calc(100% - var(--level-x) + ${LEVEL_TRACK_GAP}px);
    background: var(--level-accent, var(--primary-color));
  }

  /* Inactive half: from the handle to the end, minus the gap. */
  .level-rest {
    left: calc(var(--level-x) + ${LEVEL_TRACK_GAP}px);
    right: 0;
    background: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
  }

  .level-stops {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .level-stop {
    position: absolute;
    left: calc(
      ${LEVEL_EDGE_INSET}px + var(--level-stop-fraction) * (100% - ${LEVEL_EDGE_INSET * 2}px)
    );
    top: 50%;
    width: ${LEVEL_STOP_SIZE}px;
    height: ${LEVEL_STOP_SIZE}px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: color-mix(in srgb, var(--primary-text-color) 30%, transparent);
  }

  /* A dot sitting on the filled half has to be legible against the accent,
     not against the card. */
  .level-stop.on-fill {
    background: color-mix(in srgb, var(--level-ink, #1c1c1c) 45%, transparent);
  }

  .level-handle {
    position: absolute;
    top: 50%;
    left: var(--level-x);
    height: ${LEVEL_HANDLE_HEIGHT}px;
    border-radius: ${LEVEL_HANDLE_RADIUS}px;
    background: var(--level-accent, var(--primary-color));
    transform: translate(-50%, -50%);
    transition:
      left 0.18s ease,
      width 0.12s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .level-fill,
    .level-rest,
    .level-handle {
      transition: none;
    }
  }
`;
