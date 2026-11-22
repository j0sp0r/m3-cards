import { html, css, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  DETAIL_BUTTON_RADIUS_PRESSED,
  DETAIL_BUTTON_SIZE,
  DETAIL_CLOSE_RADIUS,
  DETAIL_ICON_RADIUS,
  DETAIL_ICON_SIZE,
} from "../const";
import { STANDARD_EASING } from "./animation";
import { M3SheetBase } from "./sheet-base";
import type { HomeAssistant } from "../types";

/** Icons for the usual devices, with words to find them by. */
const SUGGESTED: [string, string][] = [
  ["mdi:cellphone", "handy phone smartphone telefon"],
  ["mdi:tablet", "tablet ipad"],
  ["mdi:laptop", "laptop notebook macbook"],
  ["mdi:monitor", "pc desktop computer monitor"],
  ["mdi:television", "tv fernseher television"],
  ["mdi:speaker", "lautsprecher speaker sonos echo nest"],
  ["mdi:cctv", "kamera camera überwachung"],
  ["mdi:doorbell-video", "klingel türklingel doorbell ring"],
  ["mdi:printer", "drucker printer"],
  ["mdi:printer-3d", "3d drucker printer bambu"],
  ["mdi:power-socket-eu", "steckdose plug socket shelly"],
  ["mdi:lightbulb", "lampe licht light bulb"],
  ["mdi:server", "server nas homeassistant"],
  ["mdi:router-wireless", "router access point repeater wlan"],
  ["mdi:robot-vacuum", "saugroboter vacuum roborock"],
  ["mdi:washing-machine", "waschmaschine washer"],
  ["mdi:tumble-dryer", "trockner dryer"],
  ["mdi:dishwasher", "spülmaschine dishwasher"],
  ["mdi:fridge", "kühlschrank fridge"],
  ["mdi:gamepad-variant", "konsole console playstation xbox switch"],
  ["mdi:watch", "uhr watch smartwatch"],
  ["mdi:car-electric", "auto car ev"],
  ["mdi:battery-charging", "akku batterie battery ecoflow powerstation"],
  ["mdi:thermostat", "thermostat heizung"],
  ["mdi:air-conditioner", "klima klimaanlage ac"],
  ["mdi:paw", "tier haustier petkit futter"],
  ["mdi:chip", "esp mikrocontroller sensor iot"],
  ["mdi:solar-power", "solar pv wechselrichter"],
  ["mdi:help-network-outline", "unbekannt unknown"],
];

/** Home Assistant's icon picker is loaded with its editors; this fetches them once. */
let pickerLoad: Promise<boolean> | undefined;
function loadIconPicker(): Promise<boolean> {
  if (customElements.get("ha-form")) return Promise.resolve(true);
  pickerLoad ??= (async () => {
    try {
      const helpers = await (window as unknown as { loadCardHelpers?: () => Promise<{ createCardElement: (c: unknown) => HTMLElement }> }).loadCardHelpers?.();
      const tile = helpers?.createCardElement({ type: "tile", entity: "sun.sun" }) as unknown as { constructor: { getConfigElement?: () => Promise<unknown> } } | undefined;
      await tile?.constructor.getConfigElement?.();
      await Promise.race([customElements.whenDefined("ha-form"), new Promise((r) => setTimeout(r, 3000))]);
    } catch {
      // Without it the plain field stays.
    }
    return !!customElements.get("ha-form");
  })();
  return pickerLoad;
}

// The network card's detail sheet: everything known about one device —
// the whole MAC address is shown only here — and what can be done with it:
// name it, take it as known, forget it, hide it.

const EASING = unsafeCSS(STANDARD_EASING);

export interface NetSheetFact {
  label: string;
  value: string;
  mono?: boolean;
}

export interface NetSheetView {
  title: string;
  icon: string;
  /** Inline CSS variables for the icon's tint. */
  tint: string;
  facts: NetSheetFact[];
  name: string;
  iconValue: string;
  isNew: boolean;
  isKnown: boolean;
  ignored: boolean;
}

export interface NetSheetLabels {
  close: string;
  name: string;
  icon: string;
  save: string;
  cancel: string;
  rename: string;
  known: string;
  forget: string;
  ignore: string;
  unignore: string;
}

