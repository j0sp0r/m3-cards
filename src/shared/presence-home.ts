// `home_zone` on the presence card: another zone stands in for home.
//
// A person's state is "home", "not_home", or the name of the zone they are in.
// With a home zone set, being in that zone reads as "home", and being at Home
// Assistant's own home reads as a zone by that zone's name.

/** The state as the card should read it, given the home zone's name (if any). */
export function presenceStateFor(state: string, homeZoneName: string | undefined, mainHomeName: string): string {
  if (homeZoneName === undefined) return state;
  if (state === homeZoneName) return "home";
  if (state === "home") return mainHomeName;
  return state;
}

/**
 * The name a person's state carries in the configured `home_zone`: the zone's
 * friendly name for a `zone.*` id, the value itself for a plain name.
 * Undefined means Home Assistant's own home, as without the option.
 */
export function homeZoneName(zone: string | undefined, friendlyName: (id: string) => string | undefined): string | undefined {
  if (!zone || zone === "zone.home") return undefined;
  if (!zone.startsWith("zone.")) return zone;
  return friendlyName(zone);
}
