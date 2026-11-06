import { html, nothing, type TemplateResult } from "lit";
import type { HomeAssistant, CornerRadiusConfig, DetailMode } from "../types";
import {
  CORNER_KEYS,
  radiusPreset,
  radiusPresetSchema,
  radiusValueSchema,
  cornersToggleSchema,
  cornerPresetSchema,
  cornerValueSchema,
  radiusLabelMap,
} from "./radius-editor";
import type { SchemaEntry } from "./editor-helpers";
import { RADIUS_PRESETS } from "../const";
import { localize, type TranslationKey } from "../localize";

// The "Erscheinungsbild" (glass background + radius + per-corner radius)
// panel is identical across every card editor. This module owns both the
// full render template and the pure state-transition logic, so each editor
// only needs a handful of thin wrapper methods that apply the patch to its
// own @state fields and fire config-changed.

export interface AppearanceConfigBase {
  type?: string;
  glass_background?: boolean;
  detail_mode?: DetailMode;
  haptics?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
}

export interface AppearanceState {
  showCustomRadius: boolean;
  showCorners: boolean;
  cornerCustom: Record<string, boolean>;
}

export function initAppearanceState(
  config: AppearanceConfigBase,
  defaultRadius: number,
  presets: Record<string, number> = RADIUS_PRESETS,
): AppearanceState {
  const cornerCustom: Record<string, boolean> = {};
  for (const key of CORNER_KEYS) {
    cornerCustom[key] = radiusPreset(config.corners?.[key], defaultRadius, presets) === "custom";
  }
  return {
    showCustomRadius: radiusPreset(config.radius, defaultRadius, presets) === "custom",
    showCorners: !!config.corners,
    cornerCustom,
  };
}

export function radiusPresetPatch(
  preset: string,
  presets: Record<string, number> = RADIUS_PRESETS,
): { showCustomRadius: boolean; radius?: number } {
  if (preset === "custom") return { showCustomRadius: true };
  return { showCustomRadius: false, radius: presets[preset] };
}

export function cornerPresetPatch(
  preset: string,
  presets: Record<string, number> = RADIUS_PRESETS,
): { custom: boolean; px?: number } {
  if (preset === "custom") return { custom: true };
  return { custom: false, px: presets[preset] };
}

/**
 * What this section calls its own fields, for cards that never said.
 *
 * The fields belong to the shared section but the labels were left to each
 * card's `computeLabel`, so a card that forgot one showed the config key
 * instead of a name — `glass_background` and `radius_preset` in plain sight,
 * in eight editors. Anything a card does name still wins; this only fills the
 * silence, which also means the next card to use the section cannot forget.
 */
const OWN_LABELS: Record<string, TranslationKey> = {
  ...radiusLabelMap,
  glass_background: "editor_glass_background",
  detail_mode: "editor_detail_mode",
  haptics: "editor_haptics",
};

/**
 * Cards that never open an entity's details, and so have nothing for
 * `detail_mode` to change. Listing the exceptions rather than the rule means
 * a new card gets the option by default; appearance-editor.test.ts checks this
 * list against the sources both ways, so it cannot go stale silently.
 */
export const NO_DETAIL_CARDS: ReadonlySet<string> = new Set([
  "m3-clock-card",
  "m3-detail-card",
  "m3-energy-flow-card",
  "m3-gauge-card",
  "m3-group-card",
  // Both run their configured action without an entity, so a more-info
  // there has nothing to open.
  "m3-heading-card",
  "m3-search-card",
  // Its chips pick the curve in focus; nothing on it opens an entity.
  "m3-temperature-graph-card",
  "m3-humidifier-card",
  // Holds other cards; each of them opens its own details.
  "m3-popup-card",
  "m3-progress-card",
  "m3-time-card",
  "m3-todo-card",
]);

export function supportsDetailMode(type: string | undefined): boolean {
  const tag = (type ?? "").replace(/^custom:/, "");
  return tag.startsWith("m3-") && !NO_DETAIL_CARDS.has(tag);
}

export interface DetailModeFieldParams {
  hass?: HomeAssistant;
  language: string;
  config: AppearanceConfigBase;
  onValueChanged: (ev: CustomEvent) => void;
}

/**
 * "What a tap on details opens": Home Assistant's dialog, or the suite's
 * sheet. Part of the shared appearance section; editors that build their own
 * appearance panel (button, climate-mini, nav) and the heading card's
 * behaviour panel call it themselves.
 */
export function renderDetailModeField(params: DetailModeFieldParams): TemplateResult | typeof nothing {
  const { hass, language, config, onValueChanged } = params;
  if (!supportsDetailMode(config.type)) return nothing;
  return html`
    <ha-form
      .hass=${hass}
      .data=${{ detail_mode: config.detail_mode ?? "more_info" }}
      .schema=${[
        {
          name: "detail_mode",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "more_info", label: localize("editor_detail_mode_more_info", language) },
                { value: "sheet", label: localize("editor_detail_mode_sheet", language) },
              ],
            },
          },
        },
      ]}
      .computeLabel=${(schema: SchemaEntry) => localize(OWN_LABELS[schema.name] ?? "editor_detail_mode", language)}
      .computeHelper=${() => localize("editor_detail_mode_helper", language)}
      @value-changed=${onValueChanged}
    ></ha-form>
  `;
}

/**
 * Cards that do not take the shared haptics switch: the nav and remote cards
 * have their own, tuned per control, and a popup or group only holds other
 * cards, each of which vibrates by itself.
 */
export const NO_HAPTICS_FIELD_CARDS: ReadonlySet<string> = new Set([
  "m3-nav-card",
  "m3-remote-card",
  "m3-popup-card",
  "m3-group-card",
]);

