import { LitElement, html, css, nothing, unsafeCSS, type TemplateResult } from "lit";
import { STANDARD_EASING } from "./animation";

// Shared dropdown/select menu for every card that needs a "pick one of these"
// control (climate mode + preset today, more to come).
//
// Why this is a body-level portal and not just an absolutely positioned div
// inside the card: `.card-inner.glass` (shared/glass-card.ts) sets
// `backdrop-filter` and `transform: translateZ(0)`. Both make the card a
// *containing block* for fixed descendants and a *stacking context*, so a
// menu rendered inside the card can neither escape `ha-card`'s
// `overflow: hidden` nor paint above a card that comes later in the
// dashboard's DOM — no z-index inside the card can win against a sibling
// card's stacking context. The menu therefore lives in its own element
// appended to `document.body` and opens as a modal `<dialog>`, which puts it
// in the browser's *top layer*: above every card, above HA's own dialogs, and
// unclipped by any ancestor. Escape/outside-tap dismissal come for free.
//
// Only one menu is open at a time; the element is a lazily created singleton.

const TAG = "m3-dropdown-menu";

// Distance between the anchor button and the menu, and the minimum gap the
// menu keeps to the viewport edge before it flips or clamps.
const GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

// Theme variables the menu paints with. HA normally sets these on the
// document root (where a body-level element inherits them anyway), but a
// view- or card-scoped theme sets them further down, where this portal would
// not see them — so they are copied from the anchor's computed style at open
// time. That makes the menu match the card it belongs to, wherever the theme
// was applied.
const THEME_VARS = [
  "--primary-text-color",
  "--secondary-text-color",
  "--primary-color",
  "--card-background-color",
  "--ha-card-background",
  "--primary-background-color",
] as const;

export interface DropdownMenuItem {
  value: string;
  label: string;
  icon?: string;
  selected?: boolean;
}

export interface DropdownMenuOptions {
  // The button the menu belongs to: it supplies the position, the minimum
  // width and the theme context.
  anchor: HTMLElement;
  items: DropdownMenuItem[];
  onSelect: (value: string) => void;
  // Called whenever the menu closes, for whatever reason (selection, Escape,
  // outside tap) — hosts use it to reset their own `aria-expanded` state.
  onClose?: () => void;
  label?: string;
}

interface Box {
  width: number;
  height: number;
}

interface AnchorRect extends Box {
  top: number;
  left: number;
}

export type DropdownPlacement = "below" | "above";

// Pure geometry, kept separate from the element so it is unit-testable:
// prefer below the anchor, flip above when it doesn't fit, clamp into the
// viewport either way, and centre horizontally on the anchor.
export function positionDropdown(
  anchor: AnchorRect,
  menu: Box,
  viewport: Box,
  gap: number = GAP_PX,
  margin: number = VIEWPORT_MARGIN_PX,
): { left: number; top: number; placement: DropdownPlacement } {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - menu.height;
  const fitsBelow = below + menu.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  const placement: DropdownPlacement = fitsBelow || !fitsAbove ? "below" : "above";

  const maxTop = Math.max(margin, viewport.height - margin - menu.height);
  const top = Math.min(Math.max(placement === "below" ? below : above, margin), maxTop);

  const maxLeft = Math.max(margin, viewport.width - margin - menu.width);
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - menu.width / 2, margin),
    maxLeft,
  );

  return { left, top, placement };
}

export class M3DropdownMenu extends LitElement {
  private _items: DropdownMenuItem[] = [];
  private _label?: string;
  private _onSelect?: (value: string) => void;
  private _onClose?: () => void;
  private _anchor?: HTMLElement;
  private _minWidth = 0;
  private _reposition = (): void => {
    this._applyPosition();
  };

  public async openFor(options: DropdownMenuOptions): Promise<void> {
    this._items = options.items;
    this._label = options.label;
    this._onSelect = options.onSelect;
    this._onClose = options.onClose;
    this._anchor = options.anchor;
    this._minWidth = options.anchor.getBoundingClientRect().width;
    this._adoptThemeFrom(options.anchor);
    this.requestUpdate();

    await this.updateComplete;
    const dialog = this._dialog;
    if (!dialog) return;
    // Hidden until measured, so it never flashes at the viewport origin
    // before the first position is applied.
    dialog.style.visibility = "hidden";
    if (!dialog.open) dialog.showModal();
    this._applyPosition();
    dialog.style.visibility = "visible";
    window.addEventListener("resize", this._reposition);
    this._focusItem(Math.max(0, this._items.findIndex((item) => item.selected)));
  }

  public closeMenu(): void {
    const dialog = this._dialog;
    if (dialog?.open) dialog.close();
  }

  public get isOpen(): boolean {
    return !!this._dialog?.open;
  }

