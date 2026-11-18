import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3TariffCardConfig, TariffEntryConfig } from "./types";
import { DEFAULT_TARIFF_HISTORY_DAYS, DEFAULT_TARIFF_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import { tariffNotifyParts } from "./shared/tariff-notify";
import { formatCurrencyParts } from "./shared/pricing";
import {
  notifyServiceSchema,
  notifyTitleSchema,
  notifyMessageSchema,
  notifyTokenHint,
  renderNotifyControls,
  notifyActions,
  saveNotifyAutomation,
  resolveAutomationId,
  setAutomationEnabled,
  notifyStyles,
} from "./shared/notify-editor";
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
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";

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
      notify_tariffs: "editor_tariff_notify_tariffs",
      notify_advance: "editor_tariff_notify_advance",
      notify_service: "editor_notify_service",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
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

  // ---- notification -------------------------------------------------------

  private _notifySchema(): SchemaEntry[] {
    const c = this._config!;
    const options = (c.tariffs ?? []).filter((t) => t.name).map((t) => ({ value: t.name, label: t.short ? `${t.name} (${t.short})` : t.name }));
    return [
      { name: "notify_tariffs", selector: { select: { mode: "list", multiple: true, options } } },
      ...(c.schedule?.length ? [{ name: "notify_advance", selector: { number: { min: 0, max: 240, mode: "box", unit_of_measurement: "min" } } }] : []),
      notifyServiceSchema(this.hass),
      notifyTitleSchema(),
      notifyMessageSchema(),
    ] as SchemaEntry[];
  }

  private async _toggleNotify(enabled: boolean): Promise<void> {
    if (!this._config || !this.hass) return;
    this._emit({ ...this._config, notify_enabled: enabled });
    if (enabled) {
      await this._setupNotify();
      return;
    }
    const id = this._config.notify_automation_id;
    if (id) await setAutomationEnabled(this.hass, id, false);
  }

  private async _setupNotify(): Promise<void> {
    const cfg = this._config;
    const hass = this.hass;
    if (!hass || !cfg) return;
    const targets = cfg.notify_service ?? [];
    if (targets.length === 0) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t("editor_notify_missing");
      return;
    }
    this._notifyBusy = true;
    this._notifyStatus = "idle";
    this._notifyDetail = "";
    try {
      const tariffs = cfg.tariffs ?? [];
      const announce = (cfg.notify_tariffs ?? []).map((n) => tariffs.findIndex((t) => t.name === n)).filter((i) => i >= 0);
      const currency = cfg.currency || ((hass.config as { currency?: string } | undefined)?.currency ?? "EUR");
      const parts = tariffNotifyParts({
        tariffs,
        schedule: cfg.schedule,
        activeEntity: cfg.active_tariff,
        untilEntity: cfg.active_until,
        announce,
        advance: cfg.notify_advance ?? 0,
        decimalComma: (1.5).toLocaleString(this._language).includes(","),
        priceUnit: `${formatCurrencyParts(0, currency, this._language).symbol}/kWh`,
        texts: {
          now: this._t("editor_tariff_notify_now"),
          until: this._t("editor_tariff_notify_until"),
          soon: this._t("editor_tariff_notify_soon"),
          custom: cfg.notify_message,
        },
      });
      if (!parts.usable) throw new Error(this._t("editor_tariff_notify_unusable"));
      const title = cfg.title || this._t("tariff_title");
      const automationId = resolveAutomationId("tariff", cfg.notify_automation_id);
      await saveNotifyAutomation(hass, {
        id: automationId,
        alias: `${title}: ${this._t("editor_tariff_notify_alias")}`,
        description: this._t("editor_tariff_notify_description"),
        mode: "queued",
        variables: parts.variables,
        triggers: parts.triggers,
        conditions: parts.conditions,
        actions: notifyActions(targets, title, parts.message, { title: cfg.notify_title }),
      });
      if (cfg.notify_automation_id !== automationId) this._emit({ ...cfg, notify_automation_id: automationId });
      await setAutomationEnabled(hass, automationId, true);
      this._notifyStatus = "success";
    } catch (e) {
      this._notifyStatus = "error";
      this._notifyDetail = e instanceof Error ? e.message : String(e);
    } finally {
      this._notifyBusy = false;
    }
  }

  private _renderNotify() {
    const c = this._config!;
    return html`
      <ha-expansion-panel outlined .header=${this._t("editor_tariff_notify")}>
        <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
        <div class="panel-content">
          <div class="hint">${this._t("editor_tariff_notify_hint")}</div>
          <ha-form
            .hass=${this.hass}
            .data=${{
              notify_tariffs: c.notify_tariffs ?? [],
              notify_advance: c.notify_advance ?? 0,
              notify_service: c.notify_service ?? [],
              notify_title: c.notify_title ?? "",
              notify_message: c.notify_message ?? "",
            }}
            .schema=${this._notifySchema()}
            .computeLabel=${this._computeLabel}
            @value-changed=${this._valueChanged}
          ></ha-form>
          <div class="hint">${notifyTokenHint(this._language, ["tarif", "preis", "bis"])}</div>
          ${renderNotifyControls({
            hass: this.hass,
            language: this._language,
            enabled: c.notify_enabled ?? false,
            automationId: c.notify_automation_id,
            busy: this._notifyBusy,
            status: this._notifyStatus,
            detail: this._notifyDetail,
            blockedReason: !c.schedule?.length && !c.active_tariff
              ? this._t("editor_tariff_notify_unusable")
              : c.notify_service?.length
                ? undefined
                : this._t("editor_notify_missing"),
            onToggle: (on) => void this._toggleNotify(on),
            onSetup: () => void this._setupNotify(),
          })}
        </div>
      </ha-expansion-panel>
    `;
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
        ${this._renderNotify()}
      </div>
    `;
  }

  static styles = [
    editorStyles,
    notifyStyles,
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
