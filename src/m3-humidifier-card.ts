import { LitElement, html, css, svg, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type {
  HomeAssistant,
  HassEntity,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3HumidifierCardConfig,
  HumidifierModeConfig,
  HumidifierStepConfig,
  HumidifierChipConfig,
  HumidifierBlock,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_HUMIDIFIER_RADIUS,
  HUMIDIFIER_ICON_TINT,
  HUMIDIFIER_MIN_DEFAULT,
  HUMIDIFIER_MAX_DEFAULT,
  HUMIDIFIER_STEP_DEFAULT,
  HUMIDIFIER_THROTTLE_MS,
  HUMIDIFIER_DRAG_SETTLE_MS,
  HUMIDIFIER_WAVE_AMPLITUDE_LERP,
  HUMIDIFIER_SLIDER_HEIGHT,
  HUMIDIFIER_WAVE_STROKE,
  HUMIDIFIER_WAVE_AMPLITUDE,
  HUMIDIFIER_WAVE_WAVELENGTH,
  HUMIDIFIER_WAVE_GAP,
  HUMIDIFIER_HANDLE_WIDTH,
  HUMIDIFIER_HANDLE_HEIGHT,
  HUMIDIFIER_HANDLE_RADIUS,
  HUMIDIFIER_LABEL_SIZE,
  HUMIDIFIER_VALUE_SIZE,
  HUMIDIFIER_CAPTION_SIZE,
  HUMIDIFIER_MODE_HEIGHT,
  HUMIDIFIER_MODE_RADIUS,
  HUMIDIFIER_MODE_RADIUS_ACTIVE,
  HUMIDIFIER_MODE_TINT,
  HUMIDIFIER_MODE_DROPDOWN_FROM,
  HUMIDIFIER_FAN_HEIGHT,
  HUMIDIFIER_FAN_RADIUS,
  HUMIDIFIER_FAN_RADIUS_ACTIVE,
  HUMIDIFIER_FAN_TINT,
  HUMIDIFIER_BAR_WIDTH,
  HUMIDIFIER_BAR_RADIUS,
  HUMIDIFIER_BAR_HEIGHTS,
  HUMIDIFIER_CHIP_HEIGHT,
  HUMIDIFIER_CHIP_RADIUS,
  HUMIDIFIER_CHIP_RADIUS_ACTIVE,
  HUMIDIFIER_CHIP_GAP,
  HUMIDIFIER_CHIP_TINT,
  HUMIDIFIER_TANK_WARN,
  HUMIDIFIER_TANK_FULL,
  HUMIDIFIER_NARROW_PX,
  HUMIDIFIER_MODE_COLORS,
  HUMIDIFIER_MODE_PALETTE,
  resolveCornerRadius,
} from "./const";
import {
  resolveThemeColor,
  buildCssVars,
  resolveCommonColors,
  tintOn,
  foregroundOn,
  inkOn,
} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate, isReducedMotion, STANDARD_EASING } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { DragThrottle } from "./shared/drag-throttle";
import { buildWavePath, lerpStep } from "./shared/wave";
import { localize, type TranslationKey } from "./localize";
import { formatNumber } from "./shared/formatting";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-HUMIDIFIER-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #6ba7dc; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #6ba7dc; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);
const DEFAULT_WIDTH = 300;
const DEFAULT_LAYOUT: HumidifierBlock[] = ["slider", "modes", "fan", "chips"];

/** What the device is doing right now, normalised across the shapes HA uses. */
type Action = "drying" | "humidifying" | "idle" | "off";

interface ResolvedMode {
  mode: string;
  name: string;
  icon: string;
  color: string;
  /** The off pill is not a mode — it calls turn_off. */
  isOff: boolean;
  active: boolean;
}

interface ResolvedStep {
  name: string;
  /** How many of the three bars are filled, 0–3. */
  bars: number;
  active: boolean;
  apply: () => void;
}

const ACTION_KEYS: Record<Action, TranslationKey> = {
  drying: "humidifier_action_drying",
  humidifying: "humidifier_action_humidifying",
  idle: "humidifier_action_idle",
  off: "humidifier_action_off",
};

/** `select` and `input_select` behave identically here, and helpers are the
 *  usual way to stand in for a device an integration exposes badly. */
function isSelect(domain: string): boolean {
  return domain === "select" || domain === "input_select";
}

