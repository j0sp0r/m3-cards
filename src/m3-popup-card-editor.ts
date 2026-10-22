import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardConfig, LovelaceCardEditor, M3PopupCardConfig } from "./types";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { renderGroupCardsListEditor, groupCardsListStyles } from "./shared/group-cards-editor";

@customElement("m3-popup-card-editor")
export class M3PopupCardEditor extends LitElement implements LovelaceCardEditor<M3PopupCardConfig> {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PopupCardConfig;
  @state() private _showPicker = false;

  public setConfig(config: M3PopupCardConfig): void {
    this._config = config;
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3PopupCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _itemLabel(card: LovelaceCardConfig, index: number): string {
    const type = typeof card.type === "string" ? card.type.replace(/^custom:/, "") : "";
    const entity = typeof card.entity === "string" ? card.entity : undefined;
    const name = entity
      ? ((this.hass?.states[entity]?.attributes.friendly_name as string | undefined) ?? entity)
      : undefined;
    return name ? `${type} — ${name}` : type || `#${index + 1}`;
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next = { ...this._config, ...(ev.detail.value as Record<string, unknown>) } as M3PopupCardConfig;
    // An emptied optional field leaves the config rather than staying as "".
    for (const key of ["title", "icon"] as const) if (!next[key]) delete next[key];
    this._emit(next);
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labels: Record<string, TranslationKey> = {
      hash: "editor_popup_hash",
      title: "editor_popup_title",
      icon: "editor_popup_icon",
    };
    const key = labels[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _computeHelper = (schema: SchemaEntry): string | undefined =>
    schema.name === "hash" ? this._t("editor_popup_hash_helper") : undefined;

  private _schema(): SchemaEntry[] {
    return [
      { name: "hash", required: true, selector: { text: {} } },
      { name: "title", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const data = { hash: this._config.hash ?? "", title: this._config.title ?? "", icon: this._config.icon ?? "" };
    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_popup_general")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:dock-bottom"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${data}
              .schema=${this._schema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_group_cards")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:view-stream-outline"></ha-icon>
          <div class="panel-content">
            ${renderGroupCardsListEditor({
              hass: this.hass,
              cards: this._config.cards ?? [],
              showPicker: this._showPicker,
              onCardsChange: (cards) => this._config && this._emit({ ...this._config, cards }),
              onShowPickerChange: (show) => {
                this._showPicker = show;
              },
              itemLabel: (card, index) => this._itemLabel(card, index),
              addLabel: this._t("editor_group_add_card"),
              removeLabel: this._t("editor_group_remove_card"),
              moveUpLabel: this._t("editor_group_move_up"),
              moveDownLabel: this._t("editor_group_move_down"),
              emptyLabel: this._t("editor_group_empty"),
              noVisualEditorLabel: this._t("editor_group_no_visual_editor"),
              addOtherHint: this._t("editor_group_add_other_hint"),
            })}
          </div>
        </ha-expansion-panel>
      </div>
    `;
  }

  static styles = [editorStyles, groupCardsListStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-popup-card-editor": M3PopupCardEditor;
  }
}
