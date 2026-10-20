import { LitElement, html, css, svg, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3CoverCardConfig,
  CoverEntityConfig,
  LovelaceCard,
  LovelaceCardEditor,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_COVER_RADIUS,
  DEFAULT_COVER_ACCENT,
  DEFAULT_COVER_ICON,
  COVER_DEVICE_ICONS,
  COVER_FEATURE,
  COVER_TILT_STEP,
  COVER_POSITION_THROTTLE_MS,
  COVER_DRAG_SETTLE_MS,
  COVER_MIN_FEEDBACK_MS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, tintOn, foregroundOn, resolveCommonColors } from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { buildWavePath } from "./shared/wave";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters, listEntities } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-COVER-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #9fd6bf; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #9fd6bf; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

type CoverDir = "up" | "down" | "stop";

interface CoverModel {
  entity: string;
  name: string;
  icon: string;
  available: boolean;
  known: boolean; // state is open/closed/opening/closing (not unknown)
  state: string;
  position?: number; // 0..100, undefined if unsupported
  tilt?: number; // 0..100
  features: number;
  isSwitchPair: boolean;
  // switch_pair models carry their own relays, so a group row acts on its
  // own switches rather than the card-level config.
  up?: string;
  down?: string;
  stop?: string;
}

@customElement("m3-cover-card")
export class M3CoverCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CoverCardConfig;
  // Optimistic slider value while dragging, keyed by entity id.
  @state() private _dragPosition?: number;
  private _dragEntity?: string;
  private _throttleTs = 0;
  private _settleTimer?: number;
  // Transient press feedback for positionless covers: entity -> {dir, until}.
  @state() private _feedback: Record<string, { dir: CoverDir; until: number }> = {};
  private _feedbackTimers: Record<string, number> = {};

  // Cover is one of only two cards in the suite that held timers without a
  // teardown: a group can arm one feedback timer per switch pair, and a drag
  // leaves a settle timer pending. They fire on a detached element when the
  // card is removed mid-gesture — harmless in Lit, but out of step with the
  // other 21 cards.
  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._settleTimer) clearTimeout(this._settleTimer);
    this._settleTimer = undefined;
    for (const id of Object.values(this._feedbackTimers)) clearTimeout(id);
    this._feedbackTimers = {};
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.entity,
      this._config?.up_entity,
      this._config?.down_entity,
      this._config?.stop_entity,
      ...listEntities(this._config?.entities),
    ]);
  }

  public setConfig(config: M3CoverCardConfig): void {
    if (config.mode === "group" && !config.entities?.length) {
      // tolerate an empty group; render nothing rather than throw
    }
    this._config = config;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-cover-card-editor");
    return document.createElement("m3-cover-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3CoverCardConfig {
    const covers = Object.keys(hass.states).filter((id) => id.startsWith("cover."));
    return {
      type: "custom:m3-cover-card",
      mode: "single",
      entity: covers[0] ?? "",
      glass_background: true,
    };
  }

  public getCardSize(): number {
    return this._config?.mode === "group" ? 4 : 5;
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- model ---------------------------------------------------------------

  private _isSwitchPair(): boolean {
    return this._config?.entity_type === "switch_pair";
  }

  // A spec is either the card-level config (single mode) or one group entry.
  // Each can be a cover entity or a switch_pair carrying its own relays.
  private _model(cfg: CoverEntityConfig): CoverModel | undefined {
    const hass = this.hass;
    if (!hass) return undefined;
    const switchPair =
      cfg.entity_type === "switch_pair" || (!cfg.entity && !!(cfg.up_entity || cfg.down_entity));
    if (switchPair) {
      const up = cfg.up_entity;
      const down = cfg.down_entity;
      const stop = cfg.stop_entity;
      const ref = up ? hass.states[up] : down ? hass.states[down] : undefined;
      return {
        entity: up ?? down ?? cfg.entity ?? "",
        name: cfg.name || this._config?.name || this._t("cover_default_name"),
        icon: cfg.icon || this._config?.icon || COVER_DEVICE_ICONS[this._deviceClass()] || DEFAULT_COVER_ICON,
        available: !!ref && ref.state !== "unavailable",
        known: false,
        state: "unknown",
        // Only offer the buttons whose switch is actually configured — a
        // FingerBot pair often has no stop relay.
        features:
          (up ? COVER_FEATURE.OPEN : 0) |
          (down ? COVER_FEATURE.CLOSE : 0) |
          (stop ? COVER_FEATURE.STOP : 0),
        isSwitchPair: true,
        up,
        down,
        stop,
      };
    }
    if (!cfg.entity) return undefined;
    const st = hass.states[cfg.entity];
    if (!st) return undefined;
    const attrs = st.attributes ?? {};
    const features = (attrs.supported_features as number) ?? 0;
    const rawPos = attrs.current_position as number | undefined;
    let position = typeof rawPos === "number" ? Math.round(rawPos) : undefined;
    if (position !== undefined && this._config?.invert_position) position = 100 - position;
    const tilt = attrs.current_tilt_position as number | undefined;
    const dc = (this._config?.device_class || (attrs.device_class as string) || "") as string;
    const icon = cfg.icon || this._config?.icon || COVER_DEVICE_ICONS[dc] || DEFAULT_COVER_ICON;
    return {
      entity: cfg.entity,
      name: cfg.name || this._config?.name || (attrs.friendly_name as string) || cfg.entity,
      icon,
      available: st.state !== "unavailable",
      known: ["open", "closed", "opening", "closing"].includes(st.state),
      state: st.state,
      position,
      tilt: typeof tilt === "number" ? Math.round(tilt) : undefined,
      features,
      isSwitchPair: false,
    };
  }

  private _deviceClass(): string {
    if (this._config?.device_class) return this._config.device_class;
    const ent = this._config?.entity;
    const dc = ent ? (this.hass?.states[ent]?.attributes?.device_class as string) : undefined;
    return dc ?? "";
  }

  // ---- status text ---------------------------------------------------------

  private _statusText(m: CoverModel): string {
    const fb = this._feedback[m.entity];
    if (fb && fb.until > Date.now()) {
      if (fb.dir === "up") return this._t("cover_status_opening");
      if (fb.dir === "down") return this._t("cover_status_closing");
      return this._t("cover_status_stopped");
    }
    if (!m.available) return this._t("cover_status_unavailable");
    if (m.state === "opening") return this._t("cover_status_opening");
    if (m.state === "closing") return this._t("cover_status_closing");
    // No position and no open/closed state (switch pairs, or a cover right
    // after a restart): nothing meaningful to show, so leave the status line
    // empty rather than a permanent "Unknown". The :empty CSS rule hides it.
    if (!m.known) return "";
    if (m.position !== undefined) {
      if (m.position <= 0) return this._t("cover_status_closed");
      if (m.position >= 100) return this._t("cover_status_open");
      return `${this._t("cover_status_open")} · ${m.position} %`;
    }
    return m.state === "closed" ? this._t("cover_status_closed") : this._t("cover_status_open");
  }

  // ---- service calls -------------------------------------------------------

  private _callDir(m: CoverModel, dir: CoverDir): void {
    const hass = this.hass;
    if (!hass) return;
    if (m.isSwitchPair) {
      const map: Record<CoverDir, string | undefined> = { up: m.up, down: m.down, stop: m.stop };
      const target = map[dir];
      if (target) {
        const [domain] = target.split(".");
        hass.callService(domain, "turn_on", { entity_id: target }).catch(() => undefined);
      }
      this._pulseFeedback(m.entity, dir);
      return;
    }
    const service = dir === "up" ? "open_cover" : dir === "down" ? "close_cover" : "stop_cover";
    hass.callService("cover", service, { entity_id: m.entity }).catch(() => undefined);
    // Only positionless covers need the optimistic status; real ones report
    // opening/closing themselves.
    if (m.position === undefined) this._pulseFeedback(m.entity, dir);
  }

  private _pulseFeedback(entity: string, dir: CoverDir): void {
    const travel = (this._config?.travel_time ?? 0) * 1000;
    const dur = dir === "stop" ? COVER_MIN_FEEDBACK_MS : Math.max(COVER_MIN_FEEDBACK_MS, travel);
    this._feedback = { ...this._feedback, [entity]: { dir, until: Date.now() + dur } };
    if (this._feedbackTimers[entity]) clearTimeout(this._feedbackTimers[entity]);
    this._feedbackTimers[entity] = window.setTimeout(() => {
      const next = { ...this._feedback };
      delete next[entity];
      this._feedback = next;
    }, dur + 30);
  }

  private _setPosition(m: CoverModel, value: number): void {
    const hass = this.hass;
    if (!hass) return;
    const pos = this._config?.invert_position ? 100 - value : value;
    hass.callService("cover", "set_cover_position", {
      entity_id: m.entity,
      position: Math.round(pos),
    }).catch(() => undefined);
  }

  private _tiltStep(m: CoverModel, delta: number): void {
    const hass = this.hass;
    if (!hass) return;
    const step = this._config?.tilt_step ?? COVER_TILT_STEP;
    const current = m.tilt ?? 0;
    const next = Math.max(0, Math.min(100, current + delta * step));
    hass.callService("cover", "set_cover_tilt_position", {
      entity_id: m.entity,
      tilt_position: next,
    }).catch(() => undefined);
  }

  private _tiltDir(m: CoverModel, dir: "open" | "close"): void {
    this.hass?.callService("cover", dir === "open" ? "open_cover_tilt" : "close_cover_tilt", {
      entity_id: m.entity,
    }).catch(() => undefined);
  }

  private _moreInfo(entity: string): void {
    fireEvent(this, "hass-more-info", { entityId: entity });
  }

  // ---- slider drag ---------------------------------------------------------

  private _sliderFromEvent(ev: PointerEvent, track: HTMLElement): number {
    const rect = track.getBoundingClientRect();
    const ratio = (ev.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }

  private _onSliderDown(m: CoverModel, ev: PointerEvent): void {
    const track = ev.currentTarget as HTMLElement;
    track.setPointerCapture(ev.pointerId);
    this._dragEntity = m.entity;
    this._dragPosition = this._sliderFromEvent(ev, track);
  }

  private _onSliderMove(m: CoverModel, ev: PointerEvent): void {
    if (this._dragEntity !== m.entity) return;
    const track = ev.currentTarget as HTMLElement;
    const value = this._sliderFromEvent(ev, track);
    this._dragPosition = value;
    const now = Date.now();
    if (now - this._throttleTs >= COVER_POSITION_THROTTLE_MS) {
      this._throttleTs = now;
      this._setPosition(m, value);
    }
  }

  private _onSliderUp(m: CoverModel, ev: PointerEvent): void {
    if (this._dragEntity !== m.entity) return;
    const track = ev.currentTarget as HTMLElement;
    const value = this._sliderFromEvent(ev, track);
    this._setPosition(m, value);
    this._dragPosition = value;
    if (this._settleTimer) clearTimeout(this._settleTimer);
    this._settleTimer = window.setTimeout(() => {
      this._dragEntity = undefined;
      this._dragPosition = undefined;
    }, COVER_DRAG_SETTLE_MS);
  }

  private _onSliderKey(m: CoverModel, ev: KeyboardEvent): void {
    const cur = m.position ?? 0;
    let next = cur;
    if (ev.key === "ArrowRight" || ev.key === "ArrowUp") next = Math.min(100, cur + 5);
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") next = Math.max(0, cur - 5);
    else return;
    ev.preventDefault();
    this._setPosition(m, next);
  }

  private _displayPosition(m: CoverModel): number | undefined {
    if (this._dragEntity === m.entity && this._dragPosition !== undefined) return this._dragPosition;
    return m.position;
  }

  // ---- render: single ------------------------------------------------------

  private _accent(): string {
    return this._config?.accent_color ? resolveThemeColor(this._config.accent_color) : DEFAULT_COVER_ACCENT;
  }

  private _renderButtonRow(m: CoverModel, compact: boolean): unknown {
    const f = m.features;
    const canOpen = f & COVER_FEATURE.OPEN;
    const canClose = f & COVER_FEATURE.CLOSE;
    const canStop = f & COVER_FEATURE.STOP;
    const posKnown = m.position !== undefined;
    const atOpen = posKnown && (m.position as number) >= 100;
    const atClosed = posKnown && (m.position as number) <= 0;
    const active = this._feedback[m.entity];
    const fb: CoverDir | undefined = active && active.until > Date.now() ? active.dir : undefined;
    const cls = compact ? "btn-compact" : "btn-stacked";
    return html`
      <div class="btn-row ${cls}">
        ${canOpen
          ? html`<button
              class="cbtn open ${fb === "up" ? "active" : ""}"
              ?disabled=${!m.available || atOpen}
              @click=${() => this._callDir(m, "up")}
              aria-label=${this._t("cover_open")}
            >
              <ha-icon icon="mdi:chevron-up"></ha-icon>
            </button>`
          : nothing}
        ${canStop
          ? html`<button
              class="cbtn stop ${fb === "stop" ? "active" : ""}"
              ?disabled=${!m.available}
              @click=${() => this._callDir(m, "stop")}
              aria-label=${this._t("cover_stop")}
            >
              <ha-icon icon="mdi:stop"></ha-icon>
            </button>`
          : nothing}
        ${canClose
          ? html`<button
              class="cbtn close ${fb === "down" ? "active" : ""}"
              ?disabled=${!m.available || atClosed}
              @click=${() => this._callDir(m, "down")}
              aria-label=${this._t("cover_close")}
            >
              <ha-icon icon="mdi:chevron-down"></ha-icon>
            </button>`
          : nothing}
      </div>
    `;
  }

  private _renderPreview(m: CoverModel): unknown {
    if (this._config?.show_preview === false) return nothing;
    // A switch pair has no position or open/closed state, so the preview could
    // only ever show a static "unknown" hatch — hide it rather than confuse.
    if (m.isSwitchPair) return nothing;
    const dc = this._deviceClass();
    const curtain = dc === "curtain";
    const accent = this._accent();
    // shutter covers (100 - position)% from the top; positionless covers use
    // the binary state, unknown shows a neutral half.
    let covered: number;
    let neutral = false;
    const pos = this._displayPosition(m);
    if (pos !== undefined) covered = 100 - pos;
    else if (!m.known) {
      covered = 50;
      neutral = true;
    } else covered = m.state === "closed" ? 100 : 0;
    const animate = shouldAnimate(this._config?.animation);
    const trans = animate ? `transition: ${curtain ? "width" : "height"} 0.4s ${STANDARD_EASING};` : "";
    const shutterStyle = curtain
      ? `width: ${covered}%; height: 100%; top: 0; left: 0; ${trans}`
      : `height: ${covered}%; width: 100%; top: 0; left: 0; ${trans}`;
    return html`
      <div class="preview" style=${`--cv-accent: ${accent};`}>
        <div class="preview-inner">
          <div
            class="shutter ${neutral ? "neutral" : ""} ${curtain ? "curtain" : ""}"
            style=${shutterStyle}
          ></div>
        </div>
      </div>
    `;
  }

  private _renderSlider(m: CoverModel): unknown {
    if (!(m.features & COVER_FEATURE.SET_POSITION)) return nothing;
    const pos = this._displayPosition(m) ?? 0;
    const accent = this._accent();
    const wavy = this._config?.slider_style === "wavy";
    return html`
      <div
        class="slider"
        role="slider"
        tabindex="0"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${pos}
        aria-label=${m.name}
        @pointerdown=${(e: PointerEvent) => this._onSliderDown(m, e)}
        @pointermove=${(e: PointerEvent) => this._onSliderMove(m, e)}
        @pointerup=${(e: PointerEvent) => this._onSliderUp(m, e)}
        @keydown=${(e: KeyboardEvent) => this._onSliderKey(m, e)}
        style=${`--cv-accent: ${accent};`}
      >
        <div class="slider-track"></div>
        <div class="slider-fill" style=${`width: ${pos}%;`}>
          ${wavy ? this._renderSliderWave() : nothing}
        </div>
        <div class="slider-handle" style=${`left: ${pos}%;`}></div>
      </div>
    `;
  }

  private _renderSliderWave(): unknown {
    // Static decorative wave along the fill's centre line.
    const path = buildWavePath(0, 200, 2, 22, 0, 6, 4);
    return svg`<svg class="slider-wave" viewBox="0 0 200 12" preserveAspectRatio="none">
      <path d=${path} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>`;
  }

  private _renderTilt(m: CoverModel): unknown {
    const f = m.features;
    const hasSet = f & COVER_FEATURE.SET_TILT_POSITION;
    const hasBtns = f & (COVER_FEATURE.OPEN_TILT | COVER_FEATURE.CLOSE_TILT);
    if (!hasSet && !hasBtns) return nothing;
    if (hasSet) {
      const tilt = m.tilt ?? 0;
      return html`
        <div class="tilt-row">
          <span class="tilt-label">${this._t("cover_tilt")}</span>
          <div class="tilt-controls">
            <button class="tbtn minus" @click=${() => this._tiltStep(m, -1)} aria-label="−">
              <ha-icon icon="mdi:minus"></ha-icon>
            </button>
            <span class="tilt-value">${tilt}°</span>
            <button class="tbtn plus" @click=${() => this._tiltStep(m, 1)} aria-label="+">
              <ha-icon icon="mdi:plus"></ha-icon>
            </button>
          </div>
        </div>
      `;
    }
    return html`
      <div class="tilt-row">
        <span class="tilt-label">${this._t("cover_tilt")}</span>
        <div class="tilt-controls">
          <button class="tbtn" @click=${() => this._tiltDir(m, "close")} aria-label=${this._t("cover_close")}>
            <ha-icon icon="mdi:menu-down"></ha-icon>
          </button>
          <button class="tbtn" @click=${() => this._tiltDir(m, "open")} aria-label=${this._t("cover_open")}>
            <ha-icon icon="mdi:menu-up"></ha-icon>
          </button>
        </div>
      </div>
    `;
  }

  private _renderSingle(m: CoverModel): unknown {
    const posChip =
      m.position !== undefined
        ? html`<div class="pos-chip">${this._displayPosition(m)} %</div>`
        : undefined;
    return html`
      ${renderCardHeader({
        icon: m.icon,
        name: m.name,
        subtitle: this._statusText(m),
        onClick: () => this._moreInfo(m.entity),
        right: posChip,
      })}
      <div class="single-body ${m.available ? "" : "dimmed"}">
        ${this._renderPreview(m)}
        ${this._renderButtonRow(m, false)}
      </div>
      ${this._renderSlider(m)}
      ${this._renderTilt(m)}
    `;
  }

  // ---- render: group -------------------------------------------------------

  private _groupModels(): CoverModel[] {
    const list = this._config?.entities ?? [];
    return list
      .map((e) => (typeof e === "string" ? { entity: e } : e))
      .map((e) => this._model(e))
      .filter((m): m is CoverModel => !!m);
  }

  private _callAll(dir: CoverDir): void {
    const hass = this.hass;
    if (!hass) return;
    const models = this._groupModels();
    // Batch real covers into one service call; switch_pairs act per row on
    // their own relays.
    const coverIds = models.filter((m) => !m.isSwitchPair).map((m) => m.entity);
    if (coverIds.length) {
      const service = dir === "up" ? "open_cover" : dir === "down" ? "close_cover" : "stop_cover";
      hass.callService("cover", service, { entity_id: coverIds }).catch(() => undefined);
    }
    for (const m of models) {
      if (m.isSwitchPair && (m.features & (dir === "up" ? COVER_FEATURE.OPEN : dir === "down" ? COVER_FEATURE.CLOSE : COVER_FEATURE.STOP)))
        this._callDir(m, dir);
    }
  }

  private _renderGroupRow(m: CoverModel): unknown {
    const tap = this._config?.row_tap_action ?? "more-info";
    const onName = () =>
      tap === "toggle"
        ? this.hass?.callService("cover", "toggle", { entity_id: m.entity }).catch(() => undefined)
        : this._moreInfo(m.entity);
    const barPct = m.position;
    return html`
      <div class="grp-row ${m.available ? "" : "dimmed"}" style=${`--cv-accent: ${this._accent()};`}>
        ${barPct !== undefined
          ? html`<div class="grp-bar" style=${`width: ${barPct}%;`}></div>`
          : nothing}
        <div class="grp-text" role="button" tabindex="0" @click=${onName}>
          <div class="grp-name">${m.name}</div>
          ${(() => {
            const s = this._statusText(m);
            return s ? html`<div class="grp-status">${s}</div>` : nothing;
          })()}
        </div>
        ${this._renderButtonRow(m, true)}
      </div>
    `;
  }

  private _renderGroup(): unknown {
    const models = this._groupModels();
    const openCount = models.filter((m) => (m.position !== undefined ? m.position > 0 : m.state === "open")).length;
    const name = this._config?.name || this._t("cover_group_default_name");
    const icon = this._config?.icon || COVER_DEVICE_ICONS[this._deviceClass()] || DEFAULT_COVER_ICON;
    const subtitle = this._t("cover_group_subtitle")
      .replace("{n}", String(models.length))
      .replace("{m}", String(openCount));
    return html`
      ${renderCardHeader({ icon, name, subtitle })}
      ${this._config?.show_master !== false
        ? html`
            <div class="master-row">
              <button class="mbtn" @click=${() => this._callAll("up")}>
                <ha-icon icon="mdi:chevron-up"></ha-icon><span>${this._t("cover_all")}</span>
              </button>
              <button class="mbtn stop" @click=${() => this._callAll("stop")}>
                <ha-icon icon="mdi:stop"></ha-icon>
              </button>
              <button class="mbtn" @click=${() => this._callAll("down")}>
                <span>${this._t("cover_all")}</span><ha-icon icon="mdi:chevron-down"></ha-icon>
              </button>
            </div>
          `
        : nothing}
      <div class="grp-list">${models.map((m) => this._renderGroupRow(m))}</div>
    `;
  }

  // ---- render --------------------------------------------------------------

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const group = this._config.mode === "group";

    if (!group && !this._isSwitchPair() && this._config.entity && !this.hass.states[this._config.entity]) {
      return renderMissingEntity(this._config.entity);
    }

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const accent = this._accent();
    // Resolved rather than a CSS mix, so the glyph on it can be measured.
    const iconWellCss = tintOn(this, accent, undefined, 20);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(accent, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
    });
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_COVER_RADIUS, this._config.corners);

    let body: unknown;
    if (group) {
      body = this._renderGroup();
    } else {
      const m = this._model({
        entity_type: this._config.entity_type,
        entity: this._config.entity,
        up_entity: this._config.up_entity,
        down_entity: this._config.down_entity,
        stop_entity: this._config.stop_entity,
      });
      body = m ? this._renderSingle(m) : html`<div class="empty">${this._t("cover_no_entity")}</div>`;
    }

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${shouldAnimate(this._config.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${body}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      /* No status text (e.g. a switch pair with no feedback) — hide the line
         entirely instead of leaving a gap. */
      .m3-subtitle:empty,
      .grp-status:empty {
        display: none;
      }

      .pos-chip {
        flex-shrink: 0;
        height: 30px;
        border-radius: 15px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        background: color-mix(in srgb, var(--m3p-icon-color) 20%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-icon-color-fg, var(--m3p-icon-color));
        font-size: 14px;
        font-weight: 700;
      }

      .single-body {
        display: flex;
        gap: 12px;
        align-items: stretch;
      }
      .single-body.dimmed {
        opacity: 0.4;
        pointer-events: none;
      }

      .preview {
        flex-shrink: 0;
        width: 96px;
        height: 96px;
        border-radius: 20px;
        border: 2px solid color-mix(in srgb, var(--cv-accent) 35%, var(--ha-card-background, var(--card-background-color)));
        overflow: hidden;
      }
      .preview-inner {
        position: relative;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          160deg,
          color-mix(in srgb, var(--cv-accent) 12%, transparent),
          color-mix(in srgb, var(--primary-text-color) 4%, transparent)
        );
      }
      .shutter {
        position: absolute;
        background: color-mix(in srgb, var(--primary-text-color) 30%, var(--ha-card-background, var(--card-background-color)));
        background-image: repeating-linear-gradient(
          to bottom,
          color-mix(in srgb, var(--primary-text-color) 34%, transparent) 0,
          color-mix(in srgb, var(--primary-text-color) 34%, transparent) 4px,
          color-mix(in srgb, var(--primary-text-color) 22%, var(--ha-card-background, var(--card-background-color))) 4px,
          color-mix(in srgb, var(--primary-text-color) 22%, var(--ha-card-background, var(--card-background-color))) 7px
        );
      }
      .shutter.curtain {
        background-image: repeating-linear-gradient(
          to right,
          color-mix(in srgb, var(--primary-text-color) 34%, transparent) 0,
          color-mix(in srgb, var(--primary-text-color) 34%, transparent) 4px,
          color-mix(in srgb, var(--primary-text-color) 22%, var(--ha-card-background, var(--card-background-color))) 4px,
          color-mix(in srgb, var(--primary-text-color) 22%, var(--ha-card-background, var(--card-background-color))) 7px
        );
      }
      .shutter.neutral {
        background: repeating-linear-gradient(
          45deg,
          color-mix(in srgb, var(--primary-text-color) 14%, transparent) 0,
          color-mix(in srgb, var(--primary-text-color) 14%, transparent) 6px,
          transparent 6px,
          transparent 12px
        );
      }

      .btn-row {
        flex: 1;
        display: flex;
        gap: 6px;
      }
      .btn-stacked {
        flex-direction: column;
      }
      .cbtn {
        flex: 1;
        border: none;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .btn-stacked .cbtn {
        min-height: 30px;
      }
      .btn-stacked .cbtn.open {
        border-radius: 18px 18px 9px 9px;
      }
      .btn-stacked .cbtn.stop {
        border-radius: 9px;
      }
      .btn-stacked .cbtn.close {
        border-radius: 9px 9px 18px 18px;
      }
      .cbtn.active {
        background: var(--cv-accent, var(--m3p-icon-color));
        color: #14201b;
      }
      .cbtn:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .cbtn ha-icon {
        --mdc-icon-size: 22px;
      }

      .slider {
        position: relative;
        height: 46px;
        cursor: pointer;
        touch-action: none;
        color: var(--cv-accent);
      }
      .slider-track {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        left: 0;
        right: 0;
        height: 12px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--primary-text-color) 12%, var(--ha-card-background, var(--card-background-color)));
      }
      .slider-fill {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        left: 0;
        height: 12px;
        border-radius: 6px;
        background: var(--cv-accent);
        overflow: hidden;
      }
      .slider-wave {
        width: 100%;
        height: 12px;
        opacity: 0.5;
      }
      .slider-handle {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 5px;
        height: 28px;
        border-radius: 2.5px;
        background: var(--primary-text-color);
      }

      .tilt-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .tilt-label {
        font-size: 13px;
        color: var(--m3p-secondary-text);
        opacity: 0.8;
      }
      .tilt-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .tbtn {
        width: 44px;
        height: 40px;
        border: none;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
      }
      .tbtn.minus {
        border-radius: 20px 8px 8px 20px;
      }
      .tbtn.plus {
        border-radius: 8px 20px 20px 8px;
      }
      .tilt-value {
        min-width: 46px;
        text-align: center;
        font-size: 14px;
        font-weight: 700;
        color: var(--cv-accent, var(--m3p-icon-color));
      }

      .master-row {
        display: flex;
        gap: 6px;
      }
      .mbtn {
        height: 54px;
        border: none;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 14px;
        font-weight: 600;
        flex: 1;
        border-radius: 12px;
      }
      .mbtn:first-child {
        border-radius: 27px 12px 12px 27px;
      }
      .mbtn:last-child {
        border-radius: 12px 27px 27px 12px;
      }
      .mbtn.stop {
        flex: 0 0 62px;
      }
      .mbtn ha-icon {
        --mdc-icon-size: 20px;
      }

      .grp-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .grp-row {
        position: relative;
        min-height: 54px;
        border-radius: 18px;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        overflow: hidden;
      }
      .grp-row.dimmed {
        opacity: 0.4;
      }
      .grp-bar {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        background: color-mix(in srgb, var(--cv-accent) 14%, var(--ha-card-background, var(--card-background-color)));
      }
      .grp-text {
        position: relative;
        flex: 1;
        min-width: 0;
        cursor: pointer;
      }
      .grp-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .grp-status {
        font-size: 10px;
        opacity: 0.5;
        color: var(--m3p-secondary-text);
      }
      .grp-row .btn-row {
        position: relative;
        flex: 0 0 auto;
        width: 138px;
      }
      .btn-compact .cbtn {
        width: 40px;
        height: 42px;
        border-radius: 7px;
      }
      .btn-compact .cbtn.open {
        border-radius: 20px 7px 7px 20px;
      }
      .btn-compact .cbtn.close {
        border-radius: 7px 20px 20px 7px;
      }

      .empty {
        padding: 16px;
        font-size: 14px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }

      @media (max-width: 300px) {
        .grp-row {
          flex-wrap: wrap;
        }
        .grp-row .btn-row {
          width: 100%;
        }
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .pos-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .shutter {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .cbtn {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .slider-track {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .tbtn {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .mbtn {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .grp-row {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .grp-bar {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-cover-card": M3CoverCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-cover-card",
  name: "M3 Cover Card",
  description:
    "Eine Material-3-Steuerkarte für Rollläden/Jalousien, die sich an die Fähigkeiten der Entität anpasst — Auf/Zu, Position, Lamellen, Gruppen.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
