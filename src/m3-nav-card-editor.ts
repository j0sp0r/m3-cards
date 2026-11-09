import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3NavCardConfig,
  NavItemConfig,
  NavLayoutConfig,
  NavSheetItem,
  NavActionMenuEntry,
  NavSubmenuEntry,
} from "./types";
import {
  NAV_BAR_RADIUS_UI,
  NAV_DEFAULT_BREAKPOINT,
  NAV_SIZE_MAX,
  NAV_SIZE_MIN,
} from "./const";
import { dashboardViews, viewPath, type LovelaceViewLike } from "./shared/dashboard-views";
import { renderDetailModeField } from "./shared/appearance-editor";
import { localize, type TranslationKey } from "./localize";
import {
  colorRow,
  editorStyles,
  fireEvent,
  type SchemaEntry,
} from "./shared/editor-helpers";

@customElement("m3-nav-card-editor")
export class M3NavCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3NavCardConfig;

  public setConfig(config: M3NavCardConfig): void {
    this._config = config;
    this._foldMenuIntoDrawer();
  }

  /**
   * A sheet has no round button, so its menu entries move to the drawer.
   *
   * The card already draws them there — the drawer is what a sheet has instead
   * of a button — but they stayed in `action_button.menu` in the config, which
   * this editor no longer offers a section for. They would have been visible
   * on screen and uneditable here. So they are folded into the drawer's own
   * tiles, where they can be renamed and reordered like everything else.
   *
   * Idempotent: once folded there is no menu left to fold, so this settles
   * after one pass rather than looping on its own emit.
   */
  private _foldMenuIntoDrawer(): void {
    const cfg = this._config;
    if (!cfg || (cfg.style ?? "footer") !== "sheet") return;
    const menu = cfg.action_button?.menu ?? [];
    if (!menu.length) return;

    const tiles = cfg.sheet_items ?? [];
    const known = new Set(tiles.map((tile) => tile.path).filter(Boolean));
    const added = menu
      .filter((entry) => !entry.path || !known.has(entry.path))
      .map(({ name, icon, color, path, tap_action }) => ({
        name,
        icon,
        color,
        path,
        tap_action,
      }));

    const next: M3NavCardConfig = { ...cfg };
    delete next.action_button;
    next.sheet_items = [...tiles, ...added];
    this._emit(
      this._clean(next as unknown as Record<string, unknown>) as unknown as M3NavCardConfig,
    );
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _items(): NavItemConfig[] {
    return this._config?.items ?? [];
  }

  private _emit(config: M3NavCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  /** Drops keys the user cleared: the card's defaults only apply when absent. */
  private _clean(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...obj };
    for (const [k, v] of Object.entries(out)) {
      if (v === "" || v === undefined || v === null) delete out[k];
      if (Array.isArray(v) && v.length === 0) delete out[k];
    }
    return out;
  }

  // ---- items ---------------------------------------------------------------

  private _setItems(items: NavItemConfig[]): void {
    if (!this._config) return;
    this._emit({ ...this._config, items });
  }

  /**
   * Fills in a name and icon from the view a newly chosen path points at.
   *
   * Picking "Energie — /lovelace/energie" and then typing "Energie" and its
   * icon again is work the dashboard already knows the answer to. Only empty
   * fields are filled: anything the author wrote stays, and re-picking a path
   * never overwrites a label they chose on purpose.
   */
  private _withViewDefaults<T extends { name?: string; icon?: string; path?: string }>(
    current: T | undefined,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const pfad = patch.path;
    if (typeof pfad !== "string" || !pfad || pfad === current?.path) return patch;

    const views = this._dashboardViews();
    const index = views.findIndex((view, i) => viewPath(view, i) === pfad);
    if (index < 0) return patch;

    const view = views[index];
    const out = { ...patch };
    if (!("name" in patch) && !current?.name && view.title) out.name = view.title;
    if (!("icon" in patch) && !current?.icon && view.icon) out.icon = view.icon;
    return out;
  }

  private _patchItem(index: number, patch: Partial<NavItemConfig>): void {
    const items = [...this._items];
    const voll = this._withViewDefaults(items[index], patch as Record<string, unknown>);
    items[index] = this._clean({ ...items[index], ...voll }) as NavItemConfig;
    this._setItems(items);
  }

  private _addItem(): void {
    this._setItems([...this._items, {}]);
  }

  private _removeItem(index: number): void {
    this._setItems(this._items.filter((_, i) => i !== index));
  }

  /**
   * Reordering by two buttons rather than by dragging: no editor in this suite
   * has a drag-sortable list, and adding one would be new shared infrastructure
   * for a list that is typically four entries long.
   */
  private _moveItem(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this._items.length) return;
    const items = [...this._items];
    [items[index], items[target]] = [items[target], items[index]];
    this._setItems(items);
  }

  /**
   * The width cap as one switch plus, only when it is actually in use, a
   * number.
   *
   * It was a text field first, which invited values that look plausible and are
   * not — "fixed" typed in place of "fit" produced a declaration the browser
   * drops. Then a three-option dropdown, which named three concepts to answer
   * one question. It is a switch now, because the question people are actually
   * asking is "must this thing span my whole screen?" and that has two answers.
   * A fixed pixel width is still honoured and still editable when a config
   * carries one, but it is not offered to someone who never asked for it.
   */
  private _isFit(value: number | string | undefined): boolean {
    return value === "fit" || value === "fit-content";
  }

  private _widthSchema(): SchemaEntry[] {
    return [{ name: "width_fit", selector: { boolean: {} } }];
  }

  private _widthPixelSchema(): SchemaEntry[] {
    return [
      {
        name: "width_px",
        selector: { number: { min: 200, max: 1600, step: 10, mode: "slider" } },
      },
    ];
  }

  private _renderWidth(
    value: number | string | undefined,
    apply: (next: number | string | undefined) => void,
    withHint = true,
  ) {
    const fit = this._isFit(value);
    // A number already in the config stays visible, so switching the toggle off
    // does not quietly throw someone's chosen width away.
    const px = typeof value === "number" ? value : undefined;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{ width_fit: fit }}
        .schema=${this._widthSchema()}
        .computeLabel=${this._computeLabel}
        @value-changed=${(ev: CustomEvent) => {
          const on = (ev.detail.value as { width_fit: boolean }).width_fit === true;
          apply(on ? "fit" : px);
        }}
      ></ha-form>
      ${withHint ? html`<div class="hint">${this._t("editor_nav_width_hint")}</div>` : nothing}
      ${px !== undefined
        ? html`
            <ha-form
              .hass=${this.hass}
              .data=${{ width_px: px }}
              .schema=${this._widthPixelSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) =>
                apply((ev.detail.value as { width_px: number }).width_px)}
            ></ha-form>
            <div class="hint">${this._t("editor_nav_width_px_hint")}</div>
          `
        : nothing}
    `;
  }

  /** Two arrows, disabled at the ends. Shared by the entries and the tiles. */
  private _renderReorder(
    index: number,
    length: number,
    move: (from: number, to: number) => void,
  ) {
    const step = (delta: number) => (e: Event) => {
      // Without this the click reaches the expansion panel underneath and
      // folds it shut on every press.
      e.stopPropagation();
      e.preventDefault();
      move(index, index + delta);
    };
    return html`
      <ha-icon-button
        .label=${this._t("editor_nav_move_up")}
        .disabled=${index === 0}
        @click=${step(-1)}
      >
        <ha-icon icon="mdi:arrow-up"></ha-icon>
      </ha-icon-button>
      <ha-icon-button
        .label=${this._t("editor_nav_move_down")}
        .disabled=${index === length - 1}
        @click=${step(1)}
      >
        <ha-icon icon="mdi:arrow-down"></ha-icon>
      </ha-icon-button>
    `;
  }

  private _moveSheetItem(from: number, to: number): void {
    if (to < 0 || to >= this._sheetItems.length) return;
    const items = [...this._sheetItems];
    [items[from], items[to]] = [items[to], items[from]];
    this._setSheetItems(items);
  }

  // ---- action button menu ---------------------------------------------------

  /**
   * Whether the round button beside the bar exists at all.
   *
   * The card draws it only when it has an icon, so switching it off means
   * removing the whole block — which is not something anyone should have to
   * work out by clearing an icon field.
   */
  /**
   * Whether this variant has a round action button to configure.
   *
   * Only the detached pills carry one. For the others the section is hidden
   * rather than shown and ignored, because it is not part of how those bars
   * are drawn — and what it would have held ends up in the bar itself, as
   * ordinary entries. A configured button stays in the config and reappears
   * with the variant it belongs to.
   */
  private get _bubbleFits(): boolean {
    const style = this._config?.style ?? "footer";
    return style === "floating";
  }

  private get _hasActionButton(): boolean {
    return !!this._config?.action_button?.icon;
  }

  private _actionButtonToggled(on: boolean): void {
    if (!this._config) return;
    const next = { ...this._config };
    if (on) {
      // Seeded with an icon, because without one the card draws nothing and
      // the switch would look broken the moment it was turned on.
      next.action_button = { icon: "mdi:magnify", ...(next.action_button ?? {}) };
      if (!next.action_button.icon) next.action_button.icon = "mdi:magnify";
    } else {
      delete next.action_button;
    }
    this._emit(next);
  }

  private get _actionMenu(): NavActionMenuEntry[] {
    return this._config?.action_button?.menu ?? [];
  }

  private _setActionMenu(entries: NavActionMenuEntry[]): void {
    if (!this._config) return;
    const button = { ...(this._config.action_button ?? {}) };
    if (entries.length) button.menu = entries;
    else delete button.menu;
    const next = { ...this._config };
    if (Object.keys(button).length) next.action_button = button;
    else delete next.action_button;
    this._emit(next);
  }

  private _actionMenuChanged(index: number, ev: CustomEvent): void {
    const entries = [...this._actionMenu];
    entries[index] = this._clean({
      ...entries[index],
      ...this._withViewDefaults(entries[index], ev.detail.value as Record<string, unknown>),
    }) as NavActionMenuEntry;
    this._setActionMenu(entries);
  }

  private _moveActionMenuEntry(from: number, to: number): void {
    if (to < 0 || to >= this._actionMenu.length) return;
    const entries = [...this._actionMenu];
    [entries[from], entries[to]] = [entries[to], entries[from]];
    this._setActionMenu(entries);
  }

  private _actionMenuSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "color", selector: { text: {} } },
      this._pathSelector(),
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  private _itemLabel(item: NavItemConfig, index: number): string {
    return item.name || item.path || `#${index + 1}`;
  }

  // ---- views of the current dashboard --------------------------------------

  /**
   * Walks up to the Lovelace root and reads the views it is configured with.
   * Wrapped because the shape is Home Assistant's private business: anything
   * unexpected just means the button offers nothing, never a broken editor.
   */
  /**
   * The dashboard's views, for the target-page picker.
   *
   * Walking up the DOM works while the card sits in the view, but the card
   * editor runs in a dialog at the top of the document, where there is no
   * Lovelace root above it to ask — the walk came back empty and the picker
   * quietly fell back to a plain text field, which is what it was supposed to
   * replace. So when the walk finds nothing, the same websocket call
   * getStubConfig uses fills this in instead.
   */
  @state() private _fetchedViews: LovelaceViewLike[] = [];

  private _viewsRequested = false;

  private _ensureViews(): void {
    if (this._viewsRequested || !this.hass) return;
    this._viewsRequested = true;
    void dashboardViews(this.hass).then((views) => {
      this._fetchedViews = views;
    });
  }

  private _dashboardViews(): LovelaceViewLike[] {
    let node: (Node & { lovelace?: { config?: { views?: LovelaceViewLike[] } } }) | null =
      this;
    for (let depth = 0; depth < 12 && node; depth++) {
      const views = node.lovelace?.config?.views;
      // A subview is opened from another view, never from the tab strip, so it
      // does not belong in a bar built out of the tabs — same rule the
      // suggestion a new card starts with applies.
      if (Array.isArray(views)) return views.filter((view) => view && !view.subview);
      const parent: Node | null =
        (node as unknown as { parentNode?: Node }).parentNode ?? null;
      node = (parent && (parent as ShadowRoot).host
        ? (parent as ShadowRoot).host
        : parent) as typeof node;
    }
    this._ensureViews();
    return this._fetchedViews;
  }

  /**
   * The target page, as a list of this dashboard's own views rather than a
   * path to type from memory. `custom_value` keeps the field open for a path
   * the list cannot know — another dashboard, or an external page.
   */
  private _pathSelector(): SchemaEntry {
    const views = this._dashboardViews();
    if (!views.length) return { name: "path", selector: { text: {} } };
    return {
      name: "path",
      selector: {
        select: {
          mode: "dropdown",
          custom_value: true,
          options: views.map((view, index) => {
            const pfad = viewPath(view, index);
            return { value: pfad, label: view.title ? `${view.title} — ${pfad}` : pfad };
          }),
        },
      },
    };
  }

  private _importViews(): void {
    const views = this._dashboardViews();
    if (!views.length) return;
    const known = new Set(this._items.map((i) => i.path).filter(Boolean));
    const added: NavItemConfig[] = [];
    views.forEach((view, index) => {
      const path = viewPath(view, index);
      if (known.has(path)) return;
      added.push(
        this._clean({
          name: view.title,
          icon: view.icon,
          path,
        }) as NavItemConfig,
      );
    });
    if (added.length) this._setItems([...this._items, ...added]);
  }

  // ---- schemas -------------------------------------------------------------

  /** `segmented` sits in the card flow, so it has no edge to dock to. */
  private get _hasEdge(): boolean {
    return (this._config?.style ?? "footer") !== "segmented";
  }

  private get _usesSplitLayouts(): boolean {
    return !!(this._config?.desktop || this._config?.mobile);
  }

  private _splitToggleSchema(): SchemaEntry[] {
    return [{ name: "split", selector: { boolean: {} } }];
  }

  private _splitToggled(on: boolean): void {
    if (!this._config) return;
    const next = { ...this._config };
    if (on) {
      // Seeded with what the card already does, so switching it on changes
      // nothing until something below it is actually changed. The width moves
      // down with it: leaving a copy at the top would mean a setting that
      // still applies while nothing on screen shows it.
      const width = next.max_width;
      next.desktop = { ...(next.desktop ?? {}) };
      next.mobile = { ...(next.mobile ?? {}) };
      if (width !== undefined) {
        if (next.desktop.max_width === undefined) next.desktop.max_width = width;
        if (next.mobile.max_width === undefined) next.mobile.max_width = width;
        delete next.max_width;
      }
    } else {
      const width = next.desktop?.max_width ?? next.mobile?.max_width;
      if (width !== undefined && next.max_width === undefined) next.max_width = width;
      delete next.desktop;
      delete next.mobile;
    }
    this._emit(next);
  }

  private _layoutSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "header", label: this._t("editor_nav_style_header") },
              { value: "footer", label: this._t("editor_nav_style_footer") },
              { value: "segmented", label: this._t("editor_nav_style_segmented") },
              { value: "floating", label: this._t("editor_nav_style_floating") },
              { value: "sheet", label: this._t("editor_nav_style_sheet") },
            ],
          },
        },
      },
    ];
    if (this._hasEdge) {
      schema.push({
        name: "position",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "top", label: this._t("editor_nav_position_top") },
              { value: "bottom", label: this._t("editor_nav_position_bottom") },
            ],
          },
        },
      });
    }
    return schema;
  }

  private _perWidthSchema(withBreakpoint: boolean): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              // An empty select reads as "not loaded yet" rather than as "the
              // one above applies", so the fallback is spelled out.
              { value: "", label: this._t("editor_nav_style_inherit") },
              { value: "header", label: this._t("editor_nav_style_header") },
              { value: "footer", label: this._t("editor_nav_style_footer") },
              { value: "segmented", label: this._t("editor_nav_style_segmented") },
              { value: "floating", label: this._t("editor_nav_style_floating") },
              { value: "sheet", label: this._t("editor_nav_style_sheet") },
            ],
          },
        },
      },
      { name: "show_labels", selector: { boolean: {} } },
      { name: "hidden", selector: { boolean: {} } },
    ];
    if (withBreakpoint) {
      schema.push({
        name: "breakpoint",
        selector: { number: { min: 320, max: 1600, step: 8, mode: "box" } },
      });
    }
    return schema;
  }

  /** What someone needs to fill in for an entry to work at all. */
  private _itemSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "active_icon", selector: { icon: {} } },
      { name: "picture", selector: { entity: { domain: "person" } } },
      this._pathSelector(),
    ];
  }

  /** Regex and Jinja: real capabilities, wrong things to meet first. */
  private _itemAdvancedSchema(): SchemaEntry[] {
    return [
      { name: "match", selector: { text: {} } },
      { name: "hidden", selector: { text: {} } },
      { name: "users", selector: { select: { multiple: true, custom_value: true, options: [] } } },
      { name: "disabled", selector: { text: {} } },
    ];
  }

  private _itemActionSchema(): SchemaEntry[] {
    return [
      { name: "tap_action", selector: { ui_action: {} } },
      { name: "hold_action", selector: { ui_action: {} } },
      { name: "double_tap_action", selector: { ui_action: {} } },
    ];
  }

  /**
   * A badge has three possible sources and they are mutually exclusive, so the
   * editor asks which one first and then shows that one field. Offering all
   * four at once asked the reader to work out the exclusivity themselves.
   */
  private _badgeSource(item: NavItemConfig): "none" | "entity" | "count" | "template" {
    const badge = item.badge;
    if (!badge) return "none";
    if (badge.template) return "template";
    if (badge.count_entities?.length) return "count";
    if (badge.entity) return "entity";
    return "none";
  }

  private _badgeSourceSchema(): SchemaEntry[] {
    return [
      {
        name: "badge_source",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "none", label: this._t("editor_nav_badge_source_none") },
              { value: "entity", label: this._t("editor_nav_badge_source_entity") },
              { value: "count", label: this._t("editor_nav_badge_source_count") },
              { value: "template", label: this._t("editor_nav_badge_source_template") },
            ],
          },
        },
      },
    ];
  }

  private _badgeFieldSchema(source: string): SchemaEntry[] {
    if (source === "entity") return [{ name: "entity", selector: { entity: {} } }];
    if (source === "count") {
      return [{ name: "count_entities", selector: { entity: { multiple: true } } }];
    }
    if (source === "template") return [{ name: "template", selector: { text: {} } }];
    return [];
  }

  private _badgeSourceChanged(index: number, source: string): void {
    // Switching source drops the other two, or the card would go on reading a
    // field the editor no longer shows.
    if (source === "none") {
      this._patchItem(index, { badge: undefined, badge_style: undefined });
      return;
    }
    const previous = this._items[index]?.badge ?? {};
    const badge: Record<string, unknown> = {};
    if (previous.color) badge.color = previous.color;
    if (previous.show_if) badge.show_if = previous.show_if;
    this._patchItem(index, { badge: badge as NavItemConfig["badge"] });
  }

  private _badgeAdvancedSchema(): SchemaEntry[] {
    return [{ name: "show_if", selector: { text: {} } }];
  }

  private _badgeStyleSchema(): SchemaEntry[] {
    return [
      {
        name: "badge_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "dot", label: this._t("editor_nav_badge_style_dot") },
              { value: "count", label: this._t("editor_nav_badge_style_count") },
              { value: "text", label: this._t("editor_nav_badge_style_text") },
            ],
          },
        },
      },
    ];
  }

  private _appearanceSchema(): SchemaEntry[] {
    return [
      {
        name: "label_visibility",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "always", label: this._t("editor_nav_label_always") },
              { value: "active_only", label: this._t("editor_nav_label_active") },
              { value: "inactive_only", label: this._t("editor_nav_label_inactive") },
              { value: "never", label: this._t("editor_nav_label_never") },
            ],
          },
        },
      },
      {
        name: "label_position",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "below", label: this._t("editor_nav_label_pos_below") },
              { value: "above", label: this._t("editor_nav_label_pos_above") },
              { value: "right", label: this._t("editor_nav_label_pos_right") },
              { value: "left", label: this._t("editor_nav_label_pos_left") },
            ],
          },
        },
      },
      {
        name: "size",
        selector: { number: { min: NAV_SIZE_MIN, max: NAV_SIZE_MAX, step: 0.05, mode: "slider" } },
      },
      {
        name: "icon_visibility",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "always", label: this._t("editor_nav_label_always") },
              { value: "active_only", label: this._t("editor_nav_label_active") },
              { value: "inactive_only", label: this._t("editor_nav_label_inactive") },
              { value: "never", label: this._t("editor_nav_label_never") },
            ],
          },
        },
      },
      { name: "item_background", selector: { boolean: {} } },
      {
        name: "active_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "tint", label: this._t("editor_nav_active_style_tint") },
              { value: "solid", label: this._t("editor_nav_active_style_solid") },
            ],
          },
        },
      },
      {
        name: "container_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "glass", label: this._t("editor_nav_container_glass") },
              { value: "solid", label: this._t("editor_nav_container_solid") },
              { value: "transparent", label: this._t("editor_nav_container_transparent") },
            ],
          },
        },
      },
    ];
  }

  /** Fine-tuning: real options, but not the ones to meet first. */
  private _appearanceAdvancedSchema(): SchemaEntry[] {
    return [
      {
        name: "icon_size",
        selector: { number: { min: 14, max: 40, step: 1, mode: "slider" } },
      },
      {
        name: "marker_motion",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "none", label: this._t("editor_nav_marker_motion_none") },
              { value: "slide", label: this._t("editor_nav_marker_motion_slide") },
            ],
          },
        },
      },
      {
        name: "pill_size",
        selector: { number: { min: 0.7, max: 1.6, step: 0.05, mode: "slider" } },
      },
      {
        name: "label_size",
        selector: { number: { min: 9, max: 24, step: 1, mode: "slider" } },
      },
      {
        name: "edge_distance",
        selector: { number: { min: 0, max: 60, step: 1, mode: "slider" } },
      },
      {
        name: "container_opacity",
        selector: { number: { min: 10, max: 100, step: 1, mode: "slider" } },
      },
      { name: "blur", selector: { number: { min: 0, max: 40, step: 1, mode: "slider" } } },
      { name: "radius", selector: { number: { min: 0, max: 40, step: 1, mode: "slider" } } },
    ];
  }

  private _behaviorSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      { name: "haptics", selector: { boolean: {} } },
      { name: "swipe_navigation", selector: { boolean: {} } },
      ...(this._config?.swipe_navigation === true
        ? [
            {
              name: "swipe_direction",
              selector: {
                select: {
                  mode: "dropdown" as const,
                  options: [
                    { value: "follow", label: this._t("editor_nav_swipe_direction_follow") },
                    { value: "inverted", label: this._t("editor_nav_swipe_direction_inverted") },
                  ],
                },
              },
            },
            { name: "bar_scroll", selector: { boolean: {} } },
          ]
        : []),
      { name: "auto_hide_on_scroll", selector: { boolean: {} } },
      // What happens when a page changes is behaviour, not appearance: the
      // marker's own movement lives under Appearance because it is part of how
      // the bar looks, but this is about the navigation itself.
      {
        name: "page_transition",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "none", label: this._t("editor_nav_page_transition_none") },
              { value: "fade", label: this._t("editor_nav_page_transition_fade") },
              { value: "up", label: this._t("editor_nav_page_transition_up") },
            ],
          },
        },
      },
    ];
    if ((this._config?.page_transition ?? "none") !== "none") {
      schema.push({
        name: "page_transition_ms",
        selector: { number: { min: 80, max: 600, step: 10, mode: "slider" } },
      });
    }
    // Only worth asking about once something has a submenu to open, and
    // `preload_views` is deliberately absent: it does nothing today, and a
    // switch that does nothing is worse than no switch.
    if (this._items.some((i) => (i.submenu ?? []).length)) {
      schema.push({
        name: "submenu_trigger",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "tap", label: this._t("editor_nav_submenu_trigger_tap") },
              { value: "hold", label: this._t("editor_nav_submenu_trigger_hold") },
            ],
          },
        },
      });
    }
    return schema;
  }

  private _visibilitySchema(): SchemaEntry[] {
    return [{ name: "hidden", selector: { text: {} } }];
  }

  private _sheetSchema(): SchemaEntry[] {
    return [
      { name: "sheet_title", selector: { text: {} } },
      {
        name: "sheet_max_height",
        selector: { number: { min: 20, max: 90, step: 5, mode: "slider" } },
      },
      {
        name: "sheet_default",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "collapsed", label: this._t("editor_nav_sheet_default_collapsed") },
              { value: "expanded", label: this._t("editor_nav_sheet_default_expanded") },
              { value: "remember", label: this._t("editor_nav_sheet_default_remember") },
            ],
          },
        },
      },
      {
        name: "sheet_state_entity",
        selector: { entity: { domain: "input_boolean" } },
      },
      { name: "collapse_on_navigate", selector: { boolean: {} } },
      {
        name: "sheet_columns",
        selector: { number: { min: 2, max: 8, step: 1, mode: "box" } },
      },
    ];
  }

  private _sheetActionSchema(): SchemaEntry[] {
    return [
      { name: "icon", selector: { icon: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  private _sheetActionChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    const action = this._clean({ ...this._config.sheet_action, ...patch });
    const next = { ...this._config };
    if (Object.keys(action).length) {
      next.sheet_action = action as M3NavCardConfig["sheet_action"];
    } else {
      delete next.sheet_action;
    }
    this._emit(next);
  }

  /**
   * The half-open stop, as a checkbox rather than as a raw array: `ha-form` has
   * no selector for a list of floats, and "0, 0.5, 1" typed into a text field
   * is a validation problem in exchange for an option almost nobody sets by
   * hand. YAML still accepts any list.
   */
  private _snapHalfChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const on = (ev.detail.value as { snap_half?: boolean }).snap_half === true;
    const next = { ...this._config };
    if (on) {
      next.snap_points = [0, 0.5, 1];
    } else {
      delete next.snap_points;
    }
    this._emit(next);
  }

  // ---- sheet shortcut tiles -------------------------------------------------

  private get _sheetItems(): NavSheetItem[] {
    return this._config?.sheet_items ?? [];
  }

  private _setSheetItems(items: NavSheetItem[]): void {
    if (!this._config) return;
    const next = { ...this._config };
    if (items.length) next.sheet_items = items;
    else delete next.sheet_items;
    this._emit(next);
  }

  private _sheetItemSchema(list: boolean): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      this._pathSelector(),
    ];
    // The second line only exists in the list layout, so it is only asked for
    // there — a field that visibly does nothing is worse than a missing one.
    if (list) schema.push({ name: "secondary", selector: { text: {} } });
    schema.push({ name: "tap_action", selector: { ui_action: {} } });
    return schema;
  }

  private _sheetStyleSchema(): SchemaEntry[] {
    return [
      {
        name: "sheet_item_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "grid", label: this._t("editor_nav_sheet_style_grid") },
              { value: "list", label: this._t("editor_nav_sheet_style_list") },
            ],
          },
        },
      },
    ];
  }

  private _sheetItemChanged(index: number, ev: CustomEvent): void {
    const items = [...this._sheetItems];
    items[index] = this._clean({
      ...items[index],
      ...this._withViewDefaults(items[index], ev.detail.value as Record<string, unknown>),
    }) as NavSheetItem;
    this._setSheetItems(items);
  }

  /**
   * Copies every submenu entry of every item into the drawer.
   *
   * This is the whole reason the drawer's tiles exist: the entries people want
   * in it are the ones already sitting behind a "more" entry, and retyping
   * seven of them by hand to move them there would be the card's problem, not
   * theirs. Entries already in the drawer are matched by path and left alone,
   * so pressing it twice does not double them.
   */
  private _importSubmenus(): void {
    const known = new Set(this._sheetItems.map((i) => i.path).filter(Boolean));
    const added: NavSheetItem[] = [];
    for (const item of this._items) {
      for (const entry of item.submenu ?? []) {
        if (entry.path && known.has(entry.path)) continue;
        if (entry.path) known.add(entry.path);
        added.push(
          this._clean({
            name: entry.name,
            icon: entry.icon,
            path: entry.path,
            tap_action: entry.tap_action,
          }) as NavSheetItem,
        );
      }
    }
    if (added.length) this._setSheetItems([...this._sheetItems, ...added]);
  }

  /** True when any of the three layout slots asks for the sheet. */
  private get _usesSheet(): boolean {
    const cfg = this._config;
    return (
      cfg?.style === "sheet" ||
      cfg?.desktop?.style === "sheet" ||
      cfg?.mobile?.style === "sheet"
    );
  }

  // ---- change handlers -----------------------------------------------------

  private _rootChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    this._emit(this._clean({ ...this._config, ...patch }) as unknown as M3NavCardConfig);
  }

  private _perWidthChanged(which: "desktop" | "mobile", ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    const block = this._clean({ ...this._config[which], ...patch });
    const next = { ...this._config };
    if (Object.keys(block).length) {
      next[which] = block as NavLayoutConfig;
    } else {
      delete next[which];
    }
    this._emit(next);
  }

  private _perWidthWidth(which: "desktop" | "mobile", value: number | string | undefined): void {
    if (!this._config) return;
    const block: Record<string, unknown> = { ...this._config[which] };
    if (value === undefined) delete block.max_width;
    else block.max_width = value;
    const next = { ...this._config };
    if (Object.keys(block).length) next[which] = block as NavLayoutConfig;
    else delete next[which];
    this._emit(next);
  }

  private _badgeChanged(index: number, ev: CustomEvent): void {
    const patch = ev.detail.value as Record<string, unknown>;
    const badge = this._clean({ ...this._items[index]?.badge, ...patch });
    this._patchItem(index, {
      badge: Object.keys(badge).length ? (badge as NavItemConfig["badge"]) : undefined,
    });
  }

  private _colorChanged(index: number, value: string): void {
    this._patchItem(index, { color: value || undefined });
  }

  // ---- submenu -------------------------------------------------------------

  private _submenuSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      this._pathSelector(),
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  private _setSubmenu(index: number, entries: NavSubmenuEntry[]): void {
    this._patchItem(index, { submenu: entries.length ? entries : undefined });
  }

  private _addSubmenuEntry(index: number): void {
    this._setSubmenu(index, [...(this._items[index]?.submenu ?? []), {}]);
  }

  private _removeSubmenuEntry(index: number, entryIndex: number): void {
    this._setSubmenu(
      index,
      (this._items[index]?.submenu ?? []).filter((_, i) => i !== entryIndex),
    );
  }

  private _submenuEntryChanged(index: number, entryIndex: number, ev: CustomEvent): void {
    const entries = [...(this._items[index]?.submenu ?? [])];
    const patch = ev.detail.value as Record<string, unknown>;
    entries[entryIndex] = this._clean({
      ...entries[entryIndex],
      ...this._withViewDefaults(entries[entryIndex], patch),
    }) as NavSubmenuEntry;
    this._setSubmenu(index, entries);
  }

  /** The one number whose effect is not obvious from its name alone. */
  private _computeHelper = (schema: SchemaEntry): string | undefined => {
    if (schema.name === "edge_distance") return this._t("editor_nav_edge_distance_helper");
    if (schema.name === "pill_size") return this._t("editor_nav_pill_size_helper");
    if (schema.name === "marker_motion") return this._t("editor_nav_marker_motion_helper");
    if (schema.name === "page_transition") return this._t("editor_nav_page_transition_helper");
    if (schema.name === "bar_scroll") return this._t("editor_nav_bar_scroll_helper");
    if (schema.name === "match") return this._t("editor_nav_item_match_hint");
    return undefined;
  };

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      style: "editor_nav_style",
      position: "editor_nav_position",
      breakpoint: "editor_nav_breakpoint",
      show_labels: "editor_nav_show_labels",
      name: "editor_nav_item_name",
      icon: "editor_nav_item_icon",
      active_icon: "editor_nav_item_active_icon",
      picture: "editor_nav_item_picture",
      users: "editor_nav_item_users",
      config_from: "editor_nav_config_from",
      color: "editor_nav_item_color",
      badge_source: "editor_nav_badge_source",
      path: "editor_nav_item_path",
      match: "editor_nav_item_match",
      disabled: "editor_nav_item_disabled",
      template: "editor_nav_badge_template",
      entity: "editor_nav_badge_entity",
      count_entities: "editor_nav_badge_count",
      show_if: "editor_nav_badge_show_if",
      badge_style: "editor_nav_badge_style",
      tap_action: "editor_tap_action",
      hold_action: "editor_nav_hold_action",
      double_tap_action: "editor_nav_double_tap_action",
      label_visibility: "editor_nav_label_visibility",
      label_position: "editor_nav_label_position",
      icon_visibility: "editor_nav_icon_visibility",
      item_background: "editor_nav_item_background",
      active_style: "editor_nav_active_style",
      split: "editor_nav_different_widths",
      width_fit: "editor_nav_width_fit",
      width_px: "editor_nav_max_width_px",
      size: "editor_nav_size",
      icon_size: "editor_nav_icon_size",
      label_size: "editor_nav_label_size",
      pill_size: "editor_nav_pill_size",
      marker_motion: "editor_nav_marker_motion",
      page_transition: "editor_nav_page_transition",
      page_transition_ms: "editor_nav_page_transition_ms",
      edge_distance: "editor_nav_edge_distance",
      close_icon: "editor_nav_close_icon",
      action_button_on: "editor_nav_action_button_on",
      container_style: "editor_nav_container",
      container_opacity: "editor_nav_opacity",
      blur: "editor_nav_blur",
      radius: "editor_radius",
      haptics: "editor_nav_haptics",
      swipe_navigation: "editor_nav_swipe_navigation",
      swipe_direction: "editor_nav_swipe_direction",
      bar_scroll: "editor_nav_bar_scroll",
      auto_hide_on_scroll: "editor_nav_auto_hide",
      submenu_trigger: "editor_nav_submenu_trigger",
      preload_views: "editor_nav_preload_views",
      sheet_title: "editor_nav_sheet_title",
      sheet_max_height: "editor_nav_sheet_max_height",
      sheet_default: "editor_nav_sheet_default",
      sheet_state_entity: "editor_nav_sheet_state_entity",
      collapse_on_navigate: "editor_nav_collapse_on_navigate",
      sheet_columns: "editor_nav_sheet_columns",
      sheet_item_style: "editor_nav_sheet_style",
      secondary: "editor_nav_sheet_secondary",
      snap_half: "editor_nav_sheet_snap_half",
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  /** `hidden` means two different things depending on where it is shown. */
  private _hiddenLabel = (schema: SchemaEntry): string =>
    schema.name === "hidden"
      ? this._t("editor_nav_hidden_template")
      : this._computeLabel(schema);

  private _layoutHiddenLabel = (schema: SchemaEntry): string =>
    schema.name === "hidden"
      ? this._t("editor_nav_layout_hidden")
      : this._computeLabel(schema);

  private _itemHiddenLabel = (schema: SchemaEntry): string =>
    schema.name === "hidden"
      ? this._t("editor_nav_item_hidden")
      : this._computeLabel(schema);

  // ---- render --------------------------------------------------------------

  private _renderItem(item: NavItemConfig, index: number) {
    const source = this._badgeSource(item);
    const hasSubmenu = (item.submenu ?? []).length > 0;
    return html`
      <ha-expansion-panel outlined .header=${this._itemLabel(item, index)}>
        <!-- In the header, not in the body: reordering four entries should not
             mean opening four panels, scrolling to the bottom of each and
             closing it again. Clicks are stopped so an arrow does not also
             fold the panel it sits on. -->
        <div slot="icons" class="reorder">
          ${this._renderReorder(
            index,
            this._items.length,
            (from, to) => this._moveItem(from, to - from),
          )}
        </div>
        <div class="panel-content">
          <ha-form
            .hass=${this.hass}
            .data=${item}
            .schema=${this._itemSchema()}
            .computeLabel=${this._computeLabel}
            .computeHelper=${this._computeHelper}
            @value-changed=${(ev: CustomEvent) =>
              this._patchItem(index, ev.detail.value as Partial<NavItemConfig>)}
          ></ha-form>
          <div class="hint">${this._t("editor_nav_item_path_hint")}</div>
          ${colorRow(this._t("editor_mode_color"), item.color, (v) =>
            this._colorChanged(index, v),
          )}

          <div class="block">
            <div class="block-title">${this._t("editor_nav_badge")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${{ badge_source: source }}
              .schema=${this._badgeSourceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) =>
                this._badgeSourceChanged(
                  index,
                  (ev.detail.value as { badge_source: string }).badge_source,
                )}
            ></ha-form>
            ${source !== "none"
              ? html`
                  <ha-form
                    .hass=${this.hass}
                    .data=${item.badge ?? {}}
                    .schema=${this._badgeFieldSchema(source)}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(ev: CustomEvent) => this._badgeChanged(index, ev)}
                  ></ha-form>
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ badge_style: item.badge_style ?? "count" }}
                    .schema=${this._badgeStyleSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(ev: CustomEvent) =>
                      this._patchItem(index, ev.detail.value as Partial<NavItemConfig>)}
                  ></ha-form>
                  <div class="hint">${this._t("editor_nav_badge_hint")}</div>
                `
              : nothing}
          </div>

          <div class="block">
            <div class="block-title">${this._t("editor_nav_submenu")}</div>
            <div class="hint">${this._t("editor_nav_submenu_hint")}</div>
            ${(item.submenu ?? []).map(
              (entry, entryIndex) => html`
                <div class="block">
                  <ha-form
                    .hass=${this.hass}
                    .data=${entry}
                    .schema=${this._submenuSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(ev: CustomEvent) =>
                      this._submenuEntryChanged(index, entryIndex, ev)}
                  ></ha-form>
                  <ha-button
                    class="remove"
                    @click=${() => this._removeSubmenuEntry(index, entryIndex)}
                    >${this._t("editor_nav_remove_submenu")}</ha-button
                  >
                </div>
              `,
            )}
            <ha-button @click=${() => this._addSubmenuEntry(index)}
              >${this._t("editor_nav_add_submenu")}</ha-button
            >
          </div>

          <ha-expansion-panel outlined .header=${this._t("editor_nav_advanced")}>
            <div class="panel-content">
              <div class="hint">${this._t("editor_nav_actions")}</div>
              <ha-form
                .hass=${this.hass}
                .data=${item}
                .schema=${this._itemActionSchema()}
                .computeLabel=${this._computeLabel}
                @value-changed=${(ev: CustomEvent) =>
                  this._patchItem(index, ev.detail.value as Partial<NavItemConfig>)}
              ></ha-form>
              <div class="hint">
                ${hasSubmenu
                  ? this._t("editor_nav_action_hint_submenu")
                  : this._t("editor_nav_action_hint")}
              </div>
              <ha-form
                .hass=${this.hass}
                .data=${item}
                .schema=${this._itemAdvancedSchema()}
                .computeLabel=${this._itemHiddenLabel}
                @value-changed=${(ev: CustomEvent) =>
                  this._patchItem(index, ev.detail.value as Partial<NavItemConfig>)}
              ></ha-form>
              <div class="hint">${this._t("editor_nav_template_hint")}</div>
              ${source !== "none"
                ? html`
                    <ha-form
                      .hass=${this.hass}
                      .data=${item.badge ?? {}}
                      .schema=${this._badgeAdvancedSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${(ev: CustomEvent) => this._badgeChanged(index, ev)}
                    ></ha-form>
                  `
                : nothing}
            </div>
          </ha-expansion-panel>

          <ha-button class="remove" @click=${() => this._removeItem(index)}
            >${this._t("editor_nav_remove_item")}</ha-button
          >
        </div>
      </ha-expansion-panel>
    `;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;

    return html`
      <div class="editor">
        <div class="hint intro">${this._t("editor_nav_intro")}</div>
        <ha-form
          .hass=${this.hass}
          .data=${{ config_from: cfg.config_from ?? "" }}
          .schema=${[{ name: "config_from", selector: { text: {} } }]}
          .computeLabel=${this._computeLabel}
          @value-changed=${this._rootChanged}
        ></ha-form>
        <div class="hint">${this._t("editor_nav_config_from_hint")}</div>
        <ha-expansion-panel outlined .header=${this._t("editor_nav_layout")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:dock-bottom"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                style: cfg.style ?? "footer",
                position: cfg.position ?? "",
                breakpoint: cfg.breakpoint ?? NAV_DEFAULT_BREAKPOINT,
              }}
              .schema=${this._layoutSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._rootChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_nav_style_hint")}</div>
            ${this._usesSplitLayouts
              ? nothing
              : this._renderWidth(cfg.max_width, (v) => {
                  const next = { ...cfg };
                  if (v === undefined) delete next.max_width;
                  else next.max_width = v;
                  this._emit(next);
                })}

            <ha-form
              .hass=${this.hass}
              .data=${{ split: this._usesSplitLayouts }}
              .schema=${this._splitToggleSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) =>
                this._splitToggled((ev.detail.value as { split: boolean }).split === true)}
            ></ha-form>
            <div class="hint">${this._t("editor_nav_different_widths_hint")}</div>

            ${this._usesSplitLayouts
              ? html`
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ breakpoint: cfg.breakpoint ?? NAV_DEFAULT_BREAKPOINT }}
                    .schema=${[
                      {
                        name: "breakpoint",
                        selector: {
                          number: { min: 320, max: 1600, step: 8, mode: "box" },
                        },
                      },
                    ]}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${this._rootChanged}
                  ></ha-form>
                  <div class="hint">${this._t("editor_nav_breakpoint_hint")}</div>

                  <div class="block">
                    <div class="block-title">${this._t("editor_nav_desktop")}</div>
                    <ha-form
                      .hass=${this.hass}
                      .data=${cfg.desktop ?? {}}
                      .schema=${this._perWidthSchema(false)}
                      .computeLabel=${this._layoutHiddenLabel}
                      @value-changed=${(ev: CustomEvent) =>
                        this._perWidthChanged("desktop", ev)}
                    ></ha-form>
                    ${this._renderWidth(
                      cfg.desktop?.max_width,
                      (v) => this._perWidthWidth("desktop", v),
                      false,
                    )}
                  </div>

                  <div class="block">
                    <div class="block-title">${this._t("editor_nav_mobile")}</div>
                    <ha-form
                      .hass=${this.hass}
                      .data=${cfg.mobile ?? {}}
                      .schema=${this._perWidthSchema(false)}
                      .computeLabel=${this._layoutHiddenLabel}
                      @value-changed=${(ev: CustomEvent) =>
                        this._perWidthChanged("mobile", ev)}
                    ></ha-form>
                    ${this._renderWidth(
                      cfg.mobile?.max_width,
                      (v) => this._perWidthWidth("mobile", v),
                      false,
                    )}
                  </div>
                `
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_nav_items")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:format-list-bulleted"></ha-icon>
          <div class="panel-content">
            ${this._items.length
              ? this._items.map((item, index) => this._renderItem(item, index))
              : html`<div class="hint">${this._t("editor_nav_items_empty")}</div>`}
            <ha-button raised @click=${this._addItem}
              >${this._t("editor_nav_add_item")}</ha-button
            >
            <ha-button @click=${this._importViews}
              >${this._t("editor_nav_import_views")}</ha-button
            >
            <div class="hint">${this._t("editor_nav_import_hint")}</div>

            ${this._bubbleFits
              ? html`
              <div class="block">
                <div class="block-title">${this._t("editor_nav_action_button")}</div>
                <ha-form
                  .hass=${this.hass}
                  .data=${{ action_button_on: this._hasActionButton }}
                  .schema=${[{ name: "action_button_on", selector: { boolean: {} } }]}
                  .computeLabel=${this._computeLabel}
                  @value-changed=${(ev: CustomEvent) =>
                    this._actionButtonToggled(
                      (ev.detail.value as { action_button_on: boolean })
                        .action_button_on === true,
                    )}
                ></ha-form>
                ${this._hasActionButton
                  ? html`<ha-form
                  .hass=${this.hass}
                  .data=${cfg.action_button ?? {}}
                  .schema=${[
                    { name: "icon", selector: { icon: {} } },
                    { name: "color", selector: { text: {} } },
                    ...(this._actionMenu.length
                      ? [{ name: "close_icon", selector: { icon: {} } }]
                      : [{ name: "tap_action", selector: { ui_action: {} } }]),
                  ]}
                  .computeLabel=${this._computeLabel}
                  @value-changed=${(ev: CustomEvent) => {
                    const patch = ev.detail.value as Record<string, unknown>;
                    const button = this._clean({ ...cfg.action_button, ...patch });
                    const next = { ...cfg };
                    if (Object.keys(button).length) {
                      next.action_button = button as M3NavCardConfig["action_button"];
                    } else {
                      delete next.action_button;
                    }
                    this._emit(next);
                  }}
                      ></ha-form>`
                  : nothing}
                <div class="hint">${this._t("editor_nav_action_button_hint")}</div>
  
                ${this._hasActionButton
                  ? html`<div class="block">
                  <div class="block-title">${this._t("editor_nav_action_menu")}</div>
                  <div class="hint">${this._t("editor_nav_action_menu_hint")}</div>
                  ${this._actionMenu.map(
                    (entry, index) => html`
                      <div class="block">
                        <div class="tile-head">
                          <span class="tile-name"
                            >${entry.name || entry.path || "#" + (index + 1)}</span
                          >
                          <span class="reorder">
                            ${this._renderReorder(index, this._actionMenu.length, (from, to) =>
                              this._moveActionMenuEntry(from, to),
                            )}
                          </span>
                        </div>
                        <ha-form
                          .hass=${this.hass}
                          .data=${entry}
                          .schema=${this._actionMenuSchema()}
                          .computeLabel=${this._computeLabel}
                          @value-changed=${(ev: CustomEvent) =>
                            this._actionMenuChanged(index, ev)}
                        ></ha-form>
                        <ha-button
                          class="remove"
                          @click=${() =>
                            this._setActionMenu(
                              this._actionMenu.filter((_, i) => i !== index),
                            )}
                          >${this._t("editor_nav_remove_item")}</ha-button
                        >
                      </div>
                    `,
                  )}
                  <ha-button @click=${() => this._setActionMenu([...this._actionMenu, {}])}
                    >${this._t("editor_nav_add_action_menu_entry")}</ha-button
                  >
                </div>`
                  : nothing}
              </div>
                `
              : nothing}
          </div>
        </ha-expansion-panel>

        ${this._usesSheet
          ? html`
              <ha-expansion-panel outlined .header=${this._t("editor_nav_sheet")}>
                <ha-icon slot="leading-icon" icon="mdi:dock-window"></ha-icon>
                <div class="panel-content">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{
                      sheet_title: cfg.sheet_title ?? "",
                      sheet_max_height:
                        typeof cfg.sheet_max_height === "number" ? cfg.sheet_max_height : 60,
                      sheet_default: cfg.sheet_default ?? "collapsed",
                      sheet_state_entity: cfg.sheet_state_entity ?? "",
                      collapse_on_navigate: cfg.collapse_on_navigate ?? true,
                      sheet_columns: cfg.sheet_columns ?? "",
                    }}
                    .schema=${this._sheetSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${this._rootChanged}
                  ></ha-form>

                  <ha-form
                    .hass=${this.hass}
                    .data=${{ snap_half: (cfg.snap_points?.length ?? 0) > 2 }}
                    .schema=${[{ name: "snap_half", selector: { boolean: {} } }]}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${this._snapHalfChanged}
                  ></ha-form>

                  <div class="block">
                    <div class="hint">${this._t("editor_nav_sheet_action_icon")}</div>
                    <ha-form
                      .hass=${this.hass}
                      .data=${cfg.sheet_action ?? {}}
                      .schema=${this._sheetActionSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${this._sheetActionChanged}
                    ></ha-form>
                  </div>

                  <div class="block">
                    <div class="block-title">${this._t("editor_nav_sheet_items")}</div>
                    <ha-form
                      .hass=${this.hass}
                      .data=${{ sheet_item_style: cfg.sheet_item_style ?? "grid" }}
                      .schema=${this._sheetStyleSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${this._rootChanged}
                    ></ha-form>
                    <div class="hint">${this._t("editor_nav_sheet_style_hint")}</div>
                    ${this._sheetItems.map(
                      (item, index) => html`
                        <div class="block">
                          <div class="tile-head">
                            <span class="tile-name"
                              >${item.name || item.path || "#" + (index + 1)}</span
                            >
                            <span class="reorder">
                              ${this._renderReorder(
                                index,
                                this._sheetItems.length,
                                (from, to) => this._moveSheetItem(from, to),
                              )}
                            </span>
                          </div>
                          <ha-form
                            .hass=${this.hass}
                            .data=${item}
                            .schema=${this._sheetItemSchema(
                              (cfg.sheet_item_style ?? "grid") === "list",
                            )}
                            .computeLabel=${this._computeLabel}
                            @value-changed=${(ev: CustomEvent) =>
                              this._sheetItemChanged(index, ev)}
                          ></ha-form>
                          <ha-button
                            class="remove"
                            @click=${() =>
                              this._setSheetItems(
                                this._sheetItems.filter((_, i) => i !== index),
                              )}
                            >${this._t("editor_nav_remove_item")}</ha-button
                          >
                        </div>
                      `,
                    )}
                    <ha-button
                      @click=${() => this._setSheetItems([...this._sheetItems, {}])}
                      >${this._t("editor_nav_add_sheet_item")}</ha-button
                    >
                    <ha-button @click=${this._importSubmenus}
                      >${this._t("editor_nav_import_submenus")}</ha-button
                    >
                    <div class="hint">${this._t("editor_nav_import_submenus_hint")}</div>
                  </div>

                  <div class="hint">${this._t("editor_nav_sheet_cards_hint")}</div>
                </div>
              </ha-expansion-panel>
            `
          : nothing}

        <ha-expansion-panel outlined .header=${this._t("editor_nav_appearance")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                label_visibility: cfg.label_visibility ?? "always",
                size: cfg.size ?? 1,
                icon_visibility:
                  cfg.icon_visibility ?? (cfg.show_icons === false ? "never" : "always"),
                item_background: cfg.item_background ?? false,
                active_style: cfg.active_style ?? "tint",
                container_style: cfg.container_style ?? "glass",
              }}
              .schema=${this._appearanceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._rootChanged}
            ></ha-form>
            ${renderDetailModeField({
              hass: this.hass,
              language: this._language,
              config: cfg,
              onValueChanged: this._rootChanged,
            })}
            ${colorRow(this._t("editor_mode_color"), cfg.accent_color, (v) =>
              this._emit(
                this._clean({ ...cfg, accent_color: v }) as unknown as M3NavCardConfig,
              ),
            )}


            <ha-expansion-panel outlined .header=${this._t("editor_nav_advanced")}>
              <div class="panel-content">
                <ha-form
                  .hass=${this.hass}
                  .data=${{
                    icon_size: cfg.icon_size ?? 22,

                    marker_motion: cfg.marker_motion ?? "none",
                    pill_size: cfg.pill_size ?? 1,
                    label_size:
                      cfg.label_size ??
                      (cfg.label_position === "right" || cfg.label_position === "left"
                        ? 14
                        : 11),
                    edge_distance: cfg.edge_distance ?? 8,
                    container_opacity: cfg.container_opacity ?? 100,
                    blur: cfg.blur ?? 20,
                    radius: cfg.radius ?? NAV_BAR_RADIUS_UI,
                  }}
                  .schema=${this._appearanceAdvancedSchema()}
                  .computeLabel=${this._computeLabel}
                  .computeHelper=${this._computeHelper}
                  @value-changed=${this._rootChanged}
                ></ha-form>
              </div>
            </ha-expansion-panel>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_nav_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                haptics: cfg.haptics ?? true,
                swipe_navigation: cfg.swipe_navigation ?? false,
                swipe_direction: cfg.swipe_direction ?? "follow",
                bar_scroll: cfg.bar_scroll ?? true,
                auto_hide_on_scroll: cfg.auto_hide_on_scroll ?? false,
                page_transition: cfg.page_transition ?? "none",
                page_transition_ms: cfg.page_transition_ms ?? 180,
                submenu_trigger: cfg.submenu_trigger ?? "tap",
              }}
              .schema=${this._behaviorSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._rootChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_nav_visibility")}>
          <ha-icon slot="leading-icon" icon="mdi:eye-off-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ hidden: cfg.hidden ?? "" }}
              .schema=${this._visibilitySchema()}
              .computeLabel=${this._hiddenLabel}
              @value-changed=${this._rootChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_nav_visibility_hint")}</div>
          </div>
        </ha-expansion-panel>
      </div>
    `;
  }

  static styles = [
    editorStyles,
    css`
      .block {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border: 1px dashed rgba(127, 127, 127, 0.4);
        border-radius: 12px;
      }

      .intro {
        margin: 0 4px 4px;
      }

      .block-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--primary-text-color);
        opacity: 0.85;
      }

      .reorder {
        display: flex;
        align-items: center;
        --mdc-icon-button-size: 36px;
        --mdc-icon-size: 20px;
      }

      .tile-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .tile-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-nav-card-editor": M3NavCardEditor;
  }
}
