// The one door to an entity's detail view.
//
// Every card opens "details" through here instead of firing `hass-more-info`
// itself, so what that means is decided in one place. Today it is always Home
// Assistant's more-info dialog; the suite's own detail sheet will hang off this
// function, not off forty call sites. `entity-detail.test.ts` fails if a card
// goes back to dispatching the event directly.
export function openEntityDetail(host: EventTarget, entityId: string | undefined): void {
  if (!entityId) return;
  host.dispatchEvent(
    new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }),
  );
}
