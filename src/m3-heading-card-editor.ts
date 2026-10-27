import { LitElement, html, css, nothing } from "lit";
import { renderHapticsField } from "./shared/appearance-editor";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3HeadingCardConfig,
} from "./types";
import {
  HEADING_TITLE_SIZE,
  HEADING_TITLE_SIZE_MAX,
  HEADING_TITLE_SIZE_MIN,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  colorRow,
  editorStyles,
  fireEvent,
  type SchemaEntry,
} from "./shared/editor-helpers";

@customElement("m3-heading-card-editor")
export class M3HeadingCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3HeadingCardConfig;

  public setConfig(config: M3HeadingCardConfig): void {
    this._config = config;
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _style(): string {
    return this._config?.style ?? "simple";
  }

  private _emit(config: M3HeadingCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _variantSchema(): SchemaEntry[] {
    return [
      {
        name: "style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "simple", label: this._t("editor_heading_style_simple") },
              { value: "status", label: this._t("editor_heading_style_status") },
              { value: "divider", label: this._t("editor_heading_style_divider") },
              {
                value: "collapsible",
                label: this._t("editor_heading_style_collapsible"),
              },
            ],
          },
        },
      },
    ];
  }

  private _contentSchema(): SchemaEntry[] {
    // The divider has no title and no icon at all, so offering them would be
    // offering controls that change nothing.
    if (this._style === "divider") {
      return [{ name: "label", selector: { text: {} } }];
    }
    return [
      { name: "title", required: true, selector: { text: {} } },
      { name: "show_icon", selector: { boolean: {} } },
      { name: "icon", selector: { icon: {} } },
      {
        name: "title_size",
        selector: {
          number: {
            min: HEADING_TITLE_SIZE_MIN,
            max: HEADING_TITLE_SIZE_MAX,
            mode: "slider",
          },
        },
      },
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  private _statusSchema(): SchemaEntry[] {
    return [
      { name: "badge", selector: { text: {} } },
      {
        name: "count_entities",
        selector: { entity: { multiple: true } },
      },
    ];
  }

  private _actionSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  private _behaviorSchema(): SchemaEntry[] {
    return [
      { name: "default_collapsed", selector: { boolean: {} } },
      {
        name: "collapse_state_entity",
        selector: { entity: { domain: "input_boolean" } },
      },
    ];
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    const next: Record<string, unknown> = { ...this._config, ...patch };
    for (const key of ["title", "label", "icon", "badge", "collapse_state_entity"]) {
      if (next[key] === "") delete next[key];
    }
    if (Array.isArray(next.count_entities) && next.count_entities.length === 0) {
      delete next.count_entities;
    }
    this._emit(next as unknown as M3HeadingCardConfig);
  }

  private _actionChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    const action: Record<string, unknown> = { ...this._config.action, ...patch };
    for (const [k, v] of Object.entries(action)) {
      if (v === "" || v === undefined || v === null) delete action[k];
    }
    if (Object.keys(action).length === 0) {
      const { action: _drop, ...rest } = this._config;
      this._emit(rest as M3HeadingCardConfig);
      return;
    }
    this._emit({ ...this._config, action } as M3HeadingCardConfig);
  }

  private _colorChanged(value: string): void {
    if (!this._config) return;
    if (value) {
      this._emit({ ...this._config, color: value });
    } else {
      const { color: _drop, ...rest } = this._config;
      this._emit(rest as M3HeadingCardConfig);
    }
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      style: "editor_heading_style",
      title: "editor_heading_title",
      label: "editor_heading_label",
      icon: "editor_heading_action_icon",
      show_icon: "editor_heading_show_icon",
      title_size: "editor_heading_title_size",
      tap_action: "editor_tap_action",
      badge: "editor_heading_badge",
      count_entities: "editor_heading_count_entities",
      name: "editor_heading_action_name",
      default_collapsed: "editor_heading_default_collapsed",
      collapse_state_entity: "editor_heading_collapse_entity",
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const style = this._style;

    const contentData =
      style === "divider"
        ? { label: cfg.label ?? "" }
        : {
            title: cfg.title ?? "",
            show_icon: cfg.show_icon ?? true,
            icon: cfg.icon ?? "",
            title_size: cfg.title_size ?? HEADING_TITLE_SIZE,
            tap_action: cfg.tap_action,
          };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_heading_variant")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:shape-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ style }}
              .schema=${this._variantSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_heading_content")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:format-text"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${contentData}
              .schema=${this._contentSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${colorRow(this._t("editor_mode_color"), cfg.color, (v) => this._colorChanged(v))}
            ${renderHapticsField({
              hass: this.hass,
              language: this._language,
              config: this._config,
              onValueChanged: this._valueChanged,
            })}
          </div>
        </ha-expansion-panel>

        ${style === "status"
          ? html`
              <ha-expansion-panel outlined .header=${this._t("editor_heading_status")}>
                <ha-icon slot="leading-icon" icon="mdi:counter"></ha-icon>
                <div class="panel-content">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ badge: cfg.badge ?? "", count_entities: cfg.count_entities ?? [] }}
                    .schema=${this._statusSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${this._valueChanged}
                  ></ha-form>
                  <div class="hint">${this._t("editor_heading_count_hint")}</div>
                  <div class="action-block">
                    <div class="hint">${this._t("editor_heading_action")}</div>
                    <ha-form
                      .hass=${this.hass}
                      .data=${cfg.action ?? {}}
                      .schema=${this._actionSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${this._actionChanged}
                    ></ha-form>
                  </div>
                </div>
              </ha-expansion-panel>
            `
          : nothing}

        ${style === "collapsible"
          ? html`
              <ha-expansion-panel outlined .header=${this._t("editor_heading_behavior")}>
                <ha-icon slot="leading-icon" icon="mdi:chevron-down"></ha-icon>
                <div class="panel-content">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{
                      default_collapsed: cfg.default_collapsed ?? false,
                      collapse_state_entity: cfg.collapse_state_entity ?? "",
                    }}
                    .schema=${this._behaviorSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${this._valueChanged}
                  ></ha-form>
                  <div class="hint">${this._t("editor_heading_collapse_hint")}</div>
                </div>
              </ha-expansion-panel>
            `
          : nothing}
      </div>
    `;
  }

  static styles = [
    editorStyles,
    css`
      .action-block {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border: 1px dashed rgba(127, 127, 127, 0.4);
        border-radius: 12px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-heading-card-editor": M3HeadingCardEditor;
  }
}
