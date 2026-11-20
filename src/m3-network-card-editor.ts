import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3NetworkCardConfig, NetworkRouterConfig } from "./types";
import {
  DEFAULT_NETWORK_MAX_ITEMS,
  DEFAULT_NETWORK_RADIUS,
  DEFAULT_NETWORK_RECONNECTS,
  DEFAULT_NETWORK_SIGNAL_FAIR,
  DEFAULT_NETWORK_SIGNAL_GOOD,
  DEFAULT_NETWORK_WEAK_SIGNAL,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import { notifyServiceSchema } from "./shared/notify-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

const ROUTER_FIELDS = ["name", "status", "uptime", "connection_type", "download", "upload", "signal", "data_used"] as const;

@customElement("m3-network-card-editor")
export class M3NetworkCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3NetworkCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3NetworkCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_NETWORK_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3NetworkCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  /** The integrations that have device_trackers here. */
  private _trackerIntegrations(): { value: string; label: string }[] {
    const set = new Set<string>();
    for (const e of Object.values((this.hass?.entities ?? {}) as Record<string, { entity_id: string; platform?: string }>)) {
      if (e.entity_id.startsWith("device_tracker.") && e.platform) set.add(e.platform);
    }
    for (const p of this._config?.integrations ?? []) set.add(p);
    return [...set].sort().map((p) => ({ value: p, label: p }));
  }

  private _routerSchema(): SchemaEntry[] {
    const ent = { entity: {} };
    return [
      { name: "router_name", selector: { text: {} } },
      { name: "router_status", selector: { entity: { domain: ["binary_sensor", "sensor"] } } },
      { name: "router_uptime", selector: { entity: { domain: ["sensor"] } } },
      { name: "router_connection_type", selector: ent },
      { name: "router_download", selector: { entity: { domain: ["sensor"] } } },
      { name: "router_upload", selector: { entity: { domain: ["sensor"] } } },
      { name: "router_signal", selector: { entity: { domain: ["sensor"] } } },
      { name: "router_signal_good", selector: { number: { min: -140, max: 0, mode: "box", unit_of_measurement: "dBm" } } },
      { name: "router_signal_fair", selector: { number: { min: -140, max: 0, mode: "box", unit_of_measurement: "dBm" } } },
      { name: "router_data_used", selector: { entity: { domain: ["sensor"] } } },
    ];
  }

  private _sourcesSchema(): SchemaEntry[] {
    return [
      { name: "device_trackers", selector: { entity: { domain: "device_tracker", multiple: true } } },
      { name: "integrations", selector: { select: { mode: "dropdown", multiple: true, custom_value: true, options: this._trackerIntegrations() } } },
      { name: "clients_entity", selector: { entity: {} } },
      { name: "clients_attribute", selector: { text: {} } },
    ];
  }

  private _newSchema(): SchemaEntry[] {
    return [
      {
        name: "random_mac_handling",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "flag", label: this._t("editor_net_random_flag") },
              { value: "merge_by_name", label: this._t("editor_net_random_merge") },
              { value: "ignore", label: this._t("editor_net_random_ignore") },
            ],
          },
        },
      },
      { name: "notify_new", selector: { boolean: {} } },
      ...(this._config?.notify_new ? [notifyServiceSchema(this.hass)] : []),
    ];
  }

  private _rulesSchema(): SchemaEntry[] {
    return [
      { name: "weak_signal_below", selector: { number: { min: -100, max: -30, mode: "box", unit_of_measurement: "dBm" } } },
      { name: "reconnects", selector: { boolean: {} } },
      ...(this._config?.reconnects ? [{ name: "reconnect_threshold", selector: { number: { min: 1, max: 200, mode: "box" } } }] : []),
      { name: "ip_conflict", selector: { boolean: {} } },
      { name: "problem_template", selector: { template: {} } },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "title", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "show_search", selector: { boolean: {} } },
      { name: "show_filters", selector: { boolean: {} } },
      { name: "show_offline", selector: { boolean: {} } },
      { name: "max_items", selector: { number: { min: 0, max: 100, mode: "box" } } },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      router_name: "editor_net_name",
      router_status: "editor_net_status",
      router_uptime: "editor_net_uptime",
      router_connection_type: "editor_net_connection_type",
      router_download: "editor_net_download",
      router_upload: "editor_net_upload",
      router_signal: "editor_net_signal",
      router_signal_good: "editor_net_signal_good",
      router_signal_fair: "editor_net_signal_fair",
      router_data_used: "editor_net_data_used",
      device_trackers: "editor_net_trackers",
      integrations: "editor_net_integrations",
      clients_entity: "editor_net_clients_entity",
      clients_attribute: "editor_net_clients_attribute",
      random_mac_handling: "editor_net_random",
      notify_new: "editor_net_notify_new",
      notify_service: "editor_notify_service",
      weak_signal_below: "editor_net_weak",
      reconnects: "editor_net_reconnects",
      reconnect_threshold: "editor_net_reconnect_threshold",
      ip_conflict: "editor_net_ip_conflict",
      problem_template: "editor_net_template",
      title: "editor_avail_title",
      icon: "editor_icon",
      show_search: "editor_net_show_search",
      show_filters: "editor_net_show_filters",
      show_offline: "editor_net_show_offline",
      max_items: "editor_net_max_items",
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
    this._emit(next as unknown as M3NetworkCardConfig);
  }

  /** The router form is flat; the config nests it. */
  private _routerChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const v = ev.detail.value as Record<string, unknown>;
    const router: NetworkRouterConfig = {};
    for (const f of ROUTER_FIELDS) {
      const val = v[`router_${f}`];
      if (typeof val === "string" && val) router[f] = val;
    }
    const good = v.router_signal_good;
    const fair = v.router_signal_fair;
    if (typeof good === "number" || typeof fair === "number") {
      router.signal_thresholds = {};
      if (typeof good === "number" && good !== DEFAULT_NETWORK_SIGNAL_GOOD) router.signal_thresholds.good = good;
      if (typeof fair === "number" && fair !== DEFAULT_NETWORK_SIGNAL_FAIR) router.signal_thresholds.fair = fair;
      if (!Object.keys(router.signal_thresholds).length) delete router.signal_thresholds;
    }
    const next = { ...this._config };
    if (Object.keys(router).length) next.router = router;
    else delete next.router;
    this._emit(next);
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
      this._emit(rest as M3NetworkCardConfig);
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

  private _panel(header: TranslationKey, icon: string, data: unknown, schema: SchemaEntry[], onChange: (ev: CustomEvent) => void, expanded = false) {
    return html`
      <ha-expansion-panel outlined .header=${this._t(header)} ?expanded=${expanded}>
        <ha-icon slot="leading-icon" icon=${icon}></ha-icon>
        <div class="panel-content">
          <ha-form .hass=${this.hass} .data=${data} .schema=${schema} .computeLabel=${this._computeLabel} @value-changed=${onChange}></ha-form>
        </div>
      </ha-expansion-panel>
    `;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const c = this._config;
    const r = c.router ?? {};
    const routerData: Record<string, unknown> = {
      router_signal_good: r.signal_thresholds?.good ?? DEFAULT_NETWORK_SIGNAL_GOOD,
      router_signal_fair: r.signal_thresholds?.fair ?? DEFAULT_NETWORK_SIGNAL_FAIR,
    };
    for (const f of ROUTER_FIELDS) routerData[`router_${f}`] = r[f] ?? "";
    return html`
      <div class="card-config">
        ${this._panel("editor_net_router", "mdi:router-wireless", routerData, this._routerSchema(), (e) => this._routerChanged(e), true)}
        ${this._panel(
          "editor_net_sources",
          "mdi:lan",
          {
            device_trackers: c.device_trackers ?? [],
            integrations: c.integrations ?? [],
            clients_entity: c.clients_entity ?? "",
            clients_attribute: c.clients_attribute ?? "",
          },
          this._sourcesSchema(),
          (e) => this._valueChanged(e),
        )}
        ${this._panel(
          "editor_net_new",
          "mdi:creation-outline",
          { random_mac_handling: c.random_mac_handling ?? "flag", notify_new: c.notify_new === true, notify_service: c.notify_service ?? [] },
          this._newSchema(),
          (e) => this._valueChanged(e),
        )}
        ${this._panel(
          "editor_net_rules",
          "mdi:alert-outline",
          {
            weak_signal_below: c.weak_signal_below ?? DEFAULT_NETWORK_WEAK_SIGNAL,
            reconnects: c.reconnects === true,
            reconnect_threshold: c.reconnect_threshold ?? DEFAULT_NETWORK_RECONNECTS,
            ip_conflict: c.ip_conflict !== false,
            problem_template: c.problem_template ?? "",
          },
          this._rulesSchema(),
          (e) => this._valueChanged(e),
        )}
        ${this._panel(
          "editor_net_display",
          "mdi:view-dashboard-outline",
          {
            title: c.title ?? "",
            icon: c.icon ?? "",
            show_search: c.show_search !== false,
            show_filters: c.show_filters !== false,
            show_offline: c.show_offline === true,
            max_items: c.max_items ?? DEFAULT_NETWORK_MAX_ITEMS,
          },
          this._displaySchema(),
          (e) => this._valueChanged(e),
        )}
        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_NETWORK_RADIUS,
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

  static styles = [editorStyles, css``];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-network-card-editor": M3NetworkCardEditor;
  }
}
