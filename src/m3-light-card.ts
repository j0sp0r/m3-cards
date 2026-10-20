import { LitElement, html, css, svg, unsafeCSS, nothing, type PropertyValues } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3LightCardConfig,
  LightSceneConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_LIGHT_RADIUS,
  DEFAULT_LIGHT_ICON,
  DEFAULT_LIGHT_ACCENT,
  LIGHT_OFF_COLOR,
  LIGHT_POWER_BTN_SIZE,
  LIGHT_POWER_BTN_RADIUS_ON,
  LIGHT_POWER_BTN_RADIUS_OFF,
  LIGHT_WAVE_HEIGHT,
  LIGHT_WAVE_AMPLITUDE,
  LIGHT_WAVE_WAVELENGTH,
  LIGHT_WAVE_PHASE_SPEED,
  LIGHT_WAVE_STROKE,
  LIGHT_WAVE_GAP,
  LIGHT_WAVE_AMPLITUDE_LERP,
  LIGHT_HANDLE_WIDTH,
  LIGHT_HANDLE_HEIGHT,
  LIGHT_HANDLE_RADIUS,
  LIGHT_THROTTLE_MS,
  LIGHT_DRAG_SETTLE_MS,
  LIGHT_MIN_BRIGHTNESS_PCT,
  LIGHT_COLOR_TEMP_MIN_KELVIN,
  LIGHT_COLOR_TEMP_MAX_KELVIN,
  LIGHT_COLOR_TEMP_PRESET_WARM,
  LIGHT_COLOR_TEMP_PRESET_NEUTRAL,
  LIGHT_COLOR_TEMP_PRESET_COLD,
  LIGHT_WHEEL_SIZE,
  LIGHT_WHEEL_HANDLE_SIZE,
  LIGHT_PALETTE_SWATCH_SIZE,
  LIGHT_SCENE_CHIP_HEIGHT,
  LIGHT_MEMBER_ROW_HEIGHT,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, foregroundOn , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { renderListRow, listRowStyles } from "./shared/list-row";
import { shouldAnimate, isReducedMotion, STANDARD_EASING } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { buildWavePath } from "./shared/wave";
import { stopSwipe } from "./shared/swipe";
import { hexToHs, hsToRgb, rgbToHex, rgbToHs } from "./shared/color-picker";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { DragThrottle } from "./shared/drag-throttle";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-LIGHT-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #ffc773; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #ffc773; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);
const DEFAULT_SLIDER_WIDTH = 220;

