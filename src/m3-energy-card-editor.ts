import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3EnergyCardConfig } from "./types";
import {
  DEFAULT_ENERGY_RADIUS,
  DEFAULT_ENERGY_DAYS,
  DEFAULT_ENERGY_HOURS,
  DEFAULT_ENERGY_MONTHS,
  DEFAULT_ENERGY_NOTIFY_TIME,
  ENERGY_MIN_DAYS,
  ENERGY_MAX_DAYS,
  ENERGY_MIN_HOURS,
  ENERGY_MAX_HOURS,
  ENERGY_MIN_MONTHS,
  ENERGY_MAX_MONTHS,
  } from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  fireEvent,
  colorRow,
  opacityRow,
  editorStyles,
  type SchemaEntry,
} from "./shared/editor-helpers";
import { getEntityPlatform } from "./shared/ha-registry";
import {
  notifyServiceSchema,
  notifyModeSchema,
  notifyTimeSchema,
  notifyActions,
  notifyTokenHint,
  renderNotifyControls,
  setAutomationEnabled,
  notifyStyles,
  notifyTitleSchema,
  notifyMessageSchema,
  saveNotifyAutomation,
  resolveAutomationId,
  type NotifyAutomationSpec,
  meterCycle,
} from "./shared/notify-editor";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";
import { hasLongTermStatistics } from "./shared/ha-statistics";

// What a Jinja template inside the generated automation can honestly report
// for the notify entity:
//   "daily"   – its state IS today's total
//   "monthly" – it's a monthly utility_meter, so its `last_period` attribute
//               is the completed previous month's exact total
//   "other"   – its state is not a period total (lifetime counter, weekly /
//               quarterly / yearly meter, …) — nothing correct to report
//   "none"    – no entity to read at all
type NotifyScope = "daily" | "monthly" | "other" | "none";

