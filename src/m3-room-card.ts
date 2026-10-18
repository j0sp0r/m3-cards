import { LitElement, html, css, nothing, unsafeCSS } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HassEntity,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3RoomCardConfig,
  RoomCategoryConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_ROOM_ACCENT,
  DEFAULT_ROOM_RADIUS,
  DEFAULT_ROOM_CARD_COLUMNS,
  ROOM_CATEGORIES,
  ROOM_CHIP_HEIGHT,
  ROOM_CHIP_RADIUS,
  ROOM_CHIP_TINT,
  ROOM_DOT,
  ROOM_DOT_PULSE_MS,
  ROOM_FALLBACK_CATEGORY,
  ROOM_HEADER_ICON,
  ROOM_HEADER_ICON_RADIUS,
  ROOM_HOLD_MS,
  ROOM_POWER_THRESHOLD,
  ROOM_PRESENCE_BORDER,
  ROOM_PRESENCE_COLOR,
  ROOM_PRESENCE_TINT,
  ROOM_SHEET_ICON,
  ROOM_SHEET_ICON_RADIUS,
  ROOM_SHEET_MAX_HEIGHT,
  ROOM_SHEET_MS,
  ROOM_SHEET_RADIUS,
  ROOM_SHEET_ROW_HEIGHT,
  ROOM_SHEET_ROW_RADIUS,
  ROOM_SHEET_ROW_TINT,
  ROOM_TILE_GAP,
  ROOM_TILE_ICON,
  ROOM_TILE_ICON_RADIUS,
  ROOM_TILE_ICON_TINT_IDLE,
  ROOM_TILE_MIN,
  ROOM_TILE_MORPH_MS,
  ROOM_TILE_RADIUS,
  ROOM_TILE_RADIUS_ACTIVE,
  ROOM_TILE_TINT_ACTIVE,
  ROOM_ARROW,
  ROOM_ARROW_RADIUS,
  ROOM_ARROW_RADIUS_FOLDED,
  ROOM_ARROW_TINT,
  ROOM_FOLD_MS,
  ROOM_SCROLL_MARGIN,
  DOCK_SCAN_BUDGET,
  DOCK_MIN_WIDTH_SHARE,
  DOCK_MAX_HEIGHT_SHARE,
  ROOM_CARD_SCAN_DEPTH,
  ROOM_SCROLL_MS,
  ROOM_SCROLL_MAX_MS,
  ROOM_TILE_TINT_IDLE,
  resolveCornerRadius,
  type RoomCategoryDef,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { handleAction, isActionable } from "./shared/actions";