@customElement("m3-light-card")
export class M3LightCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3LightCardConfig;

  // Deliberately NOT @state: both advance every animation frame and feed a
  // single SVG path. As reactive fields they re-rendered the whole card —
  // colour wheel, sliders and all — at frame rate. One light left on produced
  // 1820 renders in 15 seconds, 73% of a 35-card dashboard's total.
  private _phase = 0;
  private _displayAmplitude = 0;
  @state() private _measuredWidth = DEFAULT_SLIDER_WIDTH;
  @state() private _dragging = false;
  @state() private _dragValue?: number;

  @state() private _tempDragging = false;
  @state() private _tempDragValue?: number;

  @state() private _wheelDragging = false;
  @state() private _wheelDragValue?: [number, number];

  @query(".wave-slider") private _sliderEl?: HTMLDivElement;
  @query(".wheel") private _wheelEl?: HTMLDivElement;

  private _rafId?: number;
  private _resizeObserver?: ResizeObserver;
  private _intersectionObserver?: IntersectionObserver;
  private _isIntersecting = true;
  private _targetAmplitude = 0;
  private _waveGeom?: { activeEnd: number; midY: number };
  private _phaseAnimating = false;

  private _dragEndTimer?: number;
  private _tempDragEndTimer?: number;

  private _entityPct = 0;
  private _unavailable = false;

  private readonly _brightnessThrottle = new DragThrottle<number>((pct) => this._setBrightnessNow(pct), LIGHT_THROTTLE_MS);
  private readonly _tempThrottle = new DragThrottle<number>((kelvin) => this._setColorTempNow(kelvin), LIGHT_THROTTLE_MS);
  private readonly _hsThrottle = new DragThrottle<[number, number]>((hs) => this._setHsNow(hs), LIGHT_THROTTLE_MS);

  public static getStubConfig(hass: HomeAssistant): M3LightCardConfig {
    const entities = Object.keys(hass?.states ?? {}).filter((eid) =>
      eid.startsWith("light."),
    );
    return {
      type: "custom:m3-light-card",
      entity: entities[0] ?? "",
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    const eid = this._config?.entity;
    // A light group renders a row per member, so their states matter too. They
    // live in the group entity's own attributes, and a membership change moves
    // that entity — which is already watched.
    const members = eid
      ? ((this.hass?.states[eid]?.attributes.entity_id as string[] | undefined) ?? [])
      : [];
    return hassChangeMatters(changed, this.hass, [
      eid,
      ...members,
      ...(this._config?.scenes ?? []).map((sc) => sc.entity),
    ]);
  }

  public setConfig(config: M3LightCardConfig): void {
    if (!config.entity) {
      throw new Error(
        "Bitte eine Licht-Entität auswählen / Please select a light entity",
      );
    }
    this._config = {
      glass_background: true,
      animation: "auto",
      wave_style: "wavy",
      use_light_color: true,
      show_color_temp: true,
      color_temp_style: "presets",
      ...config,
    };
  }

  public getCardSize(): number {
    return 2;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: "full",
      rows: "auto",
      min_rows: 2,
    };
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-light-card-editor");
    return document.createElement("m3-light-card-editor") as unknown as LovelaceCardEditor;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this._handleVisibilityChange);
    this._intersectionObserver = new IntersectionObserver((entries) => {
      this._isIntersecting = entries.some((e) => e.isIntersecting);
      this.requestUpdate();
    });
    this._intersectionObserver.observe(this);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener(
      "visibilitychange",
      this._handleVisibilityChange,
    );
    this._intersectionObserver?.disconnect();
    this._resizeObserver?.disconnect();
    this._stopAnimationLoop();
    this._brightnessThrottle.clear();
    this._tempThrottle.clear();
    this._hsThrottle.clear();
    if (this._dragEndTimer !== undefined) clearTimeout(this._dragEndTimer);
    if (this._tempDragEndTimer !== undefined) clearTimeout(this._tempDragEndTimer);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this._sliderEl && !this._resizeObserver) {
      this._resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width && Math.abs(width - this._measuredWidth) > 0.5) {
          this._measuredWidth = width;
        }
      });
      this._resizeObserver.observe(this._sliderEl);
      const rect = this._sliderEl.getBoundingClientRect();
      if (rect.width) this._measuredWidth = rect.width;
    }
  }

  private _handleVisibilityChange = (): void => {
    if (document.hidden) {
      this._stopAnimationLoop();
    } else {
      this.requestUpdate();
    }
  };

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _startAnimationLoop(): void {
    if (this._rafId !== undefined) return;
    const step = () => {
      this._rafId = requestAnimationFrame(step);
      this._tick();
    };
    this._rafId = requestAnimationFrame(step);
  }

  // Repaints only the wave path. The rest of the card is untouched, which is
  // the whole point: the animation is one attribute write per frame, not a
  // full Lit update.
  private _repaintWave(): void {
    const geom = this._waveGeom;
    if (!geom) return;
    const path = this.renderRoot?.querySelector(".wave-active");
    if (!path) return;
    path.setAttribute(
      "d",
      buildWavePath(
        0,
        geom.activeEnd,
        this._displayAmplitude,
        LIGHT_WAVE_WAVELENGTH,
        this._phase,
        geom.midY,
      ),
    );
  }

  private _stopAnimationLoop(): void {
    if (this._rafId !== undefined) {
      cancelAnimationFrame(this._rafId);
      this._rafId = undefined;
    }
  }

  private _tick(): void {
    if (document.hidden || !this._isIntersecting) {
      this._stopAnimationLoop();
      return;
    }
    let changed = false;
    const ampDelta = this._targetAmplitude - this._displayAmplitude;
    if (Math.abs(ampDelta) > 0.01) {
      this._displayAmplitude += ampDelta * LIGHT_WAVE_AMPLITUDE_LERP;
      changed = true;
    } else if (this._displayAmplitude !== this._targetAmplitude) {
      this._displayAmplitude = this._targetAmplitude;
      changed = true;
    }
    if (this._phaseAnimating) {
      this._phase -= LIGHT_WAVE_PHASE_SPEED;
      changed = true;
    }
    if (!changed) {
      this._stopAnimationLoop();
      return;
    }
    this._repaintWave();
  }

  // ---- Brightness (wave slider) --------------------------------------------

  private _pctFromClientX(clientX: number, el: HTMLElement | undefined, min = 0): number {
    if (!el) return min;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = rect.width > 0 ? (x / rect.width) * 100 : 0;
    return Math.min(100, Math.max(min, Math.round(pct)));
  }

  private _handlePointerDown = (e: PointerEvent): void => {
    if (!this._config || this._unavailable) return;
    e.preventDefault();
    this._sliderEl?.setPointerCapture(e.pointerId);
    this._dragging = true;
    const value = this._pctFromClientX(e.clientX, this._sliderEl, LIGHT_MIN_BRIGHTNESS_PCT);
    this._dragValue = value;
    this._brightnessThrottle.call(value);
  };

  private _handlePointerMove = (e: PointerEvent): void => {
    if (!this._dragging) return;
    const value = this._pctFromClientX(e.clientX, this._sliderEl, LIGHT_MIN_BRIGHTNESS_PCT);
    if (value === this._dragValue) return;
    this._dragValue = value;
    this._brightnessThrottle.call(value);
  };

  private _handlePointerUp = (e: PointerEvent): void => {
    if (!this._dragging) return;
    const value = this._dragValue ?? this._pctFromClientX(e.clientX, this._sliderEl, LIGHT_MIN_BRIGHTNESS_PCT);
    this._brightnessThrottle.flush(value);
    this._scheduleDragEnd();
  };

  private _handleKeydown = (e: KeyboardEvent): void => {
    if (this._unavailable) return;
    const dirByKey: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
    };
    const dir = dirByKey[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 5;
    const current = this._dragging ? (this._dragValue ?? this._entityPct) : this._entityPct;
    const next = Math.min(100, Math.max(LIGHT_MIN_BRIGHTNESS_PCT, current + dir * step));
    this._dragging = true;
    this._dragValue = next;
    this._brightnessThrottle.call(next);
    this._scheduleDragEnd();
  };

  private _setBrightnessNow(pct: number): void {
    if (!this.hass || !this._config) return;
    const data: Record<string, unknown> = {
      entity_id: this._config.entity,
      brightness_pct: pct,
    };
    if (this._config.transition !== undefined) data.transition = this._config.transition;
    this.hass.callService("light", "turn_on", data);
  }

  private _scheduleDragEnd(delay = LIGHT_DRAG_SETTLE_MS): void {
    if (this._dragEndTimer !== undefined) clearTimeout(this._dragEndTimer);
    this._dragEndTimer = window.setTimeout(() => {
      this._dragging = false;
      this._dragValue = undefined;
      this._dragEndTimer = undefined;
    }, delay);
  }

  // ---- Color temperature -----------------------------------------------------

  private _setColorTempNow(kelvin: number): void {
    if (!this.hass || !this._config) return;
    const data: Record<string, unknown> = {
      entity_id: this._config.entity,
      color_temp_kelvin: Math.round(kelvin),
    };
    if (this._config.transition !== undefined) data.transition = this._config.transition;
    this.hass.callService("light", "turn_on", data);
  }

  private _handleTempPointerDown = (e: PointerEvent, minK: number, maxK: number): void => {
    if (!this._config || this._unavailable) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    this._tempDragging = true;
    const pct = this._pctFromClientX(e.clientX, el);
    const value = Math.round(minK + (pct / 100) * (maxK - minK));
    this._tempDragValue = value;
    this._tempThrottle.call(value);
  };

  private _handleTempPointerMove = (e: PointerEvent, minK: number, maxK: number): void => {
    if (!this._tempDragging) return;
    const el = e.currentTarget as HTMLElement;
    const pct = this._pctFromClientX(e.clientX, el);
    const value = Math.round(minK + (pct / 100) * (maxK - minK));
    if (value === this._tempDragValue) return;
    this._tempDragValue = value;
    this._tempThrottle.call(value);
  };

  private _handleTempPointerUp = (): void => {
    if (!this._tempDragging) return;
    if (this._tempDragValue !== undefined) this._tempThrottle.flush(this._tempDragValue);
    if (this._tempDragEndTimer !== undefined) clearTimeout(this._tempDragEndTimer);
    this._tempDragEndTimer = window.setTimeout(() => {
      this._tempDragging = false;
      this._tempDragValue = undefined;
      this._tempDragEndTimer = undefined;
    }, LIGHT_DRAG_SETTLE_MS);
  };

  // ---- Color wheel -----------------------------------------------------------

  private _hsFromWheelEvent(e: PointerEvent): [number, number] {
    const rect = this._wheelEl!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const radius = rect.width / 2;
    const dist = Math.min(radius, Math.hypot(dx, dy));
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    const saturation = radius > 0 ? (dist / radius) * 100 : 0;
    return [angle, saturation];
  }

  private _handleWheelPointerDown = (e: PointerEvent): void => {
    if (!this._config || this._unavailable || !this._wheelEl) return;
    e.preventDefault();
    this._wheelEl.setPointerCapture(e.pointerId);
    this._wheelDragging = true;
    const hs = this._hsFromWheelEvent(e);
    this._wheelDragValue = hs;
    this._hsThrottle.call(hs);
  };

  private _handleWheelPointerMove = (e: PointerEvent): void => {
    if (!this._wheelDragging || !this._wheelEl) return;
    const hs = this._hsFromWheelEvent(e);
    this._wheelDragValue = hs;
    this._hsThrottle.call(hs);
  };

  private _handleWheelPointerUp = (): void => {
    if (!this._wheelDragging) return;
    if (this._wheelDragValue) this._hsThrottle.flush(this._wheelDragValue);
    this._wheelDragging = false;
    this._wheelDragValue = undefined;
  };

  private _setHsNow(hs: [number, number]): void {
    if (!this.hass || !this._config) return;
    const data: Record<string, unknown> = {
      entity_id: this._config.entity,
      hs_color: hs,
    };
    if (this._config.transition !== undefined) data.transition = this._config.transition;
    this.hass.callService("light", "turn_on", data);
  }

  private _pickPaletteColor(hex: string): void {
    const hs = hexToHs(hex);
    if (!hs) return;
    this._setHsNow(hs);
  }

  // ---- Scenes & group members --------------------------------------------

  private _activateScene(scene: LightSceneConfig): void {
    if (!this.hass) return;
    if (scene.service) {
      const [domain, service] = scene.service.split(".", 2);
      if (!domain || !service) return;
      this.hass.callService(domain, service, scene.service_data ?? {});
    } else if (scene.entity) {
      this.hass.callService("scene", "turn_on", { entity_id: scene.entity });
    }
  }

  private _toggleMember(entityId: string): void {
    this.hass?.callService("light", "toggle", { entity_id: entityId });
  }

  private _handlePowerToggle(): void {
    if (!this.hass || !this._config || this._unavailable) return;
    const data: Record<string, unknown> = { entity_id: this._config.entity };
    if (this._config.transition !== undefined) data.transition = this._config.transition;
    this.hass.callService("light", "toggle", data);
  }

  private _fireMoreInfo(): void {
    fireEvent(this, "hass-more-info", { entityId: this._config?.entity });
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const entity = this.hass.states[this._config.entity];
    if (!entity) {
      return renderMissingEntity(this._config.entity);
    }

    const unavailable = entity.state === "unavailable";
    this._unavailable = unavailable;
    const isOn = entity.state === "on";
    const effectiveOn = isOn || this._dragging;
    const compact = this._config.compact === true;

    const modes: string[] = entity.attributes.supported_color_modes ?? [];
    const hasBrightness =
      modes.some((m) => m !== "onoff") ||
      (modes.length === 0 && entity.attributes.brightness !== undefined);
    const supportsColorTemp = modes.includes("color_temp");
    const supportsColor = modes.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m));
    const memberIds: string[] = Array.isArray(entity.attributes.entity_id)
      ? entity.attributes.entity_id
      : [];
    const isGroup = memberIds.length > 0;

    const brightness255 = entity.attributes.brightness as number | undefined;
    const brightnessPct =
      brightness255 !== undefined ? Math.round((brightness255 / 255) * 100) : 0;
    this._entityPct = brightnessPct;
    const displayPct = this._dragging ? (this._dragValue ?? brightnessPct) : brightnessPct;

    const name =
      this._config.name || entity.attributes.friendly_name || this._config.entity;
    const icon = this._config.icon || entity.attributes.icon || DEFAULT_LIGHT_ICON;

    const accentColor = this._config.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : DEFAULT_LIGHT_ACCENT;
    const activeColor = unavailable || !effectiveOn ? LIGHT_OFF_COLOR : accentColor;
    const trackColorCss = this._config.track_color
      ? resolveThemeColor(this._config.track_color)
      : "rgba(255, 255, 255, 0.13)";
    const handleColorCss = this._config.handle_color
      ? resolveThemeColor(this._config.handle_color)
      : `color-mix(in srgb, ${activeColor} 60%, white 40%)`;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_LIGHT_RADIUS,
      this._config.corners,
    );

    const subtitle = unavailable
      ? this._t("unavailable")
      : !effectiveOn
        ? this._t("off")
        : `${displayPct} %`;

    const mode = this._config.animation ?? "auto";
    const wavyStatic = (this._config.wave_style ?? "wavy") === "wavy";
    const reducedMotion = isReducedMotion();
    const forceFlatShape = reducedMotion || (mode === "off" && !wavyStatic);
    this._phaseAnimating = !forceFlatShape && mode !== "off" && effectiveOn && !unavailable;
    this._targetAmplitude =
      unavailable || !effectiveOn || forceFlatShape ? 0 : LIGHT_WAVE_AMPLITUDE;

    if (this._phaseAnimating || this._targetAmplitude !== this._displayAmplitude) {
      this._startAnimationLoop();
    }

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, activeColor, this._config.accent_opacity, unavailable || !effectiveOn ? 14 : 20);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(activeColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "lc-accent": activeColor,
      "lc-accent-bg": tintOn(this, activeColor, this._config.accent_opacity, 20),
      "lc-track": trackColorCss,
      "lc-handle": handleColorCss,
      "lc-power-color": activeColor,
      "lc-power-bg": tintOn(this, activeColor, this._config.accent_opacity, 14),
      "lc-power-bg-active": tintOn(this, activeColor, this._config.accent_opacity, 20),
      "lr-row-height": `${LIGHT_MEMBER_ROW_HEIGHT}px`,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "lc-accent": activeColor,
        "lc-power-color": activeColor,
      }),
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${unavailable ? "unavailable" : ""} ${shouldAnimate(this._config.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon,
            name,
            subtitle,
            onClick: () => this._fireMoreInfo(),
            // Compact drops the power button and moves the toggle onto the icon
            // — the same split the native tile card makes. The swatch already
            // tints with the light's state, so it reads as the on/off control
            // it has become without a second lit-up thing beside it.
            ...(compact
              ? {
                  onIconClick: unavailable ? undefined : () => this._handlePowerToggle(),
                  iconLabel: name,
                }
              : {
                  right: html`
                    <button
                      class="power-btn ${effectiveOn ? "active" : ""}"
                      ?disabled=${unavailable}
                      aria-label="mdi:power"
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._handlePowerToggle();
                      }}
                    >
                      <ha-icon icon="mdi:power"></ha-icon>
                    </button>
                  `,
                }),
          })}
          ${hasBrightness ? this._renderWaveSlider(displayPct, unavailable) : nothing}
          ${this._config.show_color_temp !== false && supportsColorTemp
            ? this._renderColorTemp(entity, unavailable)
            : nothing}
          ${this._config.show_color_wheel && supportsColor
            ? this._renderColorWheel(this._currentHs(entity), unavailable)
            : nothing}
          ${this._config.scenes?.length ? this._renderScenes(unavailable) : nothing}
          ${this._config.show_members && isGroup ? this._renderMembers(memberIds) : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderWaveSlider(pct: number, unavailable: boolean) {
    const width = this._measuredWidth;
    const height = LIGHT_WAVE_HEIGHT;
    const midY = height / 2;
    const amplitude = this._displayAmplitude;
    const handleW = LIGHT_HANDLE_WIDTH;

    const handleX = handleW / 2 + (pct / 100) * Math.max(0, width - handleW);
    const gapHalf = LIGHT_WAVE_GAP / 2;
    const activeEnd = Math.max(0, handleX - gapHalf - handleW / 2);
    const trackStart = Math.min(width, handleX + gapHalf + handleW / 2);
    const hasActive = activeEnd > 1;
    const hasTrack = trackStart < width - 1;
    // Kept for the animation frame, which repaints the path without a render:
    // activeEnd and midY only move when brightness or size changes, and both
    // of those re-render anyway.
    this._waveGeom = hasActive ? { activeEnd, midY } : undefined;
    const activePath = hasActive
      ? buildWavePath(0, activeEnd, amplitude, LIGHT_WAVE_WAVELENGTH, this._phase, midY)
      : "";

    return html`
      <div
        class="wave-slider ${unavailable ? "disabled" : ""} ${this._dragging ? "dragging" : ""}"
        role="slider"
        aria-label=${this._t("light_brightness_label")}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${pct}
        aria-disabled=${unavailable ? "true" : "false"}
        tabindex=${unavailable ? -1 : 0}
        @pointerdown=${this._handlePointerDown}
        @pointermove=${this._handlePointerMove}
        @pointerup=${this._handlePointerUp}
        @pointercancel=${this._handlePointerUp}
        @touchstart=${stopSwipe}
        @touchmove=${stopSwipe}
        @mousedown=${stopSwipe}
        @mousemove=${stopSwipe}
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
        <div
          class="wave-handle"
          style=${`left: ${handleX - handleW / 2}px; top: ${midY - LIGHT_HANDLE_HEIGHT / 2}px;`}
        ></div>
      </div>
    `;
  }

  private _renderColorTemp(entity: { attributes: Record<string, unknown> }, unavailable: boolean) {
    const minK = (entity.attributes.min_color_temp_kelvin as number) ?? LIGHT_COLOR_TEMP_MIN_KELVIN;
    const maxK = (entity.attributes.max_color_temp_kelvin as number) ?? LIGHT_COLOR_TEMP_MAX_KELVIN;
    const currentK =
      this._tempDragging && this._tempDragValue !== undefined
        ? this._tempDragValue
        : ((entity.attributes.color_temp_kelvin as number) ?? Math.round((minK + maxK) / 2));
    const style = this._config?.color_temp_style ?? "presets";

    if (style === "presets") {
      const presets = this._config?.color_temp_presets ?? {};
      const options: { key: string; k: number; label: string }[] = [
        { key: "warm", k: presets.warm ?? LIGHT_COLOR_TEMP_PRESET_WARM, label: this._t("editor_light_color_temp_warm") },
        { key: "neutral", k: presets.neutral ?? LIGHT_COLOR_TEMP_PRESET_NEUTRAL, label: this._t("editor_light_color_temp_neutral") },
        { key: "cold", k: presets.cold ?? LIGHT_COLOR_TEMP_PRESET_COLD, label: this._t("editor_light_color_temp_cold") },
      ];
      return html`
        <div class="temp-presets">
          ${options.map(
            (o) => html`
              <button
                class="temp-preset ${Math.abs(currentK - o.k) < 100 ? "active" : ""}"
                ?disabled=${unavailable}
                title=${o.label}
                aria-label=${o.label}
                @click=${() => this._tempThrottle.flush(o.k)}
              >
                <span class="temp-preset-swatch" style=${`background: ${this._kelvinPreviewColor(o.k)};`}></span>
              </button>
            `,
          )}
        </div>
      `;
    }

    const pct = maxK > minK ? ((currentK - minK) / (maxK - minK)) * 100 : 0;
    return html`
      <div
        class="temp-slider ${unavailable ? "disabled" : ""}"
        role="slider"
        aria-label=${this._t("light_color_temp_label")}
        aria-valuemin=${minK}
        aria-valuemax=${maxK}
        aria-valuenow=${Math.round(currentK)}
        tabindex=${unavailable ? -1 : 0}
        @pointerdown=${(e: PointerEvent) => this._handleTempPointerDown(e, minK, maxK)}
        @pointermove=${(e: PointerEvent) => this._handleTempPointerMove(e, minK, maxK)}
        @pointerup=${this._handleTempPointerUp}
        @pointercancel=${this._handleTempPointerUp}
        @touchstart=${stopSwipe}
        @touchmove=${stopSwipe}
        @mousedown=${stopSwipe}
        @mousemove=${stopSwipe}
      >
        <span class="temp-value">${Math.round(currentK)} K</span>
        <div class="temp-handle" style=${`left: ${pct}%;`}></div>
      </div>
    `;
  }

  private _kelvinPreviewColor(kelvin: number): string {
    if (kelvin <= 3000) return "#ffb877";
    if (kelvin <= 4500) return "#fff1de";
    return "#cfe3ff";
  }

  private _currentHs(entity: { attributes: Record<string, unknown> }): [number, number] {
    const hs = entity.attributes.hs_color;
    if (Array.isArray(hs) && hs.length === 2) return [hs[0], hs[1]];
    const rgb = entity.attributes.rgb_color;
    if (Array.isArray(rgb) && rgb.length === 3) {
      const [h, s] = rgbToHs(rgb[0], rgb[1], rgb[2]);
      return [h, s];
    }
    return [0, 0];
  }

  private _renderColorWheel(currentHs: [number, number], unavailable: boolean) {
    const [h, s] = this._wheelDragging && this._wheelDragValue ? this._wheelDragValue : currentHs;
    const angleRad = (h * Math.PI) / 180;
    const radiusPct = Math.min(100, s);
    const handleX = 50 + Math.cos(angleRad) * (radiusPct / 2);
    const handleY = 50 + Math.sin(angleRad) * (radiusPct / 2);
    const palette = this._config?.color_palette ?? [];

    return html`
      <div class="wheel-row">
        <div
          class="wheel"
          role="slider"
          aria-label=${this._t("light_color_wheel_label")}
          tabindex=${unavailable ? -1 : 0}
          @pointerdown=${this._handleWheelPointerDown}
          @pointermove=${this._handleWheelPointerMove}
          @pointerup=${this._handleWheelPointerUp}
          @pointercancel=${this._handleWheelPointerUp}
          @touchstart=${stopSwipe}
          @touchmove=${stopSwipe}
          @mousedown=${stopSwipe}
          @mousemove=${stopSwipe}
        >
          <div class="wheel-saturation"></div>
          <div
            class="wheel-handle"
            style=${`left: ${handleX}%; top: ${handleY}%; background: ${rgbToHex(...hsToRgb(h, s))};`}
          ></div>
        </div>
        ${palette.length
          ? html`
              <div class="palette-row">
                ${palette.map(
                  (hex) => html`
                    <button
                      class="palette-swatch"
                      style=${`background: ${hex};`}
                      ?disabled=${unavailable}
                      aria-label=${hex}
                      @click=${() => this._pickPaletteColor(hex)}
                    ></button>
                  `,
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderScenes(unavailable: boolean) {
    const scenes = this._config?.scenes ?? [];
    return html`
      <div class="scene-row">
        ${scenes.map((scene) => {
          const sceneEntity = scene.entity ? this.hass?.states[scene.entity] : undefined;
          const label = scene.name || sceneEntity?.attributes.friendly_name || this._t("light_scene_unnamed");
          const icon = scene.icon || sceneEntity?.attributes.icon || "mdi:palette-swatch-outline";
          return html`
            <button
              class="scene-chip"
              ?disabled=${unavailable}
              @click=${() => this._activateScene(scene)}
            >
              <ha-icon icon=${icon}></ha-icon>
              <span>${label}</span>
            </button>
          `;
        })}
      </div>
    `;
  }

  private _renderMembers(memberIds: string[]) {
    return html`
      <div class="row-list members">
        ${memberIds.map((id) => {
          const member = this.hass?.states[id];
          if (!member) return nothing;
          const memberOn = member.state === "on";
          const memberUnavailable = member.state === "unavailable";
          return renderListRow({
      host: this,
            key: id,
            icon: member.attributes.icon || DEFAULT_LIGHT_ICON,
            iconColor: memberUnavailable ? LIGHT_OFF_COLOR : memberOn ? "var(--lc-accent)" : LIGHT_OFF_COLOR,
            iconBackground: tintOn(this, memberOn ? "var(--lc-accent)" : LIGHT_OFF_COLOR, this._config?.accent_opacity, 14),
            middle: html`<div class="member-name">${member.attributes.friendly_name || id}</div>`,
            right: html`
              <button
                class="member-toggle ${memberOn ? "active" : ""}"
                ?disabled=${memberUnavailable}
                aria-label=${id}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._toggleMember(id);
                }}
              >
                <ha-icon icon="mdi:power"></ha-icon>
              </button>
            `,
            label: member.attributes.friendly_name || id,
          });
        })}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    listRowStyles,
    css`
      .card-inner.unavailable {
        opacity: 0.4;
        pointer-events: none;
      }

      .power-btn {
        flex-shrink: 0;
        width: ${LIGHT_POWER_BTN_SIZE}px;
        height: ${LIGHT_POWER_BTN_SIZE}px;
        border: none;
        border-radius: ${LIGHT_POWER_BTN_RADIUS_OFF}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--lc-power-bg);
        color: var(--lc-power-color-fg, var(--lc-power-color));
        cursor: pointer;
        padding: 0;
        transition:
          border-radius 350ms ${EASING},
          background 350ms ${EASING},
          color 350ms ${EASING};
      }

      .power-btn:disabled {
        cursor: default;
      }

      .power-btn.active {
        border-radius: ${LIGHT_POWER_BTN_RADIUS_ON}px;
        background: var(--lc-power-bg-active);
      }

      .power-btn ha-icon {
        --mdc-icon-size: 20px;
      }

      .card-inner.no-animations .power-btn {
        transition: none;
      }

      .wave-slider {
        position: relative;
        width: 100%;
        height: ${LIGHT_WAVE_HEIGHT}px;
        cursor: pointer;
        touch-action: none;
        outline: none;
      }

      .wave-slider:focus-visible {
        outline: 2px solid var(--lc-accent);
        outline-offset: 2px;
        border-radius: 8px;
      }

      .wave-slider.disabled {
        cursor: default;
        pointer-events: none;
      }

      .wave-svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .wave-active {
        stroke: var(--lc-accent);
        stroke-width: ${LIGHT_WAVE_STROKE}px;
        stroke-linecap: round;
      }

      .wave-track {
        stroke: var(--lc-track);
        stroke-width: ${LIGHT_WAVE_STROKE}px;
        stroke-linecap: round;
      }

      .wave-handle {
        position: absolute;
        width: ${LIGHT_HANDLE_WIDTH}px;
        height: ${LIGHT_HANDLE_HEIGHT}px;
        border-radius: ${LIGHT_HANDLE_RADIUS}px;
        background: var(--lc-handle);
        pointer-events: none;
        transition: left 150ms ${EASING};
      }

      .wave-slider.dragging .wave-handle {
        transition: none;
      }

      .card-inner.no-animations .wave-handle {
        transition: none;
      }


      /* ---- Color temperature ---- */

      .temp-presets {
        display: flex;
        gap: 8px;
      }

      .temp-preset {
        flex: 1;
        height: 36px;
        border: none;
        border-radius: 12px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 200ms ${EASING};
      }

      .temp-preset.active {
        background: var(--lc-accent-bg);
      }

      .temp-preset:disabled {
        cursor: default;
      }

      .temp-preset-swatch {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: block;
      }

      .temp-slider {
        position: relative;
        width: 100%;
        height: 24px;
        border-radius: 12px;
        background: linear-gradient(90deg, #ff9c4a, #fff1de 50%, #a8c9ff);
        cursor: pointer;
        touch-action: none;
        outline: none;
      }

      .temp-slider:focus-visible {
        outline: 2px solid var(--lc-accent);
        outline-offset: 2px;
      }

      .temp-slider.disabled {
        cursor: default;
        pointer-events: none;
        opacity: 0.5;
      }

      .temp-value {
        position: absolute;
        top: -16px;
        right: 0;
        font-size: 11px;
        font-weight: 700;
        opacity: 0.5;
        color: var(--m3p-text);
      }

      .temp-handle {
        position: absolute;
        top: 50%;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: white;
        border: 2px solid rgba(0, 0, 0, 0.2);
        transform: translate(-50%, -50%);
        pointer-events: none;
      }

      /* ---- Color wheel + palette ---- */

      .wheel-row {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .wheel {
        position: relative;
        width: ${LIGHT_WHEEL_SIZE}px;
        height: ${LIGHT_WHEEL_SIZE}px;
        border-radius: 50%;
        background: conic-gradient(
          from 90deg,
          red,
          yellow,
          lime,
          cyan,
          blue,
          magenta,
          red
        );
        cursor: pointer;
        touch-action: none;
        outline: none;
      }

      .wheel:focus-visible {
        outline: 2px solid var(--lc-accent);
        outline-offset: 3px;
      }

      .wheel-saturation {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: radial-gradient(circle, white 0%, rgba(255, 255, 255, 0) 70%);
        pointer-events: none;
      }

      .wheel-handle {
        position: absolute;
        width: ${LIGHT_WHEEL_HANDLE_SIZE}px;
        height: ${LIGHT_WHEEL_HANDLE_SIZE}px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
        transform: translate(-50%, -50%);
        pointer-events: none;
      }

      .palette-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }

      .palette-swatch {
        width: ${LIGHT_PALETTE_SWATCH_SIZE}px;
        height: ${LIGHT_PALETTE_SWATCH_SIZE}px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.4);
        cursor: pointer;
        padding: 0;
      }

      .palette-swatch:disabled {
        cursor: default;
        opacity: 0.5;
      }

      /* ---- Scenes ---- */

      .scene-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .scene-chip {
        height: ${LIGHT_SCENE_CHIP_HEIGHT}px;
        padding: 0 14px;
        border: none;
        border-radius: 17px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
      }

      .scene-chip:disabled {
        cursor: default;
        opacity: 0.5;
      }

      .scene-chip ha-icon {
        --mdc-icon-size: 16px;
      }

      /* ---- Group members ---- */

      .members {
        margin-top: 2px;
      }

      .member-name {
        font-size: 13px;
        color: var(--m3p-text);
      }

      .member-toggle {
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 10px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--primary-text-color);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .member-toggle.active {
        background: var(--lc-accent-bg);
        color: var(--lc-accent-fg, var(--lc-accent));
      }

      .member-toggle ha-icon {
        --mdc-icon-size: 16px;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .temp-preset {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .scene-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .member-toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-light-card": M3LightCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-light-card",
  name: "M3 Light Card",
  description:
    "Eine Material-3-Expressive-Steuerkarte für Lichter mit wellenförmigem Helligkeits-Slider, Farbtemperatur, Farbrad und Szenen.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
