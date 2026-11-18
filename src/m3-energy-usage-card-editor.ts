import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3EnergyUsageCardConfig } from "./types";
import { DEFAULT_USAGE_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import { loadEnergySources } from "./shared/energy-sources";
import { energyReportParts, REPORT_TOKENS, type ReportMode } from "./shared/energy-usage-notify";
import { formatCurrencyParts } from "./shared/pricing";
import {
  notifyServiceSchema,
  notifyTitleSchema,
  notifyMessageSchema,
  notifyModeSchema,
  notifyTimeSchema,
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

@customElement("m3-energy-usage-card-editor")
export class M3EnergyUsageCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3EnergyUsageCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";

  public setConfig(config: M3EnergyUsageCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_USAGE_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3EnergyUsageCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _schema(): SchemaEntry[] {
    const kinds = (["day", "week", "month", "year"] as const).map((k) => ({ value: k, label: this._t(`usage_${k}` as TranslationKey) }));
    return [
      { name: "title", selector: { text: {} } },
      { name: "period", selector: { select: { mode: "dropdown", options: kinds } } },
      { name: "periods", selector: { select: { mode: "list", multiple: true, options: kinds } } },
      { name: "show_date", selector: { boolean: {} } },
      { name: "show_graph", selector: { boolean: {} } },
      { name: "y_axis", selector: { boolean: {} } },
      { name: "show_table", selector: { boolean: {} } },
      { name: "show_devices", selector: { boolean: {} } },
      { name: "max_devices", selector: { number: { min: 1, max: 50, mode: "box" } } },
      { name: "collection_key", selector: { text: {} } },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      title: "editor_avail_title",
      period: "editor_usage_period",
      periods: "editor_usage_periods",
      show_date: "editor_usage_show_date",
      show_graph: "editor_usage_show_graph",
      y_axis: "editor_y_axis",
      show_table: "editor_usage_show_table",
      show_devices: "editor_usage_show_devices",
      max_devices: "editor_usage_max_devices",
      collection_key: "editor_usage_key",
      notify_mode: "editor_usage_notify_mode",
      notify_time: "editor_notify_time",
      notify_service: "editor_notify_service",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config };
    for (const [k, v] of Object.entries(ev.detail.value as Record<string, unknown>)) {
      if (v === undefined || v === "" || v === null || (Array.isArray(v) && !v.length)) delete next[k];
      else next[k] = v;
    }
    this._emit(next as unknown as M3EnergyUsageCardConfig);
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
      this._emit(rest as M3EnergyUsageCardConfig);
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

  // ---- report -------------------------------------------------------------

  private _notifySchema(): SchemaEntry[] {
    return [
      notifyModeSchema([
        { value: "daily", label: this._t("editor_usage_notify_daily") },
        { value: "weekly", label: this._t("editor_usage_notify_weekly") },
        { value: "monthly", label: this._t("editor_usage_notify_monthly") },
      ]),
      notifyTimeSchema(),
      notifyServiceSchema(this.hass),
      notifyTitleSchema(),
      notifyMessageSchema(),
    ];
  }

  /** The report needs the recorder's statistics action (Home Assistant 2025.8). */
  private get _canReport(): boolean {
    return !!this.hass?.services?.recorder?.get_statistics;
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
      const { sources } = await loadEnergySources(hass, cfg.sources);
      if (!sources || sources.gridFrom.length + sources.solar.length + sources.batteryFrom.length === 0) {
        throw new Error(this._t("usage_no_dashboard"));
      }
      const mode = (cfg.notify_mode as ReportMode | undefined) ?? "daily";
      const currency = (hass.config as { currency?: string } | undefined)?.currency ?? "EUR";
      const parts = energyReportParts({
        sources,
        mode,
        time: cfg.notify_time || "08:00",
        decimalComma: (1.5).toLocaleString(this._language).includes(","),
        currency: formatCurrencyParts(0, currency, this._language).symbol,
        texts: {
          period: {
            daily: this._t("editor_usage_notify_period_daily"),
            weekly: this._t("editor_usage_notify_period_weekly"),
            monthly: this._t("editor_usage_notify_period_monthly"),
          },
          message: this._t(sources.solar.length ? "editor_usage_notify_message_solar" : "editor_usage_notify_message"),
          custom: cfg.notify_message,
        },
      });
      const title = cfg.title || this._t("editor_usage_notify_default_title");
      const automationId = resolveAutomationId("energy_report", cfg.notify_automation_id);
      await saveNotifyAutomation(hass, {
        id: automationId,
        alias: `${title}: ${this._t("editor_usage_notify_alias")}`,
        description: this._t("editor_usage_notify_description"),
        mode: "single",
        triggers: parts.triggers,
        conditions: parts.conditions,
        actions: [...parts.actions, ...notifyActions(targets, title, parts.message, { title: cfg.notify_title })],
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
      <ha-expansion-panel outlined .header=${this._t("editor_usage_notify")}>
        <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
        <div class="panel-content">
          <div class="hint">${this._t("editor_usage_notify_hint")}</div>
          <ha-form
            .hass=${this.hass}
            .data=${{
              notify_mode: c.notify_mode ?? "daily",
              notify_time: c.notify_time ?? "08:00",
              notify_service: c.notify_service ?? [],
              notify_title: c.notify_title ?? "",
              notify_message: c.notify_message ?? "",
            }}
            .schema=${this._notifySchema()}
            .computeLabel=${this._computeLabel}
            @value-changed=${this._valueChanged}
          ></ha-form>
          <div class="hint">${notifyTokenHint(this._language, [...REPORT_TOKENS])}</div>
          ${renderNotifyControls({
            hass: this.hass,
            language: this._language,
            enabled: c.notify_enabled ?? false,
            automationId: c.notify_automation_id,
            busy: this._notifyBusy,
            status: this._notifyStatus,
            detail: this._notifyDetail,
            blockedReason: !this._canReport
              ? this._t("editor_usage_notify_needs_ha")
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
    const data = {
      title: c.title ?? "",
      period: c.period ?? "day",
      periods: c.periods ?? ["day", "week", "month"],
      show_date: c.show_date !== false,
      show_graph: c.show_graph !== false,
      y_axis: c.y_axis === true,
      show_table: c.show_table !== false,
      show_devices: c.show_devices === true,
      max_devices: c.max_devices ?? 10,
      collection_key: c.collection_key ?? "",
    };
    return html`
      <div class="card-config">
        <ha-expansion-panel outlined .header=${this._t("editor_usage_parts")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:chart-bar-stacked"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${data}
              .schema=${this._schema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>
        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_USAGE_RADIUS,
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

  static styles = [editorStyles, notifyStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-energy-usage-card-editor": M3EnergyUsageCardEditor;
  }
}
