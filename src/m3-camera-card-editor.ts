import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CameraConfig, HaActionConfig, HomeAssistant, LovelaceCardEditor, M3CameraCardConfig } from "./types";
import {
  DEFAULT_CAMERA_EVENTS_HOURS,
  DEFAULT_CAMERA_LIVE_IDLE_S,
  DEFAULT_CAMERA_MAX_EVENTS,
  DEFAULT_CAMERA_RADIUS,
  DEFAULT_CAMERA_RING_TIMEOUT_S,
  DEFAULT_CAMERA_SNAPSHOT_REFRESH_S,
} from "./const";
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

const EVENT_DOMAINS = ["event", "binary_sensor"];

/** Labels for the fields of the forms, by schema name. */
const LABELS: Record<string, TranslationKey> = {
  camera: "editor_camera_camera",
  name: "editor_name",
  icon: "editor_icon",
  battery: "editor_camera_battery",
  doorbell: "editor_camera_doorbell",
  person: "editor_camera_person",
  package: "editor_camera_package",
  motion: "editor_camera_motion",
  live_provider: "editor_camera_live_provider",
  snapshot_url_template: "editor_camera_snapshot_template",
  door_tap_action: "editor_camera_door_action",
  door_confirmation: "editor_camera_door_confirm",
  door_feedback_entity: "editor_camera_feedback",
  talk_tap_action: "editor_camera_talk",
  ring_overlay: "editor_camera_ring_overlay",
  ring_timeout: "editor_camera_ring_timeout",
  auto_live_on_motion: "editor_camera_auto_live",
  live_idle_timeout: "editor_camera_idle",
  snapshot_refresh: "editor_camera_refresh",
  show_events: "editor_camera_show_events",
  events_hours: "editor_camera_events_hours",
  max_events: "editor_camera_max_events",
  events_all_action: "editor_camera_events",
};