@customElement("m3-network-sheet")
export class M3NetworkSheet extends M3SheetBase {
  @property({ attribute: false }) public view?: NetSheetView;
  @property({ attribute: false }) public labels?: NetSheetLabels;
  @property({ attribute: false }) public onSave?: (name: string, icon: string) => void;
  @property({ attribute: false }) public onKnown?: () => void;
  @property({ attribute: false }) public onForget?: () => void;
  @property({ attribute: false }) public onIgnore?: () => void;
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _picker = false;
  @state() private _renaming = false;
  @state() private _name = "";
  @state() private _icon = "";

  /** Opens the sheet; `rename` goes straight to the name field. */
  public open(opener?: HTMLElement, rename = false): void {
    this._renaming = rename;
    this._name = this.view?.name ?? "";
    this._icon = this.view?.iconValue ?? "";
    void loadIconPicker().then((ok) => (this._picker = ok));
    this.present(opener, () => {
      if (this._body) this._body.scrollTop = 0;
      if (rename) this.renderRoot.querySelector<HTMLInputElement>("#net-name")?.focus();
    });
  }

  /** The suggestions that match what is typed (an icon name or a word); all of them for nothing typed or a full mdi: name. */
  private _suggestions(): [string, string][] {
    const q = this._icon.trim().toLowerCase().replace(/^mdi:/, "");
    if (!q || this._icon.startsWith("mdi:")) return SUGGESTED;
    const hits = SUGGESTED.filter(([icon, words]) => icon.includes(q) || words.includes(q));
    return hits.length ? hits : SUGGESTED;
  }

  private _save(): void {
    this.onSave?.(this._name.trim(), this._icon.trim());
    void this.dismiss();
  }

  protected renderContent() {
    const v = this.view;
    const l = this.labels;
    if (!v || !l) return nothing;
    return html`
      <div class="header" style=${v.tint}>
        <div class="icon"><ha-icon icon=${this._renaming && this._icon ? this._icon : v.icon}></ha-icon></div>
        <div class="title">${v.title}</div>
        <button class="close" @click=${this._close} aria-label=${l.close}>
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      ${this._renaming
        ? html`<form
            class="rename"
            @submit=${(e: Event) => {
              e.preventDefault();
              this._save();
            }}
          >
            <label class="field">
              <span>${l.name}</span>
              <input id="net-name" type="text" .value=${this._name} @input=${(e: Event) => (this._name = (e.target as HTMLInputElement).value)} />
            </label>
            <div class="field">
              <span>${l.icon}</span>
              ${this._picker && this.hass
                ? html`<ha-form
                    .hass=${this.hass}
                    .data=${{ icon: this._icon }}
                    .schema=${[{ name: "icon", selector: { icon: { placeholder: v.icon } } }]}
                    .computeLabel=${() => ""}
                    @value-changed=${(e: CustomEvent) => (this._icon = (e.detail.value?.icon as string) ?? "")}
                  ></ha-form>`
                : html`<div class="icon-input">
                    <ha-icon icon=${this._icon || v.icon}></ha-icon>
                    <input type="text" placeholder="mdi:cellphone" .value=${this._icon} @input=${(e: Event) => (this._icon = (e.target as HTMLInputElement).value)} />
                  </div>`}
              <div class="suggest" role="listbox" aria-label=${l.icon}>
                ${this._suggestions().map(
                  ([icon]) => html`<button
                    type="button"
                    class="sicon ${this._icon === icon ? "on" : ""}"
                    role="option"
                    aria-selected=${this._icon === icon ? "true" : "false"}
                    aria-label=${icon.replace("mdi:", "")}
                    title=${icon.replace("mdi:", "")}
                    @click=${() => (this._icon = icon)}
                  >
                    <ha-icon icon=${icon}></ha-icon>
                  </button>`,
                )}
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn" @click=${() => (this._renaming = false)}>${l.cancel}</button>
              <button type="submit" class="btn filled">${l.save}</button>
            </div>
          </form>`
        : html`
            <div class="facts">
              ${v.facts.map(
                (f) => html`<div class="fact">
                  <span class="flabel">${f.label}</span>
                  <span class="fvalue ${f.mono ? "mono" : ""}">${f.value}</span>
                </div>`,
              )}
            </div>
            <div class="actions">
              <button class="btn" @click=${() => (this._renaming = true)}>
                <ha-icon icon="mdi:pencil-outline"></ha-icon>${l.rename}
              </button>
              ${v.isNew
                ? html`<button class="btn filled" @click=${() => { this.onKnown?.(); void this.dismiss(); }}>
                    <ha-icon icon="mdi:check"></ha-icon>${l.known}
                  </button>`
                : v.isKnown
                  ? html`<button class="btn" @click=${() => { this.onForget?.(); void this.dismiss(); }}>
                      <ha-icon icon="mdi:account-question-outline"></ha-icon>${l.forget}
                    </button>`
                  : nothing}
              <button class="btn" @click=${() => { this.onIgnore?.(); void this.dismiss(); }}>
                <ha-icon icon=${v.ignored ? "mdi:eye-outline" : "mdi:eye-off-outline"}></ha-icon>${v.ignored ? l.unignore : l.ignore}
              </button>
            </div>
          `}
    `;
  }

