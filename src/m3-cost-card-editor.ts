import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3CostCardConfig } from "./types";
import {
  DEFAULT_COST_RADIUS,
  DEFAULT_COST_CURRENCY,
  DEFAULT_COST_NOTIFY_PERCENT,
  DEFAULT_COST_NOTIFY_TIME,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  fireEvent,
  colorRow,
  editorStyles,
  type SchemaEntry,
} from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";
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
} from "./shared/notify-editor";
import { formatCurrencyParts } from "./shared/pricing";
import { detectCounterKind, type CounterKind } from "./shared/ha-statistics";

// Days in the current month as a Jinja expression — HA has no helper for it.
const DAYS_IN_MONTH =
  "((now().replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day";

/**
 * The month's use of a running counter in Jinja, as `runningDayUse` counts it
 * in the card: the step from one day's last reading to the next, the reading
 * itself after a drop below 90 % (a reset), nothing after a shallower one.
 */
function runningQtyTemplate(entity: string): string {
  return (
    "{% set ns = namespace(prev=none, total=0) %}" +
    `{% for r in (m3_stats.statistics['${entity}'] | default([])) %}` +
    "{% set v = r.state | float(0) %}" +
    "{% if ns.prev is not none %}" +
    "{% set reset = v < ns.prev - ([0.01, (ns.prev * 0.001) | abs] | max) and v < ns.prev * 0.9 %}" +
    "{% set ns.total = ns.total + ([v if reset else v - ns.prev, 0] | max) %}" +
    "{% endif %}" +
    "{% set ns.prev = v %}" +
    "{% endfor %}{{ ns.total }}"
  );
}

