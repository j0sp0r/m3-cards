import { LitElement, html, css, nothing, type PropertyValues, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3ButtonCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  HaActionConfig,
  HassEntity,
} from "./types";
import {
  DEFAULT_BUTTON_COLOR,
  DEFAULT_BUTTON_RADIUS,
  BUTTON_SHAPE_OFF_RADIUS,
  BUTTON_SHAPE_ON_RADIUS,
  BUTTON_SHAPE_ON_ICON_RADIUS,
  BUTTON_SHAPE_MS,
  THEME_COLOR_TOKENS,
  STATELESS_DOMAINS,
  ACTIVE_STATES,
  SLIDER_DOMAINS,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { hassChangeMatters } from "./shared/should-update";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { migrateAnimationsField } from "./shared/config-migration";
import { activateOnKey } from "./shared/a11y";
import { defaultEntityAction } from "./shared/entity-actions";
import {
  tintOn,
  foregroundOn,
  foregroundColor,
  fillColor,
  inkOn,
} from "./shared/color-config";
import { TemplatedCard } from "./shared/templated-card";
import {
  ChipRowFadeController,
  chipButtonsStyles,
  chipRowJustify,
  embeddedChipRowConfig,
  renderChipButtons,
} from "./shared/chip-buttons";
import { TapHoldGesture } from "./shared/gestures";

const HOLD_DURATION_MS = 500;
const DOUBLE_TAP_WINDOW_MS = 250;
const DRAG_THRESHOLD_PX = 8;

// ha-form always returns every configured field, including ones the user set
// to "Nichts" (action: "none"), so a raw truthiness check on the action
// object can't distinguish "configured" from "explicitly disabled".
function _isRealAction(action?: HaActionConfig): boolean {
  return !!action && action.action !== "none";
}

// Tile-wide hold_action defaults to more-info (matching the native tile
// card), so the hold-timer should run for both "unconfigured" and any
// explicit action — only an explicit "none" opts out.
function _isNotDisabled(action?: HaActionConfig): boolean {
  return action?.action !== "none";
}

@customElement("m3-button-card")
export class M3ButtonCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ButtonCardConfig;
  @state() private _dragPercent?: number;
  @state() private _chipPressedKey?: string;

  private _chipGestures = new TapHoldGesture();
  private _chipFades = new ChipRowFadeController();

  private _holdTimer?: number;
  private _holdTriggered = false;
  private _lastTap = 0;
  private _dragStartX = 0;
  private _dragActive = false;
  private _suppressClick = false;

  private _iconHoldTimer?: number;
  private _iconHoldTriggered = false;
  private _iconLastTap = 0;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-button-card-editor");
    return document.createElement(
      "m3-button-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3ButtonCardConfig {
    const entity = Object.keys(hass?.states ?? {})[0] ?? "";
    return {
      type: "custom:m3-button-card",
      entity,
      show_state: true,
      show_icon_background: true,
      glass_background: true,
      tap_action: { action: "toggle" },
    };
  }

  // Hold detection arms timers up to the hold delay, and the double-tap paths
  // schedule deferred actions. Without this they fire after the card is gone.
  public disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearTimeout(this._holdTimer);
    window.clearTimeout(this._iconHoldTimer);
    this._holdTimer = undefined;
    this._iconHoldTimer = undefined;
    this._chipGestures.cancel();
    this._chipFades.disconnect();
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.entity,
      ...(this._config?.chip_buttons ?? []).map((b) => b.entity),
    ]);
  }

  public setConfig(config: M3ButtonCardConfig): void {
    this._config = migrateAnimationsField({
      show_state: true,
      show_icon_background: true,
      glass_background: true,
      vertical: false,
      ...config,
    });
  }

  public getCardSize(): number {
    return 1;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: 6,
      rows: "auto",
      min_columns: 3,
      min_rows: 1,
    };
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _resolveColor(color?: string): string {
    const token = color || DEFAULT_BUTTON_COLOR;
    return THEME_COLOR_TOKENS[token] ?? token;
  }

  private _isActive(state: string, domain: string): boolean {
    if (STATELESS_DOMAINS.has(domain)) return true;
    return ACTIVE_STATES.has(state);
  }

  private _activeColor(entityState: string): string {
    const override = this._config?.state_colors?.[entityState];
    const configured = override || this._config?.color;
    return this._resolveColor(configured);
  }

  // The mapping itself now lives in shared/entity-actions.ts, unchanged — the
  // appliance card draws a row of buttons and needs the same answers, and two
  // copies of "a button.* entity should be pressed" is exactly the kind of pair
  // that drifts.
  private _defaultTapAction(domain: string): HaActionConfig {
    return defaultEntityAction(domain);
  }

  private _sliderDomain(): string | undefined {
    if (!this._config?.entity) return undefined;
    const domain = this._config.entity.split(".")[0];
    return SLIDER_DOMAINS.has(domain) ? domain : undefined;
  }

  private _sliderInfo():
    | { value: number; min: number; max: number; step: number; unit: string }
    | undefined {
    if (!this.hass || !this._config?.entity) return undefined;
    // Slider mode is opt-in. Gating here rather than only at the render site
    // keeps the pointer handlers, the swipe guard and the icon's default
    // action in step with it: without this a plain button on a light — no
    // slider drawn — would still commit a brightness on tap instead of
    // toggling, because the drag handlers only ever asked the domain.
    if (!this._config.show_slider) return undefined;
    const entity = this.hass.states[this._config.entity];
    if (!entity) return undefined;
    const domain = this._sliderDomain();
    if (!domain) return undefined;

    switch (domain) {
      case "light": {
        // Stay a usable 0-100 slider even when the light is off (brightness
        // absent) — otherwise a tap on an off light has no range to commit and
        // falls through to toggle, snapping it back to its last brightness
        // instead of the pressed position.
        const brightness = entity.attributes.brightness;
        const value =
          typeof brightness === "number" ? Math.round((brightness / 255) * 100) : 0;
        return { value, min: 0, max: 100, step: 1, unit: "%" };
      }
      case "cover": {
        const pos = entity.attributes.current_position;
        if (typeof pos !== "number") return undefined;
        return { value: pos, min: 0, max: 100, step: 1, unit: "%" };
      }
      case "fan": {
        const pct = entity.attributes.percentage;
        if (typeof pct !== "number") return undefined;
        return { value: pct, min: 0, max: 100, step: 1, unit: "%" };
      }
      case "input_number":
      case "number": {
        const val = parseFloat(entity.state);
        if (isNaN(val)) return undefined;
        return {
          value: val,
          min: entity.attributes.min ?? 0,
          max: entity.attributes.max ?? 100,
          step: entity.attributes.step ?? 1,
          unit: entity.attributes.unit_of_measurement ?? "",
        };
      }
      default:
        return undefined;
    }
  }

  private _setSliderValue(value: number): void {
    if (!this.hass || !this._config) return;
    const entityId = this._config.entity;
    switch (this._sliderDomain()) {
      case "light":
        this.hass.callService("light", "turn_on", {
          entity_id: entityId,
          brightness_pct: value,
        });
        return;
      case "cover":
        this.hass.callService("cover", "set_cover_position", {
          entity_id: entityId,
          position: value,
        });
        return;
      case "fan":
        this.hass.callService("fan", "set_percentage", {
          entity_id: entityId,
          percentage: value,
        });
        return;
      case "input_number":
        this.hass.callService("input_number", "set_value", {
          entity_id: entityId,
          value,
        });
        return;
      case "number":
        this.hass.callService("number", "set_value", {
          entity_id: entityId,
          value,
        });
        return;
    }
  }

  private _percentFromEvent(e: PointerEvent, el: HTMLElement): number {
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * 100;
  }

  private _valueFromPercent(percent: number, info: { min: number; max: number; step: number }): number {
    const raw = info.min + (percent / 100) * (info.max - info.min);
    const stepped = Math.round(raw / info.step) * info.step;
    return Math.min(info.max, Math.max(info.min, stepped));
  }

  private _fireMoreInfo(entityId?: string): void {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      }),
    );
  }

  private _navigate(path: string): void {
    const event = new CustomEvent("location-changed", {
      bubbles: true,
      composed: true,
      detail: { replace: false },
    });
    window.history.pushState(null, "", path);
    this.dispatchEvent(event);
  }

  private _handleAction(action: HaActionConfig | undefined): void {
    if (!this.hass || !this._config) return;
    const entityId = this._config.entity;
    const cfg = action ?? { action: "more-info" };

    switch (cfg.action) {
      case "none":
        return;
      case "toggle":
        if (!entityId) return;
        this.hass.callService("homeassistant", "toggle", {
          entity_id: entityId,
        });
        return;
      case "more-info":
        this._fireMoreInfo(entityId);
        return;
      case "call-service":
      case "perform-action": {
        const serviceStr = cfg.perform_action ?? cfg.service;
        if (!serviceStr) return;
        const [domain, service] = serviceStr.split(".");
        this.hass.callService(domain, service, {
          ...(entityId ? { entity_id: entityId } : {}),
          ...(cfg.target ?? {}),
          ...(cfg.data ?? cfg.service_data ?? {}),
        });
        return;
      }
      case "navigate":
        if (cfg.navigation_path) this._navigate(cfg.navigation_path);
        return;
      case "url":
        if (cfg.url_path)
          window.open(cfg.url_path, cfg.new_tab === false ? "_self" : "_blank");
        return;
      default:
        return;
    }
  }

  private _onPointerDown = (e: PointerEvent): void => {
    this._holdTriggered = false;
    if (_isNotDisabled(this._config?.hold_action)) {
      window.clearTimeout(this._holdTimer);
      this._holdTimer = window.setTimeout(() => {
        this._holdTriggered = true;
        this._handleAction(this._config?.hold_action);
      }, HOLD_DURATION_MS);
    }

    const info = this._sliderInfo();
    if (info) {
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      this._dragStartX = e.clientX;
      this._dragActive = true;
      this._dragPercent = this._percentFromEvent(e, el);
    }
  };

  private _onPointerMove = (e: PointerEvent): void => {
    if (!this._dragActive) return;
    if (Math.abs(e.clientX - this._dragStartX) > DRAG_THRESHOLD_PX) {
      window.clearTimeout(this._holdTimer);
    }
    this._dragPercent = this._percentFromEvent(e, e.currentTarget as HTMLElement);
  };

  private _onPointerUp = (e: PointerEvent): void => {
    window.clearTimeout(this._holdTimer);
    if (!this._dragActive) return;
    this._dragActive = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    const info = this._sliderInfo();
    // Commit on any release inside the slider — a drag OR a plain tap. A tap
    // sets the value to the pressed position (standard slider behavior): press
    // the middle and you get ~50%, not the old value left untouched. A release
    // that came from a long-press (hold_action fired) is left alone.
    if (info && this._dragPercent !== undefined && !this._holdTriggered) {
      this._suppressClick = true;
      this._setSliderValue(this._valueFromPercent(this._dragPercent, info));
    }
    this._dragPercent = undefined;
  };

  // Dashboard-wide swipe plugins (hass-swipe-navigation and friends) listen for
  // touch/mouse drags on an ancestor of the card in the bubble phase. A drag on
  // a slider button is setting the value, never navigation, so it is kept from
  // reaching them — otherwise a sideways flick switches the view out from under
  // the value being set (same guard as the time-card wheels). Only slider
  // buttons drag; a plain button must stay swipe-through, so the guard no-ops
  // unless this card is in slider mode.
  private _stopSwipe = (e: Event): void => {
    if (this._sliderInfo()) e.stopPropagation();
  };

  private _onClick = (): void => {
    if (this._suppressClick) {
      this._suppressClick = false;
      return;
    }
    if (this._holdTriggered) {
      this._holdTriggered = false;
      return;
    }
    const hasDoubleTap = _isRealAction(this._config?.double_tap_action);
    const now = Date.now();
    if (hasDoubleTap && now - this._lastTap < DOUBLE_TAP_WINDOW_MS) {
      this._lastTap = 0;
      this._handleAction(this._config?.double_tap_action);
      return;
    }
    this._lastTap = now;
    const domain = this._config?.entity?.split(".")[0] ?? "";
    const defaultTap = this._defaultTapAction(domain);
    if (hasDoubleTap) {
      window.setTimeout(() => {
        if (this._lastTap !== now) return;
        this._handleAction(this._config?.tap_action ?? defaultTap);
      }, DOUBLE_TAP_WINDOW_MS);
    } else {
      this._handleAction(this._config?.tap_action ?? defaultTap);
    }
  };

  // The chip row sits inside the card body, so a chip press would otherwise
  // bubble up and also fire the card's own tap/hold (or start a slider drag,
  // or activate it via Enter). The chips' own listeners sit on the chip
  // itself and have already run by the time the event reaches the row.
  private _stopChipEvent = (e: Event): void => {
    e.stopPropagation();
  };

  private _onIconPointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
    this._iconHoldTriggered = false;
    if (_isRealAction(this._config?.icon_hold_action)) {
      window.clearTimeout(this._iconHoldTimer);
      this._iconHoldTimer = window.setTimeout(() => {
        this._iconHoldTriggered = true;
        this._handleAction(this._config?.icon_hold_action);
      }, HOLD_DURATION_MS);
    }
  };

  private _onIconPointerUp = (e: PointerEvent): void => {
    e.stopPropagation();
    window.clearTimeout(this._iconHoldTimer);
  };

  private _onIconClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (this._iconHoldTriggered) {
      this._iconHoldTriggered = false;
      return;
    }
    const hasIconDoubleTap = _isRealAction(this._config?.icon_double_tap_action);
    const now = Date.now();
    if (hasIconDoubleTap && now - this._iconLastTap < DOUBLE_TAP_WINDOW_MS) {
      this._iconLastTap = 0;
      this._handleAction(this._config?.icon_double_tap_action);
      return;
    }
    this._iconLastTap = now;
    // In slider mode the body sets the value, so the icon becomes the natural
    // on/off switch: default it to the domain's toggle (falling back to
    // more-info for non-toggleable domains). A plain button keeps more-info.
    const iconDomain = this._config?.entity?.split(".")[0] ?? "";
    const defaultIconTap: HaActionConfig = this._sliderInfo()
      ? this._defaultTapAction(iconDomain)
      : { action: "more-info" };
    if (hasIconDoubleTap) {
      window.setTimeout(() => {
        if (this._iconLastTap !== now) return;
        this._handleAction(this._config?.icon_tap_action ?? defaultIconTap);
      }, DOUBLE_TAP_WINDOW_MS);
    } else {
      this._handleAction(this._config?.icon_tap_action ?? defaultIconTap);
    }
  };

  private _formatState(entity: HassEntity): string {
    if (this.hass?.formatEntityState) {
      try {
        return this.hass.formatEntityState(entity);
      } catch {
        // fall through to raw state
      }
    }
    return entity.state;
  }

  private _formatRelativeTime(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "";
    const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(this._language, { numeric: "auto" });
    const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
      [60, "seconds"],
      [60, "minutes"],
      [24, "hours"],
      [7, "days"],
      [4.34524, "weeks"],
      [12, "months"],
      [Infinity, "years"],
    ];
    let duration = diffSec;
    for (const [amount, unit] of divisions) {
      if (Math.abs(duration) < amount) {
        return rtf.format(Math.round(duration), unit);
      }
      duration /= amount;
    }
    return rtf.format(Math.round(duration), "years");
  }

  private _formatStateContent(entity: HassEntity): string {
    const content = this._config?.state_content ?? "state";
    if (content === "last_updated") {
      return this._formatRelativeTime(entity.last_updated);
    }
    if (content === "last_changed") {
      return this._formatRelativeTime(entity.last_changed);
    }
    return this._formatState(entity);
  }

  /**
   * Radius that draws a capsule at this card's actual height.
   *
   * Not simply a huge number. A browser clamps an over-large radius when it
   * paints but interpolates the value it was given, so animating from 999px to
   * 16px spends 98% of the time above the clamp: the outline sits perfectly
   * still and squares off at the very end, while the icon well, whose two
   * values are close together, travels the whole way. Measured, the two ends
   * are a few pixels apart and both shapes move together.
   */
  private _capsuleRadius = BUTTON_SHAPE_OFF_RADIUS;

  protected updated(): void {
    // Runs before the shape measuring below bails out: a scrolling chip row
    // needs its edge fades whether or not the shape follows the state.
    this._chipFades.sync(this.renderRoot);
    if (this._config?.shape_by_state !== true) return;
    // A corner radius does not affect height, so re-rendering for a new
    // measurement cannot feed itself.
    const shell = this.renderRoot?.querySelector("ha-card");
    const height = shell?.getBoundingClientRect().height ?? 0;
    if (height <= 0) return;
    const capsule = Math.round(height / 2);
    if (capsule === this._capsuleRadius) return;
    this._capsuleRadius = capsule;
    this.requestUpdate();
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const hasEntity = !!this._config.entity;
    const entity: HassEntity | undefined = hasEntity
      ? this.hass.states[this._config.entity as string]
      : undefined;

    if (hasEntity && !entity) {
      return html`
        <ha-card>
          <div class="card-inner glass missing-entity">
            ${this._config.entity}: entity not found
          </div>
        </ha-card>
      `;
    }

    const unavailable = entity?.state === "unavailable";
    if (unavailable && this._config.unavailable_style === "hidden") {
      return nothing;
    }
    const dimUnavailable = unavailable && this._config.unavailable_style !== "normal";
    const domain = this._config.entity?.split(".")[0] ?? "";
    // Action-only buttons (no entity) always render "active" — there is no
    // real state to be inactive about, matching STATELESS_DOMAINS behavior.
    // Whether the entity is actually on. `static_color` freezes the colours by
    // making the card render as inactive, which is what it has always done —
    // but the off icon and the state shape are not colours. They exist to say
    // what the entity is doing, and a colour option has no business silencing
    // them, so they follow this rather than the flag below.
    const stateActive =
      !unavailable && (entity ? this._isActive(entity.state, domain) : true);
    const active = stateActive && this._config.static_color !== true;
    const rawActiveColor = this._activeColor(entity?.state ?? "");
    const rawInactiveColor = this._config.inactive_color
      ? this._resolveColor(this._config.inactive_color)
      : "var(--primary-text-color)";
    const color = this._config.invert_colors ? rawInactiveColor : rawActiveColor;
    const inactiveColor = this._config.invert_colors
      ? rawActiveColor
      : rawInactiveColor;
    const sliderFillBg = tintOn(this, color, this._config.color_opacity, 45);
    const iconBgInactive = tintOn(this, inactiveColor, this._config.inactive_opacity, 8);
    // Solid turns the pair inside out: the accent goes on the well and the
    // glyph is darkened against it, rather than a wash of accent carrying an
    // accent-coloured glyph. Louder, and the shape that reads first from a
    // distance — which is the point of an active state.
    const solidIcon = this._config.icon_fill === "solid";
    const iconBgActive = solidIcon
      ? fillColor(this, color)
      : tintOn(this, color, this._config.color_opacity, 20);
    // In slider mode the fill runs behind the icon chip; a translucent chip
    // would double-tint over it into a muddy blob. This opaque variant (the
    // same tint mixed into the card surface instead of transparency) covers
    // the fill so the chip reads as its own surface.
    const iconBgActiveSolid = solidIcon
      ? fillColor(this, color)
      : tintOn(this, color, this._config.color_opacity, 20);
    // The glyph sits in the well, so it is measured against the well rather
    // than against the card — otherwise an active button shows an accent icon
    // on an accent-tinted ground and the glyph disappears.
    const iconInkActive = solidIcon
      ? inkOn(iconBgActive, this)
      : foregroundOn(color, iconBgActive);
    const iconInkInactive = foregroundOn(inactiveColor, iconBgInactive);
    const name =
      this._config.name ||
      entity?.attributes.friendly_name ||
      this._config.entity ||
      "";
    // With an entity, <ha-state-icon> resolves config icon > entity's own
    // icon > HA's computed domain/device-class default (matching the native
    // tile card) — so no local fallback guess is needed in that case.
    // An entity that is off may want to say so with its shape as well: the
    // struck-through variant of a symbol reads as "not connected" before any
    // colour does. Falls back to the one icon when no second one is given.
    const stateIcon =
      !stateActive && this._config.icon_off
        ? this._config.icon_off
        : this._config.icon;
    const icon = stateIcon || "mdi:gesture-tap-button";
    const stateText = !entity
      ? ""
      : unavailable
        ? this._t("unavailable")
        : this._formatStateContent(entity);
    const iconBoxCss = this._config.icon_size
      ? `${this._config.icon_size}px`
      : "min(56px, 78cqh)";
    const iconGlyphCss = this._config.icon_size
      ? `${this._config.icon_size * 0.5}px`
      : "min(28px, 39cqh)";
    // Fixed value matches the responsive formula (min(16px, 11cqh))
    // evaluated at a single Sections-view row (~56px tall), so a taller
    // aligned card's icon sits at the exact same left inset as a normal
    // 1-row card's icon, instead of an arbitrary guessed offset. Vertical
    // position stays centered regardless of align_icons — only horizontal
    // inset is fixed.
    const iconOffsetCss = this._config.align_icons
      ? "6.16px"
      : "min(16px, 11cqh)";
    // A shape that follows the state says what the colour says, in a second
    // channel — which is the point on a phone's quick settings, where a glance
    // from across the room reads the outline before it reads the tint.
    const shaped = this._config.shape_by_state === true;
    const radius = resolveCornerRadius(
      shaped
        ? stateActive
          ? (this._config.radius ?? BUTTON_SHAPE_ON_RADIUS)
          : this._capsuleRadius
        : (this._config.radius ?? DEFAULT_BUTTON_RADIUS),
      this._config.corners,
    );
    const sliderInfo = entity && !unavailable ? this._sliderInfo() : undefined;
    const sliderPercent =
      this._dragPercent ??
      (sliderInfo
        ? ((sliderInfo.value - sliderInfo.min) / (sliderInfo.max - sliderInfo.min)) * 100
        : 0);
    const sliderValue = sliderInfo
      ? this._dragPercent !== undefined
        ? Math.round(sliderInfo.min + (this._dragPercent / 100) * (sliderInfo.max - sliderInfo.min))
        : Math.round(sliderInfo.value)
      : 0;

    const chipButtons = this._config.chip_buttons ?? [];
    const hasChipButtons = chipButtons.length > 0;
    const chipRowConfig = embeddedChipRowConfig(this._config);
    const chipState = {
      pressedKey: this._chipPressedKey,
      gestures: this._chipGestures,
      onPressChange: (key: string | undefined) => {
        this._chipPressedKey = key;
      },
    };
    // Only meaningful once the card is tall enough for the bottom chip bar
    // (see .chip-row-bottom's @container rule) — a normal-height card always
    // right-aligns the inline chip row regardless of this setting.
    const chipJustify = chipRowJustify(this._config.chip_buttons_justify);

    return html`
      <ha-card
        class=${`${dimUnavailable ? "unavailable" : ""} ${
          shouldAnimate(this._config.animation) ? "" : "no-animations"
        }`}
        style=${`--m3-btn-color: ${color}; --m3-btn-inactive-color: ${inactiveColor}; --m3-btn-slider-fill-bg: ${sliderFillBg}; --m3-btn-icon-bg-inactive: ${iconBgInactive}; --m3-btn-icon-bg-active: ${iconBgActive}; --m3-btn-icon-bg-active-solid: ${iconBgActiveSolid}; --m3-btn-icon-ink-active: ${iconInkActive}; --m3-btn-icon-ink-inactive: ${iconInkInactive}; --m3-btn-color-fg: ${foregroundColor(this, color)}; --m3-icon-box: ${iconBoxCss}; --m3-icon-glyph: ${iconGlyphCss}; --m3-icon-offset: ${iconOffsetCss}; border-radius: ${radius};`}
      >
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${sliderInfo ? "sliderable" : ""} ${shouldAnimate(this._config.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};`}
          role="button"
          tabindex="0"
          aria-label=${name}
          @click=${this._onClick}
          @keydown=${activateOnKey(() => this._onClick())}
          @pointerdown=${this._onPointerDown}
          @pointermove=${this._onPointerMove}
          @pointerup=${this._onPointerUp}
          @pointercancel=${this._onPointerUp}
          @pointerleave=${this._onPointerUp}
          @touchstart=${this._stopSwipe}
          @touchmove=${this._stopSwipe}
          @mousedown=${this._stopSwipe}
          @mousemove=${this._stopSwipe}
        >
          ${sliderInfo
            ? html`<div
                class="slider-fill-bg ${this._dragPercent !== undefined
                  ? "dragging"
                  : ""}"
                style=${`width: ${sliderPercent}%;`}
              ></div>`
            : nothing}
          <div class="content ${this._config.vertical ? "vertical" : "horizontal"}">
            ${this._config.show_icon_background !== false
              ? html`
                  <div
                    class="icon-container ${active ? "active" : ""} ${
                      shaped ? "shaped" : ""
                    } ${stateActive ? "on" : ""}"
                    @click=${this._onIconClick}
                    @pointerdown=${this._onIconPointerDown}
                    @pointerup=${this._onIconPointerUp}
                    @pointercancel=${this._onIconPointerUp}
                    @pointerleave=${this._onIconPointerUp}
                  >
                    ${entity
                      ? html`<ha-state-icon
                          .hass=${this.hass}
                          .icon=${stateIcon}
                          .stateObj=${entity}
                        ></ha-state-icon>`
                      : html`<ha-icon icon=${icon}></ha-icon>`}
                  </div>
                `
              : html`
                  <div
                    class="icon-bare ${active ? "active" : ""}"
                    @click=${this._onIconClick}
                    @pointerdown=${this._onIconPointerDown}
                    @pointerup=${this._onIconPointerUp}
                    @pointercancel=${this._onIconPointerUp}
                    @pointerleave=${this._onIconPointerUp}
                  >
                    ${entity
                      ? html`<ha-state-icon
                          .hass=${this.hass}
                          .icon=${stateIcon}
                          .stateObj=${entity}
                        ></ha-state-icon>`
                      : html`<ha-icon icon=${icon}></ha-icon>`}
                  </div>
                `}
            <div class="text">
              <div class="name">${name}</div>
              ${this._config.show_state !== false && entity
                ? html`<div class="state">
                    ${sliderInfo ? `${sliderValue}${sliderInfo.unit}` : stateText}
                  </div>`
                : nothing}
            </div>
            ${hasChipButtons
              ? html`<div
                  class="chip-row chip-row-inline"
                  @click=${this._stopChipEvent}
                  @keydown=${this._stopChipEvent}
                  @pointerdown=${this._stopChipEvent}
                  @pointerup=${this._stopChipEvent}
                >
                  ${renderChipButtons(this, this.hass, chipRowConfig, chipState)}
                </div>`
              : nothing}
          </div>
          ${hasChipButtons
            ? html`<div
                class="chip-row chip-row-bottom"
                style=${`justify-content: ${chipJustify};`}
                @click=${this._stopChipEvent}
                @keydown=${this._stopChipEvent}
                @pointerdown=${this._stopChipEvent}
                @pointerup=${this._stopChipEvent}
              >
                ${renderChipButtons(this, this.hass, chipRowConfig, chipState)}
              </div>`
            : nothing}
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    ${glassCardStyles}
    ${chipButtonsStyles}

    /* Grid rather than block, and the card stretches into the grid area
       instead of taking height: 100%.

       ha-card is a size container, so its own contents cannot give it a
       height — that is what size containment means. A percentage height only
       resolves against a parent whose height is definite, which it is in the
       sections view but not in a masonry column, and an unresolved percentage
       on a size-contained box collapses to 0. The card vanished, and with it
       the cqh units every padding here is expressed in.

       A grid area is definite as soon as the host has a used height, so the
       card fills it and cqh resolves. min-height below is what gives the host
       that height when nothing else does. */
    :host {
      display: grid;
      min-height: 56px;
    }

    ha-card {
      container-type: size;
      transition: border-radius ${unsafeCSS(BUTTON_SHAPE_MS)}ms ${unsafeCSS(STANDARD_EASING)};
    }

    /* .card-inner's glass/solid background and border come from
       glassCardStyles. Only the layout this card differs on is set here. */
    .card-inner {
      position: relative;
      overflow: hidden;
      padding: var(
        --m3-group-padding,
        min(12px, 9cqh) min(16px, 11cqh) min(12px, 9cqh) var(--m3-icon-offset, min(16px, 11cqh))
      );
      cursor: pointer;
      justify-content: center;
      gap: 10px;
      transition:
        transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
        border-radius ${unsafeCSS(BUTTON_SHAPE_MS)}ms ${unsafeCSS(STANDARD_EASING)};
    }

    .card-inner:active {
      transform: scale(0.96);
    }

    .card-inner:focus-visible {
      outline: 2px solid var(--m3-btn-color);
      outline-offset: 2px;
    }

    /* The shell clips to its own corners, so it has to stop animating them
       too when animations are off — not only the surface inside it. */
    ha-card.no-animations,
    .card-inner.no-animations {
      transition: none;
    }

    .card-inner.no-animations {
      transition: none;
    }

    .card-inner.no-animations:active {
      transform: none;
    }

    .card-inner.no-animations .icon-container {
      transition: none;
    }

    .card-inner.no-animations .m3-chip-button {
      transition: none;
    }

    .card-inner.sliderable {
      touch-action: none;
    }

    .slider-fill-bg {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--m3-btn-slider-fill-bg);
      pointer-events: none;
      transition: width 0.1s ease;
    }

    /* While dragging, the fill must track the finger 1:1 — the settle
       transition would otherwise trail the pointer and read as lag. */
    .slider-fill-bg.dragging {
      transition: none;
    }

    ha-card.unavailable .card-inner {
      opacity: 0.4;
      pointer-events: none;
    }

    .content {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: stretch;
      gap: 14px;
      width: 100%;
      min-width: 0;
    }

    .content.vertical {
      flex-direction: column;
      text-align: center;
      gap: 8px;
    }

    .icon-container {
      flex-shrink: 0;
      align-self: center;
      width: var(--m3-icon-box, min(56px, 78cqh));
      height: var(--m3-icon-box, min(56px, 78cqh));
      min-width: 24px;
      min-height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--m3-btn-icon-ink-inactive, var(--m3-btn-inactive-color));
      background: var(--m3-btn-icon-bg-inactive);
      transition: all 0.25s ease;
      cursor: pointer;
    }

    .icon-container ha-icon {
      --mdc-icon-size: var(--m3-icon-glyph, min(28px, 39cqh));
    }

    .icon-container.active {
      background: var(--m3-btn-icon-bg-active);
      color: var(--m3-btn-icon-ink-active, var(--m3-btn-color));
    }

    /* The well is a circle while the entity is off and a rounded square while
       it is on. */
    .icon-container.shaped.on {
      border-radius: ${unsafeCSS(BUTTON_SHAPE_ON_ICON_RADIUS)};
    }

    /* The well transitions everything over 0.25s, the shell its corners over a
       little longer and on a different curve — so the inner shape arrived
       first and the two looked like they were changing for separate reasons.
       Listing border-radius after "all" overrides it for that one property and
       leaves the colours alone. */
    .icon-container.shaped {
      transition:
        all 0.25s ease,
        border-radius ${unsafeCSS(BUTTON_SHAPE_MS)}ms ${unsafeCSS(STANDARD_EASING)};
    }

    .icon-container.shaped.no-animations {
      transition: none;
    }

    /* Slider mode: opaque chip so the fill behind it doesn't double-tint. */
    .card-inner.sliderable .icon-container.active {
      background: var(--m3-btn-icon-bg-active-solid);
    }

    .icon-bare {
      flex-shrink: 0;
      align-self: center;
      width: var(--m3-icon-box, min(56px, 78cqh));
      height: var(--m3-icon-box, min(56px, 78cqh));
      min-width: 24px;
      min-height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--m3-btn-inactive-color);
      overflow: hidden;
      cursor: pointer;
    }

    .icon-bare ha-icon {
      --mdc-icon-size: var(--m3-icon-glyph, min(28px, 39cqh));
    }

    .icon-bare.active {
      /* Bare icon sits on the card, so the card-level foreground applies. */
      color: var(--m3-btn-color-fg, var(--m3-btn-color));
    }

    .text {
      min-width: 0;
      flex: 1;
      align-self: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
    }

    .name {
      font-size: 15px;
      font-weight: 700;
      line-height: 1.25;
      color: var(--primary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .state {
      font-size: 13px;
      opacity: 0.7;
      color: var(--primary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Chip buttons embedded in the card: right-aligned next to the content at
       normal height (below), or a bottom-anchored bar once the card is
       resized taller than one row (the @container rule below). Both variants
       render the same chips — only their CSS visibility differs — so the
       switch is purely declarative and needs no JS height measuring. */
    .chip-row {
      display: flex;
      align-items: center;
      min-width: 0;
    }

    .chip-row-inline {
      margin-left: auto;
      flex-shrink: 0;
      justify-content: flex-end;
    }

    .chip-row-bottom {
      display: none;
      margin-top: auto;
    }

    @container (min-height: 100px) {
      .card-inner:has(.chip-row-bottom) {
        justify-content: flex-start;
      }

      .chip-row-inline {
        display: none;
      }

      .chip-row-bottom {
        display: flex;
      }
    }

  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-button-card": M3ButtonCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-button-card",
  name: "M3 Button Card",
  description:
    "Eine Material-3-inspirierte Button-Karte für beliebige Entities (Buttons, Schalter, Lichter, Szenen, ...).",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
