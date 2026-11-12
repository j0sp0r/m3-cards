import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  AvailabilityFilterConfig,
  HomeAssistant,
  LovelaceCardEditor,
  M3AvailabilityCardConfig,
} from "./types";
import {
  DEFAULT_AVAILABILITY_CRITICAL_HOURS,
  DEFAULT_AVAILABILITY_MAX_ITEMS,
  DEFAULT_AVAILABILITY_RADIUS,
  DEFAULT_AVAILABILITY_RECENT_MINUTES,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import { integrationTitle, type RegEntity } from "./shared/availability";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

type FilterField = "devices" | "integrations" | "areas" | "entities";

@customElement("m3-availability-card-editor")
export class M3AvailabilityCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3AvailabilityCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3AvailabilityCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_AVAILABILITY_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3AvailabilityCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  /** The integrations present in this install, for the pickers. */
  private _integrationOptions(): { value: string; label: string }[] {
    const platforms = new Set<string>();
    for (const e of Object.values((this.hass?.entities ?? {}) as Record<string, RegEntity>)) {
      if (e.platform && e.device_id) platforms.add(e.platform);
    }
    const loc = (this.hass as unknown as { localize?: (k: string) => string } | undefined)?.localize;
    return [...platforms]
      .map((p) => ({ value: p, label: integrationTitle(p, loc ? (k) => loc(k) : undefined) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private _generalSchema(): SchemaEntry[] {
    return [
      { name: "title", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "recent_minutes", selector: { number: { min: 1, max: 1440, mode: "box" } } },
      { name: "critical_hours", selector: { number: { min: 1, max: 720, mode: "box" } } },
      {
        name: "mute_default",
        selector: {
          select: {
            mode: "dropdown",
            options: (["1h", "24h", "7d", "forever"] as const).map((d) => ({
              value: d,
              label: this._t(`avail_mute_${d}` as TranslationKey),
            })),
          },
        },
      },
    ];
  }

  private _scopeSchema(): SchemaEntry[] {
    const integrations = this._integrationOptions();
    const multiSelect = { select: { mode: "dropdown", multiple: true, options: integrations } };
    return [
      { name: "ignore_diagnostic", selector: { boolean: {} } },
      { name: "include_orphan_entities", selector: { boolean: {} } },
      { name: "include_devices", selector: { device: { multiple: true } } },
      { name: "include_integrations", selector: multiSelect },
      { name: "include_areas", selector: { area: { multiple: true } } },
      { name: "exclude_devices", selector: { device: { multiple: true } } },
      { name: "exclude_integrations", selector: multiSelect },
      { name: "exclude_areas", selector: { area: { multiple: true } } },
      { name: "exclude_entities", selector: { text: { multiline: true } } },
    ];
  }

  private _staleSchema(): SchemaEntry[] {
    return [
      { name: "stale_hours", selector: { number: { min: 0, max: 720, mode: "box" } } },
      {
        name: "stale_integrations",
        selector: { select: { mode: "dropdown", multiple: true, options: this._integrationOptions() } },
      },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "show_filters", selector: { boolean: {} } },
      { name: "max_items", selector: { number: { min: 0, max: 100, mode: "box" } } },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      title: "editor_avail_title",
      icon: "editor_icon",
      recent_minutes: "editor_avail_recent_minutes",
      critical_hours: "editor_avail_critical_hours",
      mute_default: "editor_avail_mute_default",
      ignore_diagnostic: "editor_avail_ignore_diagnostic",
      include_orphan_entities: "editor_avail_orphans",
      include_devices: "editor_avail_include_devices",
      include_integrations: "editor_avail_include_integrations",
      include_areas: "editor_avail_include_areas",
      exclude_devices: "editor_avail_exclude_devices",
      exclude_integrations: "editor_avail_exclude_integrations",
      exclude_areas: "editor_avail_exclude_areas",
      exclude_entities: "editor_avail_exclude_entities",
      stale_hours: "editor_avail_stale_hours",
      stale_integrations: "editor_avail_stale_integrations",
      show_filters: "editor_avail_show_filters",
      max_items: "editor_avail_max_items",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const value = ev.detail.value as Record<string, unknown>;
    const next: Record<string, unknown> = { ...this._config };
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === "" || v === null) delete next[k];
      else next[k] = v;
    }
    // stale_hours 0 means off: keep the config clean.
    if (next.stale_hours === 0) delete next.stale_hours;
    this._emit(next as unknown as M3AvailabilityCardConfig);
  }

  /** The scope form is flat; the config nests include/exclude. */
  private _scopeChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const v = ev.detail.value as Record<string, unknown>;
    const build = (prefix: "include" | "exclude"): AvailabilityFilterConfig | undefined => {
      const out: AvailabilityFilterConfig = {};
      for (const field of ["devices", "integrations", "areas", "entities"] as FilterField[]) {
        let list = v[`${prefix}_${field}`] as string[] | string | undefined;
        if (typeof list === "string") list = list.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
        if (list && list.length) out[field] = list;
      }
      return Object.keys(out).length ? out : undefined;
    };
    const next: M3AvailabilityCardConfig = {
      ...this._config,
      ignore_diagnostic: v.ignore_diagnostic as boolean,
      include_orphan_entities: v.include_orphan_entities as boolean,
    };
    const include = build("include");
    const exclude = build("exclude");
    if (include) next.include = include;
    else delete next.include;
    if (exclude) next.exclude = exclude;
    else delete next.exclude;
    if (next.ignore_diagnostic !== false) delete next.ignore_diagnostic;
    if (!next.include_orphan_entities) delete next.include_orphan_entities;
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
      this._emit(rest as M3AvailabilityCardConfig);
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
    const px = ev.detail.value[key] as number;
    this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } });
  }

  private _panel(header: TranslationKey, icon: string, data: unknown, schema: SchemaEntry[], onChange: (ev: CustomEvent) => void, expanded = false, hint?: string) {
    return html`
      <ha-expansion-panel outlined .header=${this._t(header)} ?expanded=${expanded}>
        <ha-icon slot="leading-icon" icon=${icon}></ha-icon>
        <div class="panel-content">
          ${hint ? html`<div class="hint">${hint}</div>` : nothing}
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${schema}
            .computeLabel=${this._computeLabel}
            @value-changed=${onChange}
          ></ha-form>
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
      recent_minutes: c.recent_minutes ?? DEFAULT_AVAILABILITY_RECENT_MINUTES,
      critical_hours: c.critical_hours ?? DEFAULT_AVAILABILITY_CRITICAL_HOURS,
      mute_default: c.mute_default ?? "24h",
    };
    const scope = {
      ignore_diagnostic: c.ignore_diagnostic !== false,
      include_orphan_entities: c.include_orphan_entities === true,
      include_devices: c.include?.devices ?? [],
      include_integrations: c.include?.integrations ?? [],
      include_areas: c.include?.areas ?? [],
      exclude_devices: c.exclude?.devices ?? [],
      exclude_integrations: c.exclude?.integrations ?? [],
      exclude_areas: c.exclude?.areas ?? [],
      exclude_entities: (c.exclude?.entities ?? []).join("\n"),
    };
    const stale = { stale_hours: c.stale_hours ?? 0, stale_integrations: c.stale_integrations ?? [] };
    const display = { show_filters: c.show_filters !== false, max_items: c.max_items ?? DEFAULT_AVAILABILITY_MAX_ITEMS };
    return html`
      <div class="card-config">
        ${this._panel("editor_avail_general", "mdi:wifi-off", general, this._generalSchema(), (e) => this._valueChanged(e), true)}
        ${this._panel("editor_avail_scope", "mdi:filter-variant", scope, this._scopeSchema(), (e) => this._scopeChanged(e))}
        ${this._panel("editor_avail_stale", "mdi:clock-alert-outline", stale, this._staleSchema(), (e) => this._valueChanged(e), false, this._t("editor_avail_stale_hint"))}
        ${this._panel("editor_avail_display", "mdi:view-dashboard-outline", display, this._displaySchema(), (e) => this._valueChanged(e))}
        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_AVAILABILITY_RADIUS,
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
    "m3-availability-card-editor": M3AvailabilityCardEditor;
  }
}
