// Dashboard-wide swipe plugins (hass-swipe-navigation and friends) listen for
// touch and mouse drags on an ancestor of the card, in the bubble phase. A
// drag on a slider/wheel is setting a value, never navigation, so it must be
// kept from reaching them — a flick with any sideways drift would otherwise
// change the view out from under the value being set. Verified against
// hass-swipe-navigation 1.16.0: its listeners sit on haAppLayout with no
// capture flag, so stopping propagation in the bubble phase is enough.
//
// Wire on any draggable control as:
//   @touchstart=${stopSwipe} @touchmove=${stopSwipe} @touchend=${stopSwipe}
//   @mousedown=${stopSwipe}  @mousemove=${stopSwipe} @mouseup=${stopSwipe}
// Note: touch-action:none only stops the browser's own panning, not these
// JS listeners — this is the piece that actually shields the plugin.
//
// Shield the whole gesture, not just its start. The plugin decides on touchend,
// and that handler reads no event: it acts on the start and movement it recorded
// before. Swallow the start and let the end through and it decides using
// whatever it last recorded somewhere else on the page — which is worse than not
// shielding it at all, because the gesture it acts on is one the user never made
// here.
//
// hass-swipe-navigation 1.16.3 (installed through HACS on 2026-11-16 on the
// author's instance) moved its listeners to the capture phase, so they run
// before any card sees the event and stopping it here comes too late: a swipe
// along the nav bar changed the view twice, once each way. What it still
// honours is its own list of elements to leave alone, matched against every
// element on the event's path below the view — and one entry there is the
// plain class `swiper`. Every drag zone that binds `stopSwipe` therefore also
// carries `SWIPE_PLUGIN_SKIP` in its class list; `stopSwipe` stays for the
// plugin's older versions and for the other plugins that listen in the bubble
// phase. Our own handlers are untouched either way.
export const SWIPE_PLUGIN_SKIP = "swiper";

export function stopSwipe(e: Event): void {
  e.stopPropagation();
}
