import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3RoomCardConfig,
  RoomCategoryConfig,
} from "./types";
import {
  DEFAULT_ROOM_RADIUS,
  ROOM_CATEGORIES,
  ROOM_FALLBACK_CATEGORY,
  ROOM_POWER_THRESHOLD,
  ROOM_NESTED_CARD_TYPES,
  ROOM_SCROLL_MS,
  ROOM_SCROLL_MAX_MS,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  colorRow,
  editorStyles,
  fireEvent,
  listRow,
  type SchemaEntry,
} from "./shared/editor-helpers";
import { areaEntityIds, listAreas } from "./shared/ha-registry";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-room-card-editor")
export class M3RoomCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3RoomCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3RoomCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_ROOM_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3RoomCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  // ---- the card's own cards -------------------------------------------------

  /**
   * The nested card's own editor, whichever card it is.
   *
   * Hand-picking a few fields was the first attempt and the wrong shape: it
   * offered four of the button card's settings, silently lacked the rest, and
   * would have fallen behind every time that card grew an option. Asking the
   * card class for its editor is the same contract Home Assistant itself uses,
   * so it cannot fall behind — and it works for any card in the suite, not just
   * the one the entity picker happens to create.
   *
   * Kept per row rather than rebuilt each render, or every keystroke would
   * replace the element under the cursor. The config is pushed back in only
   * when it differs, so typing in one field does not reset the panel it sits
   * in. Built asynchronously because a card loads its editor on demand.
   */
  @state() private _addType: string = "custom:m3-button-card";

  private _cardEditors = new Map<number, HTMLElement>();
  private _editorPending = new Set<number>();

  private _nestedEditor(
    card: Record<string, unknown>,
    index: number,
  ): HTMLElement | undefined {
    const existing = this._cardEditors.get(index);
    if (existing) {
      (existing as { hass?: unknown }).hass = this.hass;
      const key = JSON.stringify(card);
      const holder = existing as { _lastKey?: string; setConfig?: (c: unknown) => void };
      if (holder._lastKey !== key) {
        holder._lastKey = key;
        holder.setConfig?.(card);
      }
      return existing;
    }
    if (this._editorPending.has(index)) return undefined;
    this._editorPending.add(index);
    void this._buildEditor(card, index);
    return undefined;
  }

  private async _buildEditor(
    card: Record<string, unknown>,
    index: number,
  ): Promise<void> {
    const tag = String(card.type ?? "").replace("custom:", "");
    const ctor = customElements.get(tag) as
      | { getConfigElement?: () => Promise<HTMLElement> }
      | undefined;
    let el: HTMLElement | undefined;
    try {
      el = await ctor?.getConfigElement?.();
    } catch {
      el = undefined;
    }
    this._editorPending.delete(index);
    if (!el) {
      this.requestUpdate();
      return;
    }
    el.addEventListener("config-changed", (ev: Event) => {
      // Stopped, or the room card's own editor would take the nested card's
      // config for its own and write that to the dashboard.
      ev.stopPropagation();
      const next = (ev as CustomEvent).detail.config as Record<string, unknown>;
      const cards = [...this._cards];
      cards[index] = next;
      (el as { _lastKey?: string })._lastKey = JSON.stringify(next);
      this._setCards(cards);
    });
    this._cardEditors.set(index, el);
    this.requestUpdate();
  }

  private get _cards(): Record<string, unknown>[] {
    return this._config?.cards ?? [];
  }

  private _setCards(cards: Record<string, unknown>[]): void {
    if (!this._config) return;
    const next = { ...this._config };
    if (cards.length) next.cards = cards;
    else delete next.cards;
    this._emit(next);
  }

  private _moveCard(index: number, delta: number): void {
    const cards = [...this._cards];
    const target = index + delta;
    if (target < 0 || target >= cards.length) return;
    cards.splice(target, 0, cards.splice(index, 1)[0]);
    this._setCards(cards);
  }

  /**
   * What to call a nested card in the list.
   *
   * Its own name if it has one, otherwise the entity it points at, otherwise
   * the card type — enough to tell the rows apart without pretending to be a
   * preview of the card.
   */
  private _cardLabel(card: Record<string, unknown>, index: number): string {
    const name = typeof card.name === "string" ? card.name : "";
    const entity = typeof card.entity === "string" ? card.entity : "";
    const type = typeof card.type === "string" ? card.type.replace("custom:", "") : "";
    return name || entity || type || `#${index + 1}`;
  }

  // ---- detection ------------------------------------------------------------

  /**
   * The domains actually present in the chosen area, in the card's own order.
   *
   * Reading the same source the card reads is the point: a category list built
   * from a fixed table would offer the user switches for a room that has none,
   * and hide the one domain they added last week.
   */
  private _detected(): { domain: string; count: number }[] {
    const cfg = this._config;
    if (!this.hass || !cfg?.area) return [];
    const counts = new Map<string, number>();
    for (const id of areaEntityIds(this.hass, cfg.area)) {
      const domain = id.split(".", 1)[0];
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    const known = ROOM_CATEGORIES.map((c) => c.domain);
    const extra = cfg.extra_domains ?? [];
    const offered = [...known, ...extra.filter((d) => !known.includes(d))];
    const ordered = [
      ...(cfg.category_order ?? []).filter((d) => offered.includes(d)),
      ...offered.filter((d) => !(cfg.category_order ?? []).includes(d)),
    ];
    return ordered
      .filter((domain) => counts.has(domain))
      .map((domain) => ({ domain, count: counts.get(domain)! }));
  }

  /**
   * The label the tile will actually carry, so the list shows what the card
   * shows and the Name field visibly overrides *that*.
   */
  private _categoryName(domain: string): string {
    const entities = this._entitiesOf(domain).filter((id) => !this._isExcluded(id));
    if (entities.length === 1) {
      const own = this.hass?.states[entities[0]]?.attributes?.friendly_name as string | undefined;
      if (own) return own;
    }
    const key = `room_cat_${domain}` as TranslationKey;
    const label = localize(key, this._language);
    return label === key ? domain : label;
  }

  private _categoryIcon(domain: string): string {
    return (
      ROOM_CATEGORIES.find((c) => c.domain === domain)?.icon ?? ROOM_FALLBACK_CATEGORY.icon
    );
  }

  /** Every entity of a domain in the area, excluded ones included: a device you
   *  cannot see in the list is a device you cannot switch back on. */
  private _entitiesOf(domain: string): string[] {
    const cfg = this._config;
    if (!this.hass || !cfg?.area) return [];
    return areaEntityIds(this.hass, cfg.area).filter((id) => id.startsWith(`${domain}.`));
  }

  private _entityName(entityId: string): string {
    return (
      (this.hass?.states[entityId]?.attributes?.friendly_name as string | undefined) ?? entityId
    );
  }

  private _isExcluded(entityId: string): boolean {
    return (this._config?.excluded_entities ?? []).includes(entityId);
  }

  private _setExcluded(entityId: string, excluded: boolean): void {
    if (!this._config) return;
    const set = new Set(this._config.excluded_entities ?? []);
    if (excluded) set.add(entityId);
    else set.delete(entityId);
    const next = { ...this._config };
    if (set.size) next.excluded_entities = [...set];
    else delete next.excluded_entities;
    this._emit(next);
  }

  private _override(domain: string): RoomCategoryConfig | undefined {
    return this._config?.categories?.find((c) => c.domain === domain);
  }

  private _patchCategory(domain: string, patch: Partial<RoomCategoryConfig>): void {
    if (!this._config) return;
    const list = [...(this._config.categories ?? [])];
    const index = list.findIndex((c) => c.domain === domain);
    const merged: Record<string, unknown> = { ...(list[index] ?? { domain }), ...patch, domain };
    if (merged.badge === "auto") delete merged.badge;
    for (const [k, v] of Object.entries(merged)) {
      if (v === "" || v === undefined || v === null) delete merged[k];
    }
    // An entry that says nothing but its own domain is not an override.
    const meaningful = Object.keys(merged).length > 1;
    if (index >= 0) {
      if (meaningful) list[index] = merged as unknown as RoomCategoryConfig;
      else list.splice(index, 1);
    } else if (meaningful) {
      list.push(merged as unknown as RoomCategoryConfig);
    }
    const next = { ...this._config };
    if (list.length) next.categories = list;
    else delete next.categories;
    this._emit(next);
  }

  private _toggleVisible(domain: string, visible: boolean): void {
    if (!this._config) return;
    const hidden = new Set(this._config.hidden_categories ?? []);
    if (visible) hidden.delete(domain);
    else hidden.add(domain);
    const next = { ...this._config };
    if (hidden.size) next.hidden_categories = [...hidden];
    else delete next.hidden_categories;
    this._emit(next);
  }

  private _move(domain: string, delta: number): void {
    if (!this._config) return;
    const order = this._detected().map((d) => d.domain);
    const index = order.indexOf(domain);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    order.splice(target, 0, order.splice(index, 1)[0]);
    this._emit({ ...this._config, category_order: order });
  }

  // ---- schemas --------------------------------------------------------------

  private _roomSchema(): SchemaEntry[] {
    const areas = this.hass ? listAreas(this.hass) : [];
    return [
      {
        name: "area",
        required: true,
        selector: {
          select: {
            mode: "dropdown",
            options: areas.map((a) => ({ value: a.areaId, label: a.name })),
          },
        },
      },
      {
        name: "mode",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_room_mode_auto") },
              { value: "manual", label: this._t("editor_room_mode_manual") },
            ],
          },
        },
      },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
      { name: "detail_path", selector: { text: {} } },
      {
        name: "cards_columns",
        selector: { number: { min: 1, max: 4, step: 1, mode: "slider" } },
      },
    ];
  }

  private _tapSchema(): SchemaEntry[] {
    return [
      {
        name: "category_tap",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "list", label: this._t("editor_room_tap_list") },
              { value: "toggle", label: this._t("editor_room_tap_toggle") },
            ],
          },
        },
      },
    ];
  }

  private _sensorSchema(): SchemaEntry[] {
    return [
      { name: "show_sensors", selector: { boolean: {} } },
      { name: "show_windows", selector: { boolean: {} } },
      { name: "temperature_entity", selector: { entity: { domain: "sensor" } } },
      { name: "humidity_entity", selector: { entity: { domain: "sensor" } } },
      { name: "power_entity", selector: { entity: { domain: "sensor" } } },
      {
        name: "power_threshold",
        selector: { number: { min: 0, max: 1000, mode: "box" } },
      },
    ];
  }

  private _foldSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      { name: "collapsible", selector: { boolean: {} } },
      { name: "show_active_names", selector: { boolean: {} } },
      { name: "shape_by_state", selector: { boolean: {} } },
    ];
    if (this._config?.collapsible) {
      schema.push(
        { name: "default_collapsed", selector: { boolean: {} } },
        { name: "scroll_on_expand", selector: { boolean: {} } },
      );
      if (this._config?.scroll_on_expand) {
        schema.push({
          name: "scroll_duration",
          selector: {
            number: {
              min: 0,
              max: ROOM_SCROLL_MAX_MS,
              step: 20,
              unit_of_measurement: "ms",
              mode: "box",
            },
          },
        });
      }
      schema.push(
        {
          name: "collapse_memory",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "device", label: this._t("editor_room_collapse_memory_device") },
                { value: "session", label: this._t("editor_room_collapse_memory_session") },
              ],
            },
          },
        },
        {
          name: "collapse_state_entity",
          selector: { entity: { domain: "input_boolean" } },
        },
      );
    }
    return schema;
  }

  private _presenceSchema(): SchemaEntry[] {
    return [
      { name: "presence_entity", selector: { entity: { domain: "binary_sensor" } } },
      {
        name: "presence_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "tint", label: this._t("editor_room_presence_tint") },
              { value: "dot_only", label: this._t("editor_room_presence_dot") },
              { value: "none", label: this._t("editor_room_presence_none") },
            ],
          },
        },
      },
    ];
  }

  private _animationSchema(): SchemaEntry[] {
    return [
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
    ];
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    const next: Record<string, unknown> = { ...this._config, ...patch };
    for (const key of [
      "name",
      "icon",
      "detail_path",
      "temperature_entity",
      "humidity_entity",
      "power_entity",
      "presence_entity",
      "collapse_state_entity",
    ]) {
      if (next[key] === "") delete next[key];
    }
    // `ui_action` clears to undefined rather than "", and an absent key is not
    // the same as one explicitly set to undefined once the config is written
    // back out — the card reads the presence of `tap_action` to decide whether
    // the header still folds.
    if (next.tap_action === undefined) delete next.tap_action;
    this._emit(next as unknown as M3RoomCardConfig);
  }

  private _colorChanged(
    field: "accent_color" | "text_color" | "secondary_text_color" | "card_background",
    value: string,
  ): void {
    if (!this._config) return;
    if (value) {
      this._emit({ ...this._config, [field]: value });
    } else {
      const { [field]: _drop, ...rest } = this._config;
      this._emit(rest as M3RoomCardConfig);
    }
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
      const { corners: _drop, ...rest } = this._config;
      this._emit(rest as M3RoomCardConfig);
    }
  }

  private _cornerPresetChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const patch = cornerPresetPatch(ev.detail.value[key] as string);
    this._appearance = {
      ...this._appearance,
      cornerCustom: { ...this._appearance.cornerCustom, [key]: patch.custom },
    };
    if (patch.px !== undefined) {
      this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } });
    }
  }

  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const px = ev.detail.value[key] as number;
    this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } });
  }

  /** `mode` changes what the rest of the editor is for; `tap_action` changes
   * what the header does, which is worth saying before someone sets it and
   * wonders where the fold arrow went. */
  private _computeHelper = (schema: SchemaEntry): string | undefined => {
    if (schema.name === "mode") return this._t("editor_room_mode_helper");
    if (schema.name === "tap_action") return this._t("editor_room_tap_action_helper");
    return undefined;
  };

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      shape_by_state: "editor_shape_by_state",
      area: "editor_room_area",
      name: "editor_name",
      icon: "editor_icon",
      tap_action: "editor_tap_action",
      detail_path: "editor_room_detail_path",
      mode: "editor_room_mode",
      cards_columns: "editor_room_cards_columns",
      add_type: "editor_room_add_type",
      add_entities: "editor_room_add_cards",
      show_sensors: "editor_room_show_sensors",
      show_windows: "editor_room_show_windows",
      temperature_entity: "editor_room_temperature",
      humidity_entity: "editor_room_humidity",
      power_entity: "editor_room_power",
      power_threshold: "editor_room_power_threshold",
      power_entities: "editor_room_power_entities",
      window_entities: "editor_room_windows",
      door_entities: "editor_room_doors",
      category_tap: "editor_room_category_tap",
      badge: "editor_room_badge",
      tile_name: "editor_room_tile_name",
      strip_area_name: "editor_room_strip_area",
      presence_entity: "editor_room_presence_entity",
      presence_style: "editor_room_presence_style",
      collapsible: "editor_room_collapsible",
      show_active_names: "editor_room_show_active_names",
      default_collapsed: "editor_room_default_collapsed",
      scroll_on_expand: "editor_room_scroll_on_expand",
      scroll_duration: "editor_room_scroll_duration",
      collapse_memory: "editor_room_collapse_memory",
      collapse_state_entity: "editor_room_collapse_entity",
      animation: "editor_progress_animation",
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    // Manual mode draws none of the discovered tiles, so everything that
    // configures them is describing something the card will not render — a
    // whole section of switches with no effect, which is worse than an absent
    // one.
    const manual = (cfg?.mode ?? "auto") === "manual";
    const detected = this._detected();
    const hidden = new Set(cfg.hidden_categories ?? []);

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_room_section")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:floor-plan"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                area: cfg.area ?? "",
                mode: cfg.mode ?? "auto",
                name: cfg.name ?? "",
                icon: cfg.icon ?? "",
                tap_action: cfg.tap_action,
                detail_path: cfg.detail_path ?? "",
                cards_columns: cfg.cards_columns ?? 2,
              }}
              .schema=${this._roomSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="block">
              <div class="block-title">${this._t("editor_room_cards")}</div>
              ${this._cards.map(
                (card, index) => html`
                  <ha-expansion-panel outlined .header=${this._cardLabel(card, index)}>
                    <!-- Arrows in the header so reordering does not mean
                         opening and closing every panel on the way. -->
                    <div slot="icons" class="reorder">
                      <ha-icon-button
                        .label=${this._t("editor_room_move_up")}
                        .disabled=${index === 0}
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          e.preventDefault();
                          this._moveCard(index, -1);
                        }}
                      >
                        <ha-icon icon="mdi:arrow-up"></ha-icon>
                      </ha-icon-button>
                      <ha-icon-button
                        .label=${this._t("editor_room_move_down")}
                        .disabled=${index === this._cards.length - 1}
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          e.preventDefault();
                          this._moveCard(index, 1);
                        }}
                      >
                        <ha-icon icon="mdi:arrow-down"></ha-icon>
                      </ha-icon-button>
                    </div>
                    <div class="panel-content">
                      ${this._nestedEditor(card, index) ??
                      html`<div class="hint">
                        ${this._t("editor_room_card_yaml_only")}
                      </div>`}
                      <ha-button
                        class="remove"
                        @click=${() =>
                          this._setCards(this._cards.filter((_, i) => i !== index))}
                        >${this._t("editor_room_remove_card")}</ha-button
                      >
                    </div>
                  </ha-expansion-panel>
                `,
              )}
              <ha-form
                .hass=${this.hass}
                .data=${{ add_type: this._addType, add_entities: [] }}
                .schema=${[
                  {
                    name: "add_type",
                    selector: {
                      select: {
                        mode: "dropdown",
                        // Paired with its label rather than deriving one from
                        // the type: the derivation turned "climate-card-mini"
                        // into a key that did not exist, and the cast it needed
                        // stopped the compiler from saying so.
                        options: ROOM_NESTED_CARD_TYPES.map(({ type, label }) => ({
                          value: type,
                          label: this._t(label),
                        })),
                      },
                    },
                  },
                  {
                    name: "add_entities",
                    selector: { entity: { multiple: true } },
                  },
                ]}
                .computeLabel=${this._computeLabel}
                @value-changed=${(ev: CustomEvent) => {
                  const value = ev.detail.value as {
                    add_type?: string;
                    add_entities?: string[];
                  };
                  if (value.add_type && value.add_type !== this._addType) {
                    this._addType = value.add_type;
                    return;
                  }
                  const picked = value.add_entities;
                  if (!picked?.length) return;
                  // One card of the chosen kind per entity. Anything the suite
                  // does not build from an entity alone is still written by
                  // hand, and gets its own editor once it is there.
                  this._setCards([
                    ...this._cards,
                    ...picked.map((entity) => ({ type: this._addType, entity })),
                  ]);
                }}
              ></ha-form>
              <div class="hint">${this._t("editor_room_cards_hint")}</div>
            </div>
          </div>
        </ha-expansion-panel>

        ${manual
          ? nothing
          : html`<ha-expansion-panel outlined .header=${this._t("editor_room_categories")}>
          <ha-icon slot="leading-icon" icon="mdi:view-grid-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_room_categories_hint")}</div>
            ${detected.map(
              ({ domain, count }, index) => html`
                <div class="cat">
                  <div class="cat-head">
                    <ha-icon icon=${this._override(domain)?.icon ?? this._categoryIcon(domain)}></ha-icon>
                    <span class="cat-name"
                      >${this._override(domain)?.name ?? this._categoryName(domain)}</span
                    >
                    <span class="cat-count">${count}</span>
                    <ha-icon-button
                      .disabled=${index === 0}
                      .label=${this._t("editor_room_move_up")}
                      @click=${() => this._move(domain, -1)}
                    >
                      <ha-icon icon="mdi:arrow-up"></ha-icon>
                    </ha-icon-button>
                    <ha-icon-button
                      .disabled=${index === detected.length - 1}
                      .label=${this._t("editor_room_move_down")}
                      @click=${() => this._move(domain, 1)}
                    >
                      <ha-icon icon="mdi:arrow-down"></ha-icon>
                    </ha-icon-button>
                    <ha-switch
                      .checked=${!hidden.has(domain) && !this._override(domain)?.hidden}
                      @change=${(e: Event) =>
                        this._toggleVisible(domain, (e.target as HTMLInputElement).checked)}
                    ></ha-switch>
                  </div>
                  <ha-form
                    .hass=${this.hass}
                    .data=${{
                      tile_name: this._override(domain)?.name ?? "",
                      icon: this._override(domain)?.icon ?? "",
                      badge: this._override(domain)?.badge ?? "auto",
                      tap_action: this._override(domain)?.tap_action,
                    }}
                    .schema=${[
                      { name: "tile_name", selector: { text: {} } },
                      { name: "icon", selector: { icon: {} } },
                      {
                        name: "badge",
                        selector: {
                          select: {
                            mode: "dropdown",
                            options: [
                              { value: "auto", label: this._t("editor_room_badge_auto") },
                              { value: "count", label: this._t("editor_room_badge_count") },
                              { value: "state", label: this._t("editor_room_badge_state") },
                              { value: "none", label: this._t("editor_room_badge_none") },
                            ],
                          },
                        },
                      },
                      { name: "tap_action", selector: { ui_action: {} } },
                    ]}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(ev: CustomEvent) => {
                      const { tile_name, ...rest } = ev.detail.value as Record<string, unknown>;
                      this._patchCategory(domain, {
                        ...rest,
                        name: tile_name as string,
                      } as Partial<RoomCategoryConfig>);
                    }}
                  ></ha-form>
                  ${colorRow(this._t("editor_mode_color"), this._override(domain)?.color, (v) =>
                    this._patchCategory(domain, { color: v }),
                  )}
                  <div class="hint">${this._t("editor_room_entities")}</div>
                  ${this._entitiesOf(domain).map(
                    (id) => html`
                      <div class="ent">
                        <span class="ent-name" title=${id}>${this._entityName(id)}</span>
                        <ha-switch
                          .checked=${!this._isExcluded(id)}
                          @change=${(e: Event) =>
                            this._setExcluded(id, !(e.target as HTMLInputElement).checked)}
                        ></ha-switch>
                      </div>
                    `,
                  )}
                </div>
              `,
            )}
            <ha-form
              .hass=${this.hass}
              .data=${{
                category_tap: cfg.category_tap ?? "list",
                strip_area_name: cfg.strip_area_name ?? false,
              }}
              .schema=${[
                ...this._tapSchema(),
                { name: "strip_area_name", selector: { boolean: {} } },
              ]}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_room_strip_area_hint")}</div>
            <div class="hint">${this._t("editor_room_entities_hint")}</div>
            ${listRow(this._t("editor_room_extra_domains"), cfg.extra_domains ?? [], (values) => {
              const next = { ...cfg };
              if (values.length) next.extra_domains = values;
              else delete next.extra_domains;
              this._emit(next);
            })}
          </div>
        </ha-expansion-panel>`}

        <ha-expansion-panel outlined .header=${this._t("editor_room_sensors")}>
          <ha-icon slot="leading-icon" icon="mdi:thermometer"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                show_sensors: cfg.show_sensors ?? true,
                show_windows: cfg.show_windows ?? true,
                temperature_entity: cfg.temperature_entity ?? "",
                humidity_entity: cfg.humidity_entity ?? "",
                power_entity: cfg.power_entity ?? "",
                power_threshold: cfg.power_threshold ?? ROOM_POWER_THRESHOLD,
              }}
              .schema=${this._sensorSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <ha-form
              .hass=${this.hass}
              .data=${{ power_entities: cfg.power_entities ?? [] }}
              .schema=${[
                {
                  name: "power_entities",
                  // A picker rather than a comma-separated text field: these are
                  // entity ids nobody types from memory, and the filter keeps
                  // the list to things measured in watts.
                  selector: {
                    entity: {
                      multiple: true,
                      filter: { domain: "sensor", device_class: "power" },
                    },
                  },
                },
              ]}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) => {
                const picked = (ev.detail.value as { power_entities?: string[] })
                  .power_entities;
                const next = { ...cfg };
                if (picked?.length) next.power_entities = picked;
                else delete next.power_entities;
                this._emit(next);
              }}
            ></ha-form>
            <div class="hint">${this._t("editor_room_power_entities_hint")}</div>
            ${listRow(this._t("editor_room_extra_sensors"), cfg.extra_sensors ?? [], (values) => {
              const next = { ...cfg };
              if (values.length) next.extra_sensors = values;
              else delete next.extra_sensors;
              this._emit(next);
            })}
            <ha-form
              .hass=${this.hass}
              .data=${{ window_entities: cfg.window_entities ?? [] }}
              .schema=${[
                {
                  name: "window_entities",
                  // The same picker the power list uses. A sensor that is not
                  // in the room's area cannot be discovered, and typing its id
                  // from memory is not a reasonable ask.
                  selector: {
                    entity: {
                      multiple: true,
                      filter: [
                        { domain: "binary_sensor", device_class: "window" },
                        { domain: "binary_sensor", device_class: "door" },
                        { domain: "binary_sensor", device_class: "opening" },
                      ],
                    },
                  },
                },
              ]}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) => {
                const picked = (ev.detail.value as { window_entities?: string[] })
                  .window_entities;
                const next = { ...cfg };
                if (picked?.length) next.window_entities = picked;
                else delete next.window_entities;
                this._emit(next);
              }}
            ></ha-form>
            <ha-form
              .hass=${this.hass}
              .data=${{ door_entities: cfg.door_entities ?? [] }}
              .schema=${[
                {
                  name: "door_entities",
                  selector: {
                    entity: {
                      multiple: true,
                      filter: [
                        { domain: "binary_sensor", device_class: "window" },
                        { domain: "binary_sensor", device_class: "door" },
                        { domain: "binary_sensor", device_class: "opening" },
                      ],
                    },
                  },
                },
              ]}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) => {
                const picked = (ev.detail.value as { door_entities?: string[] })
                  .door_entities;
                const next = { ...cfg };
                if (picked?.length) next.door_entities = picked;
                else delete next.door_entities;
                this._emit(next);
              }}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_room_fold_section")}>
          <ha-icon slot="leading-icon" icon="mdi:arrow-collapse-vertical"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                collapsible: cfg.collapsible ?? false,
                show_active_names: cfg.show_active_names ?? false,
                shape_by_state: cfg.shape_by_state ?? false,
                default_collapsed: cfg.default_collapsed ?? false,
                scroll_on_expand: cfg.scroll_on_expand ?? false,
                scroll_duration: cfg.scroll_duration ?? ROOM_SCROLL_MS,
                collapse_memory: cfg.collapse_memory ?? "device",
                collapse_state_entity: cfg.collapse_state_entity ?? "",
              }}
              .schema=${this._foldSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_room_collapsible_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_room_presence")}>
          <ha-icon slot="leading-icon" icon="mdi:motion-sensor"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                presence_entity: cfg.presence_entity ?? "",
                presence_style: cfg.presence_style ?? "tint",
              }}
              .schema=${this._presenceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_clock_accent_color"), cfg.accent_color, (v) =>
              this._colorChanged("accent_color", v),
            )}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) =>
              this._colorChanged("text_color", v),
            )}
            ${colorRow(
              this._t("editor_progress_secondary_text_color"),
              cfg.secondary_text_color,
              (v) => this._colorChanged("secondary_text_color", v),
            )}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) =>
              this._colorChanged("card_background", v),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:wave"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ animation: cfg.animation ?? "auto" }}
              .schema=${this._animationSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: cfg,
          defaultRadius: DEFAULT_ROOM_RADIUS,
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
      .cat {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border: 1px solid rgba(127, 127, 127, 0.3);
        border-radius: 12px;
      }

      .cat-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .cat-name {
        flex: 1;
        min-width: 0;
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ent {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-left: 4px;
      }

      .ent-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cat-count {
        flex-shrink: 0;
        font-size: 12px;
        opacity: 0.6;
        font-variant-numeric: tabular-nums;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-room-card-editor": M3RoomCardEditor;
  }
}
