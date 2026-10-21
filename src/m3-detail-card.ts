import { LitElement, html, css, nothing, svg, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DetailStat, HomeAssistant, HassEntity, LovelaceCard, LovelaceCardEditor, M3DetailCardConfig } from "./types";
import {
  CARD_VERSION,
  DEFAULT_DETAIL_ICON,
  DETAIL_BUTTON_RADIUS_PRESSED,
  DETAIL_BUTTON_SIZE,
  DETAIL_CHART_HALO,
  DETAIL_CHART_HEIGHT,
  DETAIL_CHART_PADDING,
  DETAIL_CLOSE_RADIUS,
  DETAIL_DEFAULT_ACCENT,
  DETAIL_DEVICE_CLASS_COLORS,
  DETAIL_DEVICE_CLASS_ICONS,
  DETAIL_BINARY_CLASS_COLORS,
  DETAIL_BINARY_CLASS_ICONS,
  DETAIL_DOMAIN_COLORS,
  DETAIL_DOMAIN_ICONS,
  DETAIL_MAX_SHARES,
  DETAIL_DEFAULT_MAX_RELATED,
  DETAIL_RELATED_ICON_RADIUS,
  DETAIL_RELATED_ICON_SIZE,
  DETAIL_RELATED_ROW_HEIGHT,
  DETAIL_RELATED_ROW_RADIUS,
  DETAIL_SWAP_MS,
  DETAIL_ZOOM_MS,
  DETAIL_OPEN_STORAGE_PREFIX,
  DETAIL_TOGGLE_CONFIRM_MS,
  DETAIL_BIG_TOGGLE_WIDTH,
  DETAIL_BIG_TOGGLE_HEIGHT,
  DETAIL_BIG_TOGGLE_RADIUS,
  DETAIL_DETAILS_MS,
  DETAIL_WIPE_MS,
  DETAIL_TREND_MORPH_MS,
  DETAIL_TOOLTIP_LINGER_MS,
  DETAIL_ICON_RADIUS,
  DETAIL_ICON_SIZE,
  DETAIL_MIN_ALT_COLOR,
  DETAIL_MIN_COLOR,
  DETAIL_SETTINGS_RADIUS,
  DETAIL_TICK_MS,
  DETAIL_DEFAULT_RANGES,
  DETAIL_PILL_HEIGHT,
  DETAIL_PILL_RADIUS,
  DETAIL_PILL_RADIUS_ACTIVE,
  DETAIL_RANGE_STORAGE_PREFIX,
  DETAIL_SEGMENT_PADDING,
  DETAIL_SEGMENT_RADIUS,
  DETAIL_TILE_PADDING,
  DETAIL_TILE_RADIUS,
  DETAIL_TREND_DOWN_COLOR,
  DETAIL_TREND_HEIGHT,
  DETAIL_TREND_RADIUS,
  DETAIL_TREND_UP_COLOR,
  resolveCornerRadius,
} from "./const";
import { RADIUS } from "./shared/tokens";
import {
  buildCssVars,
  fillColor,
  foregroundColor,
  inkOn,
  resolveCommonColors,
  resolveThemeColor,
  tintInk,
  tintOn,
} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { shouldAnimate, isReducedMotion, STANDARD_EASING } from "./shared/animation";
import { formatClock, formatNumber } from "./shared/formatting";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { openEntityDetail, openEntitySettings } from "./shared/entity-detail";
import {
  DETAIL_RANGE_MS,
  fetchEntitySeries,
  seriesExtremes,
  seriesStats,
  type DetailRange,
  type EntitySeries,
  type SeriesPoint,
} from "./shared/entity-history";
import { monotoneArea, monotonePath, niceTicks, tickDecimals, type XY } from "./shared/smooth-path";
import { defaultControlCard, detailKind, isTwoState, type DetailKind } from "./shared/detail-kind";
import {
  clipSegments,
  countChanges,
  subscribeStateTimeline,
  isMissingState,
  type StateSegment,
  startOfDay,
  stateShares,
  type StateTimeline,
} from "./shared/state-timeline";
import {
  detailStateStyles,
  renderPairTiles,
  renderShares,
  renderTimeline,
  stateColors,
  isActiveState,
} from "./shared/detail-states";
import { DetailCardController } from "./shared/detail-card";
import { deviceSiblings } from "./shared/ha-registry";
import { temperatureColor } from "./shared/temperature-color";
import { stopSwipe } from "./shared/swipe";
import type { PopupCardHandle } from "./shared/popup-card";

const EASING = unsafeCSS(STANDARD_EASING);

