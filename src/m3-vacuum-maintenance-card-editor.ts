import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3VacuumMaintenanceCardConfig,
  VacuumReminderConfig,
} from "./types";
import {
  DEFAULT_VACUUM_MAINT_ICON,
  DEFAULT_VACUUM_RADIUS,
  VACUUM_COUNTER_MAX,
  VACUUM_COUNTER_WAIT_MS,
  VACUUM_PART_ALERT_BELOW,
  VACUUM_PART_WARN_BELOW,
} from "./const";
import { collapseBlocksFor, keptWhenFolded } from "./shared/collapse-state";
import { localize, type TranslationKey } from "./localize";
import { colorRow, editorStyles, fireEvent, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  notifyActions,
  notifyMessageSchema,
  notifyServiceSchema,
  notifyStyles,
  notifyTimeSchema,
  notifyTitleSchema,
  notifyTokenHint,
  renderNotifyControls,
  resolveAutomationId,
  saveNotifyAutomation,
  setAutomationEnabled,
} from "./shared/notify-editor";
import { discoverVacuum } from "./shared/vacuum";
import { VACUUM_PART_MAX_HOURS } from "./const";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

const MAINT_FOLD_BLOCKS = ["parts", "reminders", "station", "stats", "settings"] as const;

@customElement("m3-vacuum-maintenance-card-editor")
export class M3VacuumMaintenanceCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3VacuumMaintenanceCardConfig;
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";
  /** Which reminder's helper is being created, and what went wrong if it did. */
  @state() private _counterBusy?: number;
  @state() private _counterError = "";
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3VacuumMaintenanceCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_VACUUM_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3VacuumMaintenanceCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _reminderSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "every_runs", selector: { number: { min: 1, max: 500, mode: "box" } } },
      { name: "every_hours", selector: { number: { min: 1, max: 2000, mode: "box" } } },
      { name: "counter_entity", selector: { entity: { domain: "input_number" } } },
    ];
  }

  private _reminderChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    const list = [...(this._config.reminders ?? [])];
    const next: Record<string, unknown> = { ...list[index], ...patch };
    // A cleared field means "not set", not "set to empty".
    for (const key of Object.keys(next)) {
      if (next[key] === "" || next[key] === null) delete next[key];
    }
    list[index] = next as unknown as VacuumReminderConfig;
    this._emit({ ...this._config, reminders: list });
  }

  private _addReminder(): void {
    if (!this._config) return;
    this._emit({
      ...this._config,
      reminders: [
        ...(this._config.reminders ?? []),
        { name: this._t("vacuum_reminders"), every_runs: 3 },
      ],
    });
  }

  /**
   * Creates the `input_number` a reminder needs in order to be resettable, and
   * wires it into that reminder in one step.
   *
   * WHY THE EDITOR DOES THIS AT ALL
   *
   * Without a helper there is nowhere to write "changed it today", so the
   * reminder can only speak up on every multiple of its interval and can never
   * be ticked off — which is the half of the feature people actually want.
   * Getting one by hand means Settings → Devices & services → Helpers, an
   * `input_number` with a range nobody can guess, and then back here to pick
   * it: three screens for one number, and the step where this was being given
   * up on.
   *
   * The new helper starts at the meter's *current* reading rather than at
   * zero. A helper at zero would mean "last done when the machine was new",
   * so a vacuum with 400 runs behind it would report a mop 397 runs overdue
   * the moment the helper appeared.
   */
  private async _createCounter(index: number): Promise<void> {
    const cfg = this._config;
    const reminder = cfg?.reminders?.[index];
    if (!cfg || !reminder || !this.hass) return;
    this._counterBusy = index;
    this._counterError = "";
    try {
      const name = `${reminder.name || this._t("vacuum_reminders")} — ${this._t("editor_vacuum_counter_suffix")}`;
      const before = new Set(
        Object.keys(this.hass.states).filter((e) => e.startsWith("input_number.")),
      );
      await this.hass.callWS({
        type: "input_number/create",
        name,
        min: 0,
        max: VACUUM_COUNTER_MAX,
        step: 1,
        mode: "box",
        icon: reminder.icon ?? "mdi:calendar-refresh-outline",
      });

      // The create call answers with the collection item, whose `id` is not
      // the entity id — that is generated from the name, and only once the
      // entity has been added. So the new one is waited for rather than
      // guessed at, and matched by friendly name in case the slug collided
      // with an existing helper and picked up a `_2`.
      const entityId = await this._awaitNewHelper(before, name);
      if (!entityId) {
        this._counterError = this._t("editor_vacuum_counter_failed");
        return;
      }

      // Start the count from where the machine is now.
      const totals = discoverVacuum(this.hass, cfg.entity).totals;
      const meterId = reminder.every_hours ? totals.total_time : totals.total_count;
      const meter = parseFloat(this.hass.states[meterId ?? ""]?.state ?? "");
      if (!isNaN(meter)) {
        await this.hass.callService("input_number", "set_value", {
          entity_id: entityId,
          value: Math.floor(meter),
        });
      }

      const list = [...(cfg.reminders ?? [])];
      list[index] = { ...reminder, counter_entity: entityId };
      this._emit({ ...cfg, reminders: list });
    } catch (err) {
      this._counterError = err instanceof Error ? err.message : String(err);
    } finally {
      this._counterBusy = undefined;
    }
  }

  /** Polls `hass.states` for the helper just created. */
  private async _awaitNewHelper(before: Set<string>, name: string): Promise<string | undefined> {
    const deadline = Date.now() + VACUUM_COUNTER_WAIT_MS;
    while (Date.now() < deadline) {
      const fresh = Object.keys(this.hass?.states ?? {}).filter(
        (e) => e.startsWith("input_number.") && !before.has(e),
      );
      const byName = fresh.find(
        (e) => this.hass?.states[e]?.attributes.friendly_name === name,
      );
      if (byName ?? fresh[0]) return byName ?? fresh[0];
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return undefined;
  }

  private _removeReminder(index: number): void {
    if (!this._config) return;
    const list = (this._config.reminders ?? []).filter((_, i) => i !== index);
    if (list.length) {
      this._emit({ ...this._config, reminders: list });
    } else {
      const { reminders: _dropped, ...rest } = this._config;
      this._emit(rest as M3VacuumMaintenanceCardConfig);
    }
  }

  private _notifySchema(): SchemaEntry[] {
    return [
      notifyServiceSchema(this.hass),
      notifyTimeSchema(),
      notifyTitleSchema(),
      notifyMessageSchema(),
    ];
  }

  /**
   * Turning it off pauses the automation rather than deleting it, so the
   * wording and the target survive a toggle round-trip.
   */
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

  /**
   * Builds the automation that reports parts coming due.
   *
   * A daily digest rather than a trigger per sensor, and for a concrete
   * reason: the sensors report hours left against six different service
   * lives, so "below 25 %" is six different numbers. Working that out once a
   * day in one template is both simpler and quieter than six numeric_state
   * triggers that would each fire on their own.
   */
  private async _setupNotify(): Promise<void> {
    const cfg = this._config;
    if (!this.hass || !cfg) return;
    const targets = cfg.notify_service ?? [];
    if (targets.length === 0) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t("editor_vacuum_notify_missing");
      return;
    }
    this._notifyBusy = true;
    this._notifyStatus = "idle";
    this._notifyDetail = "";
    try {
      const found = discoverVacuum(this.hass, cfg.entity);
      const parts = Object.entries(found.consumables);
      if (!parts.length) throw new Error("no consumable sensors");

      const warn = (cfg.warn_below ?? VACUUM_PART_WARN_BELOW) / 100;
      // entity_id -> the hours that count as "due" for that part.
      const limits: Record<string, number> = {};
      for (const [key, entityId] of parts) {
        const max = VACUUM_PART_MAX_HOURS[key];
        if (max) limits[entityId] = Math.round(max * warn);
      }
      // Reminders join the same digest: both answer "what needs doing", and
      // two automations that each send a list every morning is one too many.
      const reminders = (cfg.reminders ?? []).filter((r) => r.every_runs || r.every_hours);
      if (!Object.keys(limits).length && !reminders.length) {
        throw new Error("nothing to report: no part has a known service life and no reminders");
      }

      const cardName = cfg.name || this._t("vacuum_maint_title");
      const automationId = resolveAutomationId(
        "vacuum_parts",
        cfg.notify_automation_id,
      );

      // Collect the names of every part under its own limit. `float(1e9)`
      // makes an unavailable sensor read as "plenty left" rather than as
      // overdue, so a restart does not produce a false alarm.
      // Each reminder becomes {name, meter entity, interval, mark entity}, so
      // the template can do the same "is it due" arithmetic the card does —
      // multiples without a mark, difference with one.
      const reminderSpecs = reminders.map((r) => ({
        n: r.name,
        m: r.every_hours ? found.totals.total_time : found.totals.total_count,
        e: r.every_hours ?? r.every_runs,
        h: r.every_hours ? 1 : 0,
        c: r.counter_entity ?? "",
      }));

      const listTemplate =
        `{% set limits = ${JSON.stringify(limits)} %}` +
        `{% set rem = ${JSON.stringify(reminderSpecs)} %}` +
        `{% set ns = namespace(items=[]) %}` +
        `{% for e, limit in limits.items() %}{% set s = states[e] %}` +
        `{% if s is not none and s.state not in ['unknown', 'unavailable'] %}` +
        `{% if s.state | float(1e9) <= limit %}` +
        `{% set ns.items = ns.items + [s.name] %}` +
        `{% endif %}{% endif %}{% endfor %}` +
        `{% for r in rem %}` +
        `{% set meter = states(r.m) | float(-1) %}` +
        `{% if meter >= 0 %}` +
        `{% if r.c != '' %}` +
        `{% if meter - (states(r.c) | float(0)) >= r.e %}` +
        `{% set ns.items = ns.items + [r.n] %}{% endif %}` +
        `{% elif r.h == 0 and meter | int > 0 and (meter | int) % (r.e | int) == 0 %}` +
        `{% set ns.items = ns.items + [r.n] %}` +
        `{% endif %}{% endif %}{% endfor %}` +
        `{{ ns.items }}`;

      await saveNotifyAutomation(this.hass, {
        id: automationId,
        alias: `${cardName}: ${this._t(
          reminders.length
            ? "editor_vacuum_notify_reminder_alias"
            : "editor_vacuum_notify_parts_alias",
        )}`,
        description: this._t(
          reminders.length
            ? "editor_vacuum_notify_reminder_description"
            : "editor_vacuum_notify_parts_description",
        ),
        mode: "single",
        variables: { due: listTemplate },
        triggers: [{ trigger: "time", at: cfg.notify_time || "09:00:00" }],
        // Nothing due means nothing said. Without this the automation would
        // send "Due: []" every morning, which is how people mute a channel.
        conditions: [{ condition: "template", value_template: "{{ due | count > 0 }}" }],
        actions: notifyActions(
          targets,
          cardName,
          this._t("editor_vacuum_notify_parts_body").replace("{teile}", "{{ due | join(', ') }}"),
          {
            title: cfg.notify_title,
            message: cfg.notify_message,
            tokens: { teile: "{{ due | join(', ') }}", anzahl: "{{ due | count }}" },
          },
        ),
      });

      this._emit({ ...cfg, notify_automation_id: automationId, notify_enabled: true });
      await setAutomationEnabled(this.hass, automationId, true);
      this._notifyStatus = "success";
    } catch (e) {
      this._notifyStatus = "error";
      this._notifyDetail = String(e).slice(0, 160);
    } finally {
      this._notifyBusy = false;
    }
  }

  private _deviceSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: { domain: "vacuum" } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _thresholdSchema(): SchemaEntry[] {
    return [
      { name: "warn_below", selector: { number: { min: 1, max: 90, mode: "box", unit_of_measurement: "%" } } },
      { name: "alert_below", selector: { number: { min: 0, max: 80, mode: "box", unit_of_measurement: "%" } } },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "show_station", selector: { boolean: {} } },
      { name: "show_stats", selector: { boolean: {} } },
      { name: "show_settings", selector: { boolean: {} } },
      { name: "show_reset", selector: { boolean: {} } },
      { name: "collapsible", selector: { boolean: {} } },
      {
        name: "collapse_keep",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "parts", label: this._t("editor_vacuum_maint") },
              { value: "reminders", label: this._t("vacuum_reminders") },
              { value: "station", label: this._t("editor_vacuum_show_station") },
              { value: "stats", label: this._t("editor_vacuum_show_stats") },
              { value: "settings", label: this._t("editor_vacuum_show_settings") },
            ],
          },
        },
      },
      { name: "default_collapsed", selector: { boolean: {} } },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      warn_below: "editor_vacuum_warn_below",
      alert_below: "editor_vacuum_alert_below",
      show_station: "editor_vacuum_show_station",
      show_stats: "editor_vacuum_show_stats",
      show_settings: "editor_vacuum_show_settings",
      show_reset: "editor_vacuum_show_reset",
      every_runs: "editor_vacuum_every_runs",
      every_hours: "editor_vacuum_every_hours",
      counter_entity: "editor_vacuum_counter_entity",
      notify_service: "editor_notify_service",
      notify_time: "editor_vacuum_notify_time",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      collapsible: "editor_vacuum_collapsible",
      collapse_keep: "editor_fold_keep",
      default_collapsed: "editor_vacuum_default_collapsed",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next: Record<string, unknown> = {
      ...this._config,
      ...(ev.detail.value as Record<string, unknown>),
    };
    // A cleared field means "use the default", not "show nothing".
    for (const key of ["name", "icon"]) {
      if (next[key] === "") delete next[key];
    }
    // The editor's list is what stays; the config keeps what folds.
    if ("collapse_keep" in next) {
      const blocks = collapseBlocksFor(MAINT_FOLD_BLOCKS, ((next as Record<string, unknown>).collapse_keep ?? []) as never[]);
      delete (next as Record<string, unknown>).collapse_keep;
      if (blocks) next.collapse_blocks = blocks as never;
      else delete next.collapse_blocks;
    }
    this._emit(next as unknown as M3VacuumMaintenanceCardConfig);
  }

  private _colorChanged(
    field: "accent_color" | "text_color" | "secondary_text_color" | "card_background",
    value: string,
  ): void {
    if (!this._config) return;
    if (value) {
      this._emit({ ...this._config, [field]: value });
    } else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3VacuumMaintenanceCardConfig);
    }
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
      this._emit(rest as M3VacuumMaintenanceCardConfig);
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
      this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } });
    }
  }

  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const px = ev.detail.value[key] as number;
    this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;

    const deviceData = { entity: cfg.entity ?? "", name: cfg.name ?? "", icon: cfg.icon ?? "" };
    const thresholdData = {
      warn_below: cfg.warn_below ?? VACUUM_PART_WARN_BELOW,
      alert_below: cfg.alert_below ?? VACUUM_PART_ALERT_BELOW,
    };
    const notifyData = {
      notify_service: cfg.notify_service ?? [],
      notify_time: cfg.notify_time ?? "09:00:00",
      notify_title: cfg.notify_title ?? "",
      notify_message: cfg.notify_message ?? "",
    };
    const displayData = {
      show_station: cfg.show_station ?? true,
      show_stats: cfg.show_stats ?? true,
      show_settings: cfg.show_settings ?? false,
      show_reset: cfg.show_reset ?? false,
      collapsible: cfg.collapsible ?? false,
      collapse_keep: keptWhenFolded(MAINT_FOLD_BLOCKS, cfg.collapse_blocks),
      default_collapsed: cfg.default_collapsed ?? false,
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_device")} expanded>
          <ha-icon slot="leading-icon" icon=${DEFAULT_VACUUM_MAINT_ICON}></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${deviceData}
              .schema=${this._deviceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_vacuum_entity_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_maint")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:gauge"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${thresholdData}
              .schema=${this._thresholdSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_display")}>
          <ha-icon slot="leading-icon" icon="mdi:view-list-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${displayData}
              .schema=${this._displaySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_vacuum_reset_hint")}</div>
            <div class="hint">${this._t("editor_vacuum_collapse_blocks_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("vacuum_reminders")}>
          <ha-icon slot="leading-icon" icon="mdi:calendar-refresh-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_vacuum_reminders_hint")}</div>
            ${(cfg.reminders ?? []).map(
              (reminder, index) => html`
                <ha-expansion-panel outlined .header=${reminder.name || `#${index + 1}`}>
                  <div class="panel-content">
                    <ha-form
                      .hass=${this.hass}
                      .data=${{
                        name: reminder.name ?? "",
                        icon: reminder.icon ?? "",
                        every_runs: reminder.every_runs,
                        every_hours: reminder.every_hours,
                        counter_entity: reminder.counter_entity ?? "",
                      }}
                      .schema=${this._reminderSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${(ev: CustomEvent) => this._reminderChanged(index, ev)}
                    ></ha-form>
                    ${reminder.counter_entity
                      ? nothing
                      : html`
                          <button
                            class="add-btn"
                            ?disabled=${this._counterBusy !== undefined}
                            @click=${() => void this._createCounter(index)}
                          >
                            <ha-icon icon="mdi:counter"></ha-icon>
                            ${this._counterBusy === index
                              ? this._t("editor_vacuum_counter_creating")
                              : this._t("editor_vacuum_counter_create")}
                          </button>
                          <div class="hint">${this._t("editor_vacuum_counter_create_hint")}</div>
                        `}
                    ${this._counterError
                      ? html`<div class="hint error">${this._counterError}</div>`
                      : nothing}
                    <button class="remove-btn" @click=${() => this._removeReminder(index)}>
                      ${this._t("editor_appliance_remove")}
                    </button>
                  </div>
                </ha-expansion-panel>
              `,
            )}
            <button class="add-btn" @click=${() => this._addReminder()}>
              <ha-icon icon="mdi:plus"></ha-icon>
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_notify")}>
          <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
          <div class="panel-content">
            ${renderNotifyControls({
              hass: this.hass,
              language: this._language,
              enabled: cfg.notify_enabled ?? false,
              automationId: cfg.notify_automation_id,
              busy: this._notifyBusy,
              status: this._notifyStatus,
              detail: this._notifyDetail,
              onToggle: (enabled) => void this._toggleNotify(enabled),
              onSetup: () => void this._setupNotify(),
            })}
            <ha-form
              .hass=${this.hass}
              .data=${notifyData}
              .schema=${this._notifySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_vacuum_notify_parts_hint")}</div>
            <div class="hint">${notifyTokenHint(this._language, ["teile", "anzahl"])}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_search_accent_color"), cfg.accent_color, (v) =>
              this._colorChanged("accent_color", v),
            )}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) =>
              this._colorChanged("text_color", v),
            )}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) =>
              this._colorChanged("card_background", v),
            )}
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: cfg,
          defaultRadius: DEFAULT_VACUUM_RADIUS,
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
    // This editor's three list buttons — add a reminder, create its helper,
    // remove it — were carrying classes nothing styled, so they rendered as
    // bare browser buttons inside an otherwise Material form.
    css`
      .add-btn,
      .remove-btn {
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
        font-size: 14px;
        font-family: inherit;
      }

      .add-btn[disabled] {
        opacity: 0.5;
        cursor: default;
      }

      .remove-btn {
        color: var(--error-color, #e57368);
      }

      .hint.error {
        color: var(--error-color, #e57368);
        opacity: 0.9;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-vacuum-maintenance-card-editor": M3VacuumMaintenanceCardEditor;
  }
}
