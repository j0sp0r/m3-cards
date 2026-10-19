// Values that come from Home Assistant and end up inside a `style` attribute.
//
// An inline style is parsed as CSS, so a value spliced into one can close the
// declaration it sits in and open its own. The values at risk here are not
// typed by the user: `entity_picture` and a media thumbnail come from the
// integration, and an entity's state comes from whatever writes it — which on
// a shared instance is not necessarily the person looking at the card. Raised
// in the HACS review.

/**
 * A picture URL fit to load, resolved against the page, or undefined when it
 * is not one. Separate from `cssUrl` because the same check is worth making
 * where the value is handed to an image loader rather than to CSS: a `data:`
 * payload is pointless there and `startsWith("http")` is not a scheme test.
 */
export function safeImageUrl(raw: string | null | undefined, base?: string): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw, base ?? window.location.href);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
}

/**
 * A URL fit to put inside `url(...)`, already quoted, or undefined when it is
 * not fit to use at all.
 *
 * Two gates, because they catch different things. The scheme check keeps
 * `javascript:` and `data:` out of a background-image. The escaping keeps a
 * value that *is* a picture path from ending the declaration: a quote, a
 * parenthesis, a backslash or a newline in the string would otherwise let it
 * add rules of its own.
 */
export function cssUrl(raw: string | null | undefined, base?: string): string | undefined {
  const href = safeImageUrl(raw, base);
  if (!href) return undefined;
  const url = { href };
  // url.href is already percent-encoded for most of this; the backslash and
  // the quote are escaped rather than trusted, so the result cannot leave the
  // quoted string whatever a future URL implementation decides to leave alone.
  const escaped = url.href.replace(/[\\"]/g, (c) => `\\${c}`);
  return `url("${escaped}")`;
}

/**
 * An entity state or domain fit to appear in a CSS custom property *name*
 * (`--state-<domain>-<state>-color`). A name is not a string, so it cannot be
 * quoted — the only safe move is to allow nothing that could end it. States
 * are snake_case by convention; anything else is not a state we have a
 * variable for anyway, so dropping those characters costs nothing.
 */
export function cssIdent(raw: string | undefined): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "");
}
