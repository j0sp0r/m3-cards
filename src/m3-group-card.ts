import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3GroupCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import { CARD_VERSION, DEFAULT_GROUP_RADIUS, DEFAULT_GROUP_GAP, resolveCornerRadius } from "./const";
import { resolveThemeColor } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { GroupChildrenController } from "./shared/group-children";
import { TemplatedCard } from "./shared/templated-card";

// Wraps arbitrary Lovelace cards in one shared frame instead of each keeping
// its own. The frame suppression itself lives in shared/glass-card.ts (a
// --m3-group-* CSS custom property this card sets on .group-children, which
// inherits into every nested card's shadow root) — this file only has to
// build/host the child card elements and lay them out.

console.info(
  `%c M3-GROUP-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

@customElement("m3-group-card")
export class M3GroupCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3GroupCardConfig;
  @state() private _children: HTMLElement[] = [];

  private _childrenController = new GroupChildrenController();

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-group-card-editor");
    return document.createElement("m3-group-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3GroupCardConfig {
    return {
      type: "custom:m3-group-card",
      cards: [],
    };
  }

  public setConfig(config: M3GroupCardConfig): void {
    if (!config || !Array.isArray(config.cards)) {
      throw new Error("m3-group-card: 'cards' must be a list.");
    }
    this._config = { glass_background: true, ...config };
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (!this._config || !this.hass) return;
    this._childrenController.sync({
      cards: this._config.cards,
      hass: this.hass,
      onChange: (elements) => {
        this._children = elements;
      },
    });
  }

  public async getCardSize(): Promise<number> {
    if (this._children.length === 0) return 1;
    const sizes = await Promise.all(
      this._children.map(async (el) => {
        const handle = el as HTMLElement & { getCardSize?: () => number | Promise<number> };
        try {
          return (await handle.getCardSize?.()) ?? 1;
        } catch {
          return 1;
        }
      }),
    );
    return sizes.reduce((total, size) => total + size, 0);
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto" };
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_GROUP_RADIUS, this._config.corners);
    const cardBackgroundCss = this._config.card_background
      ? resolveThemeColor(this._config.card_background)
      : undefined;
    const gap = this._config.gap ?? DEFAULT_GROUP_GAP;

    return html`
      <ha-card style=${`border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="group-children" style=${`gap: ${gap}px;`}>${this._children}</div>
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      .card-inner {
        padding: 0;
      }

      .group-children {
        display: flex;
        flex-direction: column;
        padding: 12px;
        /* Neutralizes the frame every nested card's own shared/glass-card.ts
           styles would otherwise draw — see the fallback values there. Only
           this container's own .card-inner above still shows a frame, so the
           whole group reads as one card. Padding goes to 0 too: without
           that, each child's own standalone padding stacks on top of this
           gap, so "gap: 0" would still leave visible space between rows
           instead of true edge-to-edge touching. */
        --m3-group-border: none;
        --m3-group-background: transparent;
        --m3-group-backdrop-filter: none;
        --m3-group-padding: 0;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-group-card": M3GroupCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-group-card",
  name: "M3 Group Card",
  description:
    "Wraps other cards (M3 or otherwise) in one shared frame, so e.g. several chip-button rows stack as a single card.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