console.info(
  `%c M3-DETAIL-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

interface RegistryEntity {
  device_id?: string | null;
  area_id?: string | null;
  platform?: string;
  display_precision?: number | null;
}
interface RegistryDevice {
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
}
interface RegistryArea {
  name?: string;
}

const MISSING = new Set(["unavailable", "unknown", ""]);

/** The valued point closest in time to `t`, inside the window. */
function nearestValued(points: readonly SeriesPoint[], t: number, t0: number): SeriesPoint | undefined {
  let best: SeriesPoint | undefined;
  for (const p of points) {
    if (p.v === null || p.t < t0) continue;
    if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  }
  return best;
}

/**
 * One entity, large: its value, where it has been, and how far it moved.
 *
 * Usable on its own — on a dashboard, in browser_mod or bubble-card popups, in
 * the suite's `popup` with `mode: custom` — and it is what the detail sheet
 * (shared/detail-sheet.ts) shows when a card is set to `detail_mode: sheet`.
 * In the sheet it is handed a `closeHandler` and draws a close button.
 */
@customElement("m3-detail-card")
export class M3DetailCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  /** Set by the sheet. With it the card draws a close button and calls this. */
  @property({ attribute: false }) public closeHandler?: () => void | Promise<void>;

  @state() private _config?: M3DetailCardConfig;
  @state() private _series?: EntitySeries;
  /** Whether the folded "history and details" part is open, per entity. */
  @state() private _detailsOpen = false;
  /** Folding shut: the content is still there, animating, but the button already says closed. */
  @state() private _detailsClosing = false;
  /** A toggle sent and not yet confirmed by the entity: the state it asked for. */
  @state() private _pendingToggle?: { to: boolean; since: number };
  /** The period picked in this card, or remembered from the last time. */
  @state() private _picked?: DetailRange;
  private _seriesEntity?: string;
  @state() private _timeline?: StateTimeline;
  private _timelineEntity?: string;
  /** The embedded control card of a `control` view. */
  @state() private _control?: HTMLElement & PopupCardHandle;
  private readonly _controlCtl = new DetailCardController();
  /** Where the pointer is on the curve, as a time; the nearest reading is shown. */
  @state() private _hoverT?: number;
  /** "out" while the old entity fades, "in" for the first frame of the new one. */
  @state() private _swap?: "out" | "in";
  private _hoverTimer?: number;
  /** Ends the live history subscription of the timeline on screen. */
  private _timelineUnsub?: () => void;
  /** The period the timeline on screen was read for, to zoom from on a switch. */
  private _drawnTimeline?: { entity: string; range: DetailRange };
  /** The tiles' figures as they were before the render in progress. */
  private _tilesBefore?: string[];
  /** The trend chip as it was before the render in progress. */
  private _trendBefore?: { width: number; text: string };
  /** The previous period's curve, cloned for the cross-fade. */
  private _oldChart?: SVGSVGElement;
  private _swapTimer?: number;
  @state() private _chartWidth = 0;
  @state() private _now = Date.now();

  private _fetchKey = "";
  private _fetchSeq = 0;
  private _tick?: number;
  private _resize?: ResizeObserver;
  private _observed?: Element;

  public setConfig(config: M3DetailCardConfig): void {
    if (!config?.entity) throw new Error("m3-detail-card: `entity` is required");
    if (config.entity !== this._config?.entity) {
      this._picked = this._storedRange(config.entity);
      this._detailsOpen = this._storedDetailsOpen(config.entity);
      this._pendingToggle = undefined;
    }
    this._config = config;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-detail-card-editor");
    return document.createElement("m3-detail-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass?: HomeAssistant): M3DetailCardConfig {
    const entity =
      Object.keys(hass?.states ?? {}).find(
        (id) => id.startsWith("sensor.") && hass!.states[id].attributes?.state_class === "measurement",
      ) ?? "";
    return { type: "custom:m3-detail-card", entity };
  }

  /** The entity on screen, which a tap on a sibling changes. */
  public get entity(): string | undefined {
    return this._config?.entity;
  }

  /** Reads the history again — the sheet calls this each time it opens. */
  public refresh(): void {
    this._fetchKey = "";
    this._now = Date.now();
    this._maybeFetch();
  }

  public getCardSize(): number {
    return 5;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._now = Date.now();
    this._tick = window.setInterval(() => (this._now = Date.now()), DETAIL_TICK_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tick) clearInterval(this._tick);
    window.clearTimeout(this._hoverTimer);
    window.clearTimeout(this._swapTimer);
    this._timelineUnsub?.();
    this._timelineUnsub = undefined;
    // Back on the page, the next update subscribes again.
    this._fetchKey = "";
    this._resize?.disconnect();
    this._resize = undefined;
    this._observed = undefined;
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    // The embedded card reads more than this entity — a media card its
    // artwork, a climate card the sensors it was given — and decides for
    // itself what is worth a render. It gets every hass, whatever this card
    // decides about its own.
    if (changed.has("hass") && this._control) this._control.hass = this.hass;
    return hassChangeMatters(changed, this.hass, [this._config?.entity]);
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    // "Now" is otherwise moved on once a minute, for the relative times. A
    // change of state or a new history must be drawn against the real now:
    // against one up to a minute old, a change that just happened lay in the
    // future, outside the window, and the change counter did not move.
    if (changed.has("hass") || changed.has("_timeline") || changed.has("_series")) this._now = Date.now();
    // The curve about to be replaced by another period of the same entity is
    // kept as a picture, to fade out under the new one (see _wipeChart). It
    // has to be taken here: after the render it is gone.
    const previous = changed.get("_series") as EntitySeries | undefined;
    // The chip's size and words before this render, to move from (see
    // _morphTrend).
    const chip = this.renderRoot.querySelector<HTMLElement>(".trend");
    this._trendBefore = chip
      ? { width: chip.getBoundingClientRect().width, text: chip.querySelector(".trend-text")?.textContent ?? "" }
      : undefined;
    // And the tiles' figures, by position, for the same slide (_morphTiles).
    this._tilesBefore = [...this.renderRoot.querySelectorAll<HTMLElement>(".tile-value")].map(
      (el) => el.textContent?.trim() ?? "",
    );
    if (previous && this._series && previous.range !== this._series.range) {
      const svg = this.renderRoot.querySelector<SVGSVGElement>(".chart svg");
      this._oldChart = svg ? (svg.cloneNode(true) as SVGSVGElement) : undefined;
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("hass") || changed.has("_config")) {
      this._maybeFetch();
      this._syncControl();
      const st = this._config ? this.hass?.states[this._config.entity] : undefined;
      if (this._pendingToggle && st && (st.state === "on") === this._pendingToggle.to) this._pendingToggle = undefined;
    }
    this._observeChart();
    if (changed.has("_timeline")) this._zoomTimeline();
    if (changed.has("_series")) this._wipeChart();
    this._morphTrend();
    this._morphTiles();
  }

  /**
   * A new period's curve arrives: wipe it in.
   *
   * The old curve stays where it was and fades; the new one is uncovered from
   * left to right, the way time runs, so it reads as being drawn rather than
   * swapped. The axis labels fade in with it. The timeline zooms instead (see
   * _zoomTimeline): a bar of stretches has an obvious place for the old period
   * inside the new one, a curve with a new vertical scale does not.
   */
  /**
   * The trend chip changes its figure without jumping.
   *
   * Colour and the arrow's angle are CSS transitions. What CSS cannot do is
   * animate a width that follows its text, and "+8" becoming "−707" grew the
   * chip in one frame, so its old width is taken before the render and the
   * new one animated to from there. The figure itself slides up into place.
   */
  /**
   * A tile whose figure changed slides the new one up into place, as the
   * trend chip does. The tiles keep their width (it is the grid's), so there
   * is nothing to resize; colour is a transition in the stylesheet. Tiles are
   * matched by position, and a row that gained or lost a tile is left alone:
   * the figures moved to different tiles, and sliding them would say they
   * changed.
   */
  private _morphTiles(): void {
    const before = this._tilesBefore;
    this._tilesBefore = undefined;
    if (!before?.length || !shouldAnimate(this._config?.animation) || isReducedMotion()) return;
    const now = [...this.renderRoot.querySelectorAll<HTMLElement>(".tile-value")];
    if (now.length !== before.length) return;
    now.forEach((el, i) => {
      if ((el.textContent?.trim() ?? "") === before[i] || !el.animate) return;
      el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
        duration: DETAIL_TREND_MORPH_MS,
        easing: STANDARD_EASING,
        // One after another, left to right, a few frames apart: the row reads
        // as updating rather than flashing.
        delay: i * 40,
        fill: "backwards",
      });
    });
  }

  private _morphTrend(): void {
    const before = this._trendBefore;
    this._trendBefore = undefined;
    const chip = this.renderRoot.querySelector<HTMLElement>(".trend");
    const text = chip?.querySelector<HTMLElement>(".trend-text");
    if (!before || !chip || !text || text.textContent === before.text) return;
    if (!shouldAnimate(this._config?.animation) || isReducedMotion() || !chip.animate) return;
    const width = chip.getBoundingClientRect().width;
    const options = { duration: DETAIL_TREND_MORPH_MS, easing: STANDARD_EASING };
    if (Math.abs(width - before.width) > 0.5) {
      chip.animate([{ width: `${before.width}px` }, { width: `${width}px` }], options);
    }
    text.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], options);
  }

  private _wipeChart(): void {
    const old = this._oldChart;
    this._oldChart = undefined;
    if (!old || !shouldAnimate(this._config?.animation) || isReducedMotion()) return;
    const chart = this.renderRoot.querySelector<HTMLElement>(".chart");
    const svg = chart?.querySelector<SVGSVGElement>("svg");
    if (!chart || !svg?.animate) return;
    old.classList.add("ghost");
    chart.appendChild(old);
    old
      // Linear and as long as the wipe: the eased wipe uncovers most of the
      // width early, and an eased fade had the old curve gone while the last
      // stretch on the right was still covered, leaving it briefly empty.
      .animate([{ opacity: 0.4 }, { opacity: 0 }], { duration: DETAIL_WIPE_MS, easing: "linear", fill: "forwards" })
      .finished.then(() => old.remove(), () => old.remove());
    svg.animate([{ clipPath: "inset(-12px 100% -12px -12px)" }, { clipPath: "inset(-12px -12px -12px -12px)" }], {
      duration: DETAIL_WIPE_MS,
      easing: STANDARD_EASING,
    });
    this.renderRoot
      .querySelector<HTMLElement>(".chart + .axis")
      ?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DETAIL_WIPE_MS * 0.6, delay: DETAIL_WIPE_MS * 0.3, easing: STANDARD_EASING, fill: "backwards" });
  }

  /**
   * A new period's timeline arrives: zoom to it instead of swapping it in.
   *
   * The day on screen is the last seventh of a week, so going from 24 hours to
   * 7 days starts the new bar stretched seven times, anchored at "now", where
   * it looks exactly like the old one — and shrinks it to size, the old day
   * settling into the right seventh where it actually lies. The other way
   * round the new bar starts squeezed into that seventh and opens out. The
   * eye follows where the time went instead of watching the bar repaint.
   */
  private _zoomTimeline(): void {
    const timeline = this._timeline;
    const entity = this._config?.entity;
    if (!timeline || !entity || timeline.source === "none") return;
    const before = this._drawnTimeline;
    this._drawnTimeline = { entity, range: timeline.range };
    if (!before || before.entity !== entity || before.range === timeline.range) return;
    if (!shouldAnimate(this._config?.animation) || isReducedMotion()) return;
    const track = this.renderRoot.querySelector<HTMLElement>(".timeline .track");
    if (!track?.animate) return;
    const ratio = DETAIL_RANGE_MS[timeline.range] / DETAIL_RANGE_MS[before.range];
    track.animate([{ transform: `scaleX(${ratio})` }, { transform: "scaleX(1)" }], {
      duration: DETAIL_ZOOM_MS,
      easing: STANDARD_EASING,
    });
  }

  private _kind(st: HassEntity): DetailKind {
    // Standing on its own, the card shows whatever it was given; only the
    // sheet turns entities without a kind away.
    return detailKind(st, this._config?.type_overrides) ?? "states";
  }

  private _syncControl(): void {
    const entity = this._config?.entity;
    const st = entity ? this.hass?.states[entity] : undefined;
    const option = this._config?.control_card ?? "auto";
    const skeleton =
      !st || this._kind(st) !== "control" || option === "none" || this._bigToggle(st)
        ? undefined
        : option === "auto"
          ? defaultControlCard(entity!)
          : option;
    this._controlCtl.sync({
      skeleton,
      tokens: { entity },
      hass: this.hass,
      onChange: (el) => {
        if (el !== this._control) this._control = el;
      },
    });
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _ranges(): DetailRange[] {
    const configured = (this._config?.ranges ?? []).filter((r) => r in DETAIL_RANGE_MS);
    return configured.length ? configured : [...DETAIL_DEFAULT_RANGES];
  }

  private get _range(): DetailRange {
    const ranges = this._ranges;
    const wanted = this._picked ?? this._config?.range ?? "24h";
    return ranges.includes(wanted) ? wanted : ranges.includes("24h") ? "24h" : ranges[0];
  }

  /**
   * The period last picked for this entity, on this device.
   *
   * Per entity because the useful window is a property of the reading — a
   * battery is read over a month, a door over an hour — and per device because
   * localStorage is. It can come back empty or throw (private windows, cleared
   * site data), and then the configured default stands.
   */
  private _storedRange(entity: string): DetailRange | undefined {
    try {
      const v = window.localStorage.getItem(DETAIL_RANGE_STORAGE_PREFIX + entity);
      return v && v in DETAIL_RANGE_MS ? (v as DetailRange) : undefined;
    } catch {
      return undefined;
    }
  }

  private _pick(range: DetailRange): void {
    const entity = this._config?.entity;
    if (range === this._range || !entity) return;
    this._picked = range;
    try {
      window.localStorage.setItem(DETAIL_RANGE_STORAGE_PREFIX + entity, range);
    } catch {
      // Remembering is a convenience; the switch itself has happened.
    }
    this._maybeFetch();
  }

  // ---- data ------------------------------------------------------------------

  private _maybeFetch(): void {
    const hass = this.hass;
    const entity = this._config?.entity;
    if (!hass || !entity || !hass.states[entity]) return;
    const kind = this._kind(hass.states[entity]);
    if (kind === "info") return;
    const key = `${entity}|${this._range}|${kind}`;
    if (key === this._fetchKey) return;
    this._fetchKey = key;
    const seq = ++this._fetchSeq;
    if (kind !== "numeric") {
      if (entity !== this._timelineEntity) this._timeline = undefined;
      this._timelineUnsub?.();
      this._timelineUnsub = subscribeStateTimeline(hass, entity, this._range, (timeline) => {
        if (seq !== this._fetchSeq) return;
        this._timeline = timeline;
        this._timelineEntity = entity;
      });
      return;
    }
    // Another entity's graph is not a placeholder for this one. The same
    // entity's previous period is: it stays up, dimmed, on its own axis, until
    // the new one lands — a range switch that blanks the graph for half a
    // second reads as the card breaking.
    if (entity !== this._seriesEntity) this._series = undefined;
    // The websocket has no way to cancel a request, so "abort" means: the
    // answer to an older question is dropped when it arrives. Identical
    // questions from several cards are shared by ha-statistics.ts's cache.
    void fetchEntitySeries(hass, entity, this._range).then((series) => {
      if (seq !== this._fetchSeq) return;
      this._series = series;
      this._seriesEntity = entity;
    });
  }

  private _observeChart(): void {
    const chart = this.renderRoot.querySelector(".chart");
    if (!chart || chart === this._observed) return;
    this._resize ??= new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width !== this._chartWidth) this._chartWidth = width;
    });
    if (this._observed) this._resize.unobserve(this._observed);
    this._resize.observe(chart);
    this._observed = chart;
  }

  // ---- naming ----------------------------------------------------------------

  private _registry(entityId: string): {
    entity?: RegistryEntity;
    device?: RegistryDevice;
    area?: RegistryArea;
  } {
    const entity = this.hass?.entities?.[entityId] as RegistryEntity | undefined;
    const device = entity?.device_id
      ? (this.hass?.devices?.[entity.device_id] as RegistryDevice | undefined)
      : undefined;
    const areaId = entity?.area_id ?? device?.area_id ?? undefined;
    const area = areaId ? (this.hass?.areas?.[areaId] as RegistryArea | undefined) : undefined;
    return { entity, device, area };
  }

  /**
   * The entity's name without its device's in front of it.
   *
   * Home Assistant composes `friendly_name` as "device entity", so a
   * thermometer's humidity reads "Thermometer 13 Luftfeuchtigkeit" — and the
   * breadcrumb above the title already says which thermometer. When nothing
   * is left after stripping (the entity *is* the device), the full name stays.
   */
  private _names(st: HassEntity, own = true): { title: string; crumb: string } {
    const { device, area } = this._registry(st.entity_id);
    const friendly = String(st.attributes.friendly_name ?? st.entity_id);
    const deviceName = (device?.name_by_user || device?.name || "").trim();
    let title = friendly;
    if (deviceName && friendly.toLowerCase().startsWith(deviceName.toLowerCase() + " ")) {
      title = friendly.slice(deviceName.length).trim() || friendly;
    }
    // Device and area, nothing else. The integration's name used to stand in
    // when there was no area — "template", "mqtt" — which says how the entity
    // is made, not where or what it is. With neither, the line is left out.
    // An entity named exactly like its device ("Steckdose 17 - 3D-Drucker"
    // on a device of that name) would print the name twice, once small.
    const shownDevice = deviceName && deviceName.toLowerCase() !== title.toLowerCase() ? deviceName : "";
    const crumb = [shownDevice, area?.name].filter(Boolean).join(" · ");
    return { title: (own && this._config?.name) || title, crumb };
  }

  /** A binary sensor's own class has an icon per state — the door shows open. */
  private _binaryIcon(st: HassEntity, deviceClass: string): string | undefined {
    if (!st.entity_id.startsWith("binary_sensor.")) return undefined;
    const pair = DETAIL_BINARY_CLASS_ICONS[deviceClass];
    return pair ? pair[st.state === "on" ? 0 : 1] : undefined;
  }

  private _icon(st: HassEntity, own = true): string {
    const deviceClass = String(st.attributes.device_class ?? "");
    return (
      (own && this._config?.icon) ||
      (st.attributes.icon as string | undefined) ||
      this._binaryIcon(st, deviceClass) ||
      DETAIL_DEVICE_CLASS_ICONS[deviceClass] ||
      DETAIL_DOMAIN_ICONS[st.entity_id.split(".")[0]] ||
      DEFAULT_DETAIL_ICON
    );
  }

  /**
   * The minimum's colour: orange, unless the entity itself is orange — an
   * energy or power reading — when two orange rings would mark the lowest and
   * the highest point alike.
   */
  private _minColor(accent: string): string {
    return accent.toLowerCase() === DETAIL_MIN_COLOR.toLowerCase() ? DETAIL_MIN_ALT_COLOR : DETAIL_MIN_COLOR;
  }

  private _accent(st: HassEntity, own = true): string {
    if (own && this._config?.color) return resolveThemeColor(this._config.color);
    const domain = st.entity_id.split(".")[0];
    const deviceClass = String(st.attributes.device_class ?? "");
    if (deviceClass === "temperature") {
      const byValue = temperatureColor(Number(st.state), st.attributes.unit_of_measurement as string | undefined);
      if (byValue) return byValue;
    }
    const byClass = domain === "binary_sensor" ? DETAIL_BINARY_CLASS_COLORS : DETAIL_DEVICE_CLASS_COLORS;
    return byClass[deviceClass] ?? DETAIL_DOMAIN_COLORS[domain] ?? DETAIL_DEFAULT_ACCENT;
  }

  // ---- numbers -----------------------------------------------------------------

  /** The registry's display precision, else as many decimals as the state has (at most two). */
  private _decimals(st: HassEntity): number {
    const precision = this._registry(st.entity_id).entity?.display_precision;
    if (typeof precision === "number") return precision;
    const dot = st.state.indexOf(".");
    return dot < 0 ? 0 : Math.min(2, st.state.length - dot - 1);
  }

  private _format(value: number, decimals: number): string {
    return formatNumber(this._language, value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  /**
   * A state as words. Home Assistant's own formatter, except for a timestamp:
   * it gives that its full date, "20. September 2026 um 16:37", which is
   * correct and pushed the name out of a row on a phone. formatClock drops
   * today's date and shortens any other.
   */
  private _stateText(st: HassEntity): string {
    if (st.attributes.device_class === "timestamp") return formatClock(st.state, this._language) ?? st.state;
    return this.hass?.formatEntityState?.(st) ?? st.state;
  }

  private _since(iso: string): string {
    const seconds = Math.round((Date.parse(iso) - this._now) / 1000);
    if (!Number.isFinite(seconds)) return "";
    const rtf = new Intl.RelativeTimeFormat(this._language, { numeric: "auto" });
    const abs = Math.abs(seconds);
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
    return rtf.format(Math.round(seconds / 86400), "day");
  }

  // ---- chart -------------------------------------------------------------------

  private _timeLabel(t: number, range: DetailRange): string {
    const tf = this.hass?.locale?.time_format;
    const hour12 = tf === "12" ? true : tf === "24" ? false : undefined;
    const opts: Intl.DateTimeFormatOptions =
      range === "7d"
        ? { weekday: "short" }
        : range === "30d"
          ? { day: "numeric", month: "numeric" }
          : { hour: "numeric", minute: "2-digit", hour12 };
    return new Intl.DateTimeFormat(this._language, opts).format(new Date(t));
  }

  /**
   * Where the axis labels go: three times spread over the window, rounded to
   * something a person would say, and "now" at the end.
   */
  private _labels(t0: number, range: DetailRange): { t: number; text: string }[] {
    const span = DETAIL_RANGE_MS[range];
    const round = range === "1h" ? 15 * 60_000 : range === "24h" ? 3_600_000 : 86_400_000;
    const out: { t: number; text: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = t0 + (span * i) / 3;
      // Rounded up, so the first label never falls left of the plot.
      const t = Math.ceil(raw / round) * round;
      out.push({ t, text: this._timeLabel(t, range) });
    }
    out.push({ t: t0 + span, text: this._t("detail_now") });
    return out;
  }

  private _tooltipTime(t: number, range: DetailRange): string {
    const tf = this.hass?.locale?.time_format;
    const hour12 = tf === "12" ? true : tf === "24" ? false : undefined;
    const sameDay = startOfDay(t) === startOfDay(this._now);
    const opts: Intl.DateTimeFormatOptions =
      range === "1h" || (range === "24h" && sameDay)
        ? { hour: "numeric", minute: "2-digit", hour12 }
        : { weekday: "short", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit", hour12 };
    return new Intl.DateTimeFormat(this._language, opts).format(new Date(t));
  }

  /**
   * A pointer on the curve. A mouse shows the reading under it as it moves; a
   * finger shows it while down and for a moment after, so it can be read
   * without the thumb in the way.
   */
  private _onChartPointer = (e: PointerEvent): void => {
    if (this._config?.show_tooltip === false || !this._series || this._series.source === "none") return;
    if (e.pointerType !== "mouse" && e.type === "pointermove" && !e.buttons && e.pressure === 0) return;
    window.clearTimeout(this._hoverTimer);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const plotW = Math.max(1, rect.width - DETAIL_CHART_HALO);
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / plotW));
    const span = DETAIL_RANGE_MS[this._series.range];
    this._hoverT = this._now - span + fraction * span;
  };

  private _onChartRelease = (e: PointerEvent): void => {
    window.clearTimeout(this._hoverTimer);
    if (e.pointerType === "mouse") {
      if (e.type === "pointerleave") this._hoverT = undefined;
      return;
    }
    this._hoverTimer = window.setTimeout(() => (this._hoverT = undefined), DETAIL_TOOLTIP_LINGER_MS);
  };

  /**
   * A more-info request from the embedded control card.
   *
   * That card does not know it sits inside a detail view, so a tap that
   * means "details" in it fires Home Assistant's more-info as it would on a
   * dashboard — which, in the sheet, opened a second dialog over this one.
   * Here it is answered by the view itself:
   *
   *   - the entity already on screen, in the sheet: nothing to do, this is
   *     its detail view. On a dashboard the request goes on to Home
   *     Assistant, which is the only place it can mean anything there.
   *   - another entity this view has a layout for: step to it, as a tap on
   *     a sibling does.
   *   - anything else, a settings page included: the sheet closes first and
   *     the request goes on, so the two dialogs never stack.
   */
  private _onInnerMoreInfo = (e: Event): void => {
    const detail = (e as CustomEvent<{ entityId?: string; view?: string }>).detail ?? {};
    const id = detail.entityId;
    if (!id) return;
    if (detail.view) {
      this._handOver(e, id, detail.view);
      return;
    }
    if (id === this._config?.entity) {
      if (this.closeHandler) e.stopPropagation();
      return;
    }
    if (detailKind(this.hass?.states[id]) !== undefined) {
      e.stopPropagation();
      this._switchTo(id);
      return;
    }
    this._handOver(e, id);
  };

  /**
   * Closes the sheet, then lets Home Assistant's dialog open — in that order,
   * and only once the sheet's history entry is gone, or the dialog's own
   * entry would be the one popped and it would close as it opened. On a
   * dashboard, with no sheet to close, the request simply goes on.
   */
  private _handOver(e: Event, entityId: string, view?: string): void {
    if (!this.closeHandler) return;
    e.stopPropagation();
    void Promise.resolve(this.closeHandler()).then(() =>
      view === "settings" ? openEntitySettings(this, entityId) : openEntityDetail(this, entityId),
    );
  }

  /** The other entities of this one's device, one row each. */
  private _renderRelated(st: HassEntity): unknown {
    if (this._config?.show_related === false || !this.hass) return nothing;
    // Only entities this view can show. A vacuum's program buttons are on the
    // same device, but their state is the time they were last pressed, and a
    // tap on one would step to a view with nothing in it.
    const ids = deviceSiblings(this.hass, st.entity_id)
      .filter((id) => detailKind(this.hass!.states[id]) !== undefined)
      .slice(0, this._config?.max_related ?? DETAIL_DEFAULT_MAX_RELATED);
    if (!ids.length) return nothing;
    // Behind the one "more details" fold already; a second fold inside it
    // would be one tap too many.
    return html`
      <div class="related">
        <div class="related-title">${this._t("detail_related")}</div>
        <div class="related-rows">${this._renderRelatedRows(ids)}</div>
      </div>
    `;
  }

  private _renderRelatedRows(ids: string[]): unknown {
    return html`
        ${ids.map((id) => {
          const sib = this.hass!.states[id];
          const accent = this._accent(sib, false);
          const numeric = !MISSING.has(sib.state) && sib.state.trim() !== "" && Number.isFinite(Number(sib.state));
          const unit = sib.attributes.unit_of_measurement as string | undefined;
          const value = MISSING.has(sib.state)
            ? "—"
            : numeric
              ? `${this._format(Number(sib.state), this._decimals(sib))}${unit ? ` ${unit}` : ""}`
              : this._stateText(sib);
          return html`<button class="related-row" @click=${() => this._switchTo(id)}>
            <span
              class="related-icon"
              style=${buildCssVars({
                "ri-bg": tintOn(this, accent, undefined, 20),
                "ri-ink": tintInk(this, accent, undefined, 20, 3),
              })}
              ><ha-icon icon=${this._icon(sib, false)}></ha-icon
            ></span>
            <span class="related-name">${this._names(sib, false).title}</span>
            <span class="related-value" style="color:${foregroundColor(this, accent)}">${value}</span>
            <ha-icon class="related-chevron" icon="mdi:chevron-right"></ha-icon>
          </button>`;
        })}
    `;
  }

  /**
   * Height, opacity and the gap above a folding part, animated together, so
   * neither end of the motion snaps. Shared by the details and the
   * same-device list.
   */
  private async _animateFold(el: HTMLElement | null, opening: boolean): Promise<void> {
    if (!el?.animate || !shouldAnimate(this._config?.animation) || isReducedMotion()) return;
    const height = el.getBoundingClientRect().height;
    const gap = getComputedStyle(el.parentElement ?? el).rowGap || "0px";
    const shut = { height: "0px", opacity: 0, overflow: "hidden", marginTop: `-${gap}` };
    const full = { height: `${height}px`, opacity: 1, overflow: "hidden", marginTop: "0px" };
    await el
      .animate(opening ? [shut, full] : [full, shut], {
        duration: DETAIL_DETAILS_MS,
        easing: STANDARD_EASING,
        fill: opening ? "none" : "forwards",
      })
      .finished.catch(() => undefined);
  }

  /**
   * Shows another entity in place of this one.
   *
   * The config's own name, icon, colour and control card were written for the
   * entity it was given and are dropped; periods, stats and the rest carry
   * over. The old view fades out a little to the left and the new one in from
   * the right — a step sideways, not a new dialog.
   */
  private _switchTo(entityId: string): void {
    const config = this._config;
    if (!config || entityId === config.entity) return;
    const apply = () => {
      const { name: _n, icon: _i, color: _c, ...rest } = config;
      void _n;
      void _i;
      void _c;
      const control_card = typeof rest.control_card === "object" ? undefined : rest.control_card;
      this.setConfig({ ...rest, control_card, entity: entityId });
      this._hoverT = undefined;
      this.dispatchEvent(new CustomEvent("m3-detail-switched", { bubbles: true, composed: true }));
    };
    window.clearTimeout(this._swapTimer);
    if (!shouldAnimate(config.animation) || isReducedMotion()) {
      apply();
      return;
    }
    this._swap = "out";
    this._swapTimer = window.setTimeout(() => {
      apply();
      this._swap = "in";
      // Two frames: the new view has to be laid out at its offset before the
      // transition back to rest has anywhere to start from.
      requestAnimationFrame(() => requestAnimationFrame(() => (this._swap = undefined)));
    }, DETAIL_SWAP_MS);
  }

  private _renderChart(st: HassEntity, accent: string, available: boolean): unknown {
    const series = this._series;
    if (!series) return html`<div class="chart loading" style="height:${DETAIL_CHART_HEIGHT}px"></div>`;
    if (series.source === "none") return html`<div class="no-history">${this._t("detail_no_history")}</div>`;

    const width = this._chartWidth;
    const height = DETAIL_CHART_HEIGHT;
    // The series' own period, not the selected one: while the next period
    // loads, the previous answer is still drawn to the scale it was read at.
    const span = DETAIL_RANGE_MS[series.range];
    const t1 = this._now;
    const t0 = t1 - span;
    const points = this._pointsWithLive(series.points, st, t1);
    const visible = points.filter((p) => p.t >= t0);
    const { min, max } = seriesExtremes(visible);

    let body: unknown = nothing;
    let tooltip: unknown = nothing;
    let guide: unknown = nothing;
    if (width > 0 && min && max) {
      const plotW = width - DETAIL_CHART_HALO;
      const lo = min.v as number;
      const hi = max.v as number;
      const spread = hi - lo || Math.abs(hi) * 0.1 || 1;
      const yLo = lo - spread * DETAIL_CHART_PADDING;
      const yHi = hi + spread * DETAIL_CHART_PADDING;
      const top = DETAIL_CHART_HALO;
      const bottom = height - DETAIL_CHART_HALO;
      const x = (t: number) => ((t - t0) / span) * plotW;
      const y = (v: number) => bottom - ((v - yLo) / (yHi - yLo)) * (bottom - top);

      const runs: XY[][] = [];
      let run: XY[] = [];
      for (const p of points) {
        if (p.v === null) {
          if (run.length) runs.push(run);
          run = [];
        } else {
          run.push({ x: x(p.t), y: y(p.v) });
        }
      }
      if (run.length) runs.push(run);

      const last = available ? [...points].reverse().find((p) => p.v !== null) : undefined;
      // Under a pointer the dot leaves "now" and follows it to the nearest
      // reading — one moving dot, not a second one beside the first.
      const hover = this._hoverT !== undefined ? nearestValued(points, this._hoverT, t0) : undefined;
      const dot = hover ?? last;
      if (hover) {
        const hx = x(hover.t);
        const hy = y(hover.v as number);
        tooltip = html`<div
          class="tooltip ${hy < 52 ? "below" : ""}"
          style="left:${Math.min(Math.max(hx, 48), width - 48)}px; top:${hy}px"
        >
          <b>${this._format(hover.v as number, this._decimals(st))}${st.attributes.unit_of_measurement
            ? html`<span class="tip-unit">${st.attributes.unit_of_measurement}</span>`
            : nothing}</b>
          <span>${this._tooltipTime(hover.t, series.range)}</span>
        </div>`;
        guide = svg`<line class="guide" x1=${hx} x2=${hx} y1="0" y2=${height}></line>`;
      }
      // A quiet scale: three or four round values, a faint dashed line each,
      // the figure small at the left edge in the x-axis' own style. No unit —
      // it is written large above the graph — and no frame or ticks.
      const ticks = this._config?.y_axis === false ? [] : niceTicks(yLo, yHi, 3);
      const tickPlaces = tickDecimals(ticks);
      // Lines under the fill, figures over everything: under the fill the
      // lowest figure was hidden, and under the line any figure the curve
      // happened to cross at the left edge. A thin halo in the surface colour
      // keeps them readable where the line runs through, with no box.
      const grid = ticks.map((v) => svg`<line class="grid" x1="0" x2=${plotW} y1=${y(v)} y2=${y(v)}></line>`);
      const tickLabels = ticks.map(
        (v) => svg`<text class="ytick" x="0" y=${y(v) - 3}>${this._format(v, tickPlaces)}</text>`,
      );
      const minColor = fillColor(this, this._minColor(accent));
      const lineColor = fillColor(this, accent);
      body = svg`
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color=${lineColor} stop-opacity="0.32"></stop>
            <stop offset="1" stop-color=${lineColor} stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${grid}
        ${runs.map((r) => svg`<path class="area" d=${monotoneArea(r, height)} fill="url(#fill)"></path>`)}
        ${runs.map((r) => svg`<path class="line" d=${monotonePath(r)} stroke=${lineColor}></path>`)}
        ${tickLabels}
        ${lo !== hi
          ? svg`
              <circle class="ring" cx=${x(min.t)} cy=${y(lo)} r="4" stroke=${minColor}></circle>
              <circle class="ring" cx=${x(max.t)} cy=${y(hi)} r="4" stroke=${lineColor}></circle>
            `
          : nothing}
        ${guide}
        ${dot
          ? svg`
              <circle cx=${x(dot.t)} cy=${y(dot.v as number)} r=${DETAIL_CHART_HALO} fill=${lineColor} opacity="0.2"></circle>
              <circle cx=${x(dot.t)} cy=${y(dot.v as number)} r="5.5" fill=${lineColor}></circle>
            `
          : nothing}
      `;
    }

    const labels = this._labels(t0, series.range);
    const stale = series.range !== this._range;
    return html`
      <div
        class="chart ${available ? "" : "dim"} ${stale ? "stale" : ""}"
        data-source=${series.source}
        @pointerdown=${this._onChartPointer}
        @pointermove=${this._onChartPointer}
        @pointerup=${this._onChartRelease}
        @pointercancel=${this._onChartRelease}
        @pointerleave=${this._onChartRelease}
        @touchstart=${stopSwipe}
        @touchmove=${stopSwipe}
      >
        <svg width="100%" height=${height} viewBox="0 0 ${Math.max(1, width)} ${height}" aria-hidden="true">
          ${body}
        </svg>
        ${tooltip}
      </div>
      <div class="axis">
        ${labels.map((l, i) => {
          const pct = i === labels.length - 1 ? 100 : Math.min(100, Math.max(0, ((l.t - t0) / span) * 100));
          return html`<span class="tick ${i === 0 && pct < 8 ? "start" : ""} ${i === labels.length - 1 ? "end" : ""}" style="left:${pct}%">${l.text}</span>`;
        })}
      </div>
    `;
  }

  /**
   * The fetched series, extended by whatever the entity has done since.
   *
   * The series is read once per opening; the big number above it is live. A
   * reading that arrives while the card is open is appended here, so the line
   * keeps ending on the number it sits under.
   */
  private _pointsWithLive(points: readonly SeriesPoint[], st: HassEntity, now: number): SeriesPoint[] {
    const n = Number(st.state);
    const live = MISSING.has(st.state) || !Number.isFinite(n) ? null : n;
    const lastT = points.length ? points[points.length - 1].t : -Infinity;
    if (lastT >= now) return [...points];
    return [...points, { t: now, v: live }];
  }

  // ---- render --------------------------------------------------------------------

  private _renderTrend(st: HassEntity, decimals: number): unknown {
    const series = this._series;
    const live = Number(st.state);
    if (!series?.points.length || MISSING.has(st.state) || !Number.isFinite(live)) return nothing;
    // While the next period loads, the chip keeps the previous answer, dimmed
    // like the graph. Dropping it shifted everything beside it and back again.
    const stale = series.range !== this._range;
    const t0 = this._now - DETAIL_RANGE_MS[series.range];
    const first = seriesExtremes(series.points.filter((p) => p.t >= t0)).first;
    if (!first) return nothing;
    const diff = live - (first.v as number);
    const step = 10 ** -decimals / 2;
    const dir = diff > step ? 1 : diff < -step ? -1 : 0;
    const good = this._config?.trend_inverted ? -dir : dir;
    const color = good > 0 ? DETAIL_TREND_UP_COLOR : good < 0 ? DETAIL_TREND_DOWN_COLOR : "var(--primary-text-color)";
    const sign = dir > 0 ? "+" : dir < 0 ? "−" : "±";
    // One arrow, turned: up-right, flat, down-right. A change of direction is
    // then a rotation the eye can follow, not one glyph swapped for another.
    const angle = dir > 0 ? -45 : dir < 0 ? 45 : 0;
    return html`
      <span
        class="trend ${stale ? "stale" : ""}"
        title=${this._t("detail_trend")}
        style=${buildCssVars({
          "trend-bg": tintOn(this, color, undefined, 18),
          "trend-ink": tintInk(this, color, undefined, 18),
          "trend-angle": `${angle}deg`,
        })}
      >
        <ha-icon icon="mdi:arrow-right"></ha-icon><span class="trend-text">${sign}${this._format(Math.abs(diff), decimals)}</span>
      </span>
    `;
  }

  private _renderValue(st: HassEntity, accent: string): unknown {
    const numeric = !MISSING.has(st.state) && st.state.trim() !== "" && Number.isFinite(Number(st.state));
    const decimals = numeric ? this._decimals(st) : 0;
    const unit = numeric ? (st.attributes.unit_of_measurement as string | undefined) : undefined;
    // Unknown and unavailable are words, in Home Assistant's own language,
    // not a dash: at 52px a dash read as a bar, and the line under it said
    // "unavailable" for an entity that was merely unknown.
    const text = numeric ? this._format(Number(st.state), decimals) : this._stateText(st) || "—";
    // Long numbers step down once; text — "Bewölkt", "Waschen" — starts
    // smaller, because a word at 52px wraps on a phone.
    const size = !numeric ? "text" : text.length > 6 ? "long" : "";
    // A door that is shut is not news: the accent is for the active half of a
    // pair, and the other reads in the text colour.
    const quiet = !numeric && isTwoState([st.state]) && !isActiveState(st.state);
    const color = quiet ? "var(--dc-text, var(--primary-text-color))" : foregroundColor(this, accent);
    return html`
      <div class="value-row">
        <div class="value ${size}" style="color:${color}">
          <span class="number">${text}</span>${unit ? html`<span class="unit">${unit}</span>` : nothing}
        </div>
        <div class="value-side">
          ${this._renderTrend(st, decimals)}
          <span class="since">${this._since(st.last_changed)}</span>
        </div>
      </div>
    `;
  }

  private _renderRanges(accent: string): unknown {
    const ranges = this._ranges;
    if (ranges.length < 2) return nothing;
    const current = this._range;
    const fill = fillColor(this, accent);
    return html`
      <div
        class="segments"
        role="radiogroup"
        aria-label=${this._t("detail_ranges")}
        style=${buildCssVars({ "seg-fill": fill, "seg-ink": inkOn(fill, this) })}
      >
        ${ranges.map(
          (r) => html`<button
            class="segment ${r === current ? "active" : ""}"
            role="radio"
            aria-checked=${r === current ? "true" : "false"}
            @click=${() => this._pick(r)}
          >
            ${this._t(`detail_range_${r}` as TranslationKey)}
          </button>`,
        )}
      </div>
    `;
  }

  /** Which tiles, in which order: configured, or the default for this kind of reading. */
  private _statKinds(st: HassEntity): DetailStat[] {
    if (this._config?.stats?.length) return this._config.stats;
    const meter = st.attributes.state_class === "total" || st.attributes.state_class === "total_increasing";
    return meter ? ["min", "mean", "max", "sum"] : ["min", "mean", "max"];
  }

  private _renderStats(st: HassEntity, accent: string): unknown {
    const series = this._series;
    // Tiles for a period that is still loading would contradict the graph's
    // own scale above them; they wait with it.
    if (!series || series.source === "none") return nothing;
    // While the next period loads, the tiles keep the previous answer, dimmed
    // with the graph: dropping them collapsed the view by their height and
    // threw it open again a moment later.
    const stale = series.range !== this._range;
    const t1 = this._now;
    const stats = seriesStats(this._pointsWithLive(series.points, st, t1), t1 - DETAIL_RANGE_MS[series.range], t1);
    if (!stats) return nothing;
    const decimals = this._decimals(st);
    const unit = st.attributes.unit_of_measurement as string | undefined;
    const tiles = this._statKinds(st)
      .map((kind) => {
        const value =
          kind === "sum"
            ? series.sum
            : kind === "min"
              ? Math.min(series.extremes?.min ?? stats.min, stats.min)
              : kind === "max"
                ? Math.max(series.extremes?.max ?? stats.max, stats.max)
                : stats.mean;
        if (value === undefined) return undefined;
        const color =
          kind === "min"
            ? foregroundColor(this, this._minColor(accent))
            : kind === "max"
              ? foregroundColor(this, accent)
              : "var(--dc-text, var(--primary-text-color))";
        const label: TranslationKey =
          kind === "min" ? "detail_minimum" : kind === "max" ? "detail_maximum" : kind === "sum" ? "detail_sum" : "detail_mean";
        // A mean of whole numbers is rarely whole; one decimal more than the
        // reading itself says how far between two steps it sits.
        const places = kind === "mean" ? Math.min(decimals + 1, 2) : decimals;
        return html`<div class="tile">
          <div class="tile-value" style="color:${color}">
            ${this._format(value, places)}${unit ? html`<span class="tile-unit">${unit}</span>` : nothing}
          </div>
          <div class="tile-label">${this._t(label)}</div>
        </div>`;
      })
      .filter((t) => t !== undefined);
    if (!tiles.length) return nothing;
    // Four tiles on a phone leave about 75px for a number; a meter reading of
    // 1.623,56 kWh does not fit at 17px. The unit is already large above the
    // graph, so a crowded row drops it and steps the figures down instead of
    // cutting them off.
    const dense = tiles.length > 3 ? "dense" : "";
    return html`<div
      class="tiles ${dense} ${stale ? "stale" : ""}"
      style="grid-template-columns: repeat(${tiles.length}, minmax(0, 1fr))"
    >
      ${tiles}
    </div>`;
  }

  /**
   * The view as two parts: what the entity is or does right now, and the
   * history and context under it. The second part can be folded away
   * (`details`), which is the default where the first part is the point — a
   * switch someone opens to switch, not to read about.
   */
  private _renderBody(st: HassEntity, accent: string, available: boolean): unknown {
    const kind = this._kind(st);
    const head =
      kind === "control"
        ? this._bigToggle(st)
          ? this._renderBigToggle(st, accent)
          : this._control
            ? html`<div class="control" @hass-more-info=${this._onInnerMoreInfo}>${this._control}</div>`
            : this._renderValue(st, accent)
        : this._renderValue(st, accent);
    // What Home Assistant's own dialog shows for the kind stays in view; the
    // rest — tiles, lists, the device's other entities, and for something
    // to operate its whole history — is the extra, behind one fold.
    const primary =
      kind === "numeric"
        ? html`${this._renderRanges(accent)} ${this._renderChart(st, accent, available)}`
        : kind === "info"
          ? this._renderInfo(st)
          : kind === "control"
            ? nothing
            : html`${this._renderRanges(accent)} ${this._renderStates(st, accent, "bar")}`;
    const extra =
      kind === "numeric"
        ? this._renderStats(st, accent)
        : kind === "info"
          ? nothing
          : kind === "control"
            ? html`${this._renderRanges(accent)} ${this._renderStates(st, accent, "bar")} ${this._renderStates(st, accent, "tiles")}`
            : this._renderStates(st, accent, "tiles");
    const related = this._renderRelated(st);
    const details = html`${extra} ${related}`;
    const mode = this._detailsMode();
    // A fold with nothing in it is a button that opens onto nothing: a person
    // or the sun has no extras and, without a device, no siblings either.
    if (mode === "hidden" || (extra === nothing && related === nothing)) return html`${head} ${primary}`;
    if (mode === "expanded") return html`${head} ${primary} ${details}`;
    const open = this._detailsOpen;
    // The arrow turns with the fold, not after it: tied to "open" alone it
    // turned only once the content was gone, two changes in one frame at the
    // end of the animation.
    const shown = open && !this._detailsClosing;
    return html`
      ${head} ${primary}
      <button class="details-toggle ${shown ? "open" : ""}" aria-expanded=${shown ? "true" : "false"} @click=${this._toggleDetails}>
        <span>${this._t(kind === "control" ? "detail_more" : "detail_extra")}</span>
        <ha-icon icon="mdi:chevron-down"></ha-icon>
      </button>
      ${open ? html`<div class="details">${details}</div>` : nothing}
    `;
  }

  /** Domains whose view leads with one big switch instead of an embedded card. */
  private _bigToggle(st: HassEntity): boolean {
    const option = this._config?.control_card ?? "auto";
    return option === "auto" && ["switch", "input_boolean"].includes(st.entity_id.split(".")[0]);
  }

  private _detailsMode(): "expanded" | "collapsed" | "hidden" {
    const configured = this._config?.details;
    if (configured === "expanded" || configured === "collapsed" || configured === "hidden") return configured;
    // What Home Assistant shows is always in view (see _renderBody), so the
    // fold holds only extras and starts shut.
    return "collapsed";
  }

  private _storedDetailsOpen(entity: string): boolean {
    try {
      return window.localStorage.getItem(DETAIL_OPEN_STORAGE_PREFIX + entity) === "1";
    } catch {
      return false;
    }
  }

  /**
   * Opens or folds the details, with the height animated both ways: the part
   * grows from nothing to its measured height and its content fades in, and
   * folding runs the same backwards before the content is removed. It used
   * to appear and vanish in one frame, which read as the sheet jumping.
   */
  private _toggleDetails = async (): Promise<void> => {
    if (this._detailsClosing) return;
    const opening = !this._detailsOpen;
    const entity = this._config?.entity;
    if (entity) {
      try {
        window.localStorage.setItem(DETAIL_OPEN_STORAGE_PREFIX + entity, opening ? "1" : "0");
      } catch {
        // Remembering is a convenience.
      }
    }
    if (opening) {
      this._detailsOpen = true;
      await this.updateComplete;
      void this._animateFold(this.renderRoot.querySelector<HTMLElement>(".details"), true);
      return;
    }
    this._detailsClosing = true;
    await this._animateFold(this.renderRoot.querySelector<HTMLElement>(".details"), false);
    this._detailsOpen = false;
    this._detailsClosing = false;
  };

  /**
   * One large switch: a tall track, a thumb that rides to the top for on.
   *
   * Made for the entity someone opens in order to switch it — a socket with a
   * 3D printer behind it — where the embedded button card was a single row
   * under a header and the thing that mattered looked like the least of it.
   * Large enough to be pressed on purpose rather than brushed. The thumb moves
   * as soon as it is pressed and is held there, dimmed, until the entity
   * confirms; if it never does, it goes back.
   */
  private _renderBigToggle(st: HassEntity, accent: string): unknown {
    const available = !MISSING.has(st.state);
    const pending = this._pendingToggle;
    const confirmed = st.state === "on";
    const shown = pending ? pending.to : confirmed;
    const fill = fillColor(this, accent);
    return html`
      <div class="big-toggle-wrap">
        <button
          class="big-toggle ${shown ? "on" : ""} ${pending ? "pending" : ""}"
          role="switch"
          aria-checked=${shown ? "true" : "false"}
          aria-label=${this._names(st).title}
          ?disabled=${!available}
          style=${buildCssVars({
            "bt-fill": fill,
            "bt-ink": inkOn(fill, this),
            "bt-track-on": tintOn(this, accent, undefined, 30),
          })}
          @click=${() => this._flip(st)}
        >
          <span class="big-thumb"><ha-icon icon="mdi:power"></ha-icon></span>
        </button>
        <div class="big-state">
          <span class="big-state-label">${MISSING.has(st.state) ? "—" : this._stateText(st)}</span>
          <span class="since">${MISSING.has(st.state) ? this._t("detail_unavailable") : this._since(st.last_changed)}</span>
        </div>
      </div>
    `;
  }

  private _flip(st: HassEntity): void {
    if (!this.hass || MISSING.has(st.state) || this._pendingToggle) return;
    const to = st.state !== "on";
    const domain = st.entity_id.split(".")[0];
    this._pendingToggle = { to, since: Date.now() };
    void this.hass
      .callService(domain, to ? "turn_on" : "turn_off", { entity_id: st.entity_id })
      .catch(() => (this._pendingToggle = undefined));
    window.setTimeout(() => {
      if (this._pendingToggle?.to === to) this._pendingToggle = undefined;
    }, DETAIL_TOGGLE_CONFIRM_MS);
  }

  private _stateLabel(st: HassEntity, state: string): string {
    return this.hass?.formatEntityState?.({ ...st, state }) ?? state;
  }

  /** Timeline, then the pair's tiles or the list of states. */
  /**
   * The timeline (`bar`) or the tiles and lists under it (`tiles`) — the
   * first is what Home Assistant's own dialog shows, the second the extra
   * that goes behind "more details".
   */
  private _renderStates(st: HassEntity, accent: string, part: "bar" | "tiles"): unknown {
    const timeline = this._timeline;
    if (!timeline) return part === "bar" ? html`<div class="timeline-placeholder"></div>` : nothing;
    if (timeline.source === "none") {
      return part === "bar" ? html`<div class="no-history">${this._t("detail_no_history")}</div>` : nothing;
    }
    const t1 = this._now;
    const t0 = t1 - DETAIL_RANGE_MS[timeline.range];
    const stale = timeline.range !== this._range;
    // Streamed, so every change Home Assistant records arrives as it happens;
    // the last stretch only needs running on to now between changes.
    const segments = [...timeline.segments];
    const last = segments[segments.length - 1];
    if (last && last.to < t1) segments[segments.length - 1] = { ...last, to: t1 };
    // A timestamp sensor's every state is a different moment, so a bar of
    // stretches per state would be a rainbow and a list of how long each
    // lasted meaningless. Its bar shows when it had a value at all, and the
    // list under it is what changed, newest first.
    const timestamp = st.attributes.device_class === "timestamp";
    // Its change list is the activity Home Assistant shows too: part of the bar.
    if (timestamp) {
      return part === "bar" ? this._renderTimestampHistory(st, segments, t0, t1, timeline.range, stale, accent) : nothing;
    }
    const shares = stateShares(segments, t0, t1);
    const twoState = isTwoState([...shares.map((s) => s.state), st.state]);
    const colors = stateColors(this, shares, fillColor(this, accent), twoState);
    const label = (state: string) => this._stateLabel(st, state);
    const labels = this._labels(t0, timeline.range);
    if (part === "bar") {
      // Home Assistant shows the latest changes under the bar for a sensor;
      // for something to operate the whole bar is behind the fold anyway.
      const events = clipSegments(segments, t0, t1).reverse().slice(0, DETAIL_MAX_SHARES);
      const neutral = tintOn(this, "var(--primary-text-color)", undefined, 40);
      return html`
        ${renderTimeline({ segments: clipSegments(segments, t0, t1), t0, t1, colors, stale, label })}
        <div class="axis">
          ${labels.map((l, i) => {
            const pct = i === labels.length - 1 ? 100 : Math.min(100, Math.max(0, ((l.t - t0) / (t1 - t0)) * 100));
            return html`<span class="tick ${i === 0 && pct < 8 ? "start" : ""} ${i === labels.length - 1 ? "end" : ""}" style="left:${pct}%">${l.text}</span>`;
          })}
        </div>
        ${this._renderActivity(events, label, (state) => colors.get(state) ?? neutral, stale)}
      `;
    }
    return html`
      <div class="below ${stale ? "stale" : ""}">
        ${twoState
          ? renderPairTiles({
              shares,
              // In the period on screen, like the two tiles beside it. It was
              // "since midnight" whatever the period, which read as broken
              // next to two figures for the last seven days.
              changes: countChanges(segments, t0, t1),
              colors,
              language: this._language,
              label,
              changesLabel: this._t("detail_changes"),
              inkFor: (c) => foregroundColor(this, c),
            })
          : renderShares({ shares, colors, language: this._language, label, max: DETAIL_MAX_SHARES })}
      </div>
    `;
  }

  private _renderTimestampHistory(
    st: HassEntity,
    segments: StateSegment[],
    t0: number,
    t1: number,
    range: DetailRange,
    stale: boolean,
    accent: string,
  ): unknown {
    const SET = "set";
    const bar = segments.map((s) => (isMissingState(s.state) ? s : { ...s, state: SET }));
    const colors = new Map([[SET, fillColor(this, accent)]]);
    const label = (state: string) => (state === SET ? this._t("detail_set") : this._stateLabel(st, state));
    const labels = this._labels(t0, range);
    const events = clipSegments(segments, t0, t1).reverse().slice(0, DETAIL_MAX_SHARES);
    const text = (state: string) =>
      isMissingState(state) ? this._stateLabel(st, state) : (formatClock(state, this._language) ?? state);
    return html`
      ${renderTimeline({ segments: clipSegments(bar, t0, t1), t0, t1, colors, stale, label })}
      <div class="axis">
        ${labels.map((l, i) => {
          const pct = i === labels.length - 1 ? 100 : Math.min(100, Math.max(0, ((l.t - t0) / (t1 - t0)) * 100));
          return html`<span class="tick ${i === 0 && pct < 8 ? "start" : ""} ${i === labels.length - 1 ? "end" : ""}" style="left:${pct}%">${l.text}</span>`;
        })}
      </div>
      ${this._renderActivity(events, text, () => fillColor(this, accent), stale)}
    `;
  }

  /**
   * The latest changes, newest first, with their time: Home Assistant's
   * "Activity" under the history, for anything whose states are words.
   */
  private _renderActivity(
    events: readonly StateSegment[],
    text: (state: string) => string,
    color: (state: string) => string,
    stale: boolean,
  ): unknown {
    if (!events.length) return nothing;
    return html`
      <div class="below ${stale ? "stale" : ""}">
        <div class="shares">
          ${events.map(
            (e) => html`<div class="share event">
              <span
                class="dot ${isMissingState(e.state) ? "missing" : ""}"
                style="background:${isMissingState(e.state) ? "transparent" : color(e.state)}"
              ></span>
              <span class="share-name">${text(e.state)}</span>
              <span class="share-time">${formatClock(new Date(e.from).toISOString(), this._language)}</span>
            </div>`,
          )}
        </div>
      </div>
    `;
  }

  /** The few attributes worth a line for an entity with no useful history. */
  private _renderInfo(st: HassEntity): unknown {
    if (!st.entity_id.startsWith("weather.")) return nothing;
    const a = st.attributes;
    const rows: [TranslationKey, unknown, unknown][] = [
      ["detail_temperature", a.temperature, a.temperature_unit],
      ["detail_humidity", a.humidity, "%"],
      ["detail_wind", a.wind_speed, a.wind_speed_unit],
      ["detail_pressure", a.pressure, a.pressure_unit],
    ];
    const shown = rows.filter(([, v]) => typeof v === "number");
    if (!shown.length) return nothing;
    return html`<div class="tiles" style="grid-template-columns: repeat(${Math.min(shown.length, 2)}, minmax(0, 1fr))">
      ${shown.map(
        ([key, v, unit]) => html`<div class="tile">
          <div class="tile-value">
            ${this._format(v as number, Number.isInteger(v) ? 0 : 1)}${unit ? html`<span class="tile-unit">${unit}</span>` : nothing}
          </div>
          <div class="tile-label">${this._t(key)}</div>
        </div>`,
      )}
    </div>`;
  }

  private _openSettings(): void {
    const entity = this._config?.entity;
    // Home Assistant's dialog opening on top of ours would leave two modals
    // stacked, one of them unreachable. Close first, and wait for the close:
    // see _handOver.
    void Promise.resolve(this.closeHandler?.()).then(() => openEntitySettings(this, entity));
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const st = this.hass.states[this._config.entity];
    if (!st) return renderMissingEntity(this._config.entity);

    const accent = this._accent(st);
    const { title, crumb } = this._names(st);
    const embedded = this._kind(st) === "control" && !!this._control && !this._bigToggle(st);
    const available = !MISSING.has(st.state);
    const animate = shouldAnimate(this._config.animation) && !isReducedMotion();
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const radius = resolveCornerRadius(this._config.radius ?? RADIUS.card, this._config.corners);
    const cssVars = buildCssVars({
      "dc-text": textColorCss,
      "dc-secondary": secondaryTextColorCss,
      "dc-icon-bg": tintOn(this, accent, undefined, 20),
      "dc-icon-ink": tintInk(this, accent, undefined, 20, 3),
      "dc-button-bg": tintOn(this, "var(--primary-text-color)", undefined, 5),
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="content ${this._swap ? `swap-${this._swap}` : ""}">
          <div class="header">
            ${embedded
              ? // The embedded card carries the icon and the name already;
                // the header keeps only where it is and the two buttons.
                html`<div class="titles">${crumb ? html`<div class="crumb solo">${crumb}</div>` : nothing}</div>`
              : html`<div class="icon"><ha-icon icon=${this._icon(st)}></ha-icon></div>
                  <div class="titles">
                    ${crumb ? html`<div class="crumb">${crumb}</div>` : nothing}
                    <div class="title">${title}</div>
                  </div>`}
            <button class="hbtn settings" @click=${() => this._openSettings()} aria-label=${this._t("detail_settings")}>
              <ha-icon icon="mdi:cog-outline"></ha-icon>
            </button>
            ${this.closeHandler
              ? html`<button class="hbtn close" @click=${() => this.closeHandler?.()} aria-label=${this._t("detail_close")}>
                  <ha-icon icon="mdi:close"></ha-icon>
                </button>`
              : nothing}
          </div>
          ${this._renderBody(st, accent, available)}
          </div>
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    detailStateStyles,
    css`
      .card-inner {
        gap: 16px;
        padding: 16px;
        color: var(--dc-text, var(--primary-text-color));
      }

      /* Inside the sheet the sheet is the surface; a card frame in it would
         be a box drawn inside a box. */
      :host([in-sheet]) .card-inner {
        border: none;
        background: transparent;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        padding: 0;
      }
      /* And no corners of its own. With the padding gone the content runs to
         the card's edge, so a 28px rounding with overflow: hidden cut into
         whatever sat there: the icon and the close button at the top, the
         last tile or row at the bottom, a word of text in a short view. The
         radius is set inline, hence the !important. */
      :host([in-sheet]) ha-card,
      :host([in-sheet]) .card-inner {
        border-radius: 0 !important;
        overflow: visible;
      }

      /* Everything moves together when the view steps to a sibling; the card's
         frame does not. */
      .content {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
        transition:
          opacity ${DETAIL_SWAP_MS}ms ${EASING},
          transform ${DETAIL_SWAP_MS}ms ${EASING};
      }
      .content.swap-out {
        opacity: 0;
        transform: translateX(-12px);
      }
      .content.swap-in {
        opacity: 0;
        transform: translateX(12px);
        transition: none;
      }

      .chart {
        touch-action: pan-y;
      }
      .guide {
        stroke: currentColor;
        stroke-opacity: 0.25;
        stroke-width: 1;
        stroke-dasharray: 2 3;
      }
      .tooltip {
        position: absolute;
        transform: translate(-50%, calc(-100% - 14px));
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 5px 10px;
        border-radius: 10px;
        background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        font-size: 11px;
        line-height: 1.3;
        white-space: nowrap;
        pointer-events: none;
        font-variant-numeric: tabular-nums;
      }
      .tooltip.below {
        transform: translate(-50%, 14px);
      }
      .tooltip b {
        font-size: 14px;
      }
      .tip-unit {
        font-weight: 400;
        font-size: 11px;
        margin-left: 2px;
      }
      .tooltip span:not(.tip-unit) {
        opacity: 0.6;
      }

      .big-toggle-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 6px 0 2px;
      }
      .big-toggle {
        position: relative;
        width: ${DETAIL_BIG_TOGGLE_WIDTH}px;
        height: ${DETAIL_BIG_TOGGLE_HEIGHT}px;
        border: none;
        padding: 8px;
        border-radius: ${DETAIL_BIG_TOGGLE_RADIUS}px;
        background: var(--dc-button-bg);
        cursor: pointer;
        transition:
          background-color 300ms ${EASING},
          border-radius 200ms ${EASING};
      }
      .big-toggle.on {
        background: var(--bt-track-on);
      }
      .big-toggle:active:not(:disabled) {
        border-radius: ${DETAIL_BIG_TOGGLE_RADIUS - 10}px;
      }
      .big-toggle:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .big-thumb {
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: 8px;
        height: calc(50% - 8px);
        border-radius: ${DETAIL_BIG_TOGGLE_RADIUS - 8}px;
        display: grid;
        place-items: center;
        background: color-mix(in srgb, var(--primary-text-color) 22%, var(--ha-card-background, var(--card-background-color, #1c1c1c)));
        color: var(--primary-text-color);
        --mdc-icon-size: 30px;
        transition:
          transform 350ms ${EASING},
          background-color 300ms ${EASING},
          color 300ms ${EASING},
          opacity 200ms;
      }
      .big-toggle.on .big-thumb {
        transform: translateY(calc(-100% - 0px));
        background: var(--bt-fill);
        color: var(--bt-ink);
      }
      .big-toggle.pending .big-thumb {
        opacity: 0.7;
      }
      .big-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }
      .big-state-label {
        font-size: 22px;
        font-weight: 700;
      }

      .share.event {
        grid-template-columns: 10px minmax(0, 1fr) auto;
      }
      .dot.missing {
        box-shadow: inset 0 0 0 1.5px currentColor;
        opacity: 0.45;
      }

      /* The folded part. A column of its own, so its height can be animated
         as one box; the gap matches the card's. */
      .details {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }

      .details-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 40px;
        border: none;
        border-radius: 20px;
        background: var(--dc-button-bg);
        color: inherit;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        opacity: 0.8;
        --mdc-icon-size: 18px;
      }
      .details-toggle ha-icon {
        transition: transform 250ms ${EASING};
      }
      .details-toggle.open ha-icon {
        transform: rotate(180deg);
      }

      .related {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .related-title {
        font-size: 13px;
        opacity: 0.6;
        margin: 4px 0 2px;
        color: var(--dc-secondary);
      }
      .related-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .related-row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: ${DETAIL_RELATED_ROW_HEIGHT}px;
        padding: 0 12px;
        border: none;
        border-radius: ${DETAIL_RELATED_ROW_RADIUS}px;
        background: var(--dc-button-bg);
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: border-radius 200ms ${EASING};
      }
      .related-row:active {
        border-radius: ${DETAIL_BUTTON_RADIUS_PRESSED}px;
      }
      .related-icon {
        flex: 0 0 auto;
        width: ${DETAIL_RELATED_ICON_SIZE}px;
        height: ${DETAIL_RELATED_ICON_SIZE}px;
        border-radius: ${DETAIL_RELATED_ICON_RADIUS}px;
        display: grid;
        place-items: center;
        background: var(--ri-bg);
        color: var(--ri-ink);
        --mdc-icon-size: 15px;
      }
      /* The name wins: it may take two lines, and the value is what gets
         shortened when the two do not fit side by side. */
      .related-name {
        flex: 1 1 auto;
        min-width: 40%;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.25;
        padding: 6px 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
      }
      .related-value {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 55%;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 14px;
        font-weight: 700;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .related-chevron {
        --mdc-icon-size: 18px;
        opacity: 0.4;
      }

      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .icon {
        flex: 0 0 auto;
        width: ${DETAIL_ICON_SIZE}px;
        height: ${DETAIL_ICON_SIZE}px;
        border-radius: ${DETAIL_ICON_RADIUS}px;
        display: grid;
        place-items: center;
        background: var(--dc-icon-bg);
        color: var(--dc-icon-ink);
        --mdc-icon-size: 22px;
      }

      .titles {
        flex: 1;
        min-width: 0;
      }

      .crumb {
        font-size: 10px;
        opacity: 0.45;
        color: var(--dc-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.4;
      }

      /* Two lines before an ellipsis: "Thermostat Arbeitszimmer" beside two
         buttons does not fit one line on a phone, and the title is the one
         thing in the view that has to be readable. */
      /* Alone in the header, above an embedded card, the area reads as a
         label rather than a footnote. */
      .crumb.solo {
        font-size: 13px;
        opacity: 0.6;
      }

      .title {
        font-size: 18px;
        font-weight: 700;
        line-height: 1.25;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        overflow-wrap: anywhere;
      }

      .hbtn {
        flex: 0 0 auto;
        width: ${DETAIL_BUTTON_SIZE}px;
        height: ${DETAIL_BUTTON_SIZE}px;
        border: none;
        padding: 0;
        display: grid;
        place-items: center;
        background: var(--dc-button-bg);
        color: inherit;
        cursor: pointer;
        --mdc-icon-size: 18px;
        transition: border-radius 200ms ${EASING};
      }
      .hbtn.settings {
        border-radius: ${DETAIL_SETTINGS_RADIUS}px;
      }
      .hbtn.close {
        border-radius: ${DETAIL_CLOSE_RADIUS}px;
      }
      .hbtn:active {
        border-radius: ${DETAIL_BUTTON_RADIUS_PRESSED}px;
      }

      .value-row {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        min-width: 0;
      }

      .value {
        display: flex;
        align-items: baseline;
        min-width: 0;
        font-variant-numeric: tabular-nums;
        line-height: 1;
      }
      .value .number {
        font-size: 52px;
        font-weight: 700;
        letter-spacing: -2.4px;
      }
      .value.long .number {
        font-size: 40px;
        letter-spacing: -1.6px;
      }
      .value.text .number {
        font-size: 28px;
        letter-spacing: -0.6px;
        overflow-wrap: anywhere;
      }
      /* The weight contrast is the point: a light unit beside a heavy number
         reads as one value with a label, not as two numbers. */
      .value .unit {
        font-size: 20px;
        font-weight: 300;
        margin-left: 3px;
        letter-spacing: 0;
      }

      .value-side {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding-top: 4px;
        min-width: 0;
      }

      .trend {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: ${DETAIL_TREND_HEIGHT}px;
        padding: 0 9px 0 7px;
        border-radius: ${DETAIL_TREND_RADIUS}px;
        background: var(--trend-bg);
        color: var(--trend-ink);
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        --mdc-icon-size: 15px;
        white-space: nowrap;
        overflow: hidden;
        box-sizing: border-box;
        transition:
          background-color 400ms ${EASING},
          color 400ms ${EASING},
          opacity 300ms ${EASING};
      }
      .trend.stale {
        opacity: 0.5;
      }
      .trend ha-icon {
        flex: 0 0 auto;
        transform: rotate(var(--trend-angle, 0deg));
        transition: transform 400ms ${EASING};
      }
      .trend-text {
        display: inline-block;
      }

      .since {
        font-size: 12px;
        opacity: 0.6;
        color: var(--dc-secondary);
      }

      .chart {
        position: relative;
        height: ${DETAIL_CHART_HEIGHT}px;
        transition: opacity 300ms ${EASING};
      }
      .chart svg {
        display: block;
        overflow: visible;
      }
      /* The old curve while it fades, laid exactly over the new one. */
      .chart svg.ghost {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .chart.dim {
        opacity: 0.45;
      }
      .chart.loading {
        border-radius: 16px;
        background: var(--dc-button-bg);
        opacity: 0.5;
      }
      .line {
        fill: none;
        stroke-width: 2.6;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .grid {
        stroke: currentColor;
        stroke-opacity: 0.08;
        stroke-width: 1;
        stroke-dasharray: 2 4;
      }
      .ytick {
        font-size: 9px;
        fill: currentColor;
        fill-opacity: 0.35;
        font-variant-numeric: tabular-nums;
        paint-order: stroke;
        stroke: var(--ha-card-background, var(--card-background-color, #1c1c1c));
        stroke-width: 3px;
        stroke-linejoin: round;
      }
      .ring {
        fill: var(--ha-card-background, var(--card-background-color, #1c1c1c));
        stroke-width: 2;
      }

      .axis {
        position: relative;
        height: 14px;
        margin-top: -6px;
        font-size: 9px;
        opacity: 0.35;
        font-variant-numeric: tabular-nums;
      }
      .tick {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
        white-space: nowrap;
      }
      .tick.start {
        transform: none;
      }
      .tick.end {
        transform: translateX(-100%);
      }

      .chart.stale {
        opacity: 0.4;
      }
      .tiles,
      .below {
        transition: opacity 300ms ${EASING};
      }
      .tiles.stale,
      .below.stale {
        opacity: 0.4;
      }

      .segments {
        display: flex;
        gap: 2px;
        padding: ${DETAIL_SEGMENT_PADDING}px;
        border-radius: ${DETAIL_SEGMENT_RADIUS}px;
        background: var(--dc-button-bg);
      }
      .segment {
        flex: 1 1 0;
        min-width: 0;
        height: ${DETAIL_PILL_HEIGHT}px;
        border: none;
        padding: 0 6px;
        border-radius: ${DETAIL_PILL_RADIUS}px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        opacity: 0.7;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition:
          border-radius 250ms ${EASING},
          background-color 250ms ${EASING},
          opacity 250ms ${EASING};
      }
      .segment.active {
        border-radius: ${DETAIL_PILL_RADIUS_ACTIVE}px;
        background: var(--seg-fill);
        color: var(--seg-ink);
        opacity: 1;
      }
      .segment:active {
        border-radius: ${DETAIL_PILL_RADIUS_ACTIVE}px;
      }

      .tiles {
        display: grid;
        gap: 8px;
      }
      .tile {
        padding: ${DETAIL_TILE_PADDING}px;
        border-radius: ${DETAIL_TILE_RADIUS}px;
        background: var(--dc-button-bg);
        text-align: center;
        min-width: 0;
      }
      .tile-value {
        font-size: 17px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color 400ms ${EASING};
      }
      .tile-unit {
        font-size: 10px;
        font-weight: 400;
        margin-left: 2px;
        opacity: 0.8;
      }
      .tiles.dense .tile {
        padding: ${DETAIL_TILE_PADDING}px 4px;
      }
      .tiles.dense .tile-value {
        font-size: 14px;
      }
      .tiles.dense .tile-unit {
        display: none;
      }
      .tile-label {
        font-size: 9px;
        opacity: 0.42;
        margin-top: 2px;
        color: var(--dc-secondary);
      }

      .timeline-placeholder {
        height: 32px;
        border-radius: 10px;
        background: var(--dc-button-bg);
        opacity: 0.5;
      }
      /* The embedded card brings its own frame; in the sheet it sits on the
         sheet's surface like any other part of the view. */
      .control {
        min-width: 0;
      }

      .no-history {
        padding: 14px 16px;
        border-radius: 16px;
        background: var(--dc-button-bg);
        font-size: 13px;
        opacity: 0.75;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-detail-card": M3DetailCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-detail-card",
  name: "M3 Detail Card",
  description: "Ein Wert groß, sein Verlauf als geglättete Kurve und die Änderung im gewählten Zeitraum.",
  // false: the preview would fetch a day of statistics for whichever sensor
  // the stub picked, for everyone who opens the card picker.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
