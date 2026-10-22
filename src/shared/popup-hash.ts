// The URL hash a popup card answers to, and how it lays out its cards.
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

/** The popup lays its cards out on twelve columns, as a sections view does. */
export const POPUP_GRID_COLUMNS = 12;

/**
 * How many of the twelve columns a card in a popup spans: its own
 * `grid_options.columns` (a number, or "full"), as a sections view reads it,
 * or the older `layout_options.grid_columns`, which counted four. A card that
 * says nothing takes the full width — a popup is one column on a phone.
 */
export function popupCardSpan(config: unknown): number {
  const c = (config ?? {}) as {
    grid_options?: { columns?: unknown };
    layout_options?: { grid_columns?: unknown };
  };
  const clamp = (n: number) => Math.min(POPUP_GRID_COLUMNS, Math.max(1, Math.round(n)));
  const columns = c.grid_options?.columns;
  if (columns === "full") return POPUP_GRID_COLUMNS;
  if (typeof columns === "number" && Number.isFinite(columns)) return clamp(columns);
  const legacy = c.layout_options?.grid_columns;
  if (legacy === "full") return POPUP_GRID_COLUMNS;
  if (typeof legacy === "number" && Number.isFinite(legacy)) return clamp(legacy * 3);
  return POPUP_GRID_COLUMNS;
}
