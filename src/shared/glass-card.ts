import { css, html, type TemplateResult } from "lit";

// Shared M3 card frame: the "glass" translucent/blurred background used by
// every card in this project, plus the "solid" theme-background fallback.
// Cards import this once instead of redefining ha-card/.card-inner rules.
// The frosted-glass surface, as one value so the three cards that build their
// own card CSS (button, climate, climate-mini) cannot drift from it.
//
// Mixed from the card *surface* colour, not the text colour. HA already hands
// every card theme-correct variables — the surface is light in a light theme
// and dark in a dark one — so tinting with it is self-correcting and needs no
// theme detection. Tinting with the text colour, as this did before, inverts
// that: in a light theme it darkened the backdrop that dark text then had to
// sit on, which made every card unreadable over a dark dashboard wallpaper.
//
// 55% keeps the backdrop visible through the blur while still establishing a
// ground of its own, so legibility no longer depends on what is behind the
// dashboard — something the card cannot see.
export const glassBackground = css`color-mix(
  in srgb,
  var(--ha-card-background, var(--card-background-color)) 55%,
  transparent
)`;

export const glassCardStyles = css`
  :host {
    display: block;
    height: 100%;
    /* The browser paints a grey rectangle over whatever is tapped, and it does
       not follow the border radius — on a rounded card it appears as a box
       sticking out past the corner, only while the finger is down. It also
       fights the press feedback this suite actually uses, which is the radius
       morph. Reported on the room card's header; every card has the same
       problem wherever it is tappable. */
    -webkit-tap-highlight-color: transparent;
  }

  /* The frame is .card-inner's border. ha-card draws one of its own from
     --ha-card-border-width, 1px unless the theme turns it off, and a popup
     sets it on purpose for Home Assistant's cards: on an M3 card that was a
     second rim outside the first, whose corners the clip then cut off. */
  ha-card {
    height: 100%;
    overflow: hidden;
    box-shadow: none;
    background: transparent;
    border: none;
  }

  .card-inner {
    box-sizing: border-box;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* --m3-group-padding/-border/-background/-backdrop-filter are set by
       m3-group-card on the container it holds its children in. They cross
       into this shadow root the same way HA's own theme variables do (custom
       properties inherit through shadow boundaries), so a card nested in a
       group loses its own frame without any change to the card itself —
       every card outside a group keeps the fallback below unchanged. Padding
       goes to 0 in a group: the group's own gap setting is then the only
       thing controlling space between rows, so gap: 0 means rows truly
       touch instead of still carrying each card's own standalone padding. */
    padding: var(--m3-group-padding, 12px);
    border: var(--m3-group-border, 1px solid rgba(100, 100, 100, 0.25));
  }

  .card-inner.glass {
    background: var(--m3-group-background, ${glassBackground});
    backdrop-filter: var(--m3-group-backdrop-filter, blur(20px));
    -webkit-backdrop-filter: var(--m3-group-backdrop-filter, blur(20px));
    /* Forces its own compositor layer. Without this, Chromium sometimes
       renders a visible seam where two adjacent backdrop-filter elements'
       GPU tiles meet (flickers/disappears on scroll-triggered repaint) —
       a known browser tiling bug, not a layout issue on our end. */
    transform: translateZ(0);
    isolation: isolate;
  }

  .card-inner.solid {
    background: var(--m3-group-background, var(--ha-card-background, var(--card-background-color)));
  }

  .missing-entity {
    padding: 16px;
    color: var(--error-color, red);
    font-size: 14px;
  }
`;

// Resolves the "glass" vs "solid" class from a card config's
// glass_background option (defaults to glass, matching every card so far).
export function glassCardClass(glassBackground: boolean | undefined): string {
  return glassBackground === false ? "solid" : "glass";
}

// Standard "entity not found" fallback, used identically by every card when
// its configured entity is missing from hass.states.
export function renderMissingEntity(entityId: string): TemplateResult {
  return html`
    <ha-card>
      <div class="card-inner glass">
        <div class="missing-entity">${entityId}: entity not found</div>
      </div>
    </ha-card>
  `;
}
