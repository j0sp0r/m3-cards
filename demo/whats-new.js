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
    en: "Navigation in motion: a tap slides the page over the way a swipe does, and the nav bar's pill can spring or stretch to the new entry, at a pace you set. Ukrainian joins German and English, and this live demo opens with it. Tap an entry in the bars below: all three pills move at once, each its own way, and the page stays.",
    de: "Navigation in Bewegung: Ein Tipp schiebt die Seite herüber wie ein Wischen, und die Pille der Navbar federt oder dehnt sich zum neuen Eintrag, im Tempo deiner Wahl. Ukrainisch kommt zu Deutsch und Englisch dazu, und diese Live-Demo startet mit dem Release. Tipp unten einen Eintrag an: Alle drei Pillen wandern gleichzeitig, jede auf ihre Art, und die Seite bleibt.",
  },
  /** Counts for the chips beside the summary; a zero hides its chip. */
  counts: { cards: 0, features: 5 },
  /**
   * @param t (en, de) => the text in the demo's language
   * @param nav (view key) => that view's path
   */
  sections: (t, nav) => {
    // Inline bars that only show the motion: their entries point below this
    // page (/new/x1 …), so a tap moves the pill — in all three at once, side
    // by side — and the page stays where it is.
    const here = nav("new");
    const entries = [
      [t("Lights", "Licht"), "mdi:lightbulb-group"],
      [t("Heat", "Heizung"), "mdi:radiator"],
      [t("Music", "Musik"), "mdi:music"],
      [t("Doors", "Türen"), "mdi:door"],
    ];
    const bar = (marker_motion) => ({
      type: "custom:m3-nav-card",
      style: "segmented",
      marker_motion,
      page_transition: "none",
      active_style: "solid",
      label_position: "right",
      icon_visibility: "active_only",
      items: entries.map(([name, icon], i) => ({
        name, icon, path: `${here}/x${i}`,
        // The first entry is the one lit on arriving at the page itself.
        ...(i === 0 ? { match: `${here.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/x0)?/?$` } : {}),
      })),
      variant: `marker_motion: ${marker_motion}`,
    });
    return [
      [t("The pill, three ways", "Die Pille, dreimal"), [bar("stretch"), bar("spring"), bar("slide")]],
      [t("Fixed in 2.11", "Behoben in 2.11"), [
        { type: "custom:m3-availability-card", variant: t("back online: off the list", "wieder online: aus der Liste") },
        { type: "custom:m3-leak-card", auto_discover: true, valve_entity: "valve.main_water", variant: t("valve shut elsewhere", "Ventil anderswo zu") },
      ]],
    ];
  },
};
