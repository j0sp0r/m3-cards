// The "New" view: what the latest release brought, shown on the pretend home.
//
// Update this with every release. `version` must match package.json — a unit
// test (src/demo-whats-new.test.ts) fails when a release bumps the version and
// this page still shows the release before.

export const WHATS_NEW = {
  version: "2.11.0",
  date: "2026-11-24",
  /** The release in a sentence or two, for the head of the page. */
  summary: {
    en: "Navigation in motion: a tap slides the page over the way a swipe does, and the nav bar's pill can spring or stretch to the new entry, at a pace you set. Ukrainian joins German and English, and this live demo opens with it. The bars below are inline nav cards: tap through them to see each marker move.",
    de: "Navigation in Bewegung: Ein Tipp schiebt die Seite herüber wie ein Wischen, und die Pille der Navbar federt oder dehnt sich zum neuen Eintrag, im Tempo deiner Wahl. Ukrainisch kommt zu Deutsch und Englisch dazu, und diese Live-Demo startet mit dem Release. Die Leisten unten sind Navbars im Kartenfluss: Tipp sie durch, um jede Bewegung zu sehen.",
  },
  /** Counts for the chips beside the summary; a zero hides its chip. */
  counts: { cards: 0, features: 5 },
  /**
   * @param t (en, de) => the text in the demo's language
   * @param nav (view key) => that view's path
   */
  sections: (t, nav) => {
    // An inline bar over four of the demo's pages, so a marker motion can be
    // tried right here: each tap moves the pill and slides to that page.
    const bar = (marker_motion) => ({
      type: "custom:m3-nav-card",
      style: "segmented",
      marker_motion,
      page_transition: "slide",
      active_style: "solid",
      label_position: "right",
      icon_visibility: "active_only",
      items: [
        { name: t("New", "Neu"), icon: "mdi:new-box", path: nav("new") },
        { name: t("Rooms", "Räume"), icon: "mdi:floor-plan", path: nav("rooms") },
        { name: t("Climate", "Klima"), icon: "mdi:thermostat", path: nav("climate") },
        { name: t("Energy", "Energie"), icon: "mdi:lightning-bolt", path: nav("energy") },
      ],
      variant: `marker_motion: ${marker_motion}`,
    });
    return [
      [t("The pill, three ways", "Die Pille, dreimal"), [bar("stretch"), bar("spring"), bar("slide")]],
      [t("Fixed along the way", "Unterwegs behoben"), [
        { type: "custom:m3-availability-card", variant: t("back online: off the list", "wieder online: aus der Liste") },
        { type: "custom:m3-leak-card", auto_discover: true, valve_entity: "valve.main_water", variant: t("valve shut elsewhere", "Ventil anderswo zu") },
      ]],
    ];
  },
};