  private get _dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }

  private _adoptThemeFrom(anchor: HTMLElement): void {
    const computed = getComputedStyle(anchor);
    for (const name of THEME_VARS) {
      const value = computed.getPropertyValue(name).trim();
      if (value) this.style.setProperty(name, value);
      else this.style.removeProperty(name);
    }
  }

  private _applyPosition(): void {
    const dialog = this._dialog;
    if (!dialog || !this._anchor) return;
    const anchor = this._anchor.getBoundingClientRect();
    const { left, top, placement } = positionDropdown(
      { top: anchor.top, left: anchor.left, width: anchor.width, height: anchor.height },
      { width: dialog.offsetWidth, height: dialog.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
    dialog.dataset.placement = placement;
  }

  private _itemButtons(): HTMLButtonElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLButtonElement>(".item"));
  }

  private _focusItem(index: number): void {
    const buttons = this._itemButtons();
    if (buttons.length === 0) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus();
  }

  private _handleKeydown(event: KeyboardEvent): void {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = this._itemButtons();
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (event.key === "Home") this._focusItem(0);
    else if (event.key === "End") this._focusItem(buttons.length - 1);
    else this._focusItem(current + (event.key === "ArrowDown" ? 1 : -1));
  }

  // A modal dialog reports clicks on its backdrop with the dialog itself as
  // the target — the menu inside never lets a click through.
  private _handleDialogClick(event: MouseEvent): void {
    if (event.target === this._dialog) this.closeMenu();
  }

  private _handleSelect(value: string): void {
    const onSelect = this._onSelect;
    this.closeMenu();
    onSelect?.(value);
  }

  private _handleClose(): void {
    window.removeEventListener("resize", this._reposition);
    const onClose = this._onClose;
    this._onClose = undefined;
    onClose?.();
  }

  protected render(): TemplateResult {
    return html`
      <dialog
        @click=${this._handleDialogClick}
        @close=${this._handleClose}
        @keydown=${this._handleKeydown}
      >
        <div
          class="menu"
          role="listbox"
          aria-label=${this._label ?? nothing}
          style=${`min-width: ${Math.max(this._minWidth, 180)}px;`}
        >
          ${this._items.map(
            (item) => html`
              <button
                class="item ${item.selected ? "selected" : ""}"
                role="option"
                aria-selected=${!!item.selected}
                @click=${() => this._handleSelect(item.value)}
              >
                ${item.icon ? html`<ha-icon icon=${item.icon}></ha-icon>` : nothing}
                <span>${item.label}</span>
              </button>
            `,
          )}
        </div>
      </dialog>
    `;
  }

  static styles = css`
    :host {
      display: contents;
    }

    dialog {
      position: fixed;
      margin: 0;
      padding: 0;
      border: none;
      max-width: none;
      max-height: none;
      overflow: visible;
      background: transparent;
      color: var(--primary-text-color);
    }

    /* No scrim: a dropdown is not a dialog, it just borrows the top layer. */
    dialog::backdrop {
      background: transparent;
    }

    .menu {
      box-sizing: border-box;
      max-width: min(300px, calc(100vw - 24px));
      max-height: min(320px, calc(100vh - 24px));
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px;
      border-radius: 16px;
      /* Deliberately opaque. The menu overlaps whatever card is under it, and
         the cards' own translucent "glass" surface would make the labels sit
         on top of a foreign card's text. Two layers guarantee that whatever
         the theme provides: the bottom (background-color) is the dashboard's
         own opaque ground, the top (background-image) is the card surface,
         which may well be semi-transparent — composited over the ground it
         still ends up fully opaque. */
      background-color: var(--primary-background-color, Canvas);
      background-image: linear-gradient(
        var(--ha-card-background, var(--card-background-color)),
        var(--ha-card-background, var(--card-background-color))
      );
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent);
      box-shadow:
        0 8px 28px rgba(0, 0, 0, 0.28),
        0 2px 8px rgba(0, 0, 0, 0.18);
      animation: menu-in 140ms ${unsafeCSS(STANDARD_EASING)};
    }

    dialog[data-placement="above"] .menu {
      transform-origin: bottom center;
    }

    @keyframes menu-in {
      from {
        opacity: 0;
        transform: scale(0.96);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .menu {
        animation: none;
      }
    }

    .item {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 40px;
      flex-shrink: 0;
      border: none;
      border-radius: 10px;
      background: transparent;
      color: var(--primary-text-color);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
      padding: 0 12px;
    }

    .item:hover {
      background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    }

    .item:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: -2px;
    }

    .item.selected {
      background: color-mix(in srgb, var(--primary-color) 18%, transparent);
      color: var(--primary-color);
    }

    .item ha-icon {
      --mdc-icon-size: 18px;
      flex-shrink: 0;
    }
  `;
}

if (typeof customElements !== "undefined" && !customElements.get(TAG)) {
  customElements.define(TAG, M3DropdownMenu);
}

let instance: M3DropdownMenu | undefined;

// Opens the (singleton) dropdown for `anchor`. Any menu already open is
// replaced, so two cards can never show one each.
export function openDropdownMenu(options: DropdownMenuOptions): void {
  if (typeof document === "undefined") return;
  if (!instance || !instance.isConnected) {
    instance = document.createElement(TAG) as M3DropdownMenu;
    document.body.appendChild(instance);
  }
  instance.closeMenu();
  void instance.openFor(options);
}

export function closeDropdownMenu(): void {
  instance?.closeMenu();
}
