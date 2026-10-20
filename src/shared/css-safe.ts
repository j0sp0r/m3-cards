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

// Functions that make the browser fetch something. None of them belongs in a
// colour or a size, and all of them turn a style into an outbound request —
// which is what makes a crafted value worth crafting.
const RESOURCE_FUNCTION = /(?:^|[^\w-])(?:-webkit-|-moz-)?(?:url|src|image|image-set|cross-fade|element|paint)\s*\(/i;

// The characters that let a value stop being a value. A semicolon ends the
// declaration and starts the next one, which is the whole attack; braces and
// comments are the shapes an escape attempt takes; a backslash hides any of
// them from a plain reading; and `!important` is how a value that cannot add
// a declaration overrides one instead.
const STRUCTURAL = /[;{}!\\<>]|\/\*|\*\//;

/** Longer than any colour, size or gradient this suite writes. */
const MAX_VALUE_LENGTH = 400;

/**
 * A value fit to splice into a CSS declaration, or undefined when it is not.
 *
 * The reason this is needed on config values and not only on entity state:
 * `shared/templated-card.ts` renders Jinja2 in *any* string a card reads out
 * of its config, so `color: "{{ states('sensor.x') }}"` is a colour whoever
 * writes that entity controls. The HACS review raised this for the URL action;
 * it is equally true of the sixty-odd colour options.
 *
 * What an injected value can actually do is narrower than it looks, and the
 * limit is worth knowing. A `style` attribute holds a declaration list, not
 * rules — measured, not assumed: `red; } .victim { display: none` changes
 * nothing, because there is no rule to close. What does work is appending
 * declarations to the element carrying the style, which is enough to lay it
 * over the whole viewport or to fire a request through `url()`. Hence these
 * two rules and nothing more elaborate: no function whitelist, because
 * `calc()`, `min()`, `clamp()`, `var()` and `color-mix()` all have to keep
 * working, and the blacklist is what the attack actually needs.
 */
export function cssValue(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = String(raw).trim();
  if (!value || value.length > MAX_VALUE_LENGTH) return undefined;
  if (STRUCTURAL.test(value) || RESOURCE_FUNCTION.test(value)) return undefined;
  // Unbalanced parentheses mean the value is relying on something after it to
  // close them, which a well-formed one never does.
  let depth = 0;
  for (const c of value) {
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) return undefined;
  }
  return depth === 0 ? value : undefined;
}
