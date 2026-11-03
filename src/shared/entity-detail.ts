import type { DetailMode, DetailModeConfig } from "../types";

// The one door to an entity's detail view.
//
// Every card opens "details" through here instead of firing `hass-more-info`
// itself, so what that means is decided in one place: Home Assistant's
// more-info dialog by default, the suite's own detail sheet for a card whose
// config says `detail_mode: sheet`. `entity-detail.test.ts` fails if a card
// goes back to dispatching the event directly.
//
// The sheet is not imported here. It is a Lit element that pulls in a whole
// card, and this module sits under actions.ts and templated-card.ts — the
// first loaded by the unit tests in plain node with no DOM, the second the
// base of the very card the sheet shows, which would make the import a cycle
// that breaks at load. So the sheet registers itself on import
// (shared/detail-sheet.ts, pulled in by index.ts) and this only calls whatever
// registered.

export interface DetailSheetHooks {
  /** Opens the sheet for `entityId`, or answers false if it cannot show it. */
  open: (host: HTMLElement, entityId: string) => boolean;
  /** A new `hass` for the card's sheet, if it has one. */
  forward: (host: HTMLElement, hass: unknown) => void;
  /** The card is leaving the page. */
  close: (host: HTMLElement) => void;
}

let sheet: DetailSheetHooks | undefined;

export function registerDetailSheet(hooks: DetailSheetHooks): void {
  sheet = hooks;
}

/** templated-card.ts calls these two for every card; both are no-ops without a sheet. */
export function forwardHassToSheet(host: HTMLElement, hass: unknown): void {
  sheet?.forward(host, hass);
}

export function closeSheetOf(host: HTMLElement): void {
  sheet?.close(host);
}

/**
 * The card's `detail_mode`. Every card keeps its config in a private
 * `_config`, typed per card; the ones that open details extend
 * `DetailModeConfig`. A hand-written YAML value is still checked, since
 * anything other than "sheet" means Home Assistant's own dialog.
 */
export function detailModeOf(host: EventTarget): DetailMode {
  const mode: unknown = (host as { _config?: DetailModeConfig })._config?.detail_mode;
  return mode === "sheet" ? "sheet" : "more_info";
}

export function openEntityDetail(host: EventTarget, entityId: string | undefined): void {
  if (!entityId) return;
  // An entity the sheet cannot show yet goes to more-info rather than to an
  // empty sheet, so turning the option on never makes a tap worse.
  if (sheet && detailModeOf(host) === "sheet" && sheet.open(host as HTMLElement, entityId)) return;
  fireMoreInfo(host, entityId);
}

/**
 * Home Assistant's settings page for the entity — name, icon, area, display
 * precision. Only the more-info dialog has it, so this always goes there.
 */
export function openEntitySettings(host: EventTarget, entityId: string | undefined): void {
  if (!entityId) return;
  fireMoreInfo(host, entityId, "settings");
}

function fireMoreInfo(host: EventTarget, entityId: string, view?: string): void {
  host.dispatchEvent(
    new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: view ? { entityId, view } : { entityId },
    }),
  );
}