@customElement("m3-energy-card-editor")
export class M3EnergyCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3EnergyCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };
  @state() private _showFallbackHint = false;
  @state() private _isUtilityMeter = false;
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";

  private _lastCheckedEntity?: string;
  private _lastMeterEntity?: string;

  public setConfig(config: M3EnergyCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_ENERGY_RADIUS);
    this._maybeCheckFallback();
    this._maybeCheckMeter();
  }

  protected updated(): void {
    this._maybeCheckFallback();
    this._maybeCheckMeter();
  }

  private _maybeCheckFallback(): void {
    if (!this.hass || !this._config?.entity) return;
    if (this._config.entity === this._lastCheckedEntity) return;
    this._lastCheckedEntity = this._config.entity;
    hasLongTermStatistics(this.hass, this._config.entity).then((has) => {
      this._showFallbackHint = !has;
    });
  }

  // The sensor the notification reads: an explicit override wins, otherwise
  // the card's own entity.
  private get _notifyEntity(): string | undefined {
    return this._config?.notify_entity || this._config?.entity || undefined;
  }

  // A utility_meter's cycle isn't exposed as an attribute in current HA
  // builds (verified against a live instance: only status / last_period /
  // last_valid_state / last_reset / next_reset are published), so the platform
  // lookup gates the check and the reset timestamps supply the cycle length.
  private _maybeCheckMeter(): void {
    const entity = this._notifyEntity;
    if (!this.hass || !entity) return;
    if (entity === this._lastMeterEntity) return;
    this._lastMeterEntity = entity;
    this._isUtilityMeter = false;
    getEntityPlatform(this.hass, entity).then((platform) => {
      if (entity !== this._notifyEntity) return; // stale response
      this._isUtilityMeter = platform === "utility_meter";
    });
  }

  private get _notifyScope(): NotifyScope {
    const cfg = this._config;
    const entity = this._notifyEntity;
    if (!cfg || !entity || !this.hass?.states[entity]) return "none";
    if (this._isUtilityMeter) return meterCycle(this.hass, entity) as NotifyScope;
    // Not a utility_meter, so the cycle can't be verified — except in the one
    // configuration where the card itself already treats the live state as
    // "today": consumption mode, day period, "state" statistic type (that's
    // literally the value it draws as today's bar). Only valid for the card's
    // own entity; an override sensor carries no such guarantee.
    if (entity !== cfg.entity) return "other";
    const mode = cfg.mode ?? "consumption";
    const period = cfg.period ?? "day";
    const statisticType =
      cfg.statistic_type ?? (mode === "solar" || period === "month" ? "change" : "state");
    if (mode !== "solar" && period === "day" && statisticType === "state") return "daily";
    return "other";
  }

  private get _notifyScopeHint(): TranslationKey {
    const scope = this._notifyScope;
    const mode = this._config?.notify_mode ?? "day_end";
    if (scope === "none") return "editor_energy_notify_no_entity";
    if (scope === "other") return "editor_energy_notify_unsupported_other";
    if (scope === "daily") {
      return mode === "day_end" ? "editor_energy_notify_scope_daily" : "editor_energy_notify_unsupported_daily";
    }
    return mode === "month_end"
      ? "editor_energy_notify_scope_monthly"
      : "editor_energy_notify_unsupported_monthly";
  }

  private get _notifySupported(): boolean {
    const mode = this._config?.notify_mode ?? "day_end";
    return this._notifyScope === (mode === "month_end" ? "monthly" : "daily");
  }

  // On switches the automation on (creating it first if needed); off pauses
  // it rather than deleting, so the configuration survives a toggle.
  private async _toggleNotify(enabled: boolean): Promise<void> {
    if (!this._config || !this.hass) return;
    this._config = { ...this._config, notify_enabled: enabled };
    fireEvent(this, "config-changed", { config: this._config });
    if (enabled) {
      await this._setupNotify();
      return;
    }
    const id = this._config.notify_automation_id;
    if (id) await setAutomationEnabled(this.hass, id, false);
  }

  private async _setupNotify(): Promise<void> {
    const cfg = this._config;
    const entity = this._notifyEntity;
    if (!this.hass || !cfg || !entity) return;
    const targets = cfg.notify_service ?? [];
    if (targets.length === 0) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t("editor_notify_missing");
      return;
    }
    if (!this._notifySupported) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t(this._notifyScopeHint);
      return;
    }
    this._notifyBusy = true;
    this._notifyStatus = "idle";
    this._notifyDetail = "";
    try {
      const state = this.hass.states[entity];
      const solar = (cfg.mode ?? "consumption") === "solar";
      const unit = cfg.unit || String(state?.attributes.unit_of_measurement ?? "kWh");
      const cardName = cfg.name || state?.attributes.friendly_name || entity;
      const mode = cfg.notify_mode ?? "day_end";
      const automationId = resolveAutomationId("energy_report", cfg.notify_automation_id);

      const message =
        mode === "month_end"
          ? // Fires on the 1st, after the meter's midnight reset has moved the
            // just-finished month into `last_period` — the exact, complete
            // total, rather than a month-to-date read that would clip the last
            // hours of the month. The label carries the previous month as
            // MM/YYYY (strftime has no localized month names in HA templates).
            `${this._t(solar ? "editor_energy_notify_month_label_solar" : "editor_energy_notify_month_label")}` +
            ` {{ (now().replace(day=1) - timedelta(days=1)).strftime('%m/%Y') }}: ` +
            `{{ state_attr('${entity}', 'last_period') | float(0) | round(1) }} ${unit}`
          : `${this._t(solar ? "editor_energy_notify_day_label_solar" : "editor_energy_notify_day_label")}: ` +
            `{{ states('${entity}') | float(0) | round(1) }} ${unit}`;

      const spec: NotifyAutomationSpec = {
        id: automationId,
        alias: `${cardName}: ${this._t("editor_energy_notify_alias")}`,
        description: this._t("editor_energy_notify_description"),
        mode: "single",
        triggers: [{ trigger: "time", at: cfg.notify_time || DEFAULT_ENERGY_NOTIFY_TIME }],
        conditions:
          mode === "month_end"
            ? [{ condition: "template", value_template: "{{ now().day == 1 }}" }]
            : [],
        actions: notifyActions(targets, cardName, message,
        { title: cfg.notify_title, message: cfg.notify_message, tokens: {
          wert: `{{ states('${entity}') | float(0) | round(1) }}`,
          einheit: unit,
          zeitraum: mode === "month_end"
            ? "{{ (now().replace(day=1) - timedelta(days=1)).strftime('%m/%Y') }}"
            : "{{ now().strftime('%d.%m.%Y') }}",
        } }),
      };

      await saveNotifyAutomation(this.hass, spec);
      if (cfg.notify_automation_id !== automationId) {
        this._config = { ...cfg, notify_automation_id: automationId };
        fireEvent(this, "config-changed", { config: this._config });
      }
      await setAutomationEnabled(this.hass, automationId, true);
      this._notifyStatus = "success";
      this._notifyDetail = "";
    } catch (e) {
      this._notifyStatus = "error";
      this._notifyDetail = e instanceof Error ? e.message : String(e);
    } finally {
      this._notifyBusy = false;
    }
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitiesSchema(): SchemaEntry[] {
    const mode = this._config?.mode ?? "consumption";
    const period = this._config?.period ?? "day";
    const source = this._config?.source ?? "entity";

    const modeField: SchemaEntry = {
      name: "mode",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "consumption", label: this._t("editor_energy_mode_consumption") },
            { value: "solar", label: this._t("editor_energy_mode_solar") },
          ],
        },
      },
    };

    if (mode === "solar") {
      const fields: SchemaEntry[] = [
        modeField,
        {
          name: "source",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "energy", label: this._t("editor_energy_source_energy") },
                { value: "entity", label: this._t("editor_energy_source_entity") },
              ],
            },
          },
        },
      ];
      if (source !== "energy") {
        fields.push({ name: "entity", required: true, selector: { entity: { domain: "sensor" } } });
      }
      fields.push({
        name: "statistic_type",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "state", label: this._t("editor_energy_statistic_type_state") },
              { value: "change", label: this._t("editor_energy_statistic_type_change") },
            ],
          },
        },
      });
      fields.push({ name: "forecast_entity", selector: { entity: { domain: "sensor" } } });
      fields.push({ name: "full_day", selector: { boolean: {} } });
      return fields;
    }

    const spanField: SchemaEntry =
      period === "hour"
        ? {
            name: "hours",
            selector: {
              number: {
                mode: "slider",
                min: ENERGY_MIN_HOURS,
                max: ENERGY_MAX_HOURS,
                step: 1,
              },
            },
          }
        : period === "month"
          ? {
              name: "months",
              selector: {
                number: {
                  mode: "slider",
                  min: ENERGY_MIN_MONTHS,
                  max: ENERGY_MAX_MONTHS,
                  step: 1,
                },
              },
            }
          : {
              name: "days",
              selector: {
                number: {
                  mode: "slider",
                  min: ENERGY_MIN_DAYS,
                  max: ENERGY_MAX_DAYS,
                  step: 1,
                },
              },
            };

    return [
      modeField,
      {
        name: "period",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "day", label: this._t("editor_energy_period_day") },
              { value: "hour", label: this._t("editor_energy_period_hour") },
              { value: "month", label: this._t("editor_energy_period_month") },
            ],
          },
        },
      },
      { name: "entity", required: true, selector: { entity: { domain: "sensor" } } },
      {
        name: "statistic_type",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "state", label: this._t("editor_energy_statistic_type_state") },
              { value: "change", label: this._t("editor_energy_statistic_type_change") },
            ],
          },
        },
      },
      spanField,
    ];
  }

  private _contentSchema(): SchemaEntry[] {
    const mode = this._config?.mode ?? "consumption";
    const period = this._config?.period ?? "day";
    const fields: SchemaEntry[] = [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "subtitle", selector: { text: {} } },
      { name: "unit", selector: { text: {} } },
    ];
    if (mode === "solar") {
      fields.push({ name: "show_legend", selector: { boolean: {} } });
    } else if (period === "month") {
      fields.push(
        { name: "show_projection", selector: { boolean: {} } },
        { name: "show_average", selector: { boolean: {} } },
        { name: "show_comparison", selector: { boolean: {} } },
        { name: "higher_is_better", selector: { boolean: {} } },
      );
    } else {
      fields.push({ name: "show_values", selector: { boolean: {} } });
    }
    return fields;
  }

  private _notifySchema(): SchemaEntry[] {
    return [
      notifyModeSchema([
        { value: "day_end", label: this._t("editor_energy_notify_mode_day_end") },
        { value: "month_end", label: this._t("editor_energy_notify_mode_month_end") },
      ]),
      { name: "notify_entity", selector: { entity: { domain: "sensor" } } },
      notifyServiceSchema(this.hass),
      notifyTimeSchema(),
      notifyTitleSchema("notify_title"),
      notifyMessageSchema("notify_message"),
    ];
  }

  private _animationSchema(): SchemaEntry[] {
    return [
      {
        name: "animation",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_progress_animation_auto") },
              { value: "on", label: this._t("editor_progress_animation_on") },
              { value: "off", label: this._t("editor_progress_animation_off") },
            ],
          },
        },
      },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      mode: "editor_energy_mode",
      source: "editor_energy_source",
      period: "editor_energy_period",
      entity: "editor_energy_entity",
      statistic_type: "editor_energy_statistic_type",
      days: "editor_energy_days",
      hours: "editor_energy_hours",
      months: "editor_energy_months",
      forecast_entity: "editor_energy_forecast_entity",
      full_day: "editor_energy_full_day",
      name: "editor_name",
      icon: "editor_icon",
      subtitle: "editor_energy_subtitle",
      unit: "editor_energy_unit",
      show_values: "editor_energy_show_values",
      show_legend: "editor_energy_show_legend",
      show_projection: "editor_energy_show_projection",
      show_average: "editor_energy_show_average",
      show_comparison: "editor_energy_show_comparison",
      higher_is_better: "editor_energy_higher_is_better",
      notify_mode: "editor_notify_mode",
      notify_entity: "editor_energy_notify_entity",
      notify_service: "editor_notify_service",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      notify_time: "editor_notify_time",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _colorChanged(
    field:
      | "accent_color"
      | "bar_tint_color"
      | "text_color"
      | "secondary_text_color"
      | "card_background"
      | "comparison_better_color"
      | "comparison_worse_color",
    value: string,
  ): void {
    if (!this._config) return;
    if (value) {
      this._config = { ...this._config, [field]: value };
    } else {
      const { [field]: _removed, ...rest } = this._config;
      this._config = rest;
    }
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _opacityChanged(field: "accent_opacity" | "comparison_tint_opacity", value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _radiusPresetChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = radiusPresetPatch(ev.detail.value.radius_preset as string);
    this._appearance = { ...this._appearance, showCustomRadius: patch.showCustomRadius };
    if (patch.radius !== undefined) {
      this._config = { ...this._config, radius: patch.radius };
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornersToggleChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const showCorners = ev.detail.value.use_corners as boolean;
    this._appearance = { ...this._appearance, showCorners };
    if (!showCorners) {
      const { corners, ...rest } = this._config;
      this._config = rest;
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornerPresetChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const patch = cornerPresetPatch(ev.detail.value[key] as string);
    this._appearance = {
      ...this._appearance,
      cornerCustom: { ...this._appearance.cornerCustom, [key]: patch.custom },
    };
    if (patch.px !== undefined) {
      this._config = { ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } };
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const px = ev.detail.value[key] as number;
    this._config = { ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;

    const mode = this._config.mode ?? "consumption";
    const entitiesData = {
      mode,
      source: this._config.source ?? "entity",
      period: this._config.period ?? "day",
      entity: this._config.entity,
      statistic_type: this._config.statistic_type ?? (mode === "solar" ? "change" : "state"),
      days: this._config.days ?? DEFAULT_ENERGY_DAYS,
      hours: this._config.hours ?? DEFAULT_ENERGY_HOURS,
      months: this._config.months ?? DEFAULT_ENERGY_MONTHS,
      forecast_entity: this._config.forecast_entity,
      full_day: this._config.full_day ?? false,
    };
    const contentData = {
      name: this._config.name,
      icon: this._config.icon,
      subtitle: this._config.subtitle,
      unit: this._config.unit,
      show_values: this._config.show_values ?? false,
      show_legend: this._config.show_legend ?? true,
      show_projection: this._config.show_projection ?? true,
      show_average: this._config.show_average ?? true,
      show_comparison: this._config.show_comparison ?? true,
      higher_is_better: this._config.higher_is_better ?? false,
    };
    const animationData = { animation: this._config.animation ?? "auto" };
    const notifyData = {
      notify_mode: this._config.notify_mode ?? "day_end",
      notify_entity: this._config.notify_entity ?? "",
      notify_service: this._config.notify_service ?? [],
      notify_time: this._config.notify_time ?? DEFAULT_ENERGY_NOTIFY_TIME,
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:database"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${entitiesData}
              .schema=${this._entitiesSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${this._showFallbackHint
              ? html`<div class="hint">${this._t("editor_energy_fallback_hint")}</div>`
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_content")}>
          <ha-icon slot="leading-icon" icon="mdi:text-short"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${contentData}
              .schema=${this._contentSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_notify")}>
          <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_notify_hint")}</div>
            <div class="hint">${this._t("editor_energy_notify_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${notifyData}
              .schema=${this._notifySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${this._notifySupported
              ? html`<div class="hint">${this._t(this._notifyScopeHint)}</div>`
              : nothing}
            <div class="hint">${notifyTokenHint(this._language, ["wert", "einheit", "zeitraum"])}</div>
            ${renderNotifyControls({
              hass: this.hass,
              enabled: this._config.notify_enabled ?? false,
              automationId: this._config.notify_automation_id,
              blockedReason: !this._notifySupported
                ? this._t(this._notifyScopeHint)
                : this._config.notify_service?.length
                  ? undefined
                  : this._t("editor_notify_missing"),
              language: this._language,
              busy: this._notifyBusy,
              status: this._notifyStatus,
              detail: this._notifyDetail,
              onToggle: (on) => this._toggleNotify(on),
              onSetup: () => this._setupNotify(),
            })}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_progress_colors_helper")}</div>
            ${colorRow(
              this._t("editor_energy_accent_color"),
              this._config.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config.accent_opacity,
                defaultValue: 18,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
            ${colorRow(
              this._t("editor_energy_bar_tint_color"),
              this._config.bar_tint_color,
              (v) => this._colorChanged("bar_tint_color", v),
            )}
            ${colorRow(
              this._t("editor_progress_text_color"),
              this._config.text_color,
              (v) => this._colorChanged("text_color", v),
            )}
            ${colorRow(
              this._t("editor_progress_secondary_text_color"),
              this._config.secondary_text_color,
              (v) => this._colorChanged("secondary_text_color", v),
            )}
            ${colorRow(
              this._t("editor_progress_card_background"),
              this._config.card_background,
              (v) => this._colorChanged("card_background", v),
            )}
            ${mode !== "solar" && (this._config.period ?? "day") === "month"
              ? html`
                  ${colorRow(
                    this._t("editor_energy_comparison_better_color"),
                    this._config.comparison_better_color,
                    (v) => this._colorChanged("comparison_better_color", v),
                  )}
                  ${colorRow(
                    this._t("editor_energy_comparison_worse_color"),
                    this._config.comparison_worse_color,
                    (v) => this._colorChanged("comparison_worse_color", v),
                  )}
                  ${opacityRow(
                    this._t("editor_energy_comparison_tint_opacity"),
                    this._config.comparison_tint_opacity,
                    16,
                    (v) => this._opacityChanged("comparison_tint_opacity", v),
                  )}
                `
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:chart-bar"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${animationData}
              .schema=${this._animationSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_progress_animation_reduced_motion_hint")}</div>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_ENERGY_RADIUS,
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
    notifyStyles,
    css`
      .hint.warn {
        color: var(--warning-color, #ffa600);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-energy-card-editor": M3EnergyCardEditor;
  }
}
