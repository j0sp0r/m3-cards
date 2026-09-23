// Shared logic + markup/styles behind the climate cards' action-glow frame
// (see ACTION_GLOW_* constants in const.ts for the visual geometry). Both
// m3-climate-card and m3-climate-card-mini call this so the
// hvac_action/hvac_mode resolution and the glow's CSS can't drift between
// them.

import { css, html, nothing, type TemplateResult } from "lit";
import {
  ACTION_GLOW_COLOR_HEAT,
  ACTION_GLOW_COLOR_COOL,
  ACTION_GLOW_INSET_HALO_BLUR,
  ACTION_GLOW_INSET_HALO_OPACITY,
  ACTION_GLOW_INSET_BLOOM_BLUR,
  ACTION_GLOW_INSET_BLOOM_OPACITY,
  ACTION_GLOW_INSET_LINE_OPACITY,
  ACTION_GLOW_ARMED_OPACITY,
  ACTION_GLOW_OUTER_BLUR,
  ACTION_GLOW_OUTER_OPACITY,
  ACTION_GLOW_TRANSITION_MS,
} from "../const";

// hvac_action is the entity's *actual* current activity (compressor/heater
// really running right now), distinct from hvac_mode (the selected mode,
// e.g. "heat", which can sit idle between cycles). Untyped in HassEntity's
// attributes (Record<string, any>), so it is read defensively here.
export type HvacAction =
  | "heating"
  | "cooling"
  | "drying"
  | "fan"
  | "idle"
  | "off"
  | (string & {});

export type ActionGlowState = "heat" | "cool" | null;

export interface ActionGlow {
  // Which colour the frame carries, or null for no frame at all.
  state: ActionGlowState;
  // true  — the equipment is really running now (hvac_action says so, or the
  //         integration gives us nothing better than the mode to go on).
  // false — heat/cool is selected but hvac_action reports it is not running.
  //         Drawn at ACTION_GLOW_ARMED_OPACITY instead of full strength.
  running: boolean;
}

const OFF: ActionGlow = { state: null, running: false };

// Resolves what the glow should show, in two strengths.
//
// hvac_action is the truth when it says "heating"/"cooling", and that gets the
// full frame. The interesting case is hvac_action present but idle: integrations
// that derive it from the physical valve (Homematic's eTRV/HEATING, e.g.) sit at
// "idle" for months, so treating idle as "nothing to show" makes the frame dead
// weight on those systems. Instead the selected mode still lights the frame, just
// dimmed — the card keeps saying "heating is armed" while reserving full strength
// for "heating is happening".
//
// When the attribute is missing entirely there is nothing better to go on, so the
// mode alone gets the full frame rather than permanently dimming those entities.
export function resolveActionGlow(
  attrs: Record<string, unknown>,
  currentMode: string,
  unavailable: boolean,
): ActionGlow {
  if (unavailable) return OFF;

  const hvacAction = attrs.hvac_action as HvacAction | undefined;
  if (hvacAction === "heating") return { state: "heat", running: true };
  if (hvacAction === "cooling") return { state: "cool", running: true };

  const mode: ActionGlowState =
    currentMode === "heat" ? "heat" : currentMode === "cool" ? "cool" : null;
  if (mode === null) return OFF;

  return { state: mode, running: hvacAction === undefined };
}

// The color the glow layer should use for the given state, resolved to the
// suite's existing heat/cool palette (the same hexes DEFAULT_MODE_COLORS
// already uses for mode pills/icons), so the glow reads as one accent system
// with the rest of the card rather than a competing color.
export function actionGlowColor(state: ActionGlowState): string {
  return state === "heat" ? ACTION_GLOW_COLOR_HEAT : ACTION_GLOW_COLOR_COOL;
}

// Structural CSS for the glow layer: an absolutely positioned overlay,
// inheriting the card's own border-radius, carrying three stacked box-shadow
// falloffs (crisp inset line → soft inward bloom → faint outward halo) that
// only become visible once `--m3-action-glow-color` is set and `.active` is
// toggled on. Include as an array element of a card's `static styles`
// alongside its own block.
export const actionGlowStyles = css`
  .action-glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    /* No z-index: it must paint below the card's real content, which relies
       on default stacking (later DOM siblings paint on top of earlier ones
       at the same stacking level) since this element is rendered first. */
    box-shadow:
      inset 0 0 0 1.5px var(--m3-action-glow-color, transparent),
      inset 0 0 ${ACTION_GLOW_INSET_BLOOM_BLUR}px 0
        color-mix(in srgb, var(--m3-action-glow-color, transparent) ${ACTION_GLOW_INSET_BLOOM_OPACITY * 100}%, transparent),
      inset 0 0 ${ACTION_GLOW_INSET_HALO_BLUR}px 0
        color-mix(in srgb, var(--m3-action-glow-color, transparent) ${ACTION_GLOW_INSET_HALO_OPACITY * 100}%, transparent),
      0 0 ${ACTION_GLOW_OUTER_BLUR}px 0
        color-mix(in srgb, var(--m3-action-glow-color, transparent) ${ACTION_GLOW_OUTER_OPACITY * 100}%, transparent);
    transition: opacity ${ACTION_GLOW_TRANSITION_MS}ms cubic-bezier(0.2, 0, 0, 1);
  }

  .action-glow.active {
    opacity: ${ACTION_GLOW_INSET_LINE_OPACITY};
  }

  /* Higher specificity than .active above, so "armed but not running" wins
     without needing !important or a separate colour. */
  .action-glow.active.armed {
    opacity: ${ACTION_GLOW_ARMED_OPACITY};
  }

  .card-inner.no-animations .action-glow {
    transition: none;
  }
`;

// The glow layer's markup — an inert, ARIA-hidden div; state is carried
// entirely by CSS custom properties/classes rather than per-state markup, so
// it fades between heat/cool/off with one transition instead of swapping
// elements. Render as the first child of the card's `position: relative`
// surface (e.g. `.card-inner`) so `inset: 0` and `border-radius: inherit`
// resolve against that surface, not the whole host.
export function renderActionGlow(
  glow: ActionGlow,
  enabled: boolean | undefined,
): TemplateResult | typeof nothing {
  if (enabled === false) return nothing;
  const { state, running } = glow;
  return html`
    <div
      class="action-glow ${state ? "active" : ""} ${state && !running ? "armed" : ""}"
      style=${state ? `--m3-action-glow-color: ${actionGlowColor(state)};` : ""}
      aria-hidden="true"
    ></div>
  `;
}