import {
  buildCssVars,
  fillColor,
  foregroundOn,
  inkOn,
  resolveCommonColors,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { formatNumber } from "./shared/formatting";
import { areaEntityIds, areaInfo } from "./shared/ha-registry";
import { guessRoomIcon } from "./shared/room-icons";
import { readCollapsed, writeCollapsed, type CollapseTarget } from "./shared/collapse-state";
import { hassChangeMatters } from "./shared/should-update";
import { createCards, updateCardsHass } from "./shared/card-helpers";
import { TemplatedCard } from "./shared/templated-card";

const EASING = unsafeCSS(STANDARD_EASING);

/** Amber, the same one the power chip uses when it has something to say. */
const PALETTE_WARN = "#f0a24a";

console.info(
  `%c M3-ROOM-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #5dcaa5; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #5dcaa5; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const PRESENCE_CLASSES = new Set(["occupancy", "motion", "presence"]);
/** What counts as "a way into the room that can stand open". */
const OPENING_CLASSES = new Set(["window", "door", "garage_door", "opening"]);
const UNAVAILABLE = new Set(["unavailable", "unknown"]);

interface Category {
  domain: string;
  name: string;
  icon: string;
  color: string;
  def: RoomCategoryDef;
  entities: string[];
  /** Entities that actually answer; the rest are unavailable. */
  live: string[];
  activeCount: number;
  active: boolean;
  badge: string;
  override?: RoomCategoryConfig;
}

/**
 * How much of the bottom of the window something is parked over.
 *
 * Asking the point what covers it looked like the tidy way to do this and does
 * not work: `elementsFromPoint` hands back the shadow host rather than what is
 * inside it, and following the hosts down one branch at a time walks into
 * whichever subtree paints on top — on a real dashboard that is the card being
 * scrolled, not the navigation bar two sections away. So the tree is walked
 * instead, and every element that is pinned to the viewport and lies across the
 * bottom edge counts, wherever in the shadow DOM it happens to live.
 */
function bottomDock(): number {
  const viewport = window.innerHeight;
  const edge = viewport - 2;
  const minWidth = window.innerWidth * DOCK_MIN_WIDTH_SHARE;
  let covered = 0;
  let budget = DOCK_SCAN_BUDGET;

  const stack: (Element | ShadowRoot)[] = [document.body];
  while (stack.length && budget-- > 0) {
    const node = stack.pop()!;
    if (node instanceof Element) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") {
        const rect = node.getBoundingClientRect();
        // Across the bottom edge and wide enough to be a bar rather than a
        // floating button, which leaves plenty of room beside it. The height
        // test is per element and not a check on the result: a dashboard has
        // several viewport-sized fixed layers — the background, the dialog
        // host — and every one of them crosses the bottom edge. Taking the
        // largest first and rejecting it afterwards throws the bar away with
        // them, which is exactly what happened here.
        const inset = viewport - rect.top;
        if (
          rect.top <= edge &&
          rect.bottom >= edge &&
          rect.width >= minWidth &&
          inset <= viewport * DOCK_MAX_HEIGHT_SHARE
        ) {
          covered = Math.max(covered, inset);
        }
      }
      if (node.shadowRoot) stack.push(node.shadowRoot);
    }
    stack.push(...node.children);
  }

  return covered;
}

/**
 * The thing that actually scrolls above an element.
 *
 * `scrollIntoView` finds this by itself and was the first choice for exactly
 * that reason, but it also owns the timing, and the browser's smooth scroll is
 * slower than a card opening under a finger wants to be. Driving the scroll by
 * hand means finding the scroller by hand — up the tree and out through each
 * shadow root, since a Lovelace view is several of them deep.
 */
function scrollParent(start: Element): Element {
  let node: Node | null = start;
  while (node) {
    if (node instanceof ShadowRoot) {
      node = node.host;
      continue;
    }
    if (node instanceof Element && node !== start) {
      const overflow = getComputedStyle(node).overflowY;
      if (
        (overflow === "auto" || overflow === "scroll" || overflow === "overlay") &&
        node.scrollHeight > node.clientHeight + 1
      ) {
        return node;
      }
    }
    node = node.parentNode;
  }
  return document.scrollingElement ?? document.documentElement;
}

/** Fast out of the gate, gentle into the stop — Material's usual shape. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

interface Chip {
  key: string;
  icon: string;
  text: string;
  color?: string;
  /** The entity whose history the chip opens, where exactly one is behind it.
   * A summed power chip has no single entity and a window chip over several
   * sensors has no single answer, so both leave this unset and stay inert. */
  entity?: string;
}

@customElement("m3-room-card")
export class M3RoomCard extends TemplatedCard(LitElement) implements LovelaceCard {
  /**
   * A plain property would leave the cards inside the room card starved: they
   * take their data from a `hass` pushed onto them from outside, and the render
   * path is filtered by shouldUpdate, so pushing from there means a nested card
   * showing the state it was born with. The accessor pushes on every tick and
   * lets Lit see the change as before.
   */
  @property({ attribute: false })
  public get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  public set hass(value: HomeAssistant | undefined) {
    const previous = this._hass;
    this._hass = value;
    updateCardsHass(this._cards, value);
    this.requestUpdate("hass", previous);
  }

  private _hass?: HomeAssistant;

  /** Built when the config changes, never in the render path. */
  private _cards: HTMLElement[] = [];
  private _cardsFor?: Record<string, unknown>[];

  @state() private _config?: M3RoomCardConfig;
  /** Domain of the category whose device picker is open, if any. */
  @state() private _sheet?: string;
  @state() private _folded = false;
  /** What the DOM currently shows, so a change can be animated from it. */
  private _appliedFold?: boolean;
  private _foldTimer?: number;
  /** True while the picker plays its exit; the sheet is still in the DOM. */
  @state() private _sheetClosing = false;

  private _holdTimer?: number;
  private _held = false;
  private _sheetCloseTimer?: number;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-room-card-editor");
    return document.createElement(
      "m3-room-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3RoomCardConfig {
    const areas = hass?.areas ? Object.keys(hass.areas) : [];
    return { type: "custom:m3-room-card", area: areas[0] ?? "", glass_background: true };
  }

  public setConfig(config: M3RoomCardConfig): void {
    if (!config.area) throw new Error("m3-room-card: 'area' is required");
    this._config = { glass_background: true, animation: "auto", show_sensors: true, ...config };
    this._folded = this._config.collapsible ? readCollapsed(this.hass, this._foldTarget) : false;
    void this._syncCards();
  }

  /**
   * Builds the nested cards when their config changes, and only then.
   *
   * Rebuilding per render would be expensive and would throw away whatever the
   * nested card was holding — a half-open section, a slider mid-drag. Compared
   * by serialised config rather than by identity, because a config object is a
   * fresh one on every editor keystroke while its contents are unchanged.
   */
  private async _syncCards(): Promise<void> {
    const configs = this._config?.cards ?? [];
    const key = JSON.stringify(configs);
    if (key === JSON.stringify(this._cardsFor ?? [])) return;
    this._cardsFor = configs;
    this._cards = await createCards(configs, this._hass);
    // Home Assistant sets the config before it sets hass, and building is
    // asynchronous — so the hass that arrived while this was awaiting never
    // reached a list that was still empty when the setter ran. Push it again
    // now that the cards exist, or they render the state of a card with no
    // hass at all, which is nothing.
    updateCardsHass(this._cards, this._hass);
    this.requestUpdate();
  }

  private get _foldTarget(): CollapseTarget {
    return {
      entity: this._config?.collapse_state_entity,
      // The area is what identifies the card; two cards for the same room on
      // one view would share a fold, which is the behaviour a person expects.
      storageKey: `m3-room-folded:${location.pathname}:${this._config?.area ?? ""}`,
      defaultCollapsed: this._config?.default_collapsed,
      memory: this._config?.collapse_memory,
    };
  }

  private _toggleFold = (e: Event): void => {
    e.stopPropagation();
    this._folded = !this._folded;
    writeCollapsed(this.hass, this._foldTarget, this._folded);
  };

  /**
   * The header's tap. With no `tap_action` configured this is the fold toggle
   * and nothing else, which is what the header has always done; with one it is
   * that action instead.
   *
   * A tap cannot both fold the card and open a view, so the two do not share
   * the header — the explicit action wins over the implicit fold. `collapsible`
   * is otherwise untouched: the stored fold state is still read and applied on
   * update, so a card folded by its `collapse_state_entity` or by another
   * dashboard still opens and closes; only this header stops toggling it.
   */
  private _onHeaderTap = (e: Event): void => {
    const action = this._config?.tap_action;
    if (!action) {
      this._toggleFold(e);
      return;
    }
    e.stopPropagation();
    if (!isActionable(action)) return;
    handleAction(this, this.hass, action);
  };

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 3 };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (!changed.has("hass") || changed.size > 1) return true;
    const previous = changed.get("hass") as HomeAssistant | undefined;
    if (!previous || !this.hass) return true;
    // The card discovers what it draws, so a registry change can add a whole
    // category. Listing the entities it currently reads cannot catch that:
    // the entity it should start reading is by definition not in the list.
    if (
      previous.entities !== this.hass.entities ||
      previous.devices !== this.hass.devices ||
      previous.areas !== this.hass.areas
    ) {
      return true;
    }
    return hassChangeMatters(changed, this.hass, this._watched());
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearTimeout(this._holdTimer);
    window.clearTimeout(this._sheetCloseTimer);
    window.clearTimeout(this._foldTimer);
    if (this._scrollFrame !== undefined) cancelAnimationFrame(this._scrollFrame);
  }

  protected updated(): void {
    if (!this._config?.collapsible) {
      this._appliedFold = undefined;
      return;
    }
    // An entity-backed fold can be changed from another dashboard or by an
    // automation, so it is re-read rather than only written on a tap.
    const wanted = readCollapsed(this.hass, this._foldTarget);
    if (wanted !== this._folded) {
      this._folded = wanted;
      return;
    }
    if (this._appliedFold !== this._folded) {
      // The very first paint jumps to the stored state; only a change animates.
      this._applyFold(this._appliedFold !== undefined);
      this._appliedFold = this._folded;
    }
  }

  /**
   * Folds the body by animating its height in pixels, measured each time.
   *
   * The CSS-only route — a grid track going 1fr to 0fr — does not work here.
   * That trick needs the grid to have a definite height; in a card whose height
   * comes from its content the flexible track is sized by its own contents
   * instead, so the fold moved the body from 135.6px to 134.98px and looked
   * broken. A measured height is exact, and scrollHeight still reports the
   * content while the box is collapsed, so expanding knows where to go.
   */
  private _applyFold(animate: boolean): void {
    const body = this.renderRoot.querySelector(".body") as HTMLElement | null;
    if (!body) return;
    window.clearTimeout(this._foldTimer);

    if (!animate || !shouldAnimate(this._config?.animation)) {
      body.style.height = this._folded ? "0px" : "";
      // Without an animation there is no transition to wait for, but a card
      // opening off the bottom of the screen is just as invisible — the scroll
      // belongs on this path too. No growth to allow for: the height above is
      // already committed, and measuring the card now reads the grown box.
      if (!this._folded) this._scrollIntoView(0);
      return;
    }

    const from = body.getBoundingClientRect().height;
    const to = this._folded ? 0 : body.scrollHeight;
    body.style.height = `${from}px`;
    // Reading it back commits the starting height, so the browser has two
    // values to interpolate rather than one.
    void body.offsetHeight;
    body.style.height = `${to}px`;

    // Settle on the end state once the animation has had its time, in both
    // directions and without a transition. Open goes back to auto, or the body
    // would keep the height it had at that moment and clip whatever arrives
    // later. Folded is pinned to 0, because a transition that never ran leaves
    // the box at its *starting* height — a background tab throttles them, and
    // setting the same value again does not restart one. Without this a card
    // folded while its tab was in the background stayed open.
    this._foldTimer = window.setTimeout(() => {
      const folded = this._folded;
      body.style.transition = "none";
      body.style.height = folded ? "0px" : "";
      void body.offsetHeight;
      body.style.transition = "";
      // And aim once more, now that the card really is as tall as it was going
      // to be. The first attempt runs while the page is still the height it had
      // when folded, so a card near the bottom asks to be scrolled further than
      // there is document to scroll and stops at the end — it came to rest
      // under the navigation bar every time. This is not a second movement in
      // the usual case: _scrollIntoView returns without doing anything once the
      // card is fully visible, which is what the first aim achieves whenever
      // there was room for it.
      if (!folded) this._scrollIntoView(0);
    }, ROOM_FOLD_MS + 40);

    // Alongside the fold rather than after it. Waiting for the animation to
    // finish and only then scrolling reads as two separate movements with a
    // pause in the middle; the final height is already known here, so the
    // right destination can be computed before the box has grown into it.
    if (!this._folded) this._scrollIntoView(to - from);
  }

  /**
   * Whatever is docked over the bottom of the screen.
   *
   * A navigation bar from this suite sits on top of the view, so the bottom of
   * the window is not the bottom of what can be seen. Scrolling a card flush to
   * the window edge leaves its last row underneath the bar — visible to the
   * layout, hidden to the reader.
   */
  private _bottomObstruction(): number {
    return bottomDock();
  }

  private _scrollIntoView(growth: number): void {
    if (this._config?.scroll_on_expand !== true) return;
    const rect = this.getBoundingClientRect();
    const obstruction = this._bottomObstruction();
    const bottomLimit = window.innerHeight - obstruction - ROOM_SCROLL_MARGIN;
    const grow = Math.max(0, growth);
    const finalBottom = rect.bottom + grow;
    const fitsBelow = finalBottom <= bottomLimit;
    const tooTall = finalBottom - rect.top > bottomLimit;

    if (fitsBelow && rect.top >= 0) return;

    // A card taller than the space left over cannot be shown whole, so its top
    // is what matters; anything else is aligned by its bottom, which is the
    // edge that was hidden.
    const shift = tooTall
      ? rect.top - ROOM_SCROLL_MARGIN
      : finalBottom - bottomLimit;

    this._scrollBy(shift);
  }

  /**
   * Move the page by this much, over `ROOM_SCROLL_MS` rather than the browser's
   * own idea of a smooth scroll — see `ROOM_SCROLL_MS` for why.
   *
   * The destination is re-asked every frame instead of being worked out once.
   * A card that is unfolding is still growing the page, and a page cannot be
   * scrolled to a place that does not exist yet: computing the limit at the
   * moment of the tap meant the first movement was whatever little room there
   * happened to be, and the real travel only came afterwards, from the second
   * aim once the card had finished growing. Two movements, one after the
   * other, when the fold and the scroll should be the same gesture.
   */
  private _scrollBy(shift: number): void {
    if (this._scrollFrame !== undefined) cancelAnimationFrame(this._scrollFrame);
    if (Math.abs(shift) < 1) return;

    const scroller = scrollParent(this);
    const from = scroller.scrollTop;
    const desired = from + shift;
    const reachable = (): number =>
      Math.min(Math.max(0, scroller.scrollHeight - scroller.clientHeight), Math.max(0, desired));

    const duration = Math.max(
      0,
      Math.min(ROOM_SCROLL_MAX_MS, this._config?.scroll_duration ?? ROOM_SCROLL_MS),
    );
    if (duration === 0 || !shouldAnimate(this._config?.animation)) {
      scroller.scrollTop = reachable();
      return;
    }

    // Out of room for now means the fold is what is holding the scroll back,
    // so the scroll keeps pace with it and the two land together. When the room
    // is already there the configured duration stands and nothing waits.
    const span =
      Math.abs(reachable() - desired) > 1 ? Math.max(duration, ROOM_FOLD_MS) : duration;

    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / span);
      const wanted = from + (desired - from) * easeOut(progress);
      scroller.scrollTop = Math.min(
        Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        Math.max(0, wanted),
      );
      this._scrollFrame = progress < 1 ? requestAnimationFrame(step) : undefined;
    };
    this._scrollFrame = requestAnimationFrame(step);
  }

  private _scrollFrame?: number;

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- discovery -----------------------------------------------------------

  private get _areaEntities(): string[] {
    if (!this.hass || !this._config?.area) return [];
    const all = areaEntityIds(this.hass, this._config.area);
    const excluded = this._config.excluded_entities;
    if (!excluded?.length) return all;
    const drop = new Set(excluded);
    return all.filter((id) => !drop.has(id));
  }

  /**
   * The area's entities *before* the user's exclusions, for the editor.
   *
   * The editor has to offer the excluded ones too — a device you cannot see in
   * the list is a device you cannot switch back on.
   */
  public allAreaEntities(): string[] {
    if (!this.hass || !this._config?.area) return [];
    return areaEntityIds(this.hass, this._config.area);
  }

  private _watched(): (string | undefined)[] {
    const ids: (string | undefined)[] = [...this._areaEntities];
    const cfg = this._config;
    if (cfg) {
      ids.push(
        cfg.temperature_entity,
        cfg.humidity_entity,
        cfg.power_entity,
        cfg.presence_entity,
        cfg.collapse_state_entity,
        ...(cfg.extra_sensors ?? []),
        ...(cfg.window_entities ?? []),
        ...(cfg.door_entities ?? []),
        ...(cfg.power_entities ?? []),
        ...(this._manual ? this._manualEntities() : []),
      );
    }
    return ids;
  }

  /** True while the body is the configured cards rather than the discovery. */
  private get _manual(): boolean {
    return (this._config?.mode ?? "auto") === "manual";
  }

  /**
   * The entities behind the manually configured cards.
   *
   * Manual mode exists for rooms whose devices the area registry does not know
   * about, so counting only registry entities leaves such a room reading "all
   * off" while its sockets are visibly on. Nested stacks are followed, and the
   * shapes a card config uses for its entities — `entity`, a list of ids, a
   * list of rows — are all read.
   */
  private _manualEntities(): string[] {
    const out: string[] = [];

    const walk = (cards: Record<string, unknown>[] | undefined, depth: number): void => {
      if (!cards?.length || depth > ROOM_CARD_SCAN_DEPTH) return;
      for (const card of cards) {
        if (typeof card?.entity === "string") out.push(card.entity);
        if (Array.isArray(card?.entities)) {
          for (const row of card.entities as unknown[]) {
            if (typeof row === "string") out.push(row);
            else if (typeof (row as { entity?: unknown })?.entity === "string")
              out.push((row as { entity: string }).entity);
          }
        }
        walk(card?.cards as Record<string, unknown>[] | undefined, depth + 1);
      }
    };

    walk(this._config?.cards, 0);
    return [...new Set(out)];
  }

  private _manualActiveCount(): number {
    if (!this.hass) return 0;
    return this._manualEntities().filter((id) =>
      this._isActive(id.split(".", 1)[0], this.hass!.states[id]),
    ).length;
  }

  private _defFor(domain: string): RoomCategoryDef {
    return (
      ROOM_CATEGORIES.find((c) => c.domain === domain) ?? {
        domain,
        ...ROOM_FALLBACK_CATEGORY,
      }
    );
  }

  private _overrideFor(domain: string): RoomCategoryConfig | undefined {
    return this._config?.categories?.find((c) => c.domain === domain);
  }

  /** The domains this card is willing to show, in the order they should appear. */
  private _domainOrder(): string[] {
    const cfg = this._config;
    const known = ROOM_CATEGORIES.map((c) => c.domain);
    const extra = (cfg?.extra_domains ?? []).filter(
      (d): d is string => !!d && !known.includes(d),
    );
    const all = [...known, ...extra];
    const preferred = cfg?.category_order ?? [];
    // A configured order wins for the domains it names; everything else keeps
    // the built-in order behind it, so adding a domain later does not silently
    // drop it off the card.
    return [
      ...preferred.filter((d) => all.includes(d)),
      ...all.filter((d) => !preferred.includes(d)),
    ];
  }

  private _categories(): Category[] {
    const cfg = this._config;
    if (!cfg || !this.hass) return [];
    const hidden = new Set(cfg.hidden_categories ?? []);
    const byDomain = new Map<string, string[]>();
    for (const id of this._areaEntities) {
      const domain = id.split(".", 1)[0];
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), id]);
    }

    const out: Category[] = [];
    for (const domain of this._domainOrder()) {
      const entities = byDomain.get(domain);
      if (!entities?.length) continue;
      const override = this._overrideFor(domain);
      if (hidden.has(domain) || override?.hidden) continue;

      const def = this._defFor(domain);
      const live = entities.filter((id) => !UNAVAILABLE.has(this.hass!.states[id]?.state ?? ""));
      const activeCount = live.filter((id) => this._isActive(domain, this.hass!.states[id])).length;

      out.push({
        domain,
        name: override?.name ?? this._categoryName(domain, entities),
        icon: override?.icon ?? this._categoryIcon(domain, entities),
        color: resolveThemeColor(override?.color ?? def.color),
        def,
        entities,
        live,
        activeCount,
        active: activeCount > 0,
        badge:
          override?.badge === "none"
            ? ""
            : live.length === 0
              ? "—"
              : this._badge(domain, entities, live, activeCount, override?.badge ?? "auto"),
        override,
      });
    }
    return out;
  }

  private _categoryName(domain: string, entities: string[]): string {
    // With exactly one device behind the tile, the tile *is* that device, so
    // name it. "Schalter · An" tells nobody what they are about to switch —
    // and a switch is the one category whose generic name carries no
    // information at all. The icon still says what kind of thing it is.
    if (entities.length === 1) {
      const own = this.hass?.states[entities[0]]?.attributes?.friendly_name as string | undefined;
      if (own) {
        const short = this._config?.strip_area_name ? this._withoutAreaName(own) : own;
        if (short) return short;
      }
    }
    // A dehumidifier is its own word, and calling it a humidifier would be the
    // card telling the user their device does the opposite of what it does.
    if (domain === "humidifier" && this._allHaveDeviceClass(entities, "dehumidifier")) {
      return this._t("room_cat_dehumidifier");
    }
    const key = `room_cat_${domain}` as TranslationKey;
    const label = localize(key, this._language);
    return label === key ? domain : label;
  }

  /**
   * Drops the room's name from a device name, wherever it sits. Opt-in.
   *
   * Off by default on purpose: it only helps if the device happens to be named
   * after its room, which is one convention among several. Guessing right for
   * one person means guessing wrong for the next, and `categories[].name` sets
   * the tile's label outright for anyone whose names do not fit the pattern.
   *
   * People name devices after the room they are in, and Home Assistant then
   * builds the entity name from the device, so a bedroom card repeats
   * "Schlafzimmer" on every tile. In the width of a tile that repetition is
   * the part that survives and the distinguishing part is what gets
   * ellipsised — "Thermostat Schlafzimmer" reads as "Thermostat Schlafz…" when
   * "Thermostat" was the whole message.
   *
   * It is stripped anywhere, not just as a prefix: the room name turns up at
   * the end ("Thermostat Schlafzimmer") as often as at the front, and in the
   * middle when the device is a camera ("Kamera Schlafzimmer Floodlight").
   *
   * Returns "" when nothing is left — a thermostat whose whole name is the
   * room would otherwise put the room's own name on a tile inside that room's
   * card. The caller falls back to the category label there.
   */
  private _withoutAreaName(name: string): string {
    const area =
      this._config?.area && this.hass
        ? areaInfo(this.hass, this._config.area)?.name
        : undefined;
    if (!area) return name;
    const escaped = area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = name
      .replace(new RegExp(escaped, "gi"), " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s\-–—_:.]+|[\s\-–—_:.]+$/g, "")
      .trim();
    return stripped;
  }

  private _categoryIcon(domain: string, entities: string[]): string {
    if (domain === "humidifier" && this._allHaveDeviceClass(entities, "dehumidifier")) {
      return "mdi:water-percent";
    }
    return this._defFor(domain).icon;
  }

  private _allHaveDeviceClass(entities: string[], deviceClass: string): boolean {
    return entities.every(
      (id) => this.hass?.states[id]?.attributes?.device_class === deviceClass,
    );
  }

  private _isActive(domain: string, stateObj?: HassEntity): boolean {
    const state = stateObj?.state;
    if (!state || UNAVAILABLE.has(state)) return false;
    switch (domain) {
      case "climate":
        return state !== "off";
      case "media_player":
        return state === "playing" || state === "paused" || state === "buffering" || state === "on";
      case "cover":
        return state === "open" || (stateObj?.attributes?.current_position ?? 0) > 0;
      case "vacuum":
        return state === "cleaning" || state === "returning";
      case "lock":
        // Unlocked is the state worth showing, not the resting one.
        return state === "unlocked" || state === "open";
      default:
        return state === "on";
    }
  }

  // ---- badges --------------------------------------------------------------

  /**
   * What the tile says under its name.
   *
   * With more than one device the useful answer is how many are on; with
   * exactly one it is what that one is doing, which is the whole point of the
   * card over a row of on/off buttons.
   */
  private _badge(
    domain: string,
    entities: string[],
    live: string[],
    activeCount: number,
    mode: "auto" | "count" | "state" | "none" = "auto",
  ): string {
    if (mode === "none") return "";
    if (mode === "count" || (mode === "auto" && entities.length > 1)) {
      return `${activeCount}/${entities.length}`;
    }
    const stateObj = this.hass?.states[live[0]];
    if (!stateObj) return "—";
    return this._singleBadge(domain, stateObj);
  }

  private _singleBadge(domain: string, stateObj: HassEntity): string {
    const state = stateObj.state;
    const attrs = stateObj.attributes ?? {};
    const off = this._t("room_state_off");

    switch (domain) {
      case "fan": {
        if (state !== "on") return off;
        const preset = attrs.preset_mode as string | undefined;
        if (preset) return preset;
        const percentage = attrs.percentage as number | undefined;
        const step = attrs.percentage_step as number | undefined;
        if (percentage === undefined) return this._t("room_state_on");
        if (step && step > 0 && step < 100) {
          return this._t("room_fan_step").replace("{n}", String(Math.round(percentage / step)));
        }
        return `${Math.round(percentage)} %`;
      }
      case "humidifier": {
        if (state !== "on") return off;
        const target = attrs.humidity as number | undefined;
        return target === undefined ? this._t("room_state_on") : `${Math.round(target)} %`;
      }
      case "climate": {
        if (state === "off") return off;
        const target = attrs.temperature as number | undefined;
        const mode = localize(state as TranslationKey, this._language);
        const modeLabel = mode === state ? state : mode;
        return target === undefined
          ? modeLabel
          : `${formatNumber(this._language, target, { maximumFractionDigits: 1 })}°`;
      }
      case "media_player": {
        if (state === "off" || state === "standby") return off;
        if (state === "idle") return this._t("room_state_idle");
        const title = (attrs.media_title as string | undefined) ?? (attrs.source as string | undefined);
        if (!title) return this._t("room_state_on");
        return title.length > 16 ? `${title.slice(0, 15)}…` : title;
      }
      case "cover": {
        const position = attrs.current_position as number | undefined;
        if (state === "closed" || position === 0) return this._t("room_state_closed");
        if (position !== undefined && position < 100) return `${Math.round(position)} %`;
        return localize("open", this._language);
      }
      case "vacuum": {
        const label = localize(state as TranslationKey, this._language);
        return label === state ? state : label;
      }
      case "lock":
        return state === "locked"
          ? this._t("room_state_locked")
          : this._t("room_state_unlocked");
      default:
        return state === "on" ? this._t("room_state_on") : off;
    }
  }

  // ---- presence ------------------------------------------------------------

  private _presenceEntity(): string | undefined {
    const cfg = this._config;
    if (!cfg) return undefined;
    if (cfg.presence_entity) return cfg.presence_entity;
    return this._areaEntities.find(
      (id) =>
        id.startsWith("binary_sensor.") &&
        PRESENCE_CLASSES.has(this.hass?.states[id]?.attributes?.device_class as string),
    );
  }

  private _occupied(): boolean {
    const entity = this._presenceEntity();
    if (!entity) return false;
    return this.hass?.states[entity]?.state === "on";
  }

  // ---- sensor chips --------------------------------------------------------

  private _findSensor(deviceClass: string): string | undefined {
    return this._areaEntities.find(
      (id) =>
        id.startsWith("sensor.") &&
        this.hass?.states[id]?.attributes?.device_class === deviceClass,
    );
  }

  private _chipFor(entityId: string | undefined, icon: string, color?: string): Chip | undefined {
    if (!entityId) return undefined;
    const stateObj = this.hass?.states[entityId];
    if (!stateObj || UNAVAILABLE.has(stateObj.state)) return undefined;
    const unit = stateObj.attributes?.unit_of_measurement as string | undefined;
    const numeric = parseFloat(stateObj.state);
    const value = Number.isFinite(numeric)
      ? formatNumber(this._language, numeric, { maximumFractionDigits: 1 })
      : stateObj.state;
    return { key: entityId, entity: entityId, icon, text: unit ? `${value} ${unit}` : value, color };
  }

  private _chips(): Chip[] {
    const cfg = this._config;
    if (!cfg || cfg.show_sensors === false) return [];
    const area = this.hass && cfg.area ? areaInfo(this.hass, cfg.area) : undefined;

    const chips: Chip[] = [];
    // HA's own area settings name a temperature and humidity entity; they are a
    // deliberate choice and beat anything this card could guess.
    const temperature =
      cfg.temperature_entity ?? area?.temperatureEntity ?? this._findSensor("temperature");
    const humidity = cfg.humidity_entity ?? area?.humidityEntity ?? this._findSensor("humidity");
    const powerList = cfg.power_entities ?? [];
    const power = cfg.power_entity ?? this._findSensor("power");

    const tempChip = this._chipFor(temperature, "mdi:thermometer");
    if (tempChip) chips.push(tempChip);
    const humChip = this._chipFor(humidity, "mdi:water-percent");
    if (humChip) chips.push(humChip);

    const threshold = cfg.power_threshold ?? ROOM_POWER_THRESHOLD;
    if (powerList.length) {
      // A room's consumption is usually the sum of its plugs, not one meter —
      // and picking the first power sensor in an area gets that wrong loudly
      // when the area also holds a mains channel. Unavailable readings are
      // skipped rather than counted as zero, so a flat battery on one plug does
      // not quietly shrink the total.
      let sum = 0;
      let any = false;
      for (const id of powerList) {
        const watts = parseFloat(this.hass?.states[id]?.state ?? "");
        if (!Number.isFinite(watts)) continue;
        sum += watts;
        any = true;
      }
      if (any && sum > threshold) {
        chips.push({
          key: "power-sum",
          icon: "mdi:flash",
          text: `${formatNumber(this.hass?.language ?? "en", sum, {
            maximumFractionDigits: sum >= 100 ? 0 : 1,
          })} W`,
          color: "#f0a24a",
        });
      }
    } else if (power) {
      const watts = parseFloat(this.hass?.states[power]?.state ?? "");
      // A room drawing 0.4W is a room drawing nothing, and a chip saying so
      // costs a row on every card that has a plug in it.
      if (Number.isFinite(watts) && watts > threshold) {
        const chip = this._chipFor(power, "mdi:flash", "#f0a24a");
        if (chip) chips.push(chip);
      }
    }

    const windows = this._windowChip();
    if (windows) chips.push(windows);
    const doors = this._doorChip();
    if (doors) chips.push(doors);

    for (const id of cfg.extra_sensors ?? []) {
      const chip = this._chipFor(id, "mdi:gauge");
      if (chip) chips.push(chip);
    }
    return chips;
  }

  private _windowEntities(): string[] {
    const cfg = this._config;
    if (!cfg || cfg.show_windows === false) return [];
    // Anything listed as a door is counted there instead, so a contact never
    // lands in both chips.
    const doors = new Set(cfg.door_entities ?? []);
    if (cfg.window_entities?.length) {
      return cfg.window_entities.filter((id) => !doors.has(id));
    }
    return this._areaEntities.filter(
      (id) =>
        id.startsWith("binary_sensor.") &&
        !doors.has(id) &&
        OPENING_CLASSES.has(this.hass?.states[id]?.attributes?.device_class as string),
    );
  }

  /**
   * The same count for the contacts that are not windows.
   *
   * A separate chip rather than a separate colour: a door standing open and a
   * window standing open are different facts, and a room card that adds them
   * together answers neither question. Only ever from an explicit list —
   * Home Assistant calls almost every contact sensor a `door`, so there is
   * nothing here to discover.
   */
  private _doorChip(): Chip | undefined {
    const cfg = this._config;
    if (!cfg || cfg.show_windows === false) return undefined;
    const entities = cfg.door_entities ?? [];
    const live = entities.filter(
      (id) => !UNAVAILABLE.has(this.hass?.states[id]?.state ?? "unavailable"),
    );
    if (live.length === 0) return undefined;
    const open = live.filter((id) => this.hass?.states[id]?.state === "on");
    const single = live.length === 1 ? live[0] : undefined;
    if (open.length === 0) {
      return {
        key: "doors",
        entity: single,
        icon: "mdi:door-closed",
        text: this._t("room_doors_closed"),
      };
    }
    return {
      key: "doors",
      entity: single,
      icon: "mdi:door-open",
      text:
        live.length === 1
          ? this._t("room_door_open")
          : this._t("room_doors_open").replace("{n}", String(open.length)),
      color: PALETTE_WARN,
    };
  }

  /**
   * How many ways into the room stand open.
   *
   * Shown whenever the room has such a sensor at all, closed included: "all
   * shut" is the half of the answer you go looking for on the way out of the
   * house, and a chip that only ever appears when something is wrong cannot
   * tell you that.
   */
  private _windowChip(): Chip | undefined {
    const entities = this._windowEntities();
    const live = entities.filter(
      (id) => !UNAVAILABLE.has(this.hass?.states[id]?.state ?? "unavailable"),
    );
    if (live.length === 0) return undefined;

    const open = live.filter((id) => this.hass?.states[id]?.state === "on");
    // One sensor has one history to show; several have no single answer.
    const single = live.length === 1 ? live[0] : undefined;
    if (open.length === 0) {
      return {
        key: "windows",
        entity: single,
        icon: "mdi:window-closed-variant",
        text: this._t("room_windows_closed"),
      };
    }
    return {
      key: "windows",
      entity: single,
      icon: "mdi:window-open-variant",
      text:
        live.length === 1
          ? this._t("room_window_open")
          : this._t("room_windows_open").replace("{n}", String(open.length)),
      color: PALETTE_WARN,
    };
  }

  // ---- interaction ---------------------------------------------------------

  private _toggleCategory(category: Category): void {
    if (!this.hass) return;
    if (category.override?.tap_action) {
      handleAction(this, this.hass, category.override.tap_action, category.live[0]);
      return;
    }
    if (category.def.toggle === "none" || category.live.length === 0) {
      this._moreInfo(category.live[0] ?? category.entities[0]);
      return;
    }
    const domain = category.def.toggle === "cover" ? "cover" : "homeassistant";
    // Every live entity of the category, so one tap does what the tile shows.
    this.hass.callService(domain, "toggle", { entity_id: category.live });
  }

  private _moreInfo(entityId?: string): void {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      }),
    );
  }

  private _openDetail(category: Category): void {
    const path = this._config?.detail_path;
    if (path) {
      window.history.pushState(null, "", path);
      this.dispatchEvent(
        new CustomEvent("location-changed", {
          bubbles: true,
          composed: true,
          detail: { replace: false },
        }),
      );
      return;
    }
    this._moreInfo(category.live[0] ?? category.entities[0]);
  }

  private _onTilePointerDown(category: Category): void {
    this._held = false;
    window.clearTimeout(this._holdTimer);
    this._holdTimer = window.setTimeout(() => {
      this._held = true;
      this._openDetail(category);
    }, ROOM_HOLD_MS);
  }

  private _onTilePointerUp(): void {
    window.clearTimeout(this._holdTimer);
  }

  private _onTileClick(category: Category, e: Event): void {
    e.stopPropagation();
    window.clearTimeout(this._holdTimer);
    // A hold has already opened the detail view; letting the click through
    // would toggle the category on the way back out of it.
    if (this._held) {
      this._held = false;
      return;
    }
    // With several devices behind one tile, switching all of them is rarely
    // what the tap meant: a room's four lights are four decisions, not one.
    // So the tile opens a picker instead, unless the config says otherwise or
    // there is only one device to pick.
    if (
      !category.override?.tap_action &&
      category.def.toggle !== "none" &&
      category.live.length > 1 &&
      (this._config?.category_tap ?? "list") === "list"
    ) {
      window.clearTimeout(this._sheetCloseTimer);
      this._sheetClosing = false;
      this._sheet = category.domain;
      return;
    }
    this._toggleCategory(category);
  }

  // ---- device picker -------------------------------------------------------

  private _closeSheet = (): void => {
    // Without motion there is nothing to wait for, and holding the sheet in the
    // DOM for a fifth of a second would just feel unresponsive.
    if (!shouldAnimate(this._config?.animation)) {
      this._sheet = undefined;
      return;
    }
    this._sheetClosing = true;
    window.clearTimeout(this._sheetCloseTimer);
    this._sheetCloseTimer = window.setTimeout(() => {
      this._sheet = undefined;
      this._sheetClosing = false;
    }, ROOM_SHEET_MS);
  };

  private _onSheetKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      this._closeSheet();
    }
  };

  private _toggleOne(category: Category, entityId: string): void {
    if (!this.hass) return;
    const domain = category.def.toggle === "cover" ? "cover" : "homeassistant";
    this.hass.callService(domain, "toggle", { entity_id: entityId });
  }

  private _setAll(category: Category, on: boolean): void {
    if (!this.hass || category.live.length === 0) return;
    const domain = category.def.toggle === "cover" ? "cover" : "homeassistant";
    const service = category.def.toggle === "cover" ? (on ? "open_cover" : "close_cover") : on ? "turn_on" : "turn_off";
    this.hass.callService(domain, service, { entity_id: category.live });
  }

  private _entityName(entityId: string): string {
    const stateObj = this.hass?.states[entityId];
    return (stateObj?.attributes?.friendly_name as string | undefined) ?? entityId;
  }

  private _renderSheet(categories: Category[]): TemplateResult | typeof nothing {
    const category = categories.find((c) => c.domain === this._sheet);
    if (!category) return nothing;

    const rowBackground = tintOn(this, "var(--primary-text-color)", undefined, ROOM_SHEET_ROW_TINT);
    const activeFill = fillColor(this, category.color, 3);

    return html`
      <div class="scrim ${this._sheetClosing ? "closing" : ""}" @click=${this._closeSheet}>
        <div
          class="sheet ${this._sheetClosing ? "closing" : ""}"
          role="dialog"
          aria-label=${category.name}
          tabindex="-1"
          @click=${(e: Event) => e.stopPropagation()}
          @keydown=${this._onSheetKey}
        >
          <div class="sheet-grip"></div>
          <div class="sheet-head">
            <span class="sheet-title">${category.name}</span>
            <button class="sheet-close" aria-label=${this._t("room_close")} @click=${this._closeSheet}>
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          <div class="sheet-list">
            ${category.entities.map((id, index) => {
              const stateObj = this.hass?.states[id];
              const dead = !stateObj || UNAVAILABLE.has(stateObj.state);
              const on = !dead && this._isActive(category.domain, stateObj);
              const wellBackground = on
                ? activeFill
                : tintOn(this, "var(--primary-text-color)", undefined, ROOM_TILE_ICON_TINT_IDLE);
              return html`
                <div
                  class="sheet-row ${dead ? "dead" : ""}"
                  style=${`background: ${rowBackground}; --row-index: ${index};`}
                  role=${dead ? nothing : "button"}
                  tabindex=${dead ? nothing : "0"}
                  aria-pressed=${dead ? nothing : String(on)}
                  @click=${dead ? nothing : () => this._toggleOne(category, id)}
                  @keydown=${dead ? nothing : activateOnKey(() => this._toggleOne(category, id))}
                >
                  <div
                    class="sheet-icon"
                    style=${`background: ${wellBackground}; color: ${
                      on
                        ? inkOn(wellBackground, this)
                        : foregroundOn("var(--primary-text-color)", wellBackground, 3, this)
                    };`}
                  >
                    <ha-icon icon=${category.icon}></ha-icon>
                  </div>
                  <span class="sheet-name" title=${this._entityName(id)}
                    >${this._entityName(id)}</span
                  >
                  <span
                    class="sheet-state"
                    style=${on ? `color: ${foregroundOn(category.color, rowBackground, 4.5, this)};` : ""}
                    >${dead ? "—" : this._singleBadge(category.domain, stateObj!)}</span
                  >
                  <button
                    class="sheet-info"
                    aria-label=${this._entityName(id)}
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this._moreInfo(id);
                    }}
                  >
                    <ha-icon icon="mdi:information-outline"></ha-icon>
                  </button>
                </div>
              `;
            })}
          </div>
          <div class="sheet-foot">
            <span class="sheet-hint">${this._t("room_pick_hint")}</span>
            <button class="sheet-action" @click=${() => this._setAll(category, false)}>
              ${this._t("room_all_off")}
            </button>
            <button class="sheet-action" @click=${() => this._setAll(category, true)}>
              ${this._t("room_all_on")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ---- rendering -----------------------------------------------------------

  private _renderChips(chips: Chip[]): TemplateResult | typeof nothing {
    if (chips.length === 0) return nothing;
    return html`
      <div class="chips">
        ${chips.map((chip) => {
          const color = chip.color ?? "var(--primary-text-color)";
          const background = tintOn(this, color, undefined, ROOM_CHIP_TINT);
          const style = `background: ${background}; color: ${foregroundOn(color, background, 4.5, this)};`;
          const body = html`<ha-icon icon=${chip.icon}></ha-icon><span>${chip.text}</span>`;
          // A chip states a reading; the question it provokes is "since when".
          // Where exactly one entity is behind it, tapping opens that entity's
          // own dialog, which is where Home Assistant keeps the graph.
          if (!chip.entity) return html`<div class="chip" style=${style}>${body}</div>`;
          const open = (event: Event) => {
            // The chips sit inside the card body; nothing above them should
            // also react to a tap meant for one chip.
            event.stopPropagation();
            this._moreInfo(chip.entity);
          };
          return html`
            <div
              class="chip tappable"
              style=${style}
              role="button"
              tabindex="0"
              aria-label=${chip.text}
              @click=${open}
              @keydown=${activateOnKey(open)}
            >
              ${body}
            </div>
          `;
        })}
      </div>
    `;
  }

  private _renderFoldArrow(accent: string): TemplateResult {
    const background = tintOn(this, accent, undefined, ROOM_ARROW_TINT);
    return html`
      <div
        class="fold ${this._folded ? "folded" : ""}"
        style=${`background: ${background}; color: ${foregroundOn(accent, background, 3, this)};`}
        aria-hidden="true"
      >
        <ha-icon icon="mdi:chevron-down"></ha-icon>
      </div>
    `;
  }

  private _renderTile(category: Category): TemplateResult {
    const dead = category.live.length === 0;
    const background = category.active
      ? tintOn(this, category.color, undefined, ROOM_TILE_TINT_ACTIVE)
      : tintOn(this, "var(--primary-text-color)", undefined, ROOM_TILE_TINT_IDLE);

    // An active category gets a solid well with chosen ink; an idle one a
    // neutral wash, so "on" is legible from across the room and "off" is quiet.
    const wellBackground = category.active
      ? fillColor(this, category.color, 3)
      : tintOn(this, "var(--primary-text-color)", undefined, ROOM_TILE_ICON_TINT_IDLE);
    const wellInk = category.active
      ? inkOn(wellBackground, this)
      : foregroundOn("var(--primary-text-color)", wellBackground, 3, this);

    return html`
      <div
        class="tile ${category.active ? "on" : ""} ${dead ? "dead" : ""}"
        style=${`background: ${background};`}
        role=${dead ? nothing : "button"}
        tabindex=${dead ? nothing : "0"}
        aria-label=${`${category.name}: ${category.badge}`}
        @pointerdown=${dead ? nothing : () => this._onTilePointerDown(category)}
        @pointerup=${dead ? nothing : () => this._onTilePointerUp()}
        @pointercancel=${dead ? nothing : () => this._onTilePointerUp()}
        @click=${dead ? nothing : (e: Event) => this._onTileClick(category, e)}
        @keydown=${dead
          ? nothing
          : activateOnKey(() => this._toggleCategory(category))}
      >
        <div class="well" style=${`background: ${wellBackground}; color: ${wellInk};`}>
          <ha-icon icon=${category.icon}></ha-icon>
        </div>
        <div class="tile-name" title=${category.name}>${category.name}</div>
        ${category.badge === "" ? nothing : html`<div
          class="tile-badge"
          style=${category.active
            ? `color: ${foregroundOn(category.color, background, 4.5, this)};`
            : ""}
        >
          ${category.badge}
        </div>`}
      </div>
    `;
  }

  protected render(): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;

    const area = areaInfo(this.hass, cfg.area);
    const categories = this._categories();
    const chips = this._chips();
    const occupied = this._occupied();
    const presenceStyle = cfg.presence_style ?? "tint";
    const showPresence = presenceStyle !== "none" && !!this._presenceEntity();
    const tinted = occupied && showPresence && presenceStyle === "tint";

    const accent = resolveThemeColor(cfg.accent_color ?? DEFAULT_ROOM_ACCENT);
    const presenceColor = ROOM_PRESENCE_COLOR;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);

    const name = cfg.name ?? area?.name ?? cfg.area;
    const icon = cfg.icon ?? area?.icon ?? guessRoomIcon(name);
    // Manual leaves the body to the configured cards, so the summary line has
    // to describe those rather than the area's registry entries.
    const manual = this._manual;
    const activeDevices = manual
      ? this._manualActiveCount()
      : categories.reduce((sum, c) => sum + c.activeCount, 0);

    const countText =
      activeDevices === 0
        ? this._t("room_all_off")
        : activeDevices === 1
          ? this._t("room_device_active")
          : this._t("room_devices_active").replace("{n}", String(activeDevices));
    const subtitle =
      occupied && showPresence ? `${this._t("room_occupied")} · ${countText}` : countText;

    const surface = tinted
      ? tintOn(this, presenceColor, undefined, ROOM_PRESENCE_TINT)
      : "";
    const glass = cfg.glass_background !== false;
    const painted = cardBackgroundCss
      ? cardBackgroundCss
      : surface
        ? glass
          ? `color-mix(in srgb, ${surface} 55%, transparent)`
          : surface
        : "";
    const inkSurface = cardBackgroundCss || surface || "var(--ha-card-background, var(--card-background-color))";

    const headerBackground = tintOn(this, occupied && showPresence ? presenceColor : accent, undefined, 20);

    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "room-dot": fillColor(this, presenceColor, 3),
      "room-subtitle":
        occupied && showPresence
          ? foregroundOn(presenceColor, inkSurface, 4.5, this)
          : "var(--m3p-secondary-text, var(--secondary-text-color))",
      "room-action-bg": tintOn(this, accent, undefined, 12),
      "room-action-ink": foregroundOn(accent, tintOn(this, accent, undefined, 12), 4.5, this),
      "room-border": tinted
        ? tintOn(this, presenceColor, undefined, ROOM_PRESENCE_BORDER)
        : undefined,
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_ROOM_RADIUS, cfg.corners);

    // A configured `tap_action` takes the header over from the fold. It is the
    // presence of the option that decides, not whether it does anything:
    // `action: none` is how you say the header should be inert, and it would
    // not be inert if an unusable action quietly handed the fold back.
    const headerAction = cfg.tap_action;
    const headerTappable = headerAction ? isActionable(headerAction) : !!cfg.collapsible;
    // The chevron is a promise that the header folds the card. Once an action
    // is bound to the header that stops being true, so the chevron goes rather
    // than sitting there pointing at something that no longer happens.
    const showFoldArrow = !!cfg.collapsible && !headerAction;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${
            shouldAnimate(cfg.animation) ? "" : "no-animations"
          } ${tinted ? "occupied" : ""}"
          style=${`border-radius: ${radius};${painted ? ` background: ${painted};` : ""}`}
        >
          <div
            class="header ${headerTappable ? "tappable" : ""}"
            role=${headerTappable ? "button" : nothing}
            tabindex=${headerTappable ? "0" : nothing}
            aria-expanded=${showFoldArrow ? String(!this._folded) : nothing}
            @click=${headerTappable ? this._onHeaderTap : nothing}
            @keydown=${headerTappable ? activateOnKey(this._onHeaderTap) : nothing}
          >
            <div
              class="room-icon"
              style=${`background: ${headerBackground}; color: ${foregroundOn(occupied && showPresence ? presenceColor : accent, headerBackground, 3, this)};`}
            >
              <ha-icon icon=${icon}></ha-icon>
              ${occupied && showPresence ? html`<span class="dot"></span>` : nothing}
            </div>
            <div class="text">
              <div class="name" title=${name}>${name}</div>
              <div class="subtitle">${subtitle}</div>
            </div>
            ${showFoldArrow ? this._renderFoldArrow(accent) : nothing}
          </div>
          <div class="body">
            <div class="body-inner">
              ${this._renderChips(chips)}
              ${manual
                ? nothing
                : categories.length
                  ? html`<div class="grid">${categories.map((c) => this._renderTile(c))}</div>`
                  : html`<div class="empty">${this._t("room_empty")}</div>`}
              ${this._cards.length
                ? html`<div
                    class="cards"
                    style=${`--room-card-columns: ${
                      cfg.cards_columns ?? DEFAULT_ROOM_CARD_COLUMNS
                    };`}
                  >
                    ${this._cards}
                  </div>`
                : manual
                  ? html`<div class="empty">${this._t("room_manual_empty")}</div>`
                  : nothing}
            </div>
          </div>
          ${this._sheet ? this._renderSheet(categories) : nothing}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      /* No gap between the header and the body: the space above the chips is
         padding *inside* the folding box instead, so it collapses with it. A
         flex gap does not — it applies between items whatever their size — so
         switching it to 0 on fold made everything below the header jump up
         12px the instant the fold began, while the height was still animating.
         That jump is what read as broken. */
      .card-inner {
        gap: 0;
        position: relative;
      }

      /* The nested cards stack like they would in a section, with the same
         gap the tiles use between rows. They bring their own backgrounds, so
         the room card adds nothing but the spacing. */
      /* A grid rather than a column: a row of buttons in a room card is the
         point of the thing, and one full-width button per row wastes the width
         the card already has. Entries that do not fit wrap, so a narrow card on
         a phone falls back to a single column on its own. */
      .cards {
        display: grid;
        grid-template-columns: repeat(
          var(--room-card-columns, 2),
          minmax(0, 1fr)
        );
        gap: 8px;
      }

      /* Only when both are present: tiles above, cards below. */
      .grid + .cards {
        margin-top: 8px;
      }

      .card-inner.occupied {
        border-color: var(--room-border, rgba(100, 100, 100, 0.25));
      }

      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .room-icon {
        position: relative;
        flex-shrink: 0;
        width: ${ROOM_HEADER_ICON}px;
        height: ${ROOM_HEADER_ICON}px;
        border-radius: ${ROOM_HEADER_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        --mdc-icon-size: 28px;
      }

      .dot {
        position: absolute;
        top: -2px;
        right: -2px;
        width: ${ROOM_DOT}px;
        height: ${ROOM_DOT}px;
        border-radius: 50%;
        background: var(--room-dot);
        animation: room-pulse ${unsafeCSS(ROOM_DOT_PULSE_MS)}ms ${EASING} infinite;
      }

      @keyframes room-pulse {
        0%,
        100% {
          transform: scale(1);
          opacity: 1;
        }
        50% {
          transform: scale(1.35);
          opacity: 0.55;
        }
      }

      .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .name {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .subtitle {
        font-size: 12px;
        color: var(--room-subtitle);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .chip {
        height: ${ROOM_CHIP_HEIGHT}px;
        border-radius: ${ROOM_CHIP_RADIUS}px;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        --mdc-icon-size: 15px;
      }

      /* A chip that opens something says so by answering a press. The ones
         with no single entity behind them — a summed power reading, a window
         chip over several sensors — stay plain, so a press that does nothing
         never looks like one that failed. */
      .chip.tappable {
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 120ms ease-out;
      }

      .chip.tappable:active {
        transform: scale(0.94);
      }

      .no-animations .chip.tappable {
        transition: none;
      }

      .chip.tappable:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(${ROOM_TILE_MIN}px, 1fr));
        gap: ${ROOM_TILE_GAP}px;
      }

      .tile {
        min-width: 0;
        padding: 10px 9px;
        border-radius: ${ROOM_TILE_RADIUS}px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition: border-radius ${unsafeCSS(ROOM_TILE_MORPH_MS)}ms ${EASING};
      }

      .tile[role="button"] {
        cursor: pointer;
      }

      .tile[role="button"]:active {
        border-radius: ${ROOM_TILE_RADIUS_ACTIVE}px;
      }

      .tile:focus-visible {
        outline: 2px solid var(--m3p-text, var(--primary-text-color));
        outline-offset: -2px;
      }

      .tile.dead {
        opacity: 0.4;
      }

      .well {
        width: ${ROOM_TILE_ICON}px;
        height: ${ROOM_TILE_ICON}px;
        border-radius: ${ROOM_TILE_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        --mdc-icon-size: 20px;
      }

      .tile-name {
        font-size: 11px;
        font-weight: 700;
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tile-badge {
        font-size: 11px;
        opacity: 0.6;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tile.on .tile-badge {
        opacity: 1;
        font-weight: 600;
      }

      .empty {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }



      /* ---- folding ---- */

      .header.tappable {
        cursor: pointer;
      }

      .header:focus-visible {
        outline: 2px solid var(--m3p-text, var(--primary-text-color));
        outline-offset: 2px;
        border-radius: 8px;
      }

      .fold {
        flex-shrink: 0;
        width: ${ROOM_ARROW}px;
        height: ${ROOM_ARROW}px;
        border-radius: ${ROOM_ARROW_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        --mdc-icon-size: 18px;
        transition: border-radius ${unsafeCSS(ROOM_FOLD_MS)}ms ${EASING};
      }

      .fold ha-icon {
        transition: transform ${unsafeCSS(ROOM_FOLD_MS)}ms ${EASING};
      }

      .fold.folded {
        border-radius: ${ROOM_ARROW_RADIUS_FOLDED}px;
      }

      .fold.folded ha-icon {
        transform: rotate(-90deg);
      }

      /* The height is set in pixels from _applyFold; this only says how it
         moves. Nothing here can be a percentage or a keyword: the card's height
         comes from its content, so there is no definite height for CSS alone to
         animate against. */
      .body {
        overflow: hidden;
        min-height: 0;
        transition: height ${unsafeCSS(ROOM_FOLD_MS)}ms ${EASING};
      }

      .body-inner {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 12px;
      }

      .no-animations .body,
      .no-animations .fold,
      .no-animations .fold ha-icon {
        transition: none;
      }

      /* ---- device picker ---- */

      .scrim {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding: 8px;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        animation: sheet-fade ${unsafeCSS(ROOM_SHEET_MS)}ms ${EASING} both;
      }

      .scrim.closing {
        animation: sheet-fade ${unsafeCSS(ROOM_SHEET_MS)}ms ${EASING} reverse both;
      }

      .sheet {
        width: 100%;
        /* Bounded by the card, not the viewport: 60vh let a five-device list
           grow 160px taller than the card it lives in, and since the card
           clips its overflow the sheet's whole header — the close button with
           it — was cut off above the top edge. A picker you cannot close is
           worse than no picker. */
        max-height: min(100%, ${ROOM_SHEET_MAX_HEIGHT}vh);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        border-radius: ${ROOM_SHEET_RADIUS}px;
        /* Two layers, for the same reason the calendar card's dialog needs
           them: the theme's card colour is translucent under a glass theme, by
           design, and a see-through panel over the tiles it rose out of is
           unreadable. The colour is kept as an image over an opaque base. */
        background-color: var(--primary-background-color, #1c1c1c);
        background-image: linear-gradient(
          var(--ha-card-background, var(--card-background-color, transparent)),
          var(--ha-card-background, var(--card-background-color, transparent))
        );
        transform-origin: bottom center;
        animation: sheet-rise ${unsafeCSS(ROOM_SHEET_MS)}ms ${EASING} both;
      }

      .sheet.closing {
        animation: sheet-rise ${unsafeCSS(ROOM_SHEET_MS)}ms ${EASING} reverse both;
      }

      @keyframes sheet-fade {
        from {
          opacity: 0;
        }
      }

      @keyframes sheet-rise {
        from {
          /* Grows out of the tile rather than sliding in from nowhere: the
             scale is what ties the sheet to the thing that was tapped. */
          transform: translateY(16px) scale(0.96);
          opacity: 0;
        }
      }

      /* The rows arrive one after another, which reads as a list assembling
         itself instead of a block appearing. 26ms is short enough that the
         whole run is over before the sheet has settled. */
      @keyframes sheet-row-in {
        from {
          transform: translateY(10px);
          opacity: 0;
        }
      }

      .sheet-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .sheet-title {
        flex: 1;
        min-width: 0;
        font-size: 14px;
        font-weight: 700;
        color: var(--m3p-text, var(--primary-text-color));
      }

      .sheet-close,
      .sheet-info {
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 15px;
        background: transparent;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        --mdc-icon-size: 18px;
      }

      .sheet-close {
        background: var(--room-action-bg);
        color: var(--room-action-ink);
        transition:
          transform ${unsafeCSS(ROOM_SHEET_MS)}ms ${EASING},
          border-radius ${unsafeCSS(ROOM_SHEET_MS)}ms ${EASING},
          opacity ${unsafeCSS(ROOM_SHEET_MS)}ms ${EASING};
      }

      /* The circle squares off under the finger, the house idiom for a press. */
      .sheet-close:active {
        border-radius: 9px;
        transform: scale(0.9);
      }

      /* On the way out it turns a quarter and leaves with the sheet, so the
         thing that was pressed is visibly the thing that closed it. */
      .sheet.closing .sheet-close {
        transform: rotate(90deg) scale(0.8);
        border-radius: 9px;
        opacity: 0;
      }

      .sheet-close:focus-visible,
      .sheet-info:focus-visible {
        outline: 2px solid var(--m3p-text, var(--primary-text-color));
        outline-offset: 2px;
      }

      /* The grab bar says "sheet" before anything is read, and gives the
         header a second, wider target on the way to the close button. */
      .sheet-grip {
        align-self: center;
        width: 32px;
        height: 4px;
        border-radius: 2px;
        background: var(--m3h-grip, currentColor);
        opacity: 0.25;
        flex-shrink: 0;
      }

      .sheet-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
        /* Without this a flex child refuses to shrink below its content, so
           the list pushes the sheet past its max-height instead of scrolling —
           which is how the header ended up outside the card. */
        min-height: 0;
        overscroll-behavior: contain;
      }

      .sheet-row {
        flex-shrink: 0;
        height: ${ROOM_SHEET_ROW_HEIGHT}px;
        border-radius: ${ROOM_SHEET_ROW_RADIUS}px;
        padding: 0 6px 0 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        transition: border-radius ${unsafeCSS(ROOM_TILE_MORPH_MS)}ms ${EASING};
        animation: sheet-row-in ${unsafeCSS(ROOM_SHEET_MS)}ms ${EASING} both;
        animation-delay: calc(var(--row-index, 0) * 26ms);
      }

      /* On the way out the rows leave together — staggering an exit only makes
         the dismissal feel slow. */
      .sheet.closing .sheet-row {
        animation: none;
      }

      .sheet-row[role="button"] {
        cursor: pointer;
      }

      .sheet-row[role="button"]:active {
        border-radius: ${ROOM_TILE_RADIUS_ACTIVE}px;
      }

      .sheet-row:focus-visible {
        outline: 2px solid var(--m3p-text, var(--primary-text-color));
        outline-offset: -2px;
      }

      .sheet-row.dead {
        opacity: 0.4;
      }

      .sheet-icon {
        flex-shrink: 0;
        width: ${ROOM_SHEET_ICON}px;
        height: ${ROOM_SHEET_ICON}px;
        border-radius: ${ROOM_SHEET_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        --mdc-icon-size: 18px;
      }

      .sheet-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .sheet-state {
        flex-shrink: 0;
        font-size: 12px;
        font-weight: 700;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .sheet-foot {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .sheet-hint {
        flex: 1;
        min-width: 0;
        font-size: 11px;
        opacity: 0.5;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .sheet-action {
        flex-shrink: 0;
        height: 32px;
        padding: 0 14px;
        border: none;
        border-radius: 16px;
        background: var(--room-action-bg);
        color: var(--room-action-ink);
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
      }

      .no-animations .scrim,
      .no-animations .sheet,
      .no-animations .sheet-row {
        animation: none;
      }

      .no-animations .sheet-close {
        transition: none;
      }

      .no-animations .dot {
        animation: none;
      }

      .no-animations .tile {
        transition: none;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-room-card": M3RoomCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-room-card",
  name: "M3 Room Card",
  description:
    "Raum-Zentrale: erkennt alle Gerätetypen im Bereich, zeigt Klimawerte, Präsenz und Schnellschalter.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
