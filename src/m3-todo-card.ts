import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  M3TodoCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_TODO_RADIUS,
  DEFAULT_TODO_ICON,
  DEFAULT_TODO_ACCENT,
  TODO_HEADER_ICON_SIZE,
  TODO_HEADER_ICON_RADIUS,
  TODO_COUNT_CHIP_SIZE,
  TODO_COUNT_CHIP_RADIUS,
  TODO_INPUT_HEIGHT,
  TODO_INPUT_RADIUS,
  TODO_INPUT_RADIUS_FOCUS,
  TODO_ADD_BUTTON_SIZE,
  TODO_ADD_BUTTON_RADIUS,
  TODO_ADD_BUTTON_RADIUS_ACTIVE,
  TODO_ROW_HEIGHT,
  TODO_ROW_RADIUS,
  TODO_ROW_GAP,
  TODO_CHECK_SIZE,
  TODO_CHECK_RADIUS_OPEN,
  TODO_CHECK_RADIUS_DONE,
  TODO_CHECK_MORPH_MS,
  TODO_TOGGLE_HEIGHT,
  TODO_TOGGLE_RADIUS,
  TODO_TOGGLE_RADIUS_OPEN,
  TODO_DONE_ROW_HEIGHT,
  TODO_DONE_ROW_RADIUS,
  TODO_CLEAR_ARM_MS,
  TODO_QUICK_CHIP_HEIGHT,
  TODO_QUICK_CHIP_RADIUS,
  TODO_QUICK_CHIP_RADIUS_ACTIVE,
  TODO_QUICK_MORPH_MS,
  TODO_DEFAULT_MAX_QUICK_ADD,
  TODO_LONG_PRESS_MS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { activateOnKey } from "./shared/a11y";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { fetchTodoItems, todoSupports, TODO_FEATURE, type TodoItem } from "./shared/ha-todo";
import { collectSupplyChips } from "./shared/supply-chips";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-TODO-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #5dcaa5; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #5dcaa5; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);

// Under a "Obst" heading, a row reading "Obst: Äpfel" says the category
// twice. The full text stays in the title attribute either way, and the
// stored entry is never touched — only what the row displays.
function stripCategory(summary: string, label?: string): string {
  if (!label) return summary;
  const prefix = `${label}:`;
  return summary.startsWith(prefix) ? summary.slice(prefix.length).trim() : summary;
}

