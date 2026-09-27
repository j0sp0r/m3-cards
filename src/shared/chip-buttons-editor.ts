import { html, type TemplateResult } from "lit";
import type { HomeAssistant, ChipButtonConfig } from "../types";
import { CHIP_STATE_COLOR_KEYS } from "../const";
import { localize, type TranslationKey } from "../localize";
import { colorRow, type SchemaEntry } from "./editor-helpers";

// Editor building blocks for the shared chip-buttons row (see
// shared/chip-buttons.ts). Mirrors shared/radius-editor.ts's convention: pure
// functions returning SchemaEntry[] + a label map, plus one render function
// for the whole list — a consuming editor mixes these into its own
// <ha-form>/panel layout rather than duplicating the fields.
//
// This is the deliberate UX difference from Bubble Card's sub-buttons editor
// (.claude/docs/NOTES.md): one flat <ha-form> per chip instead of 4-5 nested
// ha-expansion-panels, and explicit Up/Down buttons instead of a Move-Left/
// Right dropdown menu.

export function chipButtonSchema(): SchemaEntry[] {
  return [
    { name: "entity", selector: { entity: {} } },
    { name: "name", selector: { text: {} } },
    { name: "icon", selector: { icon: {} } },
    { name: "use_entity_color", selector: { boolean: {} } },
    { name: "show_name", selector: { boolean: {} } },
    { name: "show_state", selector: { boolean: {} } },
    { name: "static_color", selector: { boolean: {} } },
    { name: "interactive", selector: { boolean: {} } },
    { name: "tap_action", selector: { ui_action: {} } },
    { name: "hold_action", selector: { ui_action: {} } },
    { name: "double_tap_action", selector: { ui_action: {} } },
  ];
}

export const chipButtonLabelMap: Record<string, TranslationKey> = {
  entity: "editor_entity",
  name: "editor_name",
  icon: "editor_icon",
  show_name: "editor_chip_buttons_show_name",
  use_entity_color: "editor_chip_buttons_use_entity_color",
  show_state: "editor_show_state",
  static_color: "editor_static_color",
  interactive: "editor_chip_buttons_interactive",
  tap_action: "editor_tap_action",
  hold_action: "editor_hold_action",
  double_tap_action: "editor_double_tap_action",
};

// ha-form shows an unset boolean field as unchecked, but shared/chip-buttons.ts
// treats an unset show_state/interactive as "on" (only an explicit `false`
// turns them off). Without resolving that here the switch renders "off" for
// a brand-new chip while the chip itself still shows the text/stays
// tappable, and toggling it once just writes the "true" it already implied —
// visually a no-op — so it takes an off-then-on to see it move at all.
function chipButtonFormData(item: ChipButtonConfig): ChipButtonConfig {
  return {
    ...item,
    show_state: item.show_state ?? true,
    static_color: item.static_color ?? false,
    use_entity_color: item.use_entity_color ?? false,
    interactive: item.interactive ?? true,
    show_name: item.show_name ?? true,
  };
}

// Same curated set button-card's own state-colors panel offers (see
// const.ts) — kept in sync there rather than re-derived here.
const stateKeyLabelMap: Record<string, TranslationKey> = {
  on: "editor_state_on",
  open: "editor_state_open",
  unlocked: "editor_state_unlocked",
  locked: "editor_state_locked",
  home: "editor_state_home",
  playing: "editor_state_playing",
  active: "editor_state_active",
  detected: "editor_state_detected",
  wet: "editor_state_wet",
};

function stateKeyLabel(key: string, language: string): string {
  const translationKey = stateKeyLabelMap[key];
  return translationKey ? localize(translationKey, language) : key.charAt(0).toUpperCase() + key.slice(1);
}

export interface ChipButtonsListEditorParams {
  hass: HomeAssistant;
  language: string;
  items: ChipButtonConfig[];
  onChange: (items: ChipButtonConfig[]) => void;
  computeLabel: (schema: SchemaEntry) => string;
  addLabel: string;
  removeLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  itemLabel: (item: ChipButtonConfig, index: number) => string;
}

export function renderChipButtonsListEditor(params: ChipButtonsListEditorParams): TemplateResult {
  const { hass, language, items, onChange, computeLabel, addLabel, removeLabel, moveUpLabel, moveDownLabel, itemLabel } =
    params;

  const patch = (index: number, value: Partial<ChipButtonConfig>): void => {
    const next = [...items];
    const merged: Record<string, unknown> = { ...next[index], ...value };
    // A field the user cleared is an absent key, not an empty string — the
    // chip's own defaults (e.g. show_state !== false) only apply when the
    // key is missing.
    for (const [k, v] of Object.entries(merged)) {
      if (v === "" || v === undefined || v === null) delete merged[k];
    }
    next[index] = merged as ChipButtonConfig;
    onChange(next);
  };

  const move = (index: number, dir: -1 | 1): void => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (index: number): void => {
    onChange(items.filter((_, i) => i !== index));
  };

  const add = (): void => {
    onChange([...items, {}]);
  };

  const stateColorChanged = (index: number, key: string, value: string): void => {
    const state_colors = { ...(items[index].state_colors ?? {}) };
    if (value) state_colors[key] = value;
    else delete state_colors[key];
    patch(index, { state_colors: Object.keys(state_colors).length ? state_colors : undefined });
  };

  return html`
    <div class="chip-buttons-list">
      ${items.map(
        (item, index) => html`
          <ha-expansion-panel outlined .header=${itemLabel(item, index)}>
            <ha-icon slot="leading-icon" icon=${item.icon || "mdi:gesture-tap-button"}></ha-icon>
            <div class="panel-content">
              <ha-form
                .hass=${hass}
                .data=${chipButtonFormData(item)}
                .schema=${chipButtonSchema()}
                .computeLabel=${computeLabel}
                @value-changed=${(ev: CustomEvent) =>
                  patch(index, ev.detail.value as Partial<ChipButtonConfig>)}
              ></ha-form>
              <ha-expansion-panel outlined .header=${localize("editor_chip_buttons_state_colors", language)}>
                <ha-icon slot="leading-icon" icon="mdi:format-color-fill"></ha-icon>
                <div class="panel-content">
                  <div class="hint">${localize("editor_chip_buttons_state_colors_helper", language)}</div>
                  ${CHIP_STATE_COLOR_KEYS.map((key) =>
                    colorRow(stateKeyLabel(key, language), item.state_colors?.[key], (v) =>
                      stateColorChanged(index, key, v),
                    ),
                  )}
                </div>
              </ha-expansion-panel>
              <div class="chip-buttons-row-actions">
                <ha-icon-button
                  .disabled=${index === 0}
                  .label=${moveUpLabel}
                  @click=${() => move(index, -1)}
                >
                  <ha-icon icon="mdi:arrow-up"></ha-icon>
                </ha-icon-button>
                <ha-icon-button
                  .disabled=${index === items.length - 1}
                  .label=${moveDownLabel}
                  @click=${() => move(index, 1)}
                >
                  <ha-icon icon="mdi:arrow-down"></ha-icon>
                </ha-icon-button>
                <ha-button class="remove" @click=${() => remove(index)}>${removeLabel}</ha-button>
              </div>
            </div>
          </ha-expansion-panel>
        `,
      )}
      <ha-button raised @click=${add}>${addLabel}</ha-button>
    </div>
  `;
}