  static styles = [
    M3SheetBase.styles,
    css`
      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        padding: 0 0 16px;
      }
      .icon {
        flex: 0 0 auto;
        width: ${DETAIL_ICON_SIZE}px;
        height: ${DETAIL_ICON_SIZE}px;
        border-radius: ${DETAIL_ICON_RADIUS}px;
        display: grid;
        place-items: center;
        background: var(--m3-icon-background, var(--ns-icon-bg));
        color: var(--ns-icon-fg);
        --mdc-icon-size: 22px;
      }
      .title {
        flex: 1;
        min-width: 0;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        overflow-wrap: anywhere;
      }
      .close {
        flex: 0 0 auto;
        width: ${DETAIL_BUTTON_SIZE}px;
        height: ${DETAIL_BUTTON_SIZE}px;
        border: none;
        padding: 0;
        display: grid;
        place-items: center;
        border-radius: ${DETAIL_CLOSE_RADIUS}px;
        background: color-mix(in srgb, currentColor 10%, transparent);
        color: inherit;
        cursor: pointer;
        --mdc-icon-size: 18px;
        transition: border-radius 200ms ${EASING};
      }
      .close:active {
        border-radius: ${DETAIL_BUTTON_RADIUS_PRESSED}px;
      }
      .facts {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .fact {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 46px;
        padding: 0 14px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
      }
      .fact:first-child {
        border-top-left-radius: 18px;
        border-top-right-radius: 18px;
      }
      .fact:last-child {
        border-bottom-left-radius: 18px;
        border-bottom-right-radius: 18px;
      }
      .flabel {
        font-size: 14px;
        color: var(--secondary-text-color);
      }
      .fvalue {
        font-size: 14px;
        font-weight: 600;
        text-align: right;
        overflow-wrap: anywhere;
      }
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-weight: 500;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 18px;
        border-radius: 22px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        --mdc-icon-size: 18px;
        transition: border-radius 200ms ${EASING};
      }
      .btn:active {
        border-radius: 12px;
      }
      .btn.filled {
        border-color: transparent;
        background: var(--primary-color);
        color: var(--text-primary-color, #1c1c1c);
      }
      .btn:focus-visible,
      .close:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }
      .rename {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--secondary-text-color);
      }
      .field input,
      .icon-input {
        height: 48px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 22%, transparent);
        background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
        color: var(--primary-text-color);
        font: inherit;
        font-size: 15px;
        padding: 0 14px;
        box-sizing: border-box;
      }
      .icon-input {
        display: flex;
        align-items: center;
        gap: 10px;
        --mdc-icon-size: 20px;
      }
      .icon-input input {
        flex: 1;
        min-width: 0;
        height: 100%;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        outline: none;
        padding: 0;
      }
      .suggest {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
        gap: 6px;
        margin-top: 4px;
      }
      .sicon {
        height: 44px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent);
        background: transparent;
        color: var(--primary-text-color);
        display: grid;
        place-items: center;
        cursor: pointer;
        --mdc-icon-size: 22px;
        transition: border-radius 200ms ${EASING};
      }
      .sicon.on {
        border-color: transparent;
        border-radius: 22px;
        background: var(--m3-icon-background, var(--ns-icon-bg));
        color: var(--ns-icon-fg);
      }
      .sicon:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }
      .field input:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 1px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-network-sheet": M3NetworkSheet;
  }
}
