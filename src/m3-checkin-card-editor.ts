import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3CheckinCardConfig } from "./types";
import { CHECKIN_COLOR_CHECKOUT, CHECKIN_COLOR_IN, CHECKIN_COLOR_OFF, CHECKIN_OPTIMISTIC_MS, DEFAULT_CHECKIN_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

type Style = "segmented" | "status" | "swipe";
type ColorField = "color" | "color_off" | "color_checkout" | "text_color" | "secondary_text_color" | "card_background";

/** Values the card treats as "not set": left out of the YAML, not written as empty. */
const DEFAULTS: Partial<Record<keyof M3CheckinCardConfig, unknown>> = {
  style: "segmented",
  confirm: "none",
  show_people: true,
  optimistic_timeout: CHECKIN_OPTIMISTIC_MS,
  animation: "auto",
};

/**
 * The check-in card's editor. One panel per concern, and the style panel
 * changes with the style: each shows only the words and icons its control
 * actually uses, so nothing in the form does nothing.
 */
@customElement("m3-checkin-card-editor")
export class M3CheckinCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CheckinCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3CheckinCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_CHECKIN_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _style(): Style {
    const s = this._config?.style;
    return s === "status" || s === "swipe" ? s : "segmented";
  }

  private _emit(config: M3CheckinCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  /** Merges a form's values, dropping the empty ones and those at their default. */
  private _patch(values: Record<string, unknown>): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config };
    for (const [key, value] of Object.entries(values)) {
      const unset =
        value === undefined ||
        value === "" ||
        (value !== null && typeof value === "object" && Object.keys(value as object).length === 0) ||
        DEFAULTS[key as keyof M3CheckinCardConfig] === value;
      if (unset) delete next[key];
      else next[key] = value;
    }
    this._emit(next as unknown as M3CheckinCardConfig);
  }

  private _valueChanged(ev: CustomEvent): void {
    this._patch(ev.detail.value as Record<string, unknown>);
  }

  // ---- schemas --------------------------------------------------------------

  private get _domain(): string {
    return (this._config?.entity ?? "").split(".")[0];
  }

  private _entitySchema(): SchemaEntry[] {
    return [
      {
        name: "entity",
        selector: { entity: { domain: ["input_boolean", "switch", "binary_sensor", "person", "device_tracker"] } },
      },
    ];
  }

  private _styleSchema(): SchemaEntry[] {
    const style = this._style;
    const schema: SchemaEntry[] = [
      {
        name: "style",
        selector: {
          select: {
            mode: "list",
            options: (["segmented", "status", "swipe"] as const).map((value) => ({
              value,
              label: this._t(`editor_checkin_style_${value}` as TranslationKey),
            })),
          },
        },
      },
    ];
    if (style === "segmented") {
      schema.push({ name: "label_in", selector: { text: {} } }, { name: "label_out", selector: { text: {} } });
    } else if (style === "status") {
      schema.push({ name: "button_label_in", selector: { text: {} } }, { name: "button_label_out", selector: { text: {} } });
    } else {
      schema.push({ name: "swipe_label_in", selector: { text: {} } }, { name: "swipe_label_out", selector: { text: {} } });
    }
    schema.push({ name: "icon_in", selector: { icon: {} } }, { name: "icon_out", selector: { icon: {} } });
    return schema;
  }

  private _displaySchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "icon_off", selector: { icon: {} } },
      { name: "since_entity", selector: { entity: { domain: ["input_datetime", "sensor"] } } },
    ];
    // The status style's subtitle is "since 14:02"; the templates are the
    // other two styles' status line.
    if (this._style !== "status") {
      schema.push({ name: "status_in", selector: { text: {} } }, { name: "status_out", selector: { text: {} } });
    }
    return schema;
  }

  private _behaviorSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [];
    if (this._domain === "person" || this._domain === "device_tracker") {
      schema.push({ name: "home_state", selector: { text: {} } });
    } else {
      schema.push({ name: "state_on", selector: { text: {} } });
    }
    if (this._style !== "swipe") {
      schema.push({
        name: "confirm",
        selector: {
          select: {
            mode: "dropdown",
            options: (["none", "double_tap", "hold"] as const).map((value) => ({
              value,
              label: this._t(`editor_checkin_confirm_${value}` as TranslationKey),
            })),
          },
        },
      });
    }
    schema.push(
      {
        name: "optimistic_timeout",
        selector: { number: { min: 1000, max: 60000, step: 500, mode: "box", unit_of_measurement: "ms" } },
      },
      { name: "checkin_action", selector: { ui_action: {} } },
      { name: "checkout_action", selector: { ui_action: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
    );
    return schema;
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      entity: "editor_entity",
      style: "editor_checkin_style",
      label_in: "editor_checkin_label_in",
      label_out: "editor_checkin_label_out",
      button_label_in: "editor_checkin_button_label_in",
      button_label_out: "editor_checkin_button_label_out",
      swipe_label_in: "editor_checkin_swipe_label_in",
      swipe_label_out: "editor_checkin_swipe_label_out",
      icon_in: "editor_checkin_icon_in",
      icon_out: "editor_checkin_icon_out",
      name: "editor_name",
      icon: "editor_checkin_icon",
      icon_off: "editor_checkin_icon_off",
      since_entity: "editor_checkin_since_entity",
      status_in: "editor_checkin_status_in",
      status_out: "editor_checkin_status_out",
      state_on: "editor_checkin_state_on",
      home_state: "editor_checkin_home_state",
      confirm: "editor_checkin_confirm",
      optimistic_timeout: "editor_checkin_optimistic_timeout",
      checkin_action: "editor_checkin_checkin_action",
      checkout_action: "editor_checkin_checkout_action",
      tap_action: "editor_checkin_tap_action",
      show_people: "editor_checkin_show_people",
      user: "editor_checkin_user",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _computeHelper = (schema: SchemaEntry): string | undefined => {
    const map: Record<string, TranslationKey> = {
      entity: "editor_checkin_entity_helper",
      since_entity: "editor_checkin_since_entity_helper",
      status_in: "editor_checkin_status_helper",
      confirm: "editor_checkin_confirm_helper",
      optimistic_timeout: "editor_checkin_optimistic_timeout_helper",
      checkin_action: "editor_checkin_action_helper",
    };
    const key = map[schema.name];
    return key ? this._t(key) : undefined;
  };

  // ---- people ---------------------------------------------------------------

  private get _people(): Array<[string, string]> {
    return Object.entries(this._config?.user_entity_map ?? {});
  }

  private _setPeople(rows: Array<[string, string]>): void {
    // Rows without a user are kept while being typed in — a map cannot hold
    // two empty keys, so each blank one gets a placeholder that the card
    // matches to nobody.
    const map: Record<string, string> = {};
    rows.forEach(([user, entity], i) => {
      map[user || `user ${i + 1}`] = entity;
    });
    this._patch({ user_entity_map: rows.length ? map : undefined });
  }

  private _personChanged(index: number, ev: CustomEvent): void {
    const v = ev.detail.value as { user?: string; entity?: string };
    const rows = [...this._people];
    rows[index] = [(v.user ?? "").trim(), v.entity ?? ""];
    this._setPeople(rows);
  }

  private _addPerson(): void {
    this._setPeople([...this._people, ["", ""]]);
  }

  private _removePerson(index: number): void {
    this._setPeople(this._people.filter((_, i) => i !== index));
  }

  // ---- colours and appearance ----------------------------------------------

  private _colorChanged(field: ColorField, value: string): void {
    this._patch({ [field]: value || undefined });
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
      this._emit(rest as M3CheckinCardConfig);
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

  // ---- render ---------------------------------------------------------------

  private _form(data: Record<string, unknown>, schema: SchemaEntry[]) {
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${schema}
      .computeLabel=${this._computeLabel}
      .computeHelper=${this._computeHelper}
      @value-changed=${this._valueChanged}
    ></ha-form>`;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const style = this._style;
    const pick = (keys: string[]) =>
      Object.fromEntries(keys.map((k) => [k, (cfg as unknown as Record<string, unknown>)[k] ?? DEFAULTS[k as keyof M3CheckinCardConfig]]));

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_checkin_section_entity")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:account-check"></ha-icon>
          <div class="panel-content">
            ${this._form(pick(["entity"]), this._entitySchema())}
            <div class="sub-heading">${this._t("editor_checkin_people")}</div>
            <div class="hint">${this._t("editor_checkin_people_helper")}</div>
            ${this._people.map(
              ([user, entity], index) => html`
                <div class="person-row">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ user: /^user \d+$/.test(user) ? "" : user, entity }}
                    .schema=${[
                      { name: "user", selector: { text: {} } },
                      { name: "entity", selector: { entity: { domain: ["input_boolean", "switch", "binary_sensor", "person", "device_tracker"] } } },
                    ]}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(ev: CustomEvent) => {
                      ev.stopPropagation();
                      this._personChanged(index, ev);
                    }}
                  ></ha-form>
                  <button class="remove-btn" aria-label=${this._t("editor_checkin_remove_person")} @click=${() => this._removePerson(index)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addPerson()}>
              <ha-icon icon="mdi:plus"></ha-icon>${this._t("editor_checkin_add_person")}
            </button>
            ${this._people.length
              ? this._form({ show_people: cfg.show_people ?? true }, [{ name: "show_people", selector: { boolean: {} } }])
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_checkin_section_style")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap-button"></ha-icon>
          <div class="panel-content">
            ${this._form(
              pick(["style", "label_in", "label_out", "button_label_in", "button_label_out", "swipe_label_in", "swipe_label_out", "icon_in", "icon_out"]),
              this._styleSchema(),
            )}
            <div class="hint">${this._t(`editor_checkin_style_${style}_hint` as TranslationKey)}</div>
            ${style === "swipe"
              ? colorRow(this._t("editor_checkin_color_checkout"), cfg.color_checkout, (v) => this._colorChanged("color_checkout", v))
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_supply_display")}>
          <ha-icon slot="leading-icon" icon="mdi:view-dashboard-outline"></ha-icon>
          <div class="panel-content">
            ${this._form(pick(["name", "icon", "icon_off", "since_entity", "status_in", "status_out"]), this._displaySchema())}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:tune"></ha-icon>
          <div class="panel-content">
            ${this._form(
              pick(["state_on", "home_state", "confirm", "optimistic_timeout", "checkin_action", "checkout_action", "tap_action"]),
              this._behaviorSchema(),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(`${this._t("editor_checkin_color")} (${CHECKIN_COLOR_IN})`, cfg.color, (v) => this._colorChanged("color", v))}
            ${colorRow(`${this._t("editor_checkin_color_off")} (${CHECKIN_COLOR_OFF})`, cfg.color_off, (v) => this._colorChanged("color_off", v))}
            ${style === "swipe"
              ? nothing
              : html`<div class="hint">${this._t("editor_checkin_color_checkout_hint").replace("{color}", CHECKIN_COLOR_CHECKOUT)}</div>`}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:wave"></ha-icon>
          <div class="panel-content">
            ${this._form({ animation: cfg.animation ?? "auto" }, [
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
            ])}
            <div class="hint">${this._t("editor_progress_animation_reduced_motion_hint")}</div>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: cfg,
          defaultRadius: DEFAULT_CHECKIN_RADIUS,
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
      .sub-heading {
        margin-top: 8px;
        font-size: 14px;
        font-weight: 600;
      }
      .person-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .person-row ha-form {
        flex: 1;
        min-width: 0;
      }
      .remove-btn {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border: none;
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
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
        font-size: 14px;
        font-family: inherit;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-checkin-card-editor": M3CheckinCardEditor;
  }
}
