import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, HostSource, LovelaceCardEditor, M3NasCardConfig } from "./types";
import {
  DEFAULT_NAS_RADIUS,
  DEFAULT_NAS_MAX_VISIBLE,
  DEFAULT_NAS_DISK_WARN,
  DEFAULT_NAS_DISK_CRITICAL,
  DEFAULT_NAS_TEMP_WARN,
  DEFAULT_NAS_TEMP_CRITICAL,
  DEFAULT_NAS_NOTIFY_DISK,
  DEFAULT_NAS_OFFLINE_MINUTES,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  defaultHostSource,
  discoverHostEntities,
  prettyLabel,
  type HostRegistryEntry,
} from "./shared/nas-discovery";
import { fireEvent, colorRow, opacityRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  notifyServiceSchema,
  notifyTitleSchema,
  notifyMessageSchema,
  notifyTokenHint,
  renderNotifyControls,
  setAutomationEnabled,
  saveNotifyAutomation,
  notifyActions,
  triggerStatePrelude,
  notifySampleEntity,
  resolveAutomationId,
  notifyStyles,
  type NotifyAutomationSpec,
} from "./shared/notify-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

// Resolves the display name for whichever entity fired, falling back to the
// entity's own name if it was added after the automation was written.
const NAME_EXPR = "{{ nas_names.get(s.entity_id, s.name) }}";