export function supportsHapticsField(type: string | undefined): boolean {
  const tag = (type ?? "").replace(/^custom:/, "");
  return tag.startsWith("m3-") && !NO_HAPTICS_FIELD_CARDS.has(tag);
}

/** "Vibrate on tap", on by default, as the card's shared tap haptic is. */
export function renderHapticsField(params: DetailModeFieldParams): TemplateResult | typeof nothing {
  const { hass, language, config, onValueChanged } = params;
  if (!supportsHapticsField(config.type)) return nothing;
  return html`
    <ha-form
      .hass=${hass}
      .data=${{ haptics: config.haptics ?? true }}
      .schema=${[{ name: "haptics", selector: { boolean: {} } }]}
      .computeLabel=${() => localize("editor_haptics", language)}
      .computeHelper=${() => localize("editor_haptics_helper", language)}
      @value-changed=${onValueChanged}
    ></ha-form>
  `;
}

function withOwnLabels(
  computeLabel: (schema: SchemaEntry) => string,
  language: string,
): (schema: SchemaEntry) => string {
  return (schema) => {
    const given = computeLabel(schema);
    // A card that has no label for a field hands the raw name straight back.
    if (given && given !== schema.name) return given;
    const key = OWN_LABELS[schema.name];
    return key ? localize(key, language) : given;
  };
}

export function appearanceSchema(): SchemaEntry[] {
  return [{ name: "glass_background", selector: { boolean: {} } }];
}

export interface RadiusCornerFieldsParams {
  hass?: HomeAssistant;
  language: string;
  config: AppearanceConfigBase;
  defaultRadius: number;
  state: AppearanceState;
  computeLabel: (schema: SchemaEntry) => string;
  onValueChanged: (ev: CustomEvent) => void;
  onRadiusPresetChanged: (ev: CustomEvent) => void;
  onCornersToggleChanged: (ev: CustomEvent) => void;
  onCornerPresetChanged: (key: string, ev: CustomEvent) => void;
  onCornerValueChanged: (key: string, ev: CustomEvent) => void;
  // Overrides the standard eckig/leicht_rund/rund px values — for cards like
  // m3-climate-card whose default shape is a larger "hero" radius than the
  // rest of the suite, so its quick-presets stay proportional to that.
  presets?: Record<string, number>;
}

// The radius-preset + optional custom-radius + per-corner controls, without
// the glass_background toggle or the panel wrapper — for editors that embed
// this inside an existing custom "appearance" panel of their own (button,
// climate-mini) instead of using the fully-wrapped renderAppearanceSection.
export function renderRadiusCornerFields(params: RadiusCornerFieldsParams): TemplateResult {
  const { hass, language, config, defaultRadius, state, computeLabel, presets = RADIUS_PRESETS } = params;
  const label = withOwnLabels(computeLabel, language);
  const radiusPresetData = { radius_preset: radiusPreset(config.radius, defaultRadius, presets) };
  const radiusValueData = { radius: config.radius ?? defaultRadius };
  const baseRadius = config.radius ?? defaultRadius;
  const cornersToggleData = { use_corners: state.showCorners };

  return html`
    <ha-form
      .hass=${hass}
      .data=${radiusPresetData}
      .schema=${radiusPresetSchema(language)}
      .computeLabel=${label}
      @value-changed=${params.onRadiusPresetChanged}
    ></ha-form>
    ${state.showCustomRadius
      ? html`
          <ha-form
            .hass=${hass}
            .data=${radiusValueData}
            .schema=${radiusValueSchema()}
            .computeLabel=${label}
            @value-changed=${params.onValueChanged}
          ></ha-form>
        `
      : nothing}
    <ha-form
      .hass=${hass}
      .data=${cornersToggleData}
      .schema=${cornersToggleSchema()}
      .computeLabel=${label}
      @value-changed=${params.onCornersToggleChanged}
    ></ha-form>
    ${state.showCorners
      ? CORNER_KEYS.map((key) => {
          const currentPx = config.corners?.[key] ?? baseRadius;
          const presetVal = state.cornerCustom[key]
            ? "custom"
            : radiusPreset(currentPx, defaultRadius, presets);
          return html`
            <ha-form
              .hass=${hass}
              .data=${{ [key]: presetVal }}
              .schema=${cornerPresetSchema(key, language)}
              .computeLabel=${label}
              @value-changed=${(ev: CustomEvent) => params.onCornerPresetChanged(key, ev)}
            ></ha-form>
            ${state.cornerCustom[key]
              ? html`
                  <ha-form
                    .hass=${hass}
                    .data=${{ [key]: currentPx }}
                    .schema=${cornerValueSchema(key)}
                    .computeLabel=${label}
                    @value-changed=${(ev: CustomEvent) => params.onCornerValueChanged(key, ev)}
                  ></ha-form>
                `
              : nothing}
          `;
        })
      : nothing}
  `;
}

export function renderAppearanceSection(params: RadiusCornerFieldsParams): TemplateResult {
  const { hass, language, config, computeLabel } = params;
  const label = withOwnLabels(computeLabel, language);
  const appearanceData = { glass_background: config.glass_background ?? true };

  return html`
    <ha-expansion-panel outlined .header=${localize("editor_appearance", language)}>
      <ha-icon slot="leading-icon" icon="mdi:card-outline"></ha-icon>
      <div class="panel-content">
        <ha-form
          .hass=${hass}
          .data=${appearanceData}
          .schema=${appearanceSchema()}
          .computeLabel=${label}
          @value-changed=${params.onValueChanged}
        ></ha-form>
        ${renderRadiusCornerFields(params)}
        ${renderDetailModeField(params)}
        ${renderHapticsField(params)}
      </div>
    </ha-expansion-panel>
  `;
}
