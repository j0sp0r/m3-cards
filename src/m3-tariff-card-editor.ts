import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3TariffCardConfig, TariffEntryConfig } from "./types";
import { DEFAULT_TARIFF_HISTORY_DAYS, DEFAULT_TARIFF_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-tariff-card-editor")
export class M3TariffCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3TariffCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3TariffCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_TARIFF_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3TariffCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      title: "editor_avail_title",
      icon: "editor_icon",
      name: "editor_tariff_name",
      short: "editor_tariff_short",
      energy: "editor_tariff_energy",
      price_entity: "editor_tariff_price_entity",
      price_value: "editor_tariff_price_value",
      cost: "editor_tariff_cost",
      color: "editor_tariff_color",
      active_tariff: "editor_tariff_active_entity",
      active_until: "editor_tariff_active_until",
      period: "editor_tariff_period",
      history_days: "editor_tariff_history_days",
      show_history: "editor_tariff_show_history",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _generalSchema(): SchemaEntry[] {
    return [
      { name: "title", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      {
        name: "period",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "day", label: this._t("tariff_today") },
              { value: "week", label: this._t("tariff_week") },
              { value: "month", label: this._t("tariff_month") },
            ],
          },
        },
      },
      { name: "show_history", selector: { boolean: {} } },
      { name: "history_days", selector: { number: { min: 3, max: 31, mode: "box" } } },
      { name: "active_tariff", selector: { entity: { domain: ["select", "sensor", "input_select"] } } },
      { name: "active_until", selector: { entity: { domain: "sensor" } } },
    ];
  }

  private _tariffSchema(): SchemaEntry[] {
    return [
      { name: "name", required: true, selector: { text: {} } },
      { name: "short", selector: { text: {} } },
      { name: "energy", required: true, selector: { entity: { domain: "sensor", device_class: "energy" } } },
      { name: "price_entity", selector: { entity: { domain: ["sensor", "input_number", "number"] } } },
      { name: "price_value", selector: { number: { min: 0, step: 0.0001, mode: "box" } } },
      { name: "cost", selector: { entity: { domain: "sensor" } } },
      { name: "color", selector: { text: {} } },
    ];
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config };
    for (const [k, v] of Object.entries(ev.detail.value as Record<string, unknown>)) {
      if (v === undefined || v === "" || v === null) delete next[k];
      else next[k] = v;
    }
    this._emit(next as unknown as M3TariffCardConfig);
  }

  private _tariffChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const v = ev.detail.value as Record<string, unknown>;
    const t: TariffEntryConfig = { name: (v.name as string) || "", energy: (v.energy as string) || "" };
    if (v.short) t.short = v.short as string;
    if (v.price_entity) t.price = v.price_entity as string;
    else if (typeof v.price_value === "number") t.price = v.price_value;
    if (v.cost) t.cost = v.cost as string;
    if (v.color) t.color = v.color as string;
    const prev = this._config.tariffs[index];
    if (prev?.icon) t.icon = prev.icon;
    const tariffs = [...this._config.tariffs];
    tariffs[index] = t;
    this._emit({ ...this._config, tariffs });
  }

  private _move(index: number, by: number): void {
    if (!this._config) return;
    const tariffs = [...this._config.tariffs];
    const to = index + by;
    if (to < 0 || to >= tariffs.length) return;
    [tariffs[index], tariffs[to]] = [tariffs[to], tariffs[index]];
    this._emit({ ...this._config, tariffs });
  }

  private _remove(index: number): void {
    if (!this._config) return;
    this._emit({ ...this._config, tariffs: this._config.tariffs.filter((_, i) => i !== index) });
  }

  private _add(): void {
    if (!this._config) return;
    this._emit({ ...this._config, tariffs: [...this._config.tariffs, { name: "", energy: "" }] });
  }

  private _radiusPresetChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = radiusPresetPatch(ev.detail.value.radius_preset as string);
    this._appearance = { ...this._appearance, showCustomRadius: patch.showCustomRadius };
    if (patch.radius !== undefined) this._emit({ ...this._config, radius: patch.radius });
  }

  private _cornersToggleChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const showCorners = ev.detail.value.use_corners as boolean;
    this._appearance = { ...this._appearance, showCorners };
    if (!showCorners) {
      const { corners: _removed, ...rest } = this._config;
      this._emit(rest as M3TariffCardConfig);
    }
  }

  private _cornerPresetChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const patch = cornerPresetPatch(ev.detail.value[key] as string);
    this._appearance = { ...this._appearance, cornerCustom: { ...this._appearance.cornerCustom, [key]: patch.custom } };
    if (patch.px !== undefined) this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } });
  }

  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: ev.detail.value[key] as number } });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const c = this._config;
    const general = {
      title: c.title ?? "",
      icon: c.icon ?? "",
      period: c.period ?? "day",
      show_history: c.show_history !== false,
      history_days: c.history_days ?? DEFAULT_TARIFF_HISTORY_DAYS,
      active_tariff: c.active_tariff,
      active_until: c.active_until,
    };
    return html`
      <div class="card-config">
        <ha-expansion-panel outlined .header=${this._t("editor_tariff_tariffs")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:cash-multiple"></ha-icon>
          <div class="panel-content">
            ${(c.tariffs ?? []).map(
              (t, i) => html`<div class="tariff">
                <div class="tariff-head">
                  <span class="tariff-title">${t.name || `#${i + 1}`}${t.short ? ` (${t.short})` : ""}</span>
                  <button class="icon-btn" ?disabled=${i === 0} aria-label=${this._t("editor_tariff_move_up")} @click=${() => this._move(i, -1)}>
                    <ha-icon icon="mdi:arrow-up"></ha-icon>
                  </button>
                  <button class="icon-btn" ?disabled=${i === c.tariffs.length - 1} aria-label=${this._t("editor_tariff_move_down")} @click=${() => this._move(i, 1)}>
                    <ha-icon icon="mdi:arrow-down"></ha-icon>
                  </button>
                  <button class="icon-btn" aria-label=${this._t("editor_tariff_remove")} @click=${() => this._remove(i)}>
                    <ha-icon icon="mdi:delete-outline"></ha-icon>
                  </button>
                </div>
                <ha-form
                  .hass=${this.hass}
                  .data=${{
                    name: t.name,
                    short: t.short,
                    energy: t.energy,
                    price_entity: typeof t.price === "string" ? t.price : undefined,
                    price_value: typeof t.price === "number" ? t.price : undefined,
                    cost: t.cost,
                    color: t.color,
                  }}
                  .schema=${this._tariffSchema()}
                  .computeLabel=${this._computeLabel}
                  @value-changed=${(e: CustomEvent) => this._tariffChanged(i, e)}
                ></ha-form>
              </div>`,
            )}
            <button class="add-btn" @click=${() => this._add()}>
              <ha-icon icon="mdi:plus"></ha-icon>${this._t("editor_tariff_add")}
            </button>
          </div>
        </ha-expansion-panel>
        <ha-expansion-panel outlined .header=${this._t("editor_tariff_active")}>
          <ha-icon slot="leading-icon" icon="mdi:clock-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${general}
              .schema=${this._generalSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>
        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_TARIFF_RADIUS,
          state: this._appearance,
          computeLabel: this._computeLabel,
          onValueChanged: this._valueChanged.bind(this),
          onRadiusPresetChanged: this._radiusPresetChanged.bind(this),
          onCornersToggleChanged: this._cornersToggleChanged.bind(this),
          onCornerPresetChanged: this._cornerPresetChanged.bind(this),
          onCornerValueChanged: this._cornerValueChanged.bind(this),
        })}
      </div>
    `;
  }

  static styles = [
    editorStyles,
    css`
      .tariff {
        border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
        border-radius: 12px;
        padding: 8px 12px 12px;
        margin-bottom: 10px;
      }
      .tariff-head {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-bottom: 6px;
      }
      .tariff-title {
        flex: 1;
        font-weight: 600;
      }
      .icon-btn {
        width: 36px;
        height: 36px;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: var(--primary-text-color);
        cursor: pointer;
        display: grid;
        place-items: center;
      }
      .icon-btn:disabled {
        opacity: 0.3;
        cursor: default;
      }
      .add-btn {
        width: 100%;
        height: 40px;
        border: none;
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font: inherit;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-tariff-card-editor": M3TariffCardEditor;
  }
}
