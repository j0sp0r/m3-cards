import { css, html, nothing, type TemplateResult } from "lit";
import { activateOnKey } from "./a11y";

// Shared header row used by the M3 data cards (energy, gauge): a 44px/16px
// squircle icon, a name + subtitle text block, and an optional right-aligned
// slot (e.g. the energy card's big "today" value).
export function renderCardHeader(params: {
  icon: string;
  name: string;
  subtitle: string;
  onClick?: (e: Event) => void;
  /**
   * Gives the icon swatch its own action, separate from the rest of the header
   * — the split the native tile card makes, where the icon toggles and the body
   * opens more-info. Without it the swatch is decoration and the whole header
   * runs `onClick`.
   */
  onIconClick?: (e: Event) => void;
  iconLabel?: string;
  right?: TemplateResult;
  /**
   * A CSS `url(...)` (from `cssUrl`) drawn in the swatch instead of the icon —
   * a cut-out picture of the car rather than a glyph for one.
   */
  image?: string;
}): TemplateResult {
  const interactive = !!params.onClick;
  const iconInteractive = !!params.onIconClick;
  // Stops the header's own action running as well when the icon is its own
  // button — a tap meant as "toggle" would otherwise also open more-info.
  const onIconClick = params.onIconClick
    ? (e: Event) => {
        e.stopPropagation();
        params.onIconClick!(e);
      }
    : undefined;
  return html`
    <div
      class="m3-header"
      role=${interactive ? "button" : nothing}
      tabindex=${interactive ? "0" : nothing}
      aria-label=${interactive ? params.name : nothing}
      @click=${params.onClick}
      @keydown=${interactive && params.onClick ? activateOnKey(params.onClick) : nothing}
    >
      <div
        class="m3-icon-swatch ${iconInteractive ? "interactive" : ""} ${params.image ? "has-image" : ""}"
        style=${params.image ? `background-image: ${params.image};` : nothing}
        role=${iconInteractive ? "button" : nothing}
        tabindex=${iconInteractive ? "0" : nothing}
        aria-label=${iconInteractive ? (params.iconLabel ?? params.name) : nothing}
        @click=${onIconClick}
        @keydown=${onIconClick ? activateOnKey(onIconClick) : nothing}
      >
        ${params.image ? nothing : html`<ha-icon icon=${params.icon}></ha-icon>`}
      </div>
      <div class="m3-text-block">
        <div class="m3-name">${params.name}</div>
        <div class="m3-subtitle">${params.subtitle}</div>
      </div>
      ${params.right ?? nothing}
    </div>
  `;
}

export const cardHeaderStyles = css`
  .m3-header {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
  }

  .m3-header:focus-visible {
    outline: 2px solid var(--m3p-icon-color, var(--primary-color));
    outline-offset: 2px;
    border-radius: 8px;
  }

  .m3-icon-swatch {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--m3p-icon-bg);
    color: var(--m3p-icon-color);
  }

  .m3-icon-swatch.has-image {
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
  }

  .m3-icon-swatch ha-icon {
    --mdc-icon-size: 22px;
  }

  /* Only when the swatch does something on its own — otherwise it is part of
     the header and inherits its cursor. */
  .m3-icon-swatch.interactive {
    cursor: pointer;
    transition: transform 120ms ease;
  }

  .m3-icon-swatch.interactive:active {
    transform: scale(0.92);
  }

  .m3-icon-swatch.interactive:focus-visible {
    outline: 2px solid var(--m3p-icon-color, var(--primary-color));
    outline-offset: 2px;
  }

  .m3-text-block {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .m3-name {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--m3p-text);
  }

  .m3-subtitle {
    font-size: 12px;
    opacity: 0.65;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--m3p-secondary-text);
  }
`;