@customElement("m3-cost-card-editor")
export class M3CostCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CostCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";

  public setConfig(config: M3CostCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_COST_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _notifyMode(): "budget" | "month_end" {
    return this._config?.notify_mode === "month_end" ? "month_end" : "budget";
  }

  // The price per kWh (or per custom unit) as a Jinja expression, in the
  // card's base currency unit. undefined means "not reachable from entities
  // and config alone" — which is exactly the energy_dashboard case: HA keeps
  // that price inside the cost *statistics*, never in an entity state.
  private _priceExpression(): string | undefined {
    const cfg = this._config;
    if (!cfg) return undefined;
    if (cfg.price_source === "fixed") {
      if (typeof cfg.price !== "number") return undefined;
      return String(cfg.price_unit === "ct_per_kwh" ? cfg.price / 100 : cfg.price);
    }
    if (cfg.price_source === "input_number" && cfg.price_entity) {
      const st = this.hass?.states[cfg.price_entity];
      if (!st) return undefined;
      // Same unit inference as resolveCurrentPrice() — the helper's own
      // unit_of_measurement decides when the config doesn't say.
      const unit =
        cfg.price_unit ??
        (/ct|cent|¢/i.test(String(st.attributes.unit_of_measurement ?? ""))
          ? "ct_per_kwh"
          : "eur_per_kwh");
      // Read live, so a tariff change is picked up without rebuilding the
      // automation.
      return `(states('${cfg.price_entity}') | float(0)${unit === "ct_per_kwh" ? " * 0.01" : ""})`;
    }
    return undefined;
  }

  /**
   * The actions that work out the month's cost, plus the expression that names
   * it. Not a plain Jinja expression over `states()` any more, and that is the
   * whole point of this: for a counter, `states()` is the meter reading, not
   * the period's consumption. On the author's install the card said 112.66 €
   * for August while its own notification said 26,844.38 € — the reading times
   * the price.
   *
   * `recorder.get_statistics` reads exactly what the card reads, with the same
   * statistic type and the same unit normalisation, so the two can no longer
   * disagree. A template can reach neither statistics nor history, so this has
   * to be an action rather than a variable.
   */
  private _costPlan(
    mode: "budget" | "month_end",
    detected?: CounterKind,
  ): { prelude: Record<string, unknown>[]; expr: string; entity: string } | { error: TranslationKey } {
    const cfg = this._config;
    // Defaults to the card's own entity: a separate picker invited exactly the
    // mismatch that caused this, where the notification read a different sensor
    // from the card above it.
    const entity = cfg?.notify_cost_entity || cfg?.entity;
    const st = entity ? this.hass?.states[entity] : undefined;
    if (!cfg || !entity || !st) return { error: "editor_cost_notify_no_entity" };

    const monetary = st.attributes.device_class === "monetary";
    const isCustom = cfg.price_unit === "custom";
    // Mirrors the card: the configured type, else what the card detects from
    // the readings (#55) — a counter that keeps counting is summed by the
    // differences between its last readings per day, a daily counter by
    // those readings. A cost entity is summed by its change, the way the card
    // sums the energy dashboard's cost sensors.
    const configured = cfg.statistic_type === "auto" ? undefined : cfg.statistic_type;
    const running = !monetary && !configured && detected === "running";
    const statType = monetary ? "change" : (configured ?? "state");

    let quantityToCost: string;
    if (monetary) {
      quantityToCost = "m3_qty";
    } else {
      const price = this._priceExpression();
      if (!price) return { error: "editor_cost_notify_no_price" };
      quantityToCost = isCustom
        ? `m3_qty * ${cfg.price_quantity_factor ?? 1} * ${price}`
        : `m3_qty * ${price}`;
    }

    const baseFee = cfg.base_fee ?? 0;
    const expr =
      baseFee === 0
        ? quantityToCost
        : mode === "month_end"
          ? `${quantityToCost} + ${baseFee}`
          : `${quantityToCost} + (${baseFee} * now().day / ${DAYS_IN_MONTH})`;

    // Same normalisation the card asks the recorder for. Skipped in custom
    // mode, where the user's own factor does the converting.
    const deviceClass = String(st.attributes.device_class ?? "");
    const units =
      monetary || isCustom
        ? undefined
        : deviceClass === "gas" || deviceClass === "water"
          ? { volume: "m³" }
          : { energy: "kWh" };

    const prelude: Record<string, unknown>[] = [
      {
        action: "recorder.get_statistics",
        data: {
          // A running counter needs the last day of the month before to
          // count the first of this one from.
          start_time: running
            ? "{{ now().replace(day=1, hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1) }}"
            : "{{ now().replace(day=1, hour=0, minute=0, second=0, microsecond=0) }}",
          end_time: "{{ now() }}",
          statistic_ids: [entity],
          period: "day",
          types: [statType],
          ...(units ? { units } : {}),
        },
        response_variable: "m3_stats",
      },
      {
        variables: {
          m3_qty: running
            ? runningQtyTemplate(entity)
            : `{{ (m3_stats.statistics['${entity}'] | default([])) | map(attribute='${statType}') | map('float', 0) | sum }}`,
          m3_cost: `{{ ${expr} }}`,
        },
      },
    ];

    return { prelude, expr, entity };
  }

  private _notifyBlocker(): TranslationKey | undefined {
    const cfg = this._config;
    if (!cfg) return "editor_cost_notify_no_entity";
    if (this._notifyMode === "budget" && !cfg.budget) return "editor_cost_notify_no_budget";
    const plan = this._costPlan(this._notifyMode);
    return "error" in plan ? plan.error : undefined;
  }

  // utility_meter and friends advertise their cycle; a daily or yearly meter
  // would silently answer a different question than "this month". Only a
  // warning — a cron-driven meter can be monthly without saying so.
  // The cycle of a utility_meter no longer matters — the notification sums the
  // month out of the statistics itself, whatever the meter resets on. What does
  // matter is reading a *different* entity from the card, because the card's
  // statistic_type travels with it and may not suit another sensor.
  private _notifyPeriodWarning(): string | undefined {
    const cfg = this._config;
    const chosen = cfg?.notify_cost_entity;
    if (!chosen || !cfg?.entity || chosen === cfg.entity) return undefined;
    return this._t("editor_cost_notify_other_entity");
  }

  private _currencySymbol(): string {
    const currency = this._config?.currency || DEFAULT_COST_CURRENCY;
    try {
      return formatCurrencyParts(0, currency, this._language).symbol;
    } catch {
      return currency; // free-text currency Intl doesn't know
    }
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
    if (!this.hass || !cfg) return;
    const targets = cfg.notify_service ?? [];
    if (targets.length === 0) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t("editor_notify_missing");
      return;
    }
    const blocker = this._notifyBlocker();
    if (blocker) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t(blocker);
      return;
    }
    const mode = this._notifyMode;
    const planEntity = cfg.notify_cost_entity || cfg.entity;
    const planState = planEntity ? this.hass?.states[planEntity] : undefined;
    const detected =
      this.hass &&
      planEntity &&
      (cfg.statistic_type ?? "auto") === "auto" &&
      planState?.attributes.device_class !== "monetary"
        ? await detectCounterKind(this.hass, planEntity, cfg.price_unit !== "custom")
        : undefined;
    const plan = this._costPlan(mode, detected);
    if ("error" in plan) return; // already handled by the blocker check

    this._notifyBusy = true;
    this._notifyStatus = "idle";
    this._notifyDetail = "";
    try {
      const cardName = cfg.name || this._t("cost_default_name");
      const symbol = this._currencySymbol();
      const automationId = resolveAutomationId("cost_notify", cfg.notify_automation_id);
      const valueText = `{{ m3_cost | float(0) | round(2) }} ${symbol}`;
      const base = {
        alias: `${cardName}: ${this._t(
          mode === "budget" ? "editor_cost_notify_alias_budget" : "editor_cost_notify_alias_month_end",
        )}`,
        description: this._t("editor_cost_notify_description"),
        mode: "single" as const,
      };

      let spec: NotifyAutomationSpec;
      if (mode === "budget") {
        const budget = cfg.budget!;
        const percent = cfg.notify_budget_percent ?? DEFAULT_COST_NOTIFY_PERCENT;
        const threshold = Math.round(budget * percent) / 100;
        const message = this._t("editor_cost_notify_budget_message")
          .replace("{value}", valueText)
          .replace("{budget}", `${budget} ${symbol}`)
          .replace("{percent}", `{{ (m3_cost | float(0) / ${budget} * 100) | round(0) }}`);
        spec = {
          id: automationId,
          ...base,
          // This used to be a numeric_state trigger with a value_template, which
          // fires exactly once on the crossing — but a trigger template cannot
          // call a service, and the cost now comes from recorder.get_statistics.
          // So it checks on a schedule instead, and "once per month" is kept by
          // asking the automation when it last fired. `this` is the automation's
          // own state object inside its templates.
          triggers: [{ trigger: "time_pattern", minutes: "/30" }],
          conditions: [
            {
              condition: "template",
              value_template:
                "{{ this.attributes.last_triggered is none or " +
                "this.attributes.last_triggered.month != now().month }}",
            },
          ],
          actions: [
            ...plan.prelude,
            {
              condition: "template",
              value_template: `{{ (m3_cost | float(0)) >= ${threshold} }}`,
            },
            ...notifyActions(targets, cardName, message,
          { title: cfg.notify_title, message: cfg.notify_message, tokens: {
            betrag: valueText,
            waehrung: symbol,
            budget: String(cfg.budget ?? ""),
            zeitraum: "{{ now().strftime('%m/%Y') }}",
          } }),
          ],
        };
      } else {
        const message = this._t("editor_cost_notify_month_end_message")
          .replace("{month}", "{{ now().strftime('%m/%Y') }}")
          .replace("{value}", valueText);
        spec = {
          id: automationId,
          ...base,
          triggers: [{ trigger: "time", at: cfg.notify_time || DEFAULT_COST_NOTIFY_TIME }],
          // "tomorrow is a different month" == "today is the last day of it".
          conditions: [
            {
              condition: "template",
              value_template: "{{ (now() + timedelta(days=1)).month != now().month }}",
            },
          ],
          actions: [
            ...plan.prelude,
            ...notifyActions(targets, cardName, message,
            { title: cfg.notify_title, message: cfg.notify_message, tokens: {
              betrag: valueText,
              waehrung: symbol,
              budget: String(cfg.budget ?? ""),
              zeitraum: "{{ now().strftime('%m/%Y') }}",
            } }),
          ],
        };
      }

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

  private _notifySchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      notifyServiceSchema(this.hass),
      notifyModeSchema([
        { value: "budget", label: this._t("editor_cost_notify_mode_budget") },
        { value: "month_end", label: this._t("editor_cost_notify_mode_month_end") },
      ]),
      { name: "notify_cost_entity", selector: { entity: { domain: "sensor" } } },
    ];
    if (this._notifyMode === "budget") {
      // A budget warning has no schedule: it fires the moment the cost crosses
      // the configured share, so a check time would be misleading.
      schema.push({
        name: "notify_budget_percent",
        selector: { number: { min: 10, max: 200, step: 5, mode: "box", unit_of_measurement: "%" } },
      });
    } else {
      schema.push(notifyTimeSchema());
    }
    schema.push(notifyTitleSchema("notify_title"), notifyMessageSchema("notify_message"));
    return schema;
  }

  private _priceSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "price_source",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "energy_dashboard", label: this._t("editor_cost_price_source_energy_dashboard") },
              { value: "input_number", label: this._t("editor_cost_price_source_input_number") },
              { value: "fixed", label: this._t("editor_cost_price_source_fixed") },
            ],
          },
        },
      },
    ];
    const source = this._config?.price_source ?? "energy_dashboard";
    if (source === "input_number") {
      schema.push({ name: "price_entity", selector: { entity: { domain: "input_number" } } });
    }
    const isCustomUnit = source === "fixed" && this._config?.price_unit === "custom";
    if (source === "fixed") {
      schema.push({ name: "price", selector: { number: { min: 0, step: 0.001, mode: "box" } } });
      schema.push({
        name: "price_unit",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "eur_per_kwh", label: this._t("editor_cost_price_unit_eur") },
              { value: "ct_per_kwh", label: this._t("editor_cost_price_unit_ct") },
              { value: "custom", label: this._t("editor_cost_price_unit_custom") },
            ],
          },
        },
      });
      if (isCustomUnit) {
        schema.push({ name: "price_unit_label", selector: { text: {} } });
        schema.push({
          name: "price_quantity_factor",
          selector: { number: { min: 0, step: 0.0001, mode: "box" } },
        });
      }
    }
    if (source !== "energy_dashboard") {
      schema.push({
        name: "entity",
        selector: { entity: isCustomUnit ? { domain: "sensor" } : { domain: "sensor", device_class: "energy" } },
      });
      schema.push({
        name: "statistic_type",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_cost_statistic_type_auto") },
              { value: "state", label: this._t("editor_cost_statistic_type_state") },
              { value: "change", label: this._t("editor_energy_statistic_type_change") },
            ],
          },
        },
      });
    }
    schema.push({ name: "base_fee", selector: { number: { min: 0, step: 0.5, mode: "box" } } });
    schema.push({ name: "currency", selector: { text: {} } });
    return schema;
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "subtitle", selector: { text: {} } },
      {
        name: "period",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "day", label: this._t("editor_cost_period_day") },
              { value: "month", label: this._t("editor_cost_period_month") },
              { value: "year", label: this._t("editor_cost_period_year") },
            ],
          },
        },
      },
      { name: "show_projection", selector: { boolean: {} } },
      { name: "show_comparison", selector: { boolean: {} } },
      { name: "budget", selector: { number: { min: 0, step: 1, mode: "box" } } },
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
      price_source: "editor_cost_price_source",
      price_entity: "editor_cost_price_entity",
      price: "editor_cost_price",
      price_unit: "editor_cost_price_unit",
      price_unit_label: "editor_cost_price_unit_label",
      price_quantity_factor: "editor_cost_price_quantity_factor",
      entity: "editor_cost_entity",
      statistic_type: "editor_energy_statistic_type",
      base_fee: "editor_cost_base_fee",
      currency: "editor_cost_currency",
      name: "editor_name",
      icon: "editor_icon",
      subtitle: "editor_energy_subtitle",
      period: "editor_cost_period",
      show_projection: "editor_cost_show_projection",
      show_comparison: "editor_cost_show_comparison",
      budget: "editor_cost_budget",
      notify_service: "editor_notify_service",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      notify_mode: "editor_notify_mode",
      notify_time: "editor_notify_time",
      notify_cost_entity: "editor_cost_notify_entity",
      notify_budget_percent: "editor_cost_notify_percent",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _colorChanged(
    field: "accent_color" | "text_color" | "secondary_text_color" | "card_background",
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

  private _opacityChanged(field: "accent_opacity", value: number): void {
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

    const priceData = {
      price_source: this._config.price_source ?? "energy_dashboard",
      price_entity: this._config.price_entity,
      price: this._config.price,
      price_unit: this._config.price_unit ?? "eur_per_kwh",
      price_unit_label: this._config.price_unit_label ?? "",
      price_quantity_factor: this._config.price_quantity_factor ?? 1,
      entity: this._config.entity,
      statistic_type: this._config.statistic_type ?? "auto",
      base_fee: this._config.base_fee ?? 0,
      currency: this._config.currency ?? DEFAULT_COST_CURRENCY,
    };
    const contentData = {
      name: this._config.name,
      icon: this._config.icon,
      subtitle: this._config.subtitle,
      period: this._config.period ?? "month",
      show_projection: this._config.show_projection ?? true,
      show_comparison: this._config.show_comparison ?? true,
      budget: this._config.budget,
    };
    const animationData = { animation: this._config.animation ?? "auto" };
    const notifyData = {
      notify_service: this._config.notify_service ?? [],
      notify_mode: this._notifyMode,
      notify_cost_entity: this._config.notify_cost_entity,
      notify_budget_percent: this._config.notify_budget_percent ?? DEFAULT_COST_NOTIFY_PERCENT,
      notify_time: this._config.notify_time ?? DEFAULT_COST_NOTIFY_TIME,
    };
    const notifyBlocker = this._notifyBlocker();
    const notifyPeriodWarning = this._notifyPeriodWarning();

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_cost_price_section")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:cash-multiple"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${priceData}
              .schema=${this._priceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${this._config.base_fee
              ? html`<div class="hint">${this._t("editor_cost_base_fee_helper")}</div>`
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
            <ha-form
              .hass=${this.hass}
              .data=${notifyData}
              .schema=${this._notifySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_cost_notify_entity_hint")}</div>
            ${this._notifyMode === "month_end"
              ? html`<div class="hint">${this._t("editor_cost_notify_month_end_hint")}</div>`
              : nothing}
            ${notifyPeriodWarning
              ? html`<div class="hint warn">${notifyPeriodWarning}</div>`
              : nothing}
            ${notifyBlocker ? html`<div class="hint warn">${this._t(notifyBlocker)}</div>` : nothing}
            <div class="hint">${notifyTokenHint(this._language, ["betrag", "waehrung", "budget", "zeitraum"])}</div>
            ${renderNotifyControls({
              hass: this.hass,
              enabled: this._config.notify_enabled ?? false,
              automationId: this._config.notify_automation_id,
              blockedReason: notifyBlocker
                ? this._t(notifyBlocker)
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
            ${colorRow(
              this._t("editor_summary_accent_color"),
              this._config.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config.accent_opacity,
                defaultValue: 18,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
            ${colorRow(this._t("editor_progress_text_color"), this._config.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), this._config.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), this._config.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:cash-multiple"></ha-icon>
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
          defaultRadius: DEFAULT_COST_RADIUS,
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
        color: var(--warning-color, #ff9800);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-cost-card-editor": M3CostCardEditor;
  }
}