@customElement("m3-todo-card")
export class M3TodoCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3TodoCardConfig;
  @state() private _items: TodoItem[] = [];
  @state() private _expanded = false;
  @state() private _focused = false;
  @state() private _addMorph = false;
  /** uid of an item pulsing because the user tried to add it twice. */
  @state() private _duplicate?: string;
  @state() private _clearArmed = false;
  /** Chip labels gathered from the supply cards on this dashboard. */
  @state() private _supplyChips: string[] = [];
  /** Chip currently confirming a tap with its morph. */
  @state() private _chipMorph?: string;
  /** uid of the row currently open for renaming. */
  @state() private _editing?: string;
  @state() private _dragging?: string;

  @query(".todo-input") private _input?: HTMLInputElement;

  private _lastStateKey?: string;
  private _fetchInFlight = false;
  private _morphTimer?: number;
  private _duplicateTimer?: number;
  private _clearTimer?: number;
  private _chipTimer?: number;
  private _suppliesLoaded = false;
  private _pressTimer?: number;
  /** Set once a long press fires, so the release does not also toggle. */
  private _longPressed = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-todo-card-editor");
    return document.createElement("m3-todo-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3TodoCardConfig {
    const entity = Object.keys(hass?.states ?? {}).find((e) => e.startsWith("todo.")) ?? "";
    return { type: "custom:m3-todo-card", entity };
  }

  public setConfig(config: M3TodoCardConfig): void {
    if (!config.entity) throw new Error("entity is required");
    this._config = {
      glass_background: true,
      animation: "auto",
      add_position: "top",
      prevent_duplicates: true,
      show_completed: true,
      show_clear_completed: true,
      ...config,
    };
    this._lastStateKey = undefined;
    this._suppliesLoaded = false;
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 3 };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._morphTimer) clearTimeout(this._morphTimer);
    if (this._duplicateTimer) clearTimeout(this._duplicateTimer);
    if (this._clearTimer) clearTimeout(this._clearTimer);
    if (this._chipTimer) clearTimeout(this._chipTimer);
    if (this._pressTimer) clearTimeout(this._pressTimer);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetch();
    this._loadSupplyChips();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey, vars?: Record<string, string | number>): string {
    let out = localize(key, this._language);
    for (const [k, v] of Object.entries(vars ?? {})) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  }

  // ---- data -------------------------------------------------------------

  // A todo entity's state is its open-item count, so it changes whenever the
  // list does — from this card, another dashboard, or the companion app. That
  // makes it a reliable trigger to re-read the list.
  private _maybeFetch(): void {
    const entityId = this._config?.entity;
    if (!this.hass || !entityId) return;
    const st = this.hass.states[entityId];
    if (!st) return;
    const key = `${entityId}|${st.state}|${st.last_updated ?? ""}|${this._config?.show_completed}`;
    if (key === this._lastStateKey) return;
    this._lastStateKey = key;
    this._load();
  }

  private async _load(): Promise<void> {
    const entityId = this._config?.entity;
    if (!this.hass || !entityId || this._fetchInFlight) return;
    this._fetchInFlight = true;
    try {
      this._items = await fetchTodoItems(
        this.hass,
        entityId,
        // Asking only for open items keeps a long archive of completed
        // entries off the wire when the card would not show them anyway.
        this._config?.show_completed === false ? ["needs_action"] : undefined,
      );
    } catch (e) {
      console.warn("m3-todo-card: could not read the list", e);
    } finally {
      this._fetchInFlight = false;
    }
  }

  private get _open(): TodoItem[] {
    return this._items.filter((i) => i.status === "needs_action");
  }

  private get _done(): TodoItem[] {
    return this._items.filter((i) => i.status === "completed");
  }

  private get _available(): boolean {
    const st = this.hass?.states[this._config?.entity ?? ""];
    return !!st && st.state !== "unavailable" && st.state !== "unknown";
  }

  // ---- actions ----------------------------------------------------------

  private async _call(service: string, data: Record<string, unknown>): Promise<void> {
    const entityId = this._config?.entity;
    if (!this.hass || !entityId) return;
    try {
      await this.hass.callService("todo", service, data, { entity_id: entityId });
    } catch (e) {
      // These run from click handlers, so an unhandled rejection would surface
      // as a bare "Uncaught (in promise)" with no hint of which call failed.
      console.warn(`m3-todo-card: todo.${service} failed`, e);
    }
    // The entity state settles a moment after the service returns; re-reading
    // immediately keeps the card in step with edits made elsewhere too.
    this._lastStateKey = undefined;
    await this._load();
  }

  // Reordering is a websocket command, not a service: `todo.move_item` does
  // not exist (verified against a live instance, which answers "Service
  // todo.move_item not found"). Omitting previous_uid moves to the top.
  private async _move(uid: string, previousUid?: string): Promise<void> {
    const entityId = this._config?.entity;
    if (!this.hass || !entityId) return;
    try {
      await this.hass.callWS({
        type: "todo/item/move",
        entity_id: entityId,
        uid,
        ...(previousUid ? { previous_uid: previousUid } : {}),
      });
    } catch (e) {
      console.warn("m3-todo-card: could not reorder", e);
    }
    this._lastStateKey = undefined;
    await this._load();
  }

  private _add = async (): Promise<void> => {
    const text = this._input?.value.trim();
    if (!text || !this._available) return;

    if (this._config?.prevent_duplicates !== false) {
      const hit = this._open.find((i) => i.summary.toLowerCase() === text.toLowerCase());
      if (hit) {
        // Highlighting the existing entry says more than a silent no-op or a
        // second identical line would.
        this._pulse(hit.uid);
        if (this._input) this._input.value = "";
        return;
      }
    }

    if (this._input) this._input.value = "";
    // Focus stays put so several items can be typed in one go.
    this._input?.focus();
    this._morph();
    await this._call("add_item", { item: text });

    // todo.add_item always appends. Landing at the top takes a second call,
    // and only works on backends that implement reordering — without MOVE the
    // option is silently a no-op rather than an error.
    if (
      this._config?.add_position === "top" &&
      todoSupports(this.hass, this._config.entity, TODO_FEATURE.move)
    ) {
      const added = this._items.find((i) => i.summary === text && i.status === "needs_action");
      if (added) await this._move(added.uid);
    }
  };

  private _pulse(uid: string): void {
    this._duplicate = uid;
    if (this._duplicateTimer) clearTimeout(this._duplicateTimer);
    this._duplicateTimer = window.setTimeout(() => {
      this._duplicate = undefined;
    }, 900);
  }

  private _morph(): void {
    if (!shouldAnimate(this._config?.animation)) return;
    this._addMorph = true;
    if (this._morphTimer) clearTimeout(this._morphTimer);
    this._morphTimer = window.setTimeout(() => {
      this._addMorph = false;
    }, TODO_CHECK_MORPH_MS);
  }

  private _toggle(item: TodoItem): () => void {
    return () => {
      if (!this._available) return;
      const next: TodoItem["status"] =
        item.status === "completed" ? "needs_action" : "completed";
      // Optimistic: the checkbox morph should start on the tap, not after the
      // round-trip. _call re-reads afterwards and wins over this guess.
      this._items = this._items.map((i) => (i.uid === item.uid ? { ...i, status: next } : i));
      this._call("update_item", { item: item.uid, status: next });
    };
  }

  // Two-step instead of a confirm() dialog: a browser modal blocks the whole
  // page and looks nothing like the rest of Home Assistant. The first tap arms
  // the button, a second within the window commits, and it disarms itself.
  private _clearCompleted = async (): Promise<void> => {
    if (!this._available) return;
    if (!this._clearArmed) {
      this._clearArmed = true;
      if (this._clearTimer) clearTimeout(this._clearTimer);
      this._clearTimer = window.setTimeout(() => {
        this._clearArmed = false;
      }, TODO_CLEAR_ARM_MS);
      return;
    }
    this._clearArmed = false;
    if (this._clearTimer) clearTimeout(this._clearTimer);
    await this._call("remove_completed_items", {});
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this._add();
    }
  };

  // ---- editing ----------------------------------------------------------

  // A long press opens the row for renaming. The press has to cancel the tap
  // that follows it, or letting go would immediately tick the item off.
  private _pressHandlers(item: TodoItem) {
    return {
      down: () => {
        if (!this._available) return;
        this._longPressed = false;
        if (this._pressTimer) clearTimeout(this._pressTimer);
        this._pressTimer = window.setTimeout(() => {
          this._longPressed = true;
          this._editing = item.uid;
        }, TODO_LONG_PRESS_MS);
      },
      up: () => {
        if (this._pressTimer) clearTimeout(this._pressTimer);
      },
    };
  }

  private _rename(item: TodoItem, value: string): void {
    const text = value.trim();
    this._editing = undefined;
    if (!text || text === item.summary) return;
    this._call("update_item", { item: item.uid, rename: text });
  }

  private _remove(item: TodoItem): void {
    this._editing = undefined;
    this._call("remove_item", { item: item.uid });
  }

  private _dropOn(target: TodoItem): (e: DragEvent) => void {
    return (e: DragEvent) => {
      e.preventDefault();
      const uid = this._dragging;
      this._dragging = undefined;
      if (!uid || uid === target.uid) return;
      const open = this._open;
      const targetIndex = open.findIndex((i) => i.uid === target.uid);
      const from = open.findIndex((i) => i.uid === uid);
      // previous_uid names the item to land after; dropping onto the first row
      // from below means "move to the very top", which is previous_uid unset.
      const previous =
        targetIndex === 0 && from > 0 ? undefined : open[Math.max(0, targetIndex - (from < targetIndex ? 0 : 1))]?.uid;
      this._move(uid, previous === uid ? undefined : previous);
    };
  }

  // ---- quick add --------------------------------------------------------

  private get _quickAddChips(): string[] {
    const cfg = this._config;
    if (!cfg) return [];
    const max = cfg.max_quick_add ?? TODO_DEFAULT_MAX_QUICK_ADD;
    const openNames = new Set(this._open.map((i) => i.summary.toLowerCase()));
    let candidates: string[] = [];

    switch (cfg.quick_add_mode) {
      case "fixed":
        candidates = cfg.quick_add ?? [];
        break;
      case "recent":
        // There is no completion timestamp in the todo API, so "recent" can
        // only mean "latest in list order" — a good enough stand-in, since
        // backends append rather than reshuffle.
        candidates = [...this._done].reverse().map((i) => i.summary);
        break;
      case "supplies":
        candidates = this._supplyChips;
        break;
      default:
        return [];
    }

    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of candidates) {
      const text = raw.trim();
      const key = text.toLowerCase();
      // Suggesting something already on the list would just trigger the
      // duplicate pulse, so those are dropped rather than shown.
      if (!text || seen.has(key) || openNames.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= max) break;
    }
    return out;
  }

  private async _loadSupplyChips(): Promise<void> {
    if (this._suppliesLoaded || !this.hass) return;
    if (this._config?.quick_add_mode !== "supplies") return;
    this._suppliesLoaded = true;
    this._supplyChips = await collectSupplyChips(this.hass);
  }

  private _quickAdd(text: string): () => void {
    return async () => {
      if (!this._available) return;
      if (shouldAnimate(this._config?.animation)) {
        this._chipMorph = text;
        if (this._chipTimer) clearTimeout(this._chipTimer);
        this._chipTimer = window.setTimeout(() => {
          this._chipMorph = undefined;
        }, TODO_QUICK_MORPH_MS);
      }
      await this._call("add_item", { item: text });
      if (
        this._config?.add_position === "top" &&
        todoSupports(this.hass, this._config.entity, TODO_FEATURE.move)
      ) {
        const added = this._items.find((i) => i.summary === text && i.status === "needs_action");
        if (added) await this._move(added.uid);
      }
    };
  }

  // ---- render -----------------------------------------------------------

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._config?.entity]);
  }

  protected render() {
    const cfg = this._config;
    if (!cfg) return nothing;
    if (this.hass && !this.hass.states[cfg.entity]) return renderMissingEntity(cfg.entity);

    const accent = resolveThemeColor(cfg.accent_color ?? DEFAULT_TODO_ACCENT);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const open = this._open;
    const done = this._done;
    const available = this._available;

    const cssVars = buildCssVars({
      "m3t-accent": accent,
      "m3t-accent-tint": tintOn(this, accent, cfg.accent_opacity, 18),
      "m3t-text": textColorCss,
      "m3t-secondary-text": secondaryTextColorCss,
      "m3t-radius": resolveCornerRadius(cfg.radius ?? DEFAULT_TODO_RADIUS, cfg.corners),
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3t-accent": accent,
      }),
    });
    const style = cardBackgroundCss
      ? `${cssVars} --ha-card-background: ${cardBackgroundCss};`
      : cssVars;

    return html`
      <ha-card style=${style}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${shouldAnimate(cfg.animation) ? "" : "no-animations"}"
        >
          ${this._renderHeader(open.length, done.length)}
          ${available ? this._renderInput() : html`<div class="hint">${this._t("todo_unavailable")}</div>`}
          ${available ? this._renderQuickAdd() : nothing}
          ${open.length
            ? this._renderOpen(open)
            : html`<div class="empty">${this._t("todo_empty")}</div>`}
          ${cfg.show_completed !== false && done.length ? this._renderDone(done) : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderHeader(openCount: number, doneCount: number): TemplateResult {
    const cfg = this._config!;
    const name =
      cfg.name ??
      (this.hass?.states[cfg.entity]?.attributes.friendly_name as string | undefined) ??
      cfg.entity;
    return html`
      <div class="header">
        <div class="header-icon">
          <ha-icon icon=${cfg.icon ?? DEFAULT_TODO_ICON}></ha-icon>
        </div>
        <div class="header-text">
          <div class="header-name">${name}</div>
          <div class="header-sub">
            ${this._t("todo_open_done", { offen: openCount, erledigt: doneCount })}
          </div>
        </div>
        <div class="count-chip ${openCount === 0 ? "clear" : ""}">
          ${openCount === 0
            ? html`<ha-icon icon="mdi:check"></ha-icon>`
            : html`<span>${openCount}</span>`}
        </div>
      </div>
    `;
  }

  private _renderInput(): TemplateResult {
    return html`
      <div class="input-row">
        <input
          class="todo-input ${this._focused ? "focused" : ""}"
          type="text"
          .placeholder=${this._t("todo_add_placeholder")}
          @focus=${() => (this._focused = true)}
          @blur=${() => (this._focused = false)}
          @keydown=${this._onKeyDown}
        />
        <div
          class="add-btn ${this._addMorph ? "morph" : ""}"
          role="button"
          tabindex="0"
          aria-label=${this._t("todo_add")}
          @click=${this._add}
          @keydown=${activateOnKey(this._add)}
        >
          <ha-icon icon="mdi:plus"></ha-icon>
        </div>
      </div>
    `;
  }

  private _renderOpen(open: TodoItem[]): TemplateResult {
    if (!this._config?.group_by_category) {
      return html`<div class="rows">
        ${repeat(open, (i) => i.uid, (i) => this._renderRow(i))}
      </div>`;
    }
    // Entries written as "Category: item" get grouped under that category;
    // anything without a prefix stays in one unlabelled group at the end.
    const groups = new Map<string, TodoItem[]>();
    for (const item of open) {
      const split = item.summary.indexOf(":");
      const key = split > 0 ? item.summary.slice(0, split).trim() : "";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
    );
    return html`
      ${ordered.map(
        ([label, items]) => html`
          ${label ? html`<div class="group-label">${label}</div>` : nothing}
          <div class="rows">
            ${repeat(items, (i) => i.uid, (i) => this._renderRow(i, label))}
          </div>
        `,
      )}
    `;
  }

  private _renderQuickAdd() {
    const chips = this._quickAddChips;
    if (!chips.length) return nothing;
    return html`
      <div class="quick-row">
        ${chips.map(
          (text) => html`
            <div
              class="quick-chip ${this._chipMorph === text ? "morph" : ""}"
              role="button"
              tabindex="0"
              @click=${this._quickAdd(text)}
              @keydown=${activateOnKey(this._quickAdd(text))}
            >
              <span class="quick-plus">+</span>${text}
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderRow(item: TodoItem, label?: string): TemplateResult {
    if (this._editing === item.uid) return this._renderEditRow(item);
    const done = item.status === "completed";
    const press = this._pressHandlers(item);
    const reorder = this._config?.reorderable && todoSupports(this.hass, this._config!.entity, TODO_FEATURE.move);
    return html`
      <div
        class="row ${this._duplicate === item.uid ? "pulse" : ""} ${this._dragging === item.uid ? "dragging" : ""}"
        role="button"
        tabindex="0"
        aria-label=${this._t("todo_toggle_item")}
        aria-pressed=${done ? "true" : "false"}
        draggable=${reorder ? "true" : nothing}
        @dragstart=${reorder ? () => (this._dragging = item.uid) : nothing}
        @dragover=${reorder ? (e: DragEvent) => e.preventDefault() : nothing}
        @drop=${reorder ? this._dropOn(item) : nothing}
        @click=${(e: Event) => {
          // Swallow the click that ends a long press, otherwise opening the
          // rename field would tick the item off at the same time.
          if (this._longPressed) {
            this._longPressed = false;
            e.stopPropagation();
            return;
          }
          this._toggle(item)();
        }}
        @keydown=${activateOnKey(this._toggle(item))}
        @pointerdown=${press.down}
        @pointerup=${press.up}
        @pointerleave=${press.up}
        @pointercancel=${press.up}
      >
        <div class="check ${done ? "done" : ""}">
          <ha-icon icon="mdi:check"></ha-icon>
        </div>
        <div class="row-text ${done ? "done" : ""}" title=${item.summary}>
          ${stripCategory(item.summary, label)}
        </div>
        ${reorder ? html`<ha-icon class="grip" icon="mdi:drag-horizontal-variant"></ha-icon>` : nothing}
      </div>
    `;
  }

  private _renderEditRow(item: TodoItem): TemplateResult {
    return html`
      <div class="row editing">
        <input
          class="edit-input"
          type="text"
          .value=${item.summary}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") this._rename(item, (e.target as HTMLInputElement).value);
            if (e.key === "Escape") this._editing = undefined;
          }}
          @blur=${(e: Event) => this._rename(item, (e.target as HTMLInputElement).value)}
          autofocus
        />
        <ha-icon
          class="row-delete"
          icon="mdi:trash-can-outline"
          role="button"
          tabindex="0"
          aria-label=${this._t("todo_delete_item")}
          @mousedown=${(e: Event) => e.preventDefault()}
          @click=${() => this._remove(item)}
          @keydown=${activateOnKey(() => this._remove(item))}
        ></ha-icon>
      </div>
    `;
  }

  private _renderDone(done: TodoItem[]): TemplateResult {
    const canClear =
      this._config?.show_clear_completed !== false &&
      todoSupports(this.hass, this._config!.entity, TODO_FEATURE.delete);
    return html`
      <div class="done-block">
        <div
          class="done-toggle ${this._expanded ? "open" : ""}"
          role="button"
          tabindex="0"
          aria-expanded=${this._expanded ? "true" : "false"}
          @click=${() => (this._expanded = !this._expanded)}
          @keydown=${activateOnKey(() => (this._expanded = !this._expanded))}
        >
          <div class="check done small"><ha-icon icon="mdi:check"></ha-icon></div>
          <span class="done-label">${this._t("todo_done_count", { n: done.length })}</span>
          ${canClear && this._expanded
            ? html`<span
                class="clear-btn ${this._clearArmed ? "armed" : ""}"
                role="button"
                tabindex="0"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._clearCompleted();
                }}
                @keydown=${activateOnKey((e: Event) => {
                  e.stopPropagation();
                  this._clearCompleted();
                })}
                >${this._t(this._clearArmed ? "todo_clear_confirm" : "todo_clear_completed")}</span
              >`
            : nothing}
          <ha-icon class="chevron" icon=${this._expanded ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>
        </div>
        ${this._expanded
          ? html`<div class="rows done-rows">
              ${repeat(done, (i) => i.uid, (i) => this._renderDoneRow(i))}
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderDoneRow(item: TodoItem): TemplateResult {
    return html`
      <div
        class="row done-row"
        role="button"
        tabindex="0"
        aria-label=${this._t("todo_toggle_item")}
        aria-pressed="true"
        @click=${this._toggle(item)}
        @keydown=${activateOnKey(this._toggle(item))}
      >
        <div class="check done"><ha-icon icon="mdi:check"></ha-icon></div>
        <div class="row-text done" title=${item.summary}>${item.summary}</div>
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      ha-card {
        border-radius: var(--m3t-radius);
      }

      .card-inner {
        border-radius: var(--m3t-radius);
        gap: 10px;
      }

      .hint,
      .empty {
        font-size: 12px;
        opacity: 0.45;
        color: var(--m3t-secondary-text);
        text-align: center;
        padding: 10px 0;
      }

      /* ---- header ---- */

      .header {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .header-icon {
        flex-shrink: 0;
        width: ${TODO_HEADER_ICON_SIZE}px;
        height: ${TODO_HEADER_ICON_SIZE}px;
        border-radius: ${TODO_HEADER_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--m3t-accent-fg, var(--m3t-accent));
        background: var(--m3t-accent-tint);
      }

      .header-icon ha-icon {
        --mdc-icon-size: 24px;
      }

      .header-text {
        flex: 1;
        min-width: 0;
      }

      .header-name {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--m3t-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .header-sub {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3t-secondary-text);
      }

      .count-chip {
        flex-shrink: 0;
        min-width: ${TODO_COUNT_CHIP_SIZE}px;
        height: ${TODO_COUNT_CHIP_SIZE}px;
        padding: 0 10px;
        border-radius: ${TODO_COUNT_CHIP_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        font-size: 13px;
        font-weight: 700;
        color: var(--m3t-accent-fg, var(--m3t-accent));
        background: var(--m3t-accent-tint);
      }

      .count-chip ha-icon {
        --mdc-icon-size: 17px;
      }

      /* ---- input ---- */

      .input-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .todo-input {
        flex: 1;
        min-width: 0;
        height: ${TODO_INPUT_HEIGHT}px;
        box-sizing: border-box;
        padding: 0 18px;
        border: none;
        outline: none;
        font-size: 14px;
        font-family: inherit;
        color: var(--m3t-text);
        border-radius: ${TODO_INPUT_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 7%, var(--ha-card-background, var(--card-background-color)));
        transition:
          border-radius 300ms ${EASING},
          background 300ms ${EASING};
      }

      .todo-input.focused {
        border-radius: ${TODO_INPUT_RADIUS_FOCUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 11%, var(--ha-card-background, var(--card-background-color)));
      }

      .card-inner.no-animations .todo-input {
        transition: none;
      }

      .todo-input::placeholder {
        color: var(--m3t-secondary-text);
        opacity: 0.45;
      }

      .add-btn {
        flex-shrink: 0;
        width: ${TODO_ADD_BUTTON_SIZE}px;
        height: ${TODO_ADD_BUTTON_SIZE}px;
        border-radius: ${TODO_ADD_BUTTON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        background: var(--m3t-accent);
        /* The accent is a light pastel, so the glyph has to be dark to stay
           readable on it — the card's text colour would vanish. */
        color: #1c1c1c;
        transition: border-radius ${TODO_CHECK_MORPH_MS}ms ${EASING};
      }

      .add-btn.morph {
        border-radius: ${TODO_ADD_BUTTON_RADIUS_ACTIVE}px;
      }

      .card-inner.no-animations .add-btn {
        transition: none;
      }

      .add-btn ha-icon {
        --mdc-icon-size: 24px;
      }

      .add-btn:focus-visible,
      .row:focus-visible,
      .done-toggle:focus-visible,
      .clear-btn:focus-visible {
        outline: 2px solid var(--m3t-accent);
        outline-offset: 2px;
      }

      .quick-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .quick-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: ${TODO_QUICK_CHIP_HEIGHT}px;
        padding: 0 12px;
        box-sizing: border-box;
        border-radius: ${TODO_QUICK_CHIP_RADIUS}px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        color: var(--m3t-text);
        background: color-mix(in srgb, var(--primary-text-color) 7%, var(--ha-card-background, var(--card-background-color)));
        transition:
          border-radius ${TODO_QUICK_MORPH_MS}ms ${EASING},
          background ${TODO_QUICK_MORPH_MS}ms ${EASING};
      }

      .quick-chip.morph {
        border-radius: ${TODO_QUICK_CHIP_RADIUS_ACTIVE}px;
        background: var(--m3t-accent-tint);
      }

      .card-inner.no-animations .quick-chip {
        transition: none;
      }

      .quick-chip:focus-visible {
        outline: 2px solid var(--m3t-accent);
        outline-offset: 2px;
      }

      .quick-plus {
        opacity: 0.5;
        font-weight: 700;
      }

      /* ---- rows ---- */

      .rows {
        display: flex;
        flex-direction: column;
        gap: ${TODO_ROW_GAP}px;
      }

      .row {
        display: flex;
        align-items: center;
        gap: 12px;
        height: ${TODO_ROW_HEIGHT}px;
        padding: 0 14px;
        box-sizing: border-box;
        border-radius: ${TODO_ROW_RADIUS}px;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
      }

      .row.pulse {
        animation: pulse 900ms ${EASING};
      }

      @keyframes pulse {
        0%,
        100% {
          background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        }
        30% {
          background: var(--m3t-accent-tint);
        }
      }

      .card-inner.no-animations .row.pulse {
        animation: none;
      }

      .check {
        flex-shrink: 0;
        width: ${TODO_CHECK_SIZE}px;
        height: ${TODO_CHECK_SIZE}px;
        box-sizing: border-box;
        border-radius: ${TODO_CHECK_RADIUS_OPEN}px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        color: transparent;
        background: transparent;
        transition:
          border-radius ${TODO_CHECK_MORPH_MS}ms ${EASING},
          background ${TODO_CHECK_MORPH_MS}ms ${EASING},
          border-color ${TODO_CHECK_MORPH_MS}ms ${EASING};
      }

      .check.done {
        border-radius: ${TODO_CHECK_RADIUS_DONE}px;
        border-color: var(--m3t-accent-fg, var(--m3t-accent));
        background: var(--m3t-accent);
        color: #1c1c1c;
      }

      .check.small {
        width: 22px;
        height: 22px;
      }

      .card-inner.no-animations .check {
        transition: none;
      }

      .check ha-icon {
        --mdc-icon-size: 15px;
      }

      .row-text {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--m3t-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row-text.done {
        font-weight: 400;
        opacity: 0.55;
        text-decoration: line-through;
        text-decoration-color: color-mix(in srgb, var(--m3t-text) 45%, transparent);
      }

      .row.dragging {
        opacity: 0.4;
      }

      .grip {
        flex-shrink: 0;
        --mdc-icon-size: 18px;
        color: var(--m3t-secondary-text);
        opacity: 0.35;
        cursor: grab;
      }

      .row.editing {
        gap: 8px;
      }

      .edit-input {
        flex: 1;
        min-width: 0;
        border: none;
        outline: none;
        background: transparent;
        font-size: 13px;
        font-weight: 500;
        font-family: inherit;
        color: var(--m3t-text);
      }

      .row-delete {
        flex-shrink: 0;
        --mdc-icon-size: 18px;
        color: var(--error-color, #e57368);
        cursor: pointer;
      }

      .group-label {
        font-size: 11px;
        font-weight: 600;
        opacity: 0.5;
        color: var(--m3t-secondary-text);
        padding: 2px 4px 0;
      }

      /* ---- completed ---- */

      .done-block {
        display: flex;
        flex-direction: column;
        gap: ${TODO_ROW_GAP}px;
      }

      .done-toggle {
        display: flex;
        align-items: center;
        gap: 12px;
        height: ${TODO_TOGGLE_HEIGHT}px;
        padding: 0 14px;
        box-sizing: border-box;
        border-radius: ${TODO_TOGGLE_RADIUS}px;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        transition: border-radius ${TODO_CHECK_MORPH_MS}ms ${EASING};
      }

      .done-toggle.open {
        border-radius: ${TODO_TOGGLE_RADIUS_OPEN}px;
      }

      .card-inner.no-animations .done-toggle {
        transition: none;
      }

      .done-label {
        flex: 1;
        font-size: 12px;
        font-weight: 600;
        color: var(--m3t-secondary-text);
        opacity: 0.75;
      }

      .clear-btn {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 600;
        color: var(--m3t-accent-fg, var(--m3t-accent));
        cursor: pointer;
      }

      .clear-btn.armed {
        color: var(--error-color, #e57368);
      }

      .chevron {
        flex-shrink: 0;
        --mdc-icon-size: 18px;
        color: var(--m3t-secondary-text);
        opacity: 0.5;
      }

      .done-rows .row {
        height: ${TODO_DONE_ROW_HEIGHT}px;
        border-radius: ${TODO_DONE_ROW_RADIUS}px;
        opacity: 0.6;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .todo-input {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .todo-input.focused {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .quick-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .row {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .done-toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
        @keyframes pulse {
          0%, 100% {
            background: var(--ha-card-background, var(--card-background-color));
          }
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-todo-card": M3TodoCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-todo-card",
  name: "M3 Todo Card",
  description:
    "Einkaufs- und Aufgabenlisten im Material-3-Design: schnelles Hinzufügen, Abhaken mit Morph-Animation und ein Aufklappbereich für Erledigtes.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
