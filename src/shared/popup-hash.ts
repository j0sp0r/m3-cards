// The URL hash a popup card answers to.
//
// A popup opens when the page's hash is its own — `#remotes` — which is how
// Bubble Card's pop-ups work and why any button with `navigate: "#remotes"`
// opens one, deep links included. Back takes the hash away, so it closes too.

/** `remotes`, `#remotes` and ` #remotes ` all mean `#remotes`; nothing usable is undefined. */
export function normalizeHash(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const bare = raw.trim().replace(/^#+/, "");
  return bare ? `#${bare}` : undefined;
}

/** Whether the page's hash (`location.hash`, percent-encoded) is `hash`. */
export function hashMatches(locationHash: string, hash: string | undefined): boolean {
  if (!hash) return false;
  let current = locationHash;
  try {
    current = decodeURIComponent(locationHash);
  } catch {
    // A malformed escape is compared as it stands.
  }
  return current === hash;
}

/** The current address without its hash, for putting back after a deep link. */
export function withoutHash(loc: Pick<Location, "pathname" | "search">): string {
  return `${loc.pathname}${loc.search}`;
}