@customElement("m3-camera-card-editor")
export class M3CameraCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CameraCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3CameraCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_CAMERA_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3CameraCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const key = LABELS[schema.name] ?? radiusLabelMap[schema.name as keyof typeof radiusLabelMap];
    return key ? this._t(key as TranslationKey) : schema.name;
  };

  /** The cameras as objects, whatever short form the YAML uses. */
  private get _cameras(): CameraConfig[] {
    const c = this._config;
    if (!c) return [];
    const raw = c.cameras ?? (c.camera ? [c.camera] : []);
    return raw.map((x) => (typeof x === "string" ? { camera: x } : x));
  }

  private _writeCameras(cameras: CameraConfig[]): void {
    if (!this._config) return;
    const { camera: _short, ...rest } = this._config;
    // A camera with nothing but its entity goes back to the short form.
    const out = cameras.map((c) => (Object.keys(c).length === 1 && c.camera ? c.camera : c));
    this._emit({ ...rest, cameras: out } as M3CameraCardConfig);
  }

  private _cameraSchema(): SchemaEntry[] {
    const ev = { entity: { domain: EVENT_DOMAINS } };
    return [
      // Optional: an intercom without a camera has only its doorbell.
      { name: "camera", selector: { entity: { domain: "camera" } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "doorbell", selector: ev },
      { name: "person", selector: ev },
      { name: "package", selector: ev },
      { name: "motion", selector: ev },
      { name: "battery", selector: { entity: { domain: "sensor", device_class: "battery" } } },
      {
        name: "live_provider",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_camera_live_auto") },
              { value: "webrtc", label: "WebRTC" },
              { value: "hls", label: "HLS" },
              { value: "image", label: this._t("editor_camera_live_image") },
            ],
          },
        },
      },
      { name: "snapshot_url_template", selector: { text: {} } },
      { name: "door_tap_action", selector: { ui_action: {} } },
      { name: "door_confirmation", selector: { boolean: {} } },
      { name: "door_feedback_entity", selector: { entity: {} } },
      { name: "talk_tap_action", selector: { ui_action: {} } },
    ];
  }

  private _cameraData(c: CameraConfig): Record<string, unknown> {
    return {
      camera: c.camera ?? "",
      name: c.name ?? "",
      icon: c.icon ?? "",
      doorbell: c.doorbell ?? "",
      person: c.person ?? "",
      package: c.package ?? "",
      motion: c.motion ?? "",
      battery: c.battery ?? "",
      live_provider: c.live_provider ?? "auto",
      snapshot_url_template: c.snapshot_url_template ?? "",
      door_tap_action: c.door_action?.tap_action,
      door_confirmation: c.door_action?.confirmation !== false,
      door_feedback_entity: c.door_action?.feedback_entity ?? "",
      talk_tap_action: c.talk_action?.tap_action,
    };
  }

  /** The form is flat; door and talk nest in the config. */
  private _cameraChanged(index: number, ev: CustomEvent): void {
    const v = ev.detail.value as Record<string, unknown>;
    const cameras = this._cameras.slice();
    const prev = cameras[index] ?? { camera: "" };
    const next: CameraConfig = { ...prev };
    if (typeof v.camera === "string" && v.camera) next.camera = v.camera;
    else delete next.camera;
    for (const key of ["name", "icon", "doorbell", "person", "package", "motion", "battery", "snapshot_url_template"] as const) {
      const val = v[key];
      if (typeof val === "string" && val) next[key] = val;
      else delete next[key];
    }
    if (v.live_provider && v.live_provider !== "auto") next.live_provider = v.live_provider as CameraConfig["live_provider"];
    else delete next.live_provider;
    const doorAction = v.door_tap_action as HaActionConfig | undefined;
    if (doorAction?.action && doorAction.action !== "none") {
      next.door_action = {
        ...(prev.door_action ?? {}),
        tap_action: doorAction,
        ...(v.door_confirmation === false ? { confirmation: false } : {}),
        ...(v.door_feedback_entity ? { feedback_entity: v.door_feedback_entity as string } : {}),
      };
      if (v.door_confirmation !== false) delete next.door_action.confirmation;
      if (!v.door_feedback_entity) delete next.door_action.feedback_entity;
    } else {
      delete next.door_action;
    }
    const talk = v.talk_tap_action as { action?: string } | undefined;
    if (talk?.action && talk.action !== "none") next.talk_action = { ...(prev.talk_action ?? {}), tap_action: talk as HaActionConfig };
    else delete next.talk_action;
    cameras[index] = next;
    this._writeCameras(cameras);
  }

  private _addCamera = (): void => {
    const used = new Set(this._cameras.map((c) => c.camera));
    const free = Object.keys(this.hass?.states ?? {}).find((id) => id.startsWith("camera.") && !used.has(id));
    if (!free) return;
    this._writeCameras([...this._cameras, { camera: free }]);
  };

  private _removeCamera(index: number): void {
    const cameras = this._cameras.filter((_, i) => i !== index);
    if (!cameras.length) return;
    this._writeCameras(cameras);
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config };
    for (const [k, v] of Object.entries(ev.detail.value as Record<string, unknown>)) {
      if (v === undefined || v === "" || v === null) delete next[k];
      else next[k] = v;
    }
    this._emit(next as unknown as M3CameraCardConfig);
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
      this._emit(rest as M3CameraCardConfig);
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

  private _panel(header: string, icon: string, body: unknown, expanded = false) {
    return html`
      <ha-expansion-panel outlined .header=${header} ?expanded=${expanded}>
        <ha-icon slot="leading-icon" icon=${icon}></ha-icon>
        <div class="panel-content">${body}</div>
      </ha-expansion-panel>
    `;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const c = this._config;
    const cameras = this._cameras;
    const form = (data: unknown, schema: SchemaEntry[], onChange: (e: CustomEvent) => void) =>
      html`<ha-form .hass=${this.hass} .data=${data} .schema=${schema} .computeLabel=${this._computeLabel} @value-changed=${onChange}></ha-form>`;
    return html`
      <div class="card-config">
        ${this._panel(
          this._t("editor_camera_cameras"),
          "mdi:cctv",
          html`
            ${cameras.map(
              (cam, i) => html`
                <ha-expansion-panel outlined .header=${cam.name ?? (this.hass!.states[cam.camera ?? cam.doorbell ?? ""]?.attributes.friendly_name as string | undefined) ?? cam.camera ?? cam.doorbell ?? "?"} ?expanded=${cameras.length === 1}>
                  <div class="panel-content">
                    ${form(this._cameraData(cam), this._cameraSchema(), (e) => this._cameraChanged(i, e))}
                    ${cameras.length > 1
                      ? html`<button class="remove" @click=${() => this._removeCamera(i)}>${this._t("editor_camera_remove")}</button>`
                      : nothing}
                  </div>
                </ha-expansion-panel>
              `,
            )}
            <button class="add" @click=${this._addCamera}>+ ${this._t("editor_camera_add")}</button>
            <p class="hint">${this._t("editor_camera_actions_hint")}</p>
          `,
          true,
        )}
        ${this._panel(
          this._t("editor_camera_ring"),
          "mdi:doorbell-video",
          form(
            {
              ring_overlay: c.ring_overlay ?? "card",
              ring_timeout: c.ring_timeout ?? DEFAULT_CAMERA_RING_TIMEOUT_S,
              auto_live_on_motion: c.auto_live_on_motion === true,
              live_idle_timeout: c.live_idle_timeout ?? DEFAULT_CAMERA_LIVE_IDLE_S,
              snapshot_refresh: c.snapshot_refresh ?? DEFAULT_CAMERA_SNAPSHOT_REFRESH_S,
            },
            [
              {
                name: "ring_overlay",
                selector: {
                  select: {
                    mode: "dropdown",
                    options: [
                      { value: "card", label: this._t("editor_camera_ring_card") },
                      { value: "fullscreen", label: this._t("editor_camera_ring_fullscreen") },
                    ],
                  },
                },
              },
              { name: "ring_timeout", selector: { number: { min: 10, max: 600, mode: "box", unit_of_measurement: "s" } } },
              { name: "auto_live_on_motion", selector: { boolean: {} } },
              { name: "live_idle_timeout", selector: { number: { min: 0, max: 900, mode: "box", unit_of_measurement: "s" } } },
              { name: "snapshot_refresh", selector: { number: { min: 0, max: 600, mode: "box", unit_of_measurement: "s" } } },
            ],
            (e) => this._valueChanged(e),
          ),
        )}
        ${this._panel(
          this._t("editor_camera_events"),
          "mdi:timeline-clock-outline",
          form(
            {
              show_events: c.show_events !== false,
              events_hours: c.events_hours ?? DEFAULT_CAMERA_EVENTS_HOURS,
              max_events: c.max_events ?? DEFAULT_CAMERA_MAX_EVENTS,
              events_all_action: c.events_all_action,
            },
            [
              { name: "show_events", selector: { boolean: {} } },
              { name: "events_hours", selector: { number: { min: 1, max: 168, mode: "box", unit_of_measurement: "h" } } },
              { name: "max_events", selector: { number: { min: 1, max: 50, mode: "box" } } },
              { name: "events_all_action", selector: { ui_action: {} } },
            ],
            (e) => this._valueChanged(e),
          ),
        )}
        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_CAMERA_RADIUS,
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
      .add,
      .remove {
        margin-top: 8px;
        border: none;
        border-radius: 18px;
        height: 36px;
        padding: 0 16px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-color) 16%, transparent);
        color: var(--primary-text-color);
      }
      .remove {
        background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent);
      }
      .hint {
        margin: 12px 0 0;
        font-size: 13px;
        color: var(--secondary-text-color);
      }
      ha-expansion-panel + ha-expansion-panel {
        margin-top: 8px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-camera-card-editor": M3CameraCardEditor;
  }
}
