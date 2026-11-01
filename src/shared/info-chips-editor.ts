import { css, html, nothing, type TemplateResult } from "lit";
import type { HomeAssistant, InfoChipHeading, StatusRule } from "../types";
import type { TranslationKey } from "../localize";
import { colorRow, type SchemaEntry } from "./editor-helpers";
import { isChipHeading, type InfoChipConfig, type InfoChipStyle } from "./info-chips";

export type ChipEntry = InfoChipConfig | InfoChipHeading;

/**
 * The editor for a card's `chips`: readings and dividers in one list, with
 * reordering, and the pill/tile choice above it. Shared by the appliance and
 * printer cards so both offer the same thing; a card that has per-chip state
 * rules passes `renderRules` and gets them under each reading.
 */
export interface ChipsEditorParams {
  hass: HomeAssistant | undefined;
  chips: ChipEntry[] | undefined;
  style: InfoChipStyle | undefined;
  t: (key: TranslationKey) => string;
  computeLabel: (schema: SchemaEntry) => string;
  onChange: (chips: ChipEntry[] | undefined) => void;
  onStyleChange: (style: InfoChipStyle | undefined) => void;
  /** Per-chip state rules, for a card that has a rule editor of its own. */
  renderRules?: (rules: StatusRule[], set: (rules: StatusRule[]) => void) => TemplateResult;
}

const CHIP_SCHEMA: SchemaEntry[] = [
  { name: "entity", selector: { entity: {} }, required: true },
  { name: "name", selector: { text: {} } },
  { name: "icon", selector: { icon: {} } },
  { name: "label", selector: { text: {} } },
  { name: "show_state", selector: { boolean: {} } },
  { name: "tap_action", selector: { ui_action: {} } },
];

const HEADING_SCHEMA: SchemaEntry[] = [
  { name: "heading", selector: { text: {} }, required: true },
  { name: "icon", selector: { icon: {} } },
];

/** Drops the keys a cleared field left behind, so the card's defaults apply again. */
function prune<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete out[k];
  }
  return out as T;
}

/** A move within the list, or undefined when it would leave the list. */
export function moveChip<T>(list: T[], index: number, by: -1 | 1): T[] | undefined {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return undefined;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

function entryTitle(entry: ChipEntry, index: number, p: ChipsEditorParams): string {
  if (isChipHeading(entry)) return `${p.t("editor_chips_heading_entry")}: ${entry.heading || "…"}`;
  if (entry.name) return entry.name;
  if (entry.label) return entry.label;
  if (entry.entity) {
    return (p.hass?.states[entry.entity]?.attributes.friendly_name as string | undefined) ?? entry.entity;
  }
  return `#${index + 1}`;
}

export function renderChipsEditor(p: ChipsEditorParams): TemplateResult {
  const list = p.chips ?? [];
  const set = (next: ChipEntry[]): void => p.onChange(next.length ? next : undefined);
  const patch = (index: number, change: Record<string, unknown>): void => {
    const next = [...list];
    next[index] = prune({ ...next[index], ...change }) as ChipEntry;
    set(next);
  };
  const styleSchema: SchemaEntry[] = [
    {
      name: "chip_style",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "pill", label: p.t("editor_chips_style_pill") },
            { value: "tile", label: p.t("editor_chips_style_tile") },
          ],
        },
      },
    },
  ];

  return html`
    <ha-form
      .hass=${p.hass}
      .data=${{ chip_style: p.style ?? "pill" }}
      .schema=${styleSchema}
      .computeLabel=${(s: SchemaEntry) => (s.name === "chip_style" ? p.t("editor_chips_style") : p.computeLabel(s))}
      @value-changed=${(ev: CustomEvent) => {
        const v = (ev.detail.value as { chip_style?: InfoChipStyle }).chip_style;
        p.onStyleChange(v === "pill" ? undefined : v);
      }}
    ></ha-form>
    <div class="hint">${p.t("editor_appliance_chips_hint")}</div>
    ${list.map((entry, index) => {
      const heading = isChipHeading(entry);
      const data = heading ? entry : { show_state: entry.show_state !== false, ...entry };
      return html`
        <div class="entry-block ${heading ? "heading-entry" : ""}">
          <div class="entry-head">
            <div class="entry-title">${entryTitle(entry, index, p)}</div>
            <ha-icon-button
              .label=${p.t("editor_chips_move_up")}
              .disabled=${index === 0}
              @click=${() => {
                const next = moveChip(list, index, -1);
                if (next) set(next);
              }}
              ><ha-icon icon="mdi:arrow-up"></ha-icon
            ></ha-icon-button>
            <ha-icon-button
              .label=${p.t("editor_chips_move_down")}
              .disabled=${index === list.length - 1}
              @click=${() => {
                const next = moveChip(list, index, 1);
                if (next) set(next);
              }}
              ><ha-icon icon="mdi:arrow-down"></ha-icon
            ></ha-icon-button>
          </div>
          <ha-form
            .hass=${p.hass}
            .data=${data}
            .schema=${heading ? HEADING_SCHEMA : CHIP_SCHEMA}
            .computeLabel=${(s: SchemaEntry) =>
              s.name === "heading" ? p.t("editor_chips_heading") : p.computeLabel(s)}
            @value-changed=${(ev: CustomEvent) => patch(index, ev.detail.value as Record<string, unknown>)}
          ></ha-form>
          ${heading
            ? nothing
            : colorRow(p.t("editor_mode_color"), entry.color, (v) => patch(index, { color: v }))}
          ${!heading && p.renderRules
            ? html`
                <ha-expansion-panel outlined .header=${p.t("editor_appliance_chip_states")}>
                  <div class="panel-content">
                    ${p.renderRules(entry.states ?? [], (rules) =>
                      patch(index, { states: rules.length ? rules : undefined }),
                    )}
                  </div>
                </ha-expansion-panel>
              `
            : nothing}
          <ha-button class="remove" @click=${() => set(list.filter((_, i) => i !== index))}
            >${p.t("editor_appliance_remove")}</ha-button
          >
        </div>
      `;
    })}
    <div class="chip-add">
      <ha-button raised @click=${() => set([...list, { entity: "" }])}
        >${p.t("editor_appliance_add_chip")}</ha-button
      >
      <ha-button @click=${() => set([...list, { heading: "" }])}>${p.t("editor_chips_add_heading")}</ha-button>
    </div>
  `;
}

export const chipsEditorStyles = css`
  .entry-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 12px;
    margin-bottom: 8px;
  }

  .entry-block.heading-entry {
    border-style: dashed;
  }

  .entry-head {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .entry-head .entry-title {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-head ha-icon-button {
    --mdc-icon-button-size: 32px;
    --mdc-icon-size: 18px;
  }

  .entry-block .remove {
    align-self: flex-end;
    --mdc-theme-primary: var(--error-color, #e57368);
  }

  .chip-add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
`;