@customElement("m3-nas-card-editor")
export class M3NasCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3NasCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";
  @state() private _syncEntities: string[] = [];
  @state() private _diskEntities: string[] = [];
  /** entity_id → the name the card shows, baked into the notification. */
  @state() private _prettyNames: Record<string, string> = {};
  private _registryLoaded = false;
  private _loadedSource?: HostSource;

  public setConfig(config: M3NasCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_NAS_RADIUS);
    // Switching the source in the dropdown has to re-resolve the volume list,
    // otherwise the notification automation would keep the old source's
    // entities.
    if (this._loadedSource !== this._source) this._registryLoaded = false;
    this._loadRegistry();
  }

  protected updated(): void {
    if (this.hass && !this._registryLoaded) this._loadRegistry();
  }

  // The automation has to watch exactly the entities the card lists, so the
  // editor resolves them the same way the card does — by platform, not by
  // display name.
  private async _loadRegistry(): Promise<void> {
    if (!this.hass || this._registryLoaded) return;
    this._registryLoaded = true;
    const source = this._source;
    this._loadedSource = source;
    try {
      const reg = await this.hass.callWS<HostRegistryEntry[]>({ type: "config/entity_registry/list" });
      const { byMetric, sync } = discoverHostEntities(reg, source, this._config?.config_entry_id);
      const names: Record<string, string> = {};
      for (const id of sync) {
        // Syncthing's friendly_name is the whole connection string plus the
        // device id plus the folder twice — the label attribute is the part a
        // person recognises.
        names[id] = this.hass!.states[id]?.attributes.label || id;
      }
      const disks = byMetric.disk_usage ?? [];
      for (const e of disks) {
        names[e.entityId] = this._config?.mount_names?.[e.label] ?? prettyLabel(source, e.label);
      }
      this._syncEntities = sync;
      this._diskEntities = disks.map((e) => e.entityId);
      this._prettyNames = names;
    } catch {
      this._syncEntities = [];
      this._diskEntities = [];
      this._prettyNames = {};
    }
  }

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
    this._notifyBusy = true;
    this._notifyStatus = "idle";
    this._notifyDetail = "";
    try {
      const cardName = cfg.name || this._t("nas_default_name");
      const wantSync = cfg.notify_sync_errors !== false && this._syncEntities.length > 0;
      const wantDisk = cfg.notify_disk_full !== false && this._diskEntities.length > 0;
      const wantOffline = cfg.notify_offline === true && this._diskEntities.length > 0;
      const threshold = cfg.notify_disk_threshold ?? DEFAULT_NAS_NOTIFY_DISK;
      const offlineMinutes = cfg.notify_offline_minutes ?? DEFAULT_NAS_OFFLINE_MINUTES;

      const triggers: Record<string, unknown>[] = [];
      if (wantSync) {
        // "paused" is a deliberate user choice, never a fault — only real
        // errors trigger. A folder can also accumulate pull errors while its
        // state stays "idle", so the attributes are watched separately.
        triggers.push({ trigger: "state", entity_id: this._syncEntities, to: "error", id: "sync" });
        triggers.push({
          trigger: "numeric_state",
          entity_id: this._syncEntities,
          attribute: "pull_errors",
          above: 0,
          id: "sync",
        });
        triggers.push({
          trigger: "numeric_state",
          entity_id: this._syncEntities,
          attribute: "errors",
          above: 0,
          id: "sync",
        });
      }
      if (wantDisk) {
        triggers.push({ trigger: "numeric_state", entity_id: this._diskEntities, above: threshold, id: "disk" });
      }
      if (wantOffline) {
        triggers.push({
          trigger: "state",
          entity_id: this._diskEntities,
          to: "unavailable",
          for: { minutes: offlineMinutes },
          id: "offline",
        });
      }
      if (!triggers.length) throw new Error("no trigger selected");

      // Run by hand from the automation menu there is no trigger context, so
      // `s` and `tid` fall back to the first branch that is actually enabled —
      // the test message then reads like the real one.
      // Like the other cards: demo with something that is actually in trouble,
      // so the test message does not read "sync problem on X: idle".
      const sample = wantSync
        ? notifySampleEntity(this.hass, this._syncEntities, (st) =>
            st.state === "error" ||
            Number(st.attributes.pull_errors ?? 0) > 0 ||
            Number(st.attributes.errors ?? 0) > 0)
        : notifySampleEntity(this.hass, this._diskEntities, (st) => Number(st.state) > threshold);
      const fallbackId = wantSync ? "sync" : wantDisk ? "disk" : "offline";
      const prelude =
        triggerStatePrelude(sample) +
        `{% set tid = trigger.id if trigger is defined and trigger.id is defined` +
        ` else '${fallbackId}' %}`;

      const automation = {
        alias: `${cardName}: ${this._t("editor_nas_notify_alias")}`,
        description: this._t("editor_nas_notify_description"),
        mode: "queued" as const,
        triggers,
        conditions: [],
        // The raw friendly_name is unusable here ("Syncthing (http://...) ABCDEFG
        // HA Share HA Share"), so the names the card displays are resolved once
        // and written into the automation as a lookup.
        // Wrapped in a template on purpose: Home Assistant renders `variables`
        // and parses the result, so `{{ {...} }}` arrives as a real dict. A
        // bare JSON string stays a string, and `nas_names.get(...)` then dies
        // with "NodeStrClass object has no attribute 'get'" on every run.
        variables: { nas_names: `{{ ${JSON.stringify(this._prettyNames)} }}` },
        actions: notifyActions(
          targets,
          cardName,
          `{% if tid == 'disk' %}${this._t("editor_nas_notify_disk")}` +
            `{% elif tid == 'offline' %}${this._t("editor_nas_notify_offline")}` +
            `{% else %}${this._t("editor_nas_notify_sync")}{% endif %}`,
          {
            title: cfg.notify_title,
            message: cfg.notify_message,
            prelude,
            tokens: {
              name: NAME_EXPR,
              wert: "{{ s.state }}",
              zustand: "{{ s.state }}",
            },
          },
        ),
      };

      const automationId = resolveAutomationId("nas", cfg.notify_automation_id);
      await saveNotifyAutomation(this.hass, { id: automationId, ...automation } as NotifyAutomationSpec);
      if (cfg.notify_automation_id !== automationId) {
        this._config = { ...cfg, notify_automation_id: automationId };
        fireEvent(this, "config-changed", { config: this._config });
      }
      await setAutomationEnabled(this.hass, automationId, true);
      this._notifyStatus = "success";
      this._notifyDetail = `${triggers.length}`;
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
      { name: "notify_sync_errors", selector: { boolean: {} } },
      { name: "notify_disk_full", selector: { boolean: {} } },
    ];
    if (this._config?.notify_disk_full !== false) {
      schema.push({
        name: "notify_disk_threshold",
        selector: { number: { min: 1, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } },
      });
    }
    schema.push({ name: "notify_offline", selector: { boolean: {} } });
    if (this._config?.notify_offline === true) {
      schema.push({
        name: "notify_offline_minutes",
        selector: { number: { min: 1, max: 120, step: 1, mode: "box", unit_of_measurement: "min" } },
      });
    }
    schema.push(notifyTitleSchema(), notifyMessageSchema());
    return schema;
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  /** One editor serves both card types, so the default follows the card type. */
  private get _source(): HostSource {
    return this._config?.source ?? defaultHostSource(this._config?.type);
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _sourceSchema(): SchemaEntry[] {
    return [
      {
        name: "source",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "glances", label: this._t("editor_nas_source_glances") },
              { value: "systemmonitor", label: this._t("editor_nas_source_systemmonitor") },
              { value: "synology_dsm", label: this._t("editor_nas_source_synology") },
            ],
          },
        },
      },
      { name: "auto_discover", selector: { boolean: {} } },
      { name: "exclude_mounts", selector: { select: { multiple: true, custom_value: true, options: [] } } },
    ];
  }

  private _thresholdSchema(): SchemaEntry[] {
    return [
      { name: "disk_warn", selector: { number: { min: 1, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } } },
      {
        name: "disk_critical",
        selector: { number: { min: 1, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } },
      },
      { name: "temp_warn", selector: { number: { min: 20, max: 120, step: 1, mode: "box", unit_of_measurement: "°C" } } },
      {
        name: "temp_critical",
        selector: { number: { min: 20, max: 120, step: 1, mode: "box", unit_of_measurement: "°C" } },
      },
    ];
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "max_visible", selector: { number: { min: 0, step: 1, mode: "box" } } },
      { name: "show_cpu", selector: { boolean: {} } },
      { name: "show_memory", selector: { boolean: {} } },
      { name: "show_temperature", selector: { boolean: {} } },
      { name: "show_network", selector: { boolean: {} } },
      { name: "show_uptime", selector: { boolean: {} } },
      { name: "show_sync", selector: { boolean: {} } },
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

  /** The explanation belongs on the field, not in a paragraph under the
   *  form: what people miss is that the rest stays reachable. */
  private _computeHelper = (schema: SchemaEntry): string | undefined =>
    schema.name === "max_visible" ? this._t("editor_max_visible_helper") : undefined;

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      source: "editor_nas_source",
      auto_discover: "editor_nas_auto_discover",
      exclude_mounts: "editor_nas_exclude_mounts",
      disk_warn: "editor_nas_disk_warn",
      disk_critical: "editor_nas_disk_critical",
      temp_warn: "editor_nas_temp_warn",
      temp_critical: "editor_nas_temp_critical",
      name: "editor_name",
      icon: "editor_icon",
      max_visible: "editor_nas_max_visible",
      show_cpu: "editor_nas_show_cpu",
      show_memory: "editor_nas_show_memory",
      show_temperature: "editor_nas_show_temperature",
      show_network: "editor_nas_show_network",
      show_uptime: "editor_nas_show_uptime",
      show_sync: "editor_nas_show_sync",
      notify_service: "editor_updates_notify_service",
      notify_sync_errors: "editor_nas_notify_sync_errors",
      notify_disk_full: "editor_nas_notify_disk_full",
      notify_disk_threshold: "editor_nas_notify_disk_threshold",
      notify_offline: "editor_nas_notify_offline_enable",
      notify_offline_minutes: "editor_nas_notify_offline_minutes",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _colorChanged(
    field:
      | "ok_color"
      | "warn_color"
      | "critical_color"
      | "offline_color"
      | "text_color"
      | "secondary_text_color"
      | "card_background",
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

  private _opacityChanged(value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, accent_opacity: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    if (this._loadedSource !== this._source) {
      this._registryLoaded = false;
      this._loadRegistry();
    }
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
      const { corners: _dropped, ...rest } = this._config;
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

    const sourceData = {
      source: this._source,
      auto_discover: this._config.auto_discover ?? true,
      exclude_mounts: this._config.exclude_mounts ?? [],
    };
    const thresholdData = {
      disk_warn: this._config.disk_warn ?? DEFAULT_NAS_DISK_WARN,
      disk_critical: this._config.disk_critical ?? DEFAULT_NAS_DISK_CRITICAL,
      temp_warn: this._config.temp_warn ?? DEFAULT_NAS_TEMP_WARN,
      temp_critical: this._config.temp_critical ?? DEFAULT_NAS_TEMP_CRITICAL,
    };
    const contentData = {
      name: this._config.name,
      icon: this._config.icon,
      max_visible: this._config.max_visible ?? DEFAULT_NAS_MAX_VISIBLE,
      show_cpu: this._config.show_cpu ?? true,
      show_memory: this._config.show_memory ?? true,
      show_temperature: this._config.show_temperature ?? true,
      show_network: this._config.show_network ?? true,
      show_uptime: this._config.show_uptime ?? true,
      show_sync: this._config.show_sync ?? true,
    };
    const animationData = { animation: this._config.animation ?? "auto" };
    const notifyData = {
      notify_service: this._config.notify_service ?? [],
      notify_sync_errors: this._config.notify_sync_errors ?? true,
      notify_disk_full: this._config.notify_disk_full ?? true,
      notify_disk_threshold: this._config.notify_disk_threshold ?? DEFAULT_NAS_NOTIFY_DISK,
      notify_offline: this._config.notify_offline ?? false,
      notify_offline_minutes: this._config.notify_offline_minutes ?? DEFAULT_NAS_OFFLINE_MINUTES,
      notify_title: this._config.notify_title ?? "",
      notify_message: this._config.notify_message ?? "",
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:database"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${sourceData}
              .schema=${this._sourceSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_nas_auto_discover_helper")}</div>
            <div class="hint">
              ${this._t(
                this._source === "synology_dsm"
                  ? "editor_nas_exclude_volumes_helper"
                  : "editor_nas_exclude_mounts_helper",
              )}
            </div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_nas_thresholds")}>
          <ha-icon slot="leading-icon" icon="mdi:gauge"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${thresholdData}
              .schema=${this._thresholdSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_nas_thresholds_helper")}</div>
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
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_nas_sync_helper")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_battery_notify")}>
          <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_nas_notify_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${notifyData}
              .schema=${this._notifySchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_nas_notify_paused_hint")}</div>
            <div class="hint">${notifyTokenHint(this._language, ["name", "zustand", "wert"])}</div>
            ${renderNotifyControls({
              hass: this.hass,
              language: this._language,
              enabled: this._config.notify_enabled ?? false,
              automationId: this._config.notify_automation_id,
              busy: this._notifyBusy,
              status: this._notifyStatus,
              detail: this._notifyDetail,
              blockedReason: this._config.notify_service?.length ? undefined : this._t("editor_notify_missing"),
              successText: `${this._t("editor_nas_notify_success_prefix")} ${this._notifyDetail} ${this._t("editor_nas_notify_success_suffix")}`,
              onToggle: (on) => this._toggleNotify(on),
              onSetup: () => this._setupNotify(),
            })}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_nas_ok_color"), this._config.ok_color, (v) => this._colorChanged("ok_color", v))}
            ${colorRow(this._t("editor_nas_warn_color"), this._config.warn_color, (v) => this._colorChanged("warn_color", v))}
            ${colorRow(this._t("editor_nas_critical_color"), this._config.critical_color, (v) => this._colorChanged("critical_color", v))}
            ${colorRow(this._t("editor_nas_offline_color"), this._config.offline_color, (v) => this._colorChanged("offline_color", v))}
            ${opacityRow(this._t("editor_nas_accent_opacity"), this._config.accent_opacity, 18, (v) => this._opacityChanged(v))}
            ${colorRow(this._t("editor_progress_text_color"), this._config.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), this._config.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), this._config.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:wave"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${animationData}
              .schema=${this._animationSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_NAS_RADIUS,
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

  static styles = [editorStyles, notifyStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-nas-card-editor": M3NasCardEditor;
  }
}
