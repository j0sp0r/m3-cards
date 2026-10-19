import type { HaActionConfig, HomeAssistant } from "../types";

// The tap/hold/double-tap action config every Lovelace card understands, run
// from one place.
//
// The button card has carried its own copy of this since it was the only card
// that needed more than `more-info`. The status card needs the same seven
// branches — toggle above all, which is what makes a "medication given" card
// tappable — so the logic moved here rather than being written twice. The
// button card still has its own copy; it is the most-used card in the suite and
// not worth destabilising for a refactor, but it should adopt this next time it
// is touched.

/**
 * The URL a `url` action may open, or undefined when it may not be opened.
 *
 * `window.open("javascript:…")` runs its payload in the page's own context,
 * with the user's session. That matters here because a card resolves
 * templates anywhere in its config, so `url_path` can be built from an
 * entity's state — and an entity another person can write to then chooses
 * what gets executed. A link is allowed to point anywhere on the web; it is
 * not allowed to stop being a link.
 *
 * So the value is resolved against the current page and kept only if it comes
 * out as http(s). That accepts an absolute URL, a same-origin path and a
 * protocol-relative one, and rejects `javascript:`, `data:`, `vbscript:`,
 * `file:` and anything else a scheme can be.
 */
export function safeActionUrl(raw: string, base?: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw, base ?? window.location.href);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
}

/** Opens a `url` action's target, or does nothing if it is not openable. */
export function openActionUrl(raw: string | undefined, newTab: boolean): void {
  if (!raw) return;
  const href = safeActionUrl(raw);
  if (!href) return;
  window.open(href, newTab ? "_blank" : "_self");
}

function fireMoreInfo(source: HTMLElement, entityId?: string): void {
  if (!entityId) return;
  source.dispatchEvent(
    new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }),
  );
}

function navigate(source: HTMLElement, path: string): void {
  window.history.pushState(null, "", path);
  source.dispatchEvent(
    new CustomEvent("location-changed", {
      bubbles: true,
      composed: true,
      detail: { replace: false },
    }),
  );
}

/**
 * Runs one action.
 *
 * `entityId` is the entity the action defaults to — the more-info target, the
 * toggle target, and the `entity_id` passed to a service that names no target
 * of its own. An action with no entity behind it (a `navigate`, or a service
 * call with an explicit target) works fine without one.
 */
/**
 * Honours an action's `confirmation`, which Home Assistant's own action editor
 * offers and which this handler used to ignore — so a "restart Home Assistant"
 * action ran on the first tap, which is the one case it was configured not to.
 *
 * A native confirm is deliberate rather than a styled dialog: it is synchronous,
 * so the decision cannot race the action, and it works identically in every
 * context a card renders in. Home Assistant's own dialog is not reachable from
 * a custom card without depending on frontend internals.
 */
function confirmed(action: HaActionConfig): boolean {
  const confirmation = action.confirmation;
  if (!confirmation) return true;
  const text =
    typeof confirmation === "object" && confirmation.text
      ? confirmation.text
      : "Are you sure?";
  return window.confirm(text);
}

export function handleAction(
  source: HTMLElement,
  hass: HomeAssistant | undefined,
  action: HaActionConfig | undefined,
  entityId?: string,
): void {
  if (!hass) return;
  const cfg = action ?? { action: "more-info" as const };
  if (!confirmed(cfg)) return;

  switch (cfg.action) {
    case "none":
      return;
    case "toggle":
      if (!entityId) return;
      hass.callService("homeassistant", "toggle", { entity_id: entityId });
      return;
    case "more-info":
      fireMoreInfo(source, entityId);
      return;
    case "call-service":
    case "perform-action": {
      const serviceStr = cfg.perform_action ?? cfg.service;
      if (!serviceStr) return;
      const [domain, service] = serviceStr.split(".");
      if (!domain || !service) return;
      hass.callService(domain, service, {
        // An explicit target replaces the implied entity rather than joining
        // it: `homeassistant.turn_off` with a target list plus the card's own
        // entity would switch off one more thing than the config asked for.
        ...(cfg.target ? {} : entityId ? { entity_id: entityId } : {}),
        ...(cfg.target ?? {}),
        ...(cfg.data ?? cfg.service_data ?? {}),
      });
      return;
    }
    case "navigate":
      if (cfg.navigation_path) navigate(source, cfg.navigation_path);
      return;
    case "url":
      openActionUrl(cfg.url_path, cfg.new_tab !== false);
      return;
    default:
      return;
  }
}