/** Title-cases a raw mode/option string when no name was configured for it. */
function prettify(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

@customElement("m3-humidifier-card")
export class M3HumidifierCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3HumidifierCardConfig;

  // Not @state, for the reason the light card documents: both advance every
  // animation frame and feed one SVG path. As reactive fields they would
  // re-render the whole card — pills, chips and all — at frame rate.
  private _phase = 0;
  private _displayAmplitude = 0;

  @state() private _measuredWidth = DEFAULT_WIDTH;
  @state() private _dragging = false;
  @state() private _dragValue?: number;

  @query(".wave-slider") private _sliderEl?: HTMLDivElement;

  private _rafId?: number;
  private _resizeObserver?: ResizeObserver;
  private _intersectionObserver?: IntersectionObserver;
  private _isIntersecting = true;
  private _targetAmplitude = 0;
  private _waveGeom?: { activeEnd: number; midY: number };
  private _phaseAnimating = false;
  private _dragEndTimer?: number;

  private readonly _targetThrottle = new DragThrottle<number>(
    (value) => this._setTargetNow(value),
    HUMIDIFIER_THROTTLE_MS,
  );

  public static getStubConfig(hass: HomeAssistant): M3HumidifierCardConfig {
    const states = hass?.states ?? {};
    const humidifier = Object.keys(states).find((e) => e.startsWith("humidifier."));
    return {
      type: "custom:m3-humidifier-card",
      entity: humidifier ?? "",
      glass_background: true,
    };
  }

  public setConfig(config: M3HumidifierCardConfig): void {
    if (!config?.entity) throw new Error("entity is required");
    this._config = {
      glass_background: true,
      animation: "auto",
      mode_style: "icon_label",
      tank_style: "chip",
      ...config,
    };
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 3 };
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-humidifier-card-editor");
    return document.createElement("m3-humidifier-card-editor") as unknown as LovelaceCardEditor;
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, this._watchedEntities());
  }

  /**
   * Every entity the card reads. Collected in one place because the card is
   * deliberately open about where its values come from: half of these are
   * optional overrides that most configs never set.
   */
  private _watchedEntities(): string[] {
    const c = this._config;
    if (!c) return [];
    return [
      c.entity,
      c.current_entity,
      c.target_entity,
      c.action_entity,
      c.mode_entity,
      c.fan_entity,
      c.tank_entity,
      ...(c.controls ?? []).map((x) => x.entity),
      ...(c.sensors ?? []).map((x) => x.entity),
    ].filter((e): e is string => !!e);
  }

  // ---- Lifecycle ------------------------------------------------------------

  public connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && Math.abs(w - this._measuredWidth) > 1) this._measuredWidth = w;
    });
    // Only ticks while the card is on screen. A humidifier on a wall tablet
    // would otherwise animate its wave for hours to an empty room.
    this._intersectionObserver = new IntersectionObserver((entries) => {
      this._isIntersecting = entries[0]?.isIntersecting ?? true;
      if (this._isIntersecting) this._startAnimationLoop();
    });
    this._intersectionObserver.observe(this);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._intersectionObserver?.disconnect();
    if (this._rafId !== undefined) cancelAnimationFrame(this._rafId);
    this._rafId = undefined;
    this._targetThrottle.clear();
    window.clearTimeout(this._dragEndTimer);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    const el = this.renderRoot.querySelector(".wave-slider") as HTMLElement | null;
    if (el && this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver.observe(el);
    }
  }

  private _startAnimationLoop(): void {
    if (this._rafId !== undefined) return;
    const tick = (): void => {
      this._rafId = undefined;
      if (!this._isIntersecting) return;
      if (this._phaseAnimating) this._phase -= 0.08;
      this._displayAmplitude = lerpStep(
        this._displayAmplitude,
        this._targetAmplitude,
        HUMIDIFIER_WAVE_AMPLITUDE_LERP,
      );
      this._repaintWave();
      const settled = Math.abs(this._displayAmplitude - this._targetAmplitude) < 0.01;
      if (settled) this._displayAmplitude = this._targetAmplitude;
      if (this._phaseAnimating || !settled) this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  /** Rewrites the path attribute directly, so a frame costs no Lit render. */
  private _repaintWave(): void {
    const geom = this._waveGeom;
    if (!geom) return;
    const path = this.renderRoot.querySelector(".wave-active") as SVGPathElement | null;
    if (!path) return;
    path.setAttribute(
      "d",
      buildWavePath(
        0,
        geom.activeEnd,
        this._displayAmplitude,
        HUMIDIFIER_WAVE_WAVELENGTH,
        this._phase,
        geom.midY,
      ),
    );
  }

  // ---- Reading the device ---------------------------------------------------

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _state(entityId?: string): HassEntity | undefined {
    return entityId ? this.hass?.states[entityId] : undefined;
  }

  private _num(entityId: string | undefined, attribute?: string): number | undefined {
    const st = this._state(entityId);
    if (!st) return undefined;
    const raw = attribute ? st.attributes?.[attribute] : st.state;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    return Number.isFinite(n) ? n : undefined;
  }

  private get _main(): HassEntity | undefined {
    return this._state(this._config?.entity);
  }

  private get _unavailable(): boolean {
    const st = this._main;
    return !st || st.state === "unavailable" || st.state === "unknown";
  }

  private get _isOn(): boolean {
    const st = this._main;
    if (!st) return false;
    return st.state !== "off" && st.state !== "unavailable" && st.state !== "unknown";
  }

  /**
   * Dehumidifier or humidifier. Decides the wording and the default icon, and
   * it is worth overriding: plenty of integrations set no device_class at all,
   * and a `switch`-based device has none by definition.
   */
  private get _kind(): "humidifier" | "dehumidifier" {
    if (this._config?.device_kind) return this._config.device_kind;
    const dc = this._main?.attributes?.device_class as string | undefined;
    return dc === "dehumidifier" ? "dehumidifier" : "humidifier";
  }

  private get _currentHumidity(): number | undefined {
    const c = this._config;
    if (c?.current_entity) return this._num(c.current_entity);
    return this._num(c?.entity, "current_humidity");
  }

  private get _targetHumidity(): number | undefined {
    const c = this._config;
    if (c?.target_entity) return this._num(c.target_entity);
    return this._num(c?.entity, "humidity");
  }

  private get _range(): { min: number; max: number } {
    const c = this._config;
    const src = c?.target_entity ? this._state(c.target_entity) : this._main;
    const min =
      c?.min_humidity ??
      (src?.attributes?.min_humidity as number | undefined) ??
      (src?.attributes?.min as number | undefined) ??
      HUMIDIFIER_MIN_DEFAULT;
    const max =
      c?.max_humidity ??
      (src?.attributes?.max_humidity as number | undefined) ??
      (src?.attributes?.max as number | undefined) ??
      HUMIDIFIER_MAX_DEFAULT;
    return max > min ? { min, max } : { min: HUMIDIFIER_MIN_DEFAULT, max: HUMIDIFIER_MAX_DEFAULT };
  }

  /**
   * What the device reports doing. `action` is the documented attribute, but it
   * is optional and many integrations omit it — then the state plus the
   * direction of travel is the best available answer, which is still better
   * than showing nothing.
   */
  private get _action(): Action {
    const c = this._config;
    const raw = c?.action_entity
      ? this._state(c.action_entity)?.state
      : (this._main?.attributes?.action as string | undefined);
    const known = String(raw ?? "").toLowerCase();
    if (known === "drying" || known === "humidifying" || known === "idle" || known === "off") {
      return known as Action;
    }
    if (!this._isOn) return "off";
    const current = this._currentHumidity;
    const target = this._targetHumidity;
    if (current === undefined || target === undefined) return "idle";
    if (Math.abs(current - target) < 1) return "idle";
    return current > target ? "drying" : "humidifying";
  }

  private get _accent(): string {
    if (this._config?.accent_color) return resolveThemeColor(this._config.accent_color);
    const active = this._modes().find((m) => m.active && !m.isOff);
    return active?.color ?? resolveThemeColor(HUMIDIFIER_MODE_COLORS.normal);
  }

  private get _layout(): HumidifierBlock[] {
    return this._config?.layout?.length ? this._config.layout : DEFAULT_LAYOUT;
  }

  private get _narrow(): boolean {
    return this._measuredWidth > 0 && this._measuredWidth < HUMIDIFIER_NARROW_PX;
  }

  // ---- Modes ----------------------------------------------------------------

  /**
   * Three sources, in order: an explicit `modes` list, a `select` named by
   * `mode_entity`, or the humidifier's own `available_modes`. The off pill is
   * prepended in every case, because turning the thing off is not a mode and
   * every integration spells it differently if it offers one at all.
   */
  private _modes(): ResolvedMode[] {
    const c = this._config;
    if (!c) return [];

    const declared = c.modes?.filter((m) => !m.hidden);
    const selectEntity = c.mode_entity ? this._state(c.mode_entity) : undefined;
    // A select's options live under `options`; a humidifier's under
    // `available_modes`. Both are read below, so either kind can drive the row.
    const available: string[] =
      declared?.map((m) => m.mode) ??
      (selectEntity?.attributes?.options as string[] | undefined) ??
      ((this._main?.attributes?.available_modes as string[] | undefined) ?? []);

    if (available.length === 0) return [];

    const currentMode = selectEntity
      ? selectEntity.state
      : (this._main?.attributes?.mode as string | undefined);

    const byMode = new Map((declared ?? []).map((m) => [m.mode, m]));
    let paletteIndex = 0;

    const modes: ResolvedMode[] = available.map((raw) => {
      const cfg: HumidifierModeConfig | undefined = byMode.get(raw);
      const key = raw.toLowerCase();
      const fallback =
        HUMIDIFIER_MODE_COLORS[key] ??
        HUMIDIFIER_MODE_PALETTE[paletteIndex++ % HUMIDIFIER_MODE_PALETTE.length];
      return {
        mode: raw,
        name: cfg?.name ?? prettify(raw),
        icon: cfg?.icon ?? this._modeIcon(key),
        color: resolveThemeColor(cfg?.color ?? fallback),
        isOff: false,
        active: this._isOn && currentMode === raw,
      };
    });

    return [
      {
        mode: "__off__",
        name: this._t("humidifier_off"),
        icon: "mdi:power",
        color: resolveThemeColor(HUMIDIFIER_MODE_COLORS.off),
        isOff: true,
        active: !this._isOn,
      },
      ...modes,
    ];
  }

  private _modeIcon(key: string): string {
    if (key.includes("auto")) return "mdi:auto-mode";
    if (key.includes("boost") || key.includes("turbo") || key.includes("max")) return "mdi:rocket-launch-outline";
    if (key.includes("sleep") || key.includes("night")) return "mdi:weather-night";
    if (key.includes("baby")) return "mdi:baby-carriage";
    if (key.includes("eco")) return "mdi:leaf";
    if (key.includes("away")) return "mdi:home-export-outline";
    return this._kind === "dehumidifier" ? "mdi:water-off-outline" : "mdi:water-outline";
  }

  // ---- Fan ------------------------------------------------------------------

  /**
   * A fan row can be driven by three different things, and which one it is has
   * to be worked out rather than assumed: a `fan` with `preset_modes`, a `fan`
   * with a percentage, or a `select` holding the speed. The configured
   * `fan_steps` win over all of them.
   */
  private _fanSteps(): ResolvedStep[] {
    const c = this._config;
    const st = this._state(c?.fan_entity);
    if (!c?.fan_entity || !st) return [];

    const domain = c.fan_entity.split(".")[0];
    const presets = (st.attributes?.preset_modes as string[] | undefined) ?? [];
    const options = (st.attributes?.options as string[] | undefined) ?? [];
    const currentPreset = st.attributes?.preset_mode as string | undefined;
    const currentPct = st.attributes?.percentage as number | undefined;
    const fanOn = st.state === "on";

    const declared = c.fan_steps;
    const bars = (i: number, total: number): number =>
      i === 0 ? 0 : Math.min(3, Math.max(1, Math.round((i / Math.max(1, total - 1)) * 3)));

    if (declared?.length) {
      return declared.map((step, i) => {
        const label = step.name ?? prettify(step.preset ?? step.option ?? String(step.percentage ?? i));
        return {
          name: label,
          bars: bars(i, declared.length),
          active: this._stepActive(step, { domain, currentPreset, currentPct, fanOn }),
          apply: () => this._applyStep(step, domain),
        };
      });
    }

    if (isSelect(domain) && options.length) {
      return options.map((option, i) => ({
        name: prettify(option),
        bars: bars(i, options.length),
        active: st.state === option,
        apply: () => this._call(domain, "select_option", { option }, c.fan_entity!),
      }));
    }

    if (presets.length) {
      const steps: HumidifierStepConfig[] = [
        { name: this._t("humidifier_off") },
        ...presets.map((p) => ({ preset: p })),
      ];
      return steps.map((step, i) => ({
        name: step.name ?? prettify(step.preset!),
        bars: bars(i, steps.length),
        active: i === 0 ? !fanOn : fanOn && currentPreset === step.preset,
        apply: () => this._applyStep(step, domain),
      }));
    }

    // Percentage fan: three steps plus off, which is what a fan with a
    // percentage_step of 33 or 25 actually offers a person.
    const pcts = [0, 33, 66, 100];
    const labels: TranslationKey[] = [
      "humidifier_off",
      "humidifier_fan_low",
      "humidifier_fan_medium",
      "humidifier_fan_high",
    ];
    return pcts.map((pct, i) => ({
      name: this._t(labels[i]),
      bars: i,
      active: i === 0 ? !fanOn || currentPct === 0 : fanOn && this._nearestPct(currentPct, pcts) === pct,
      apply: () => this._applyStep({ percentage: pct }, domain),
    }));
  }

  private _nearestPct(value: number | undefined, pcts: number[]): number | undefined {
    if (value === undefined) return undefined;
    return pcts.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), pcts[0]);
  }

  private _stepActive(
    step: HumidifierStepConfig,
    ctx: { domain: string; currentPreset?: string; currentPct?: number; fanOn: boolean },
  ): boolean {
    if (step.option !== undefined) return this._state(this._config?.fan_entity)?.state === step.option;
    if (step.preset !== undefined) return ctx.fanOn && ctx.currentPreset === step.preset;
    if (step.percentage !== undefined) {
      if (step.percentage === 0) return !ctx.fanOn || ctx.currentPct === 0;
      return ctx.fanOn && ctx.currentPct === step.percentage;
    }
    return !ctx.fanOn;
  }

  private _applyStep(step: HumidifierStepConfig, domain: string): void {
    const eid = this._config?.fan_entity;
    if (!eid) return;
    if (step.option !== undefined) {
      this._call(isSelect(domain) ? domain : "select", "select_option", { option: step.option }, eid);
      return;
    }
    if (step.preset !== undefined) {
      this._call(domain, "turn_on", { preset_mode: step.preset }, eid);
      return;
    }
    if (step.percentage !== undefined) {
      // Percentage 0 is "off" for a fan, and set_percentage(0) is how the fan
      // integration itself spells that — no separate turn_off call needed.
      this._call(domain, "set_percentage", { percentage: step.percentage }, eid);
      return;
    }
    this._call(domain, "turn_off", {}, eid);
  }

  // ---- Service calls --------------------------------------------------------

  private _call(domain: string, service: string, data: Record<string, unknown>, entityId: string): void {
    this.hass?.callService(domain, service, { ...data, entity_id: entityId });
  }

  private _setTargetNow(value: number): void {
    const c = this._config;
    if (!c) return;
    if (c.target_entity) {
      const domain = c.target_entity.split(".")[0];
      if (domain === "number" || domain === "input_number") {
        this._call(domain, "set_value", { value }, c.target_entity);
        return;
      }
      this._call("humidifier", "set_humidity", { humidity: value }, c.target_entity);
      return;
    }
    this._call("humidifier", "set_humidity", { humidity: value }, c.entity);
  }

  private _selectMode(mode: ResolvedMode): void {
    const c = this._config;
    if (!c || this._unavailable) return;
    if (mode.isOff) {
      const domain = c.entity.split(".")[0];
      this._call(domain, "turn_off", {}, c.entity);
      return;
    }
    if (!this._isOn) {
      const domain = c.entity.split(".")[0];
      this._call(domain, "turn_on", {}, c.entity);
    }
    if (c.mode_entity) {
      this._call(c.mode_entity.split(".")[0], "select_option", { option: mode.mode }, c.mode_entity);
      return;
    }
    this._call("humidifier", "set_mode", { mode: mode.mode }, c.entity);
  }

  private _toggleChip(chip: HumidifierChipConfig): void {
    const domain = chip.entity.split(".")[0];
    if (domain === "switch" || domain === "input_boolean" || domain === "fan" || domain === "light") {
      this._call(domain, "toggle", {}, chip.entity);
      return;
    }
    if (domain === "button" || domain === "input_button") {
      this._call(domain, "press", {}, chip.entity);
      return;
    }
    if (domain === "select" || domain === "input_select") {
      this._call(domain, "select_next", { cycle: true }, chip.entity);
    }
  }

  // ---- Slider interaction ---------------------------------------------------

  private _valueFromClientX(clientX: number): number {
    const el = this._sliderEl;
    const { min, max } = this._range;
    if (!el) return min;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const raw = rect.width > 0 ? min + (x / rect.width) * (max - min) : min;
    const step = this._config?.humidity_step ?? HUMIDIFIER_STEP_DEFAULT;
    return Math.min(max, Math.max(min, Math.round(raw / step) * step));
  }

  private _handlePointerDown = (e: PointerEvent): void => {
    if (this._unavailable) return;
    e.preventDefault();
    this._sliderEl?.setPointerCapture(e.pointerId);
    this._dragging = true;
    const value = this._valueFromClientX(e.clientX);
    this._dragValue = value;
    this._targetThrottle.call(value);
  };

  private _handlePointerMove = (e: PointerEvent): void => {
    if (!this._dragging) return;
    const value = this._valueFromClientX(e.clientX);
    if (value === this._dragValue) return;
    this._dragValue = value;
    this._targetThrottle.call(value);
  };

  private _handlePointerUp = (e: PointerEvent): void => {
    if (!this._dragging) return;
    const value = this._dragValue ?? this._valueFromClientX(e.clientX);
    this._targetThrottle.flush(value);
    this._scheduleDragEnd();
  };

  private _handleKeydown = (e: KeyboardEvent): void => {
    if (this._unavailable) return;
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    const { min, max } = this._range;
    const step = (this._config?.humidity_step ?? HUMIDIFIER_STEP_DEFAULT) * (e.shiftKey ? 5 : 1);
    const current = this._dragValue ?? this._targetHumidity ?? min;
    const next = Math.min(max, Math.max(min, current + dir * step));
    this._dragging = true;
    this._dragValue = next;
    this._targetThrottle.call(next);
    this._scheduleDragEnd();
  };

  private _scheduleDragEnd(): void {
    window.clearTimeout(this._dragEndTimer);
    this._dragEndTimer = window.setTimeout(() => {
      this._dragging = false;
      this._dragValue = undefined;
      this._dragEndTimer = undefined;
    }, HUMIDIFIER_DRAG_SETTLE_MS);
  }

  // ---- Render ---------------------------------------------------------------

  protected render(): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;
    if (!this.hass.states[cfg.entity]) return renderMissingEntity(cfg.entity);

    const unavailable = this._unavailable;
    const accent = this._accent;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_HUMIDIFIER_RADIUS, cfg.corners);

    const iconBg = tintOn(this, accent, undefined, HUMIDIFIER_ICON_TINT);
    const cssVars = buildCssVars({
      "m3h-accent": accent,
      "m3h-ink": inkOn(accent, this),
      "m3h-icon-bg": iconBg,
      "m3h-icon-fg": foregroundOn(accent, iconBg, 3, this),
      "m3h-text": textColorCss,
      "m3h-secondary": secondaryTextColorCss,
    });

    const target = this._dragValue ?? this._targetHumidity;
    const current = this._currentHumidity;
    const action = this._action;
    const subtitle = unavailable
      ? this._t("humidifier_unavailable")
      : target === undefined
        ? this._t(ACTION_KEYS[action])
        : `${this._t(ACTION_KEYS[action])} · ${this._t("humidifier_target_short").replace(
            "{n}",
            formatNumber(this._language, target, { maximumFractionDigits: 0 }),
          )}`;

    this._phaseAnimating =
      !unavailable &&
      (action === "drying" || action === "humidifying") &&
      shouldAnimate(cfg.animation) &&
      !isReducedMotion();
    this._targetAmplitude = this._phaseAnimating ? HUMIDIFIER_WAVE_AMPLITUDE : 0;
    if (this._phaseAnimating || this._displayAmplitude !== this._targetAmplitude) {
      this._startAnimationLoop();
    }

    const blocks = this._layout.map((b) => this._renderBlock(b, unavailable));

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${unavailable ? "off" : ""} ${
            shouldAnimate(cfg.animation) ? "" : "no-animations"
          }"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon: cfg.icon ?? (this._kind === "dehumidifier" ? "mdi:air-humidifier-off" : "mdi:air-humidifier"),
            name: cfg.name ?? this._main?.attributes?.friendly_name ?? cfg.entity,
            subtitle,
            right:
              current === undefined
                ? undefined
                : html`
                    <div class="reading">
                      <div class="reading-value">
                        ${formatNumber(this._language, current, { maximumFractionDigits: 0 })}<span
                          class="reading-unit"
                          >%</span
                        >
                      </div>
                      <div class="reading-caption">${this._t("humidifier_current")}</div>
                    </div>
                  `,
          })}
          ${this._renderTankHint()} ${blocks}
        </div>
      </ha-card>
    `;
  }

  private _renderBlock(block: HumidifierBlock, unavailable: boolean): TemplateResult | typeof nothing {
    switch (block) {
      case "slider":
        return this._renderSlider(unavailable);
      case "modes":
        return this._renderModes(unavailable);
      case "fan":
        return this._renderFan(unavailable);
      case "chips":
        return this._renderChips(unavailable);
      default:
        return nothing;
    }
  }

  private _renderSlider(unavailable: boolean): TemplateResult | typeof nothing {
    const target = this._dragValue ?? this._targetHumidity;
    if (target === undefined) return nothing;

    const { min, max } = this._range;
    const width = this._measuredWidth;
    const height = HUMIDIFIER_SLIDER_HEIGHT;
    const midY = height / 2;
    const handleW = HUMIDIFIER_HANDLE_WIDTH;
    const pct = max > min ? ((target - min) / (max - min)) * 100 : 0;

    const handleX = handleW / 2 + (pct / 100) * Math.max(0, width - handleW);
    const gapHalf = HUMIDIFIER_WAVE_GAP / 2;
    const activeEnd = Math.max(0, handleX - gapHalf - handleW / 2);
    const trackStart = Math.min(width, handleX + gapHalf + handleW / 2);
    const hasActive = activeEnd > 1;
    const hasTrack = trackStart < width - 1;
    this._waveGeom = hasActive ? { activeEnd, midY } : undefined;
    const activePath = hasActive
      ? buildWavePath(0, activeEnd, this._displayAmplitude, HUMIDIFIER_WAVE_WAVELENGTH, this._phase, midY)
      : "";

    return html`
      <div class="block">
        <div class="block-head">
          <span class="block-label">${this._t("humidifier_target")}</span>
          <span class="block-value"
            >${formatNumber(this._language, target, { maximumFractionDigits: 0 })} %</span
          >
        </div>
        <div
          class="wave-slider ${unavailable ? "disabled" : ""} ${this._dragging ? "dragging" : ""}"
          role="slider"
          aria-label=${this._t("humidifier_slider_label")}
          aria-valuemin=${min}
          aria-valuemax=${max}
          aria-valuenow=${target}
          aria-disabled=${unavailable ? "true" : "false"}
          tabindex=${unavailable ? -1 : 0}
          @pointerdown=${this._handlePointerDown}
          @pointermove=${this._handlePointerMove}
          @pointerup=${this._handlePointerUp}
          @pointercancel=${this._handlePointerUp}
          @keydown=${this._handleKeydown}
        >
          <svg
            class="wave-svg"
            viewBox="0 0 ${width} ${height}"
            width="100%"
            height=${height}
            preserveAspectRatio="none"
          >
            ${hasActive
              ? svg`<path class="wave-active" d=${activePath} fill="none"></path>`
              : nothing}
            ${hasTrack
              ? svg`<line class="wave-track" x1=${trackStart} y1=${midY} x2=${width} y2=${midY}></line>`
              : nothing}
          </svg>
          <div class="handle" style=${`left: ${handleX}px;`}></div>
        </div>
      </div>
    `;
  }

  private _renderModes(unavailable: boolean): TemplateResult | typeof nothing {
    const modes = this._modes();
    if (modes.length <= 1) return nothing;

    const style =
      this._config?.mode_style === "dropdown" || modes.length > HUMIDIFIER_MODE_DROPDOWN_FROM
        ? "dropdown"
        : this._narrow
          ? "icon_only"
          : (this._config?.mode_style ?? "icon_label");

    if (style === "dropdown") {
      const active = modes.find((m) => m.active);
      return html`
        <div class="block">
          <span class="block-label">${this._t("humidifier_mode")}</span>
          <select
            class="mode-select"
            ?disabled=${unavailable}
            @change=${(e: Event) => {
              const value = (e.target as HTMLSelectElement).value;
              const mode = modes.find((m) => m.mode === value);
              if (mode) this._selectMode(mode);
            }}
          >
            ${modes.map(
              (m) => html`<option value=${m.mode} ?selected=${m.mode === active?.mode}>${m.name}</option>`,
            )}
          </select>
        </div>
      `;
    }

    return html`
      <div class="block">
        <span class="block-label">${this._t("humidifier_mode")}</span>
        <div class="pill-row">
          ${modes.map((m) => {
            const onTap = (): void => this._selectMode(m);
            return html`
              <button
                class="mode-pill ${m.active ? "active" : ""}"
                style=${buildCssVars({
                  "m3h-pill": m.color,
                  "m3h-pill-tint": tintOn(this, m.color, undefined, HUMIDIFIER_MODE_TINT),
                  "m3h-pill-ink": inkOn(m.color, this),
                })}
                ?disabled=${unavailable}
                aria-pressed=${m.active ? "true" : "false"}
                @click=${onTap}
                @keydown=${activateOnKey(onTap)}
              >
                <ha-icon icon=${m.icon}></ha-icon>
                ${style === "icon_only" ? nothing : html`<span class="pill-label">${m.name}</span>`}
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  private _renderFan(unavailable: boolean): TemplateResult | typeof nothing {
    const steps = this._fanSteps();
    if (steps.length === 0) return nothing;
    const accent = this._accent;

    return html`
      <div class="block">
        <span class="block-label">${this._t("humidifier_fan")}</span>
        <div class="pill-row ${this._narrow ? "wrap" : ""}">
          ${steps.map((step) => {
            const onTap = (): void => step.apply();
            return html`
              <button
                class="fan-pill ${step.active ? "active" : ""}"
                style=${buildCssVars({
                  "m3h-fan-tint": tintOn(this, accent, undefined, HUMIDIFIER_FAN_TINT),
                })}
                ?disabled=${unavailable}
                aria-pressed=${step.active ? "true" : "false"}
                @click=${onTap}
                @keydown=${activateOnKey(onTap)}
              >
                <span class="bars" aria-hidden="true">
                  ${HUMIDIFIER_BAR_HEIGHTS.map(
                    (h, i) =>
                      html`<span
                        class="bar ${i < step.bars ? "on" : ""}"
                        style=${`height: ${h}px;`}
                      ></span>`,
                  )}
                </span>
                <span class="pill-label">${step.name}</span>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  private _renderChips(unavailable: boolean): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg) return nothing;

    const chips: TemplateResult[] = [];
    const tank = this._renderTankChip();
    if (tank) chips.push(tank);

    for (const control of cfg.controls ?? []) {
      const st = this._state(control.entity);
      if (!st) continue;
      const on = st.state === "on" || st.state === "true";
      const color = resolveThemeColor(control.color ?? this._accent);
      const tint = tintOn(this, color, undefined, HUMIDIFIER_CHIP_TINT);
      const onTap = (): void => this._toggleChip(control);
      chips.push(html`
        <button
          class="chip control ${on ? "active" : ""}"
          style=${buildCssVars({
            "m3h-chip": color,
            "m3h-chip-tint": tint,
            "m3h-chip-fg": foregroundOn(color, tint, 3, this),
            "m3h-chip-ink": inkOn(color, this),
          })}
          ?disabled=${unavailable}
          aria-pressed=${on ? "true" : "false"}
          @click=${onTap}
          @keydown=${activateOnKey(onTap)}
        >
          ${control.icon ? html`<ha-icon icon=${control.icon}></ha-icon>` : nothing}
          <span>${control.name ?? st.attributes?.friendly_name ?? control.entity}</span>
        </button>
      `);
    }

    for (const sensor of cfg.sensors ?? []) {
      const st = this._state(sensor.entity);
      if (!st || st.state === "unavailable" || st.state === "unknown") continue;
      const color = resolveThemeColor(sensor.color ?? this._accent);
      const tint = tintOn(this, color, undefined, HUMIDIFIER_CHIP_TINT);
      const unit = (st.attributes?.unit_of_measurement as string | undefined) ?? "";
      const text = sensor.label ?? `${sensor.name ? `${sensor.name} ` : ""}${st.state}${unit ? ` ${unit}` : ""}`;
      chips.push(html`
        <span
          class="chip"
          style=${buildCssVars({
            "m3h-chip": color,
            "m3h-chip-tint": tint,
            "m3h-chip-fg": foregroundOn(color, tint, 3, this),
          })}
        >
          ${sensor.icon ? html`<ha-icon icon=${sensor.icon}></ha-icon>` : nothing}
          <span>${text}</span>
        </span>
      `);
    }

    if (chips.length === 0) return nothing;
    return html`<div class="chip-row">${chips}</div>`;
  }

  /** Numeric level, a binary "full" sensor, or nothing at all. */
  private _tankLevel(): { pct?: number; full: boolean } | undefined {
    const eid = this._config?.tank_entity;
    const st = this._state(eid);
    if (!eid || !st || st.state === "unavailable" || st.state === "unknown") return undefined;
    if (eid.startsWith("binary_sensor.") || st.state === "on" || st.state === "off") {
      return { full: st.state === "on" };
    }
    const pct = this._num(eid);
    if (pct === undefined) return undefined;
    return { pct, full: pct >= (this._config?.tank_full ?? HUMIDIFIER_TANK_FULL) };
  }

  private _renderTankChip(): TemplateResult | undefined {
    if (this._config?.tank_style === "bar") return undefined;
    const tank = this._tankLevel();
    if (!tank) return undefined;

    const warn = this._config?.tank_warn ?? HUMIDIFIER_TANK_WARN;
    const color = tank.full
      ? resolveThemeColor("#e57368")
      : tank.pct !== undefined && tank.pct >= warn
        ? resolveThemeColor("#f0a24a")
        : undefined;

    // A binary sensor that is not full says nothing worth a chip.
    if (tank.pct === undefined && !tank.full) return undefined;

    const text = tank.full
      ? this._t("humidifier_tank_full")
      : this._t("humidifier_tank").replace(
          "{n}",
          formatNumber(this._language, tank.pct ?? 0, { maximumFractionDigits: 0 }),
        );

    const warnTint = color ? tintOn(this, color, undefined, HUMIDIFIER_CHIP_TINT * 1.6) : undefined;
    return html`
      <span
        class="chip ${color ? "warn" : ""}"
        style=${buildCssVars({
          "m3h-chip": color,
          "m3h-chip-tint": warnTint,
          "m3h-chip-fg": color && warnTint ? foregroundOn(color, warnTint, 3, this) : undefined,
        })}
      >
        <ha-icon icon="mdi:cup-water"></ha-icon>
        <span>${text}</span>
      </span>
    `;
  }

  private _renderTankHint(): TemplateResult | typeof nothing {
    const tank = this._tankLevel();
    if (!tank?.full) return nothing;
    return html`<div class="hint">${this._t("humidifier_tank_hint")}</div>`;
  }

  static styles = css`
    ${glassCardStyles}
    ${cardHeaderStyles}

    :host {
      display: block;
      height: 100%;
      /* The browser's tap highlight is a rectangle and ignores the border
         radius, so every pill and chip would flash a grey box on press. */
      -webkit-tap-highlight-color: transparent;
    }

    ha-card {
      color: var(--m3h-text);
    }

    /* .card-inner's glass/solid background, padding, gap and border all come
       from glassCardStyles. Only the two things this card actually differs on
       are set here. */
    .card-inner {
      gap: var(--m3-card-gap, 12px);
    }

    .card-inner.off {
      opacity: 0.4;
      pointer-events: none;
    }

    .m3-icon-swatch {
      background: var(--m3h-icon-bg);
      color: var(--m3h-icon-fg);
    }

    /* ---- header reading ---- */
    .reading {
      margin-left: auto;
      text-align: right;
      line-height: 1.05;
    }

    .reading-value {
      font-size: ${HUMIDIFIER_VALUE_SIZE}px;
      font-weight: 700;
      color: var(--m3h-accent);
      font-variant-numeric: tabular-nums;
    }

    .reading-unit {
      font-size: ${Math.round(HUMIDIFIER_VALUE_SIZE * 0.5)}px;
      font-weight: 700;
    }

    .reading-caption {
      font-size: ${HUMIDIFIER_CAPTION_SIZE}px;
      opacity: 0.5;
      color: var(--m3h-secondary);
    }

    /* ---- blocks ---- */
    .block {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }

    .block-label {
      font-size: ${HUMIDIFIER_LABEL_SIZE}px;
      opacity: 0.5;
      color: var(--m3h-secondary);
    }

    .block-value {
      font-size: 13px;
      font-weight: 700;
      color: var(--m3h-accent);
      font-variant-numeric: tabular-nums;
    }

    .hint {
      font-size: 11px;
      opacity: 0.7;
      color: var(--m3h-secondary);
      margin-top: -6px;
    }

    /* ---- slider ---- */
    .wave-slider {
      position: relative;
      height: ${HUMIDIFIER_SLIDER_HEIGHT}px;
      cursor: pointer;
      touch-action: none;
      outline: none;
    }

    .wave-slider.disabled {
      cursor: default;
    }

    .wave-slider:focus-visible {
      outline: 2px solid var(--m3h-accent);
      outline-offset: 3px;
      border-radius: 8px;
    }

    .wave-svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .wave-active {
      stroke: var(--m3h-accent);
      stroke-width: ${HUMIDIFIER_WAVE_STROKE}px;
      stroke-linecap: round;
    }

    .wave-track {
      stroke: color-mix(in srgb, var(--m3h-secondary) 22%, transparent);
      stroke-width: ${HUMIDIFIER_WAVE_STROKE}px;
      stroke-linecap: round;
    }

    .handle {
      position: absolute;
      top: 50%;
      width: ${HUMIDIFIER_HANDLE_WIDTH}px;
      height: ${HUMIDIFIER_HANDLE_HEIGHT}px;
      border-radius: ${HUMIDIFIER_HANDLE_RADIUS}px;
      background: var(--m3h-text);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    /* ---- pills ---- */
    .pill-row {
      display: flex;
      gap: 6px;
    }

    .pill-row.wrap {
      flex-wrap: wrap;
    }

    .mode-pill,
    .fan-pill {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: none;
      cursor: pointer;
      color: var(--m3h-text);
      font-family: inherit;
      transition:
        border-radius 0.35s ${EASING},
        background 0.35s ${EASING},
        color 0.35s ${EASING};
    }

    .no-animations .mode-pill,
    .no-animations .fan-pill,
    .no-animations .chip {
      transition: none;
    }

    .mode-pill {
      flex-direction: column;
      gap: 2px;
      height: ${HUMIDIFIER_MODE_HEIGHT}px;
      border-radius: ${HUMIDIFIER_MODE_RADIUS}px;
      background: var(--m3h-pill-tint);
    }

    .mode-pill ha-icon {
      --mdc-icon-size: 16px;
      width: 16px;
      height: 16px;
    }

    .mode-pill.active {
      border-radius: ${HUMIDIFIER_MODE_RADIUS_ACTIVE}px;
      background: var(--m3h-pill);
      color: var(--m3h-pill-ink);
    }

    .pill-label {
      font-size: 9px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }

    .fan-pill {
      height: ${HUMIDIFIER_FAN_HEIGHT}px;
      border-radius: ${HUMIDIFIER_FAN_RADIUS}px;
      background: color-mix(in srgb, var(--m3h-secondary) 8%, transparent);
    }

    .fan-pill .pill-label {
      font-size: 10px;
    }

    .fan-pill.active {
      border-radius: ${HUMIDIFIER_FAN_RADIUS_ACTIVE}px;
      background: var(--m3h-fan-tint);
      color: var(--m3h-accent);
    }

    .bars {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: ${Math.max(...HUMIDIFIER_BAR_HEIGHTS)}px;
    }

    .bar {
      width: ${HUMIDIFIER_BAR_WIDTH}px;
      border-radius: ${HUMIDIFIER_BAR_RADIUS}px;
      background: color-mix(in srgb, var(--m3h-secondary) 30%, transparent);
    }

    .fan-pill.active .bar.on {
      background: var(--m3h-accent);
    }

    .bar.on {
      background: color-mix(in srgb, var(--m3h-secondary) 65%, transparent);
    }

    .mode-select {
      width: 100%;
      height: 40px;
      border-radius: 14px;
      border: none;
      padding: 0 12px;
      font-family: inherit;
      font-size: 13px;
      color: var(--m3h-text);
      background: color-mix(in srgb, var(--m3h-secondary) 8%, transparent);
    }

    /* ---- chips ---- */
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: ${HUMIDIFIER_CHIP_GAP}px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: ${HUMIDIFIER_CHIP_HEIGHT}px;
      padding: 0 12px;
      border: none;
      border-radius: ${HUMIDIFIER_CHIP_RADIUS}px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      color: var(--m3h-chip-fg, var(--m3h-secondary));
      background: var(--m3h-chip-tint, color-mix(in srgb, var(--m3h-secondary) 8%, transparent));
      transition:
        border-radius 0.35s ${EASING},
        background 0.35s ${EASING},
        color 0.35s ${EASING};
    }

    .chip ha-icon {
      --mdc-icon-size: 16px;
      width: 16px;
      height: 16px;
    }

    .chip.control {
      cursor: pointer;
    }

    .chip.control.active {
      border-radius: ${HUMIDIFIER_CHIP_RADIUS_ACTIVE}px;
      background: var(--m3h-chip);
      color: var(--m3h-chip-ink);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-humidifier-card": M3HumidifierCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-humidifier-card",
  name: "M3 Humidifier Card",
  description:
    "Target humidity, mode, fan speed and extras for a (de)humidifier in one card — and it does not insist the device is a humidifier entity.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
