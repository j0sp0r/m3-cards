# Contributing

Thanks for looking at this. The repo is one bundle — `dist/m3-cards.js` —
registering every card in `src/`, built with Lit and TypeScript, with `lit` as
the only runtime dependency. No dependency on `button-card`, `card-mod`,
`mod-card` or `stack-in-card`: every card is a plain Lit custom element.

Issues and pull requests are welcome in English or German. Code, comments,
commit messages, the changelog and the card documentation are in English.

## Setup

```bash
npm install
npm run dev     # watch build to dist/m3-cards.js
npm run build   # production bundle
npm run lint    # tsc --noEmit && eslint src
npm test        # vitest
npm run docs    # regenerates README.md — never edit README.md by hand
```

To test locally, copy `dist/m3-cards.js` into Home Assistant's `config/www/`
and register it as a Lovelace resource (`/local/m3-cards.js`, type "JavaScript
module"). `docs/TESTING.md` is the manual QA checklist used before releases.

CI runs lint, the unit tests, the build, and `npm run docs` followed by
`git diff --exit-code`. That last one is what enforces "README.md is
generated": a dirty tree means someone edited it directly, or a card page
drifted from it.

So the mechanics are covered by the machine. What follows are the things it
cannot check — the conventions this suite is held together by. They are not
style preferences; each one is here because the alternative broke something.

## Card anatomy

**Every card class is declared as
`extends TemplatedCard(LitElement) implements LovelaceCard`**
(`src/shared/templated-card.ts`). That is what gives its config fields Jinja2
support; a new card gets it by using the same declaration and needs nothing
else — it goes on reading `this._config`, which arrives resolved.

**Shared behaviour lives in `src/shared/`** — wave-slider geometry, list-row
animation, card header, corner-radius editor, appearance editor panel, colour
resolver, design tokens. Reuse it before adding a new abstraction.

**Config field names stay consistent across cards** where the concept is the
same: `animation: auto | on | off`, `card_background`, `radius` / `corners`.

**Each card writes its own `card_version` into the config** so future config
migrations can be detected reliably (`src/shared/config-migration.ts`).

**Every card implements `shouldUpdate`.** Use `hassChangeMatters` from
`shared/should-update.ts`, or `discoveryChangeMatters` when the card finds its
own entities. Name *every* entity the render path reads — an under-declared
list means the card silently stops reacting to one of its sensors, which is a
bug nobody reports because it looks like Home Assistant being slow. If you
write the predicate by hand, let a `themes` change through, or an off-screen
card keeps the old theme's colours.

## Look and feel

**Icons are always `ha-icon`, never inline SVG.** The icon set, the sizing and
the theme colour all come with it. Dark ink on an accent fill is `#1c1c1c`,
not black.

**Colour goes through `src/shared/color-config.ts`.** The helpers are not
interchangeable, and picking the wrong one produces something that looks fine
on the theme you are using and fails on the other:

| Helper | For |
| --- | --- |
| `foregroundColor` | an accent used as text on the card surface |
| `foregroundOn` | text on another, known surface |
| `tintOn` | a mixed fill derived from an accent |
| `fillColor` | a solid data fill |
| `tintInk` | ink on a tint |
| `inkOn` | choosing dark ink or white on a solid fill |

They measure against the real surface rather than assuming one. A hand-rolled
`color-mix(…, var(--primary-color) 18%, transparent)` with `--primary-color`
as its ink is the combination that usually fails on a light theme.

**Per-card numbers live in `src/const.ts`, derived from the scale in
`shared/tokens.ts`.** Radii, row heights, spacing and durations are shared on
purpose: `RADIUS.row` / `RADIUS.rowActive` is the press-morph pair every card
uses, `DURATION_MS.roll` is the one roll duration. A new constant that happens
to equal one of those should be that one. If a card genuinely needs a new
step, add it to `tokens.ts` with a line on why.

**A card's glass background belongs on `.card-inner`, not on `ha-card`,** and
its colour is applied inline only when one is configured. Copy the shell from
an existing card rather than building a new one.

**All animation respects `prefers-reduced-motion`,** in addition to the
per-card `animation` override via `shouldAnimate(config.animation)`.

## Accessibility

**All interactive elements need `role="button"`, `tabindex`, `aria-label` and
keyboard activation** (Enter/Space) via `src/shared/a11y.ts`.

**To remove an attribute conditionally, use Lit's `nothing`.** `undefined`
does not remove it — lit-html commits `setAttribute(name, value ?? '')`, so
`aria-haspopup=${open ? "listbox" : undefined}` lands as `aria-haspopup=""`.

**User-facing strings go in `src/localize.ts`, in both `de` and `en`.** Add the
Ukrainian wording in `src/translations/uk.ts` when available. Check for an
existing key first and keep placeholder names the same across languages.

## Two traps worth knowing

**SVG children written inside a nested template need Lit's `` svg` `` tag,**
not `` html` ``. Under `html` they are created as unknown HTML elements: the
attributes are set, the CSS matches, and nothing is painted.

**Dialogs.** Several cards open their own `<dialog>`, which has two
consequences that are easy to miss:

- A modal dialog lives in the browser's **top layer, outside `ha-card`**, so
  CSS custom properties set inline on the card do not reach it. Pass the
  colours to the dialog's own element instead.
- `showModal()` moves focus into the dialog, and on close the browser returns
  focus to whatever had it before **and scrolls that into view**. On a phone a
  tap often focuses nothing, so "whatever had it before" can be two screens
  away, and closing the dialog throws the dashboard there. Park focus first —
  `anchorFocus()` in `shared/focus-anchor.ts` does it without scrolling.
  `installFocusAnchor` only covers Home Assistant's own more-info dialog; a
  dialog you open yourself is yours to anchor.

## Documentation

- **`docs/cards/<card>.md`** is the source for that card's README section.
  It needs the frontmatter block (`title`, `type`, `category`, `display`,
  `summary`, `table_order`, `section_order`) — copy an existing one. Images
  are referenced as `docs/images/…`, relative to the generated README, not to
  the card page. Run `npm run docs` afterwards.
- **`docs/TESTING.md`** is the manual test matrix, in German. Anything that
  can only be checked by hand — a new option, a new gesture, a visual state —
  gets a row: what to set, and what you should then see.
- **`CHANGELOG.md`** gets an entry under `## [Unreleased]`, in English, under
  Added / Changed / Fixed. Say what was wrong before, not only what is new.

Versions, tags and releases are the maintainer's: don't bump the version or
write release notes in a PR.

## Pull requests

Run `npm run lint`, `npm test` and `npm run build` before opening one, and
test the change in a real Home Assistant dashboard — type checking alone
doesn't catch rendering or interaction issues. The PR template has the full
checklist.

Review looks beyond correctness: both themes, phone width, the card at its
smallest configured size, keyboard focus and screen-reader labels, and that an
unavailable entity still renders something sane. New runtime dependencies need
a reason — there is exactly one today. Pull requests are also read for
supply-chain risk, so changes to `package.json`, lockfiles, CI workflows or
build config are reviewed on their own terms rather than as part of a feature.

Manual testing happens on real hardware before anything is released, so a PR
that cannot be exercised here may sit until the matching device exists. Saying
in the PR what you tested it against is the fastest way past that.