/** Whether an action would do nothing, so a card can skip the pointer affordances. */
export function isActionable(action: HaActionConfig | undefined): boolean {
  return (action?.action ?? "more-info") !== "none";
}

export interface RunActionContext {
  /** Default `entity_id` target for toggle/perform-action/more-info, when the
   * action config itself doesn't set one. */
  entityId?: string;
  /** Overrides the default `homeassistant.toggle` on `entityId` — e.g. a room
   * tile toggles an explicit list of light entities rather than one entity. */
  toggle?: () => void;
  /** Handles the "popup" action kind (see shared/popup-card.ts). A "popup"
   * action no-ops if this is unset, same as any action a card doesn't wire up. */
  openPopup?: () => void;
  fireMoreInfo: (entityId?: string) => void;
  navigate: (path: string) => void;
}

// Executes a standard HaActionConfig the same way every M3 card's tap/hold/
// double-tap handler wants to: toggle/more-info/perform-action/navigate/url,
// plus the two hooks (toggle/openPopup) a card supplies for the parts that
// aren't generic. Extracted from m3-button-card's inline _handleAction, which
// keeps its own copy rather than migrating onto this (see the lights-overview
// modularization plan) — behavior here matches it exactly for the cases both
// share. Distinct from handleAction() above (upstream's version, used by the
// heading/room/status cards): this one adds the "popup" action kind and lets
// a card override what "toggle" does, which climate-overview and
// lights-overview both need for a tile that represents more than one entity.
export function runHaAction(
  hass: HomeAssistant,
  action: HaActionConfig | undefined,
  ctx: RunActionContext,
): void {
  const cfg = action ?? { action: "more-info" };
  // Same confirmation gate handleAction() applies — a "popup" or overridden
  // "toggle" is no less worth confirming than a service call.
  if (!confirmed(cfg)) return;
  switch (cfg.action) {
    case "none":
      return;
    case "toggle":
      if (ctx.toggle) {
        ctx.toggle();
        return;
      }
      if (!ctx.entityId) return;
      hass.callService("homeassistant", "toggle", { entity_id: ctx.entityId });
      return;
    case "more-info":
      ctx.fireMoreInfo(ctx.entityId);
      return;
    case "popup":
      ctx.openPopup?.();
      return;
    case "call-service":
    case "perform-action": {
      const serviceStr = cfg.perform_action ?? cfg.service;
      if (!serviceStr) return;
      const [domain, service] = serviceStr.split(".");
      if (!domain || !service) return;
      hass.callService(domain, service, {
        ...(cfg.target ? {} : ctx.entityId ? { entity_id: ctx.entityId } : {}),
        ...(cfg.target ?? {}),
        ...(cfg.data ?? cfg.service_data ?? {}),
      });
      return;
    }
    case "navigate":
      if (cfg.navigation_path) ctx.navigate(cfg.navigation_path);
      return;
    case "url":
      openActionUrl(cfg.url_path, cfg.new_tab !== false);
      return;
    default:
      return;
  }
}

// Standard navigate() implementation — pushes history state and fires the
// location-changed event HA's frontend listens for. Identical across every
// card that implements the "navigate" action.
export function navigateTo(host: EventTarget, path: string): void {
  window.history.pushState(null, "", path);
  host.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true, detail: { replace: false } }));
}
