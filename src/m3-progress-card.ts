import { LitElement, html, css, nothing, svg, type SVGTemplateResult, type PropertyValues } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3ProgressCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_PROGRESS_RADIUS,
  DEFAULT_PROGRESS_ACCENT,
  DEFAULT_RUNNING_STATES,
  DEFAULT_PREPARING_STATES,
  DEFAULT_DONE_STATES,
  WAVE_AMPLITUDE,
  WAVE_WAVELENGTH,
  WAVE_PHASE_SPEED,
  WAVE_GAP,
  WAVE_DOT_RADIUS,
  INDETERMINATE_SEGMENT_FRACTION,
  INDETERMINATE_CYCLE_MS,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { buildWavePath } from "./shared/wave";
import { resolveCommonColors, tintOn, foregroundOn , tintBackground , resolveThemeColor } from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-PROGRESS-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #5dcaa5; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #5dcaa5; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

type StatusCategory = "running" | "preparing" | "done" | "ready";

const BAR_SVG_HEIGHT = 24;
const AMPLITUDE_LERP = 0.12;
const DEFAULT_BAR_WIDTH = 220;

@customElement("m3-progress-card")
export class M3ProgressCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ProgressCardConfig;

  @state() private _phase = 0;
  @state() private _displayAmplitude = WAVE_AMPLITUDE;
  @state() private _measuredWidth = DEFAULT_BAR_WIDTH;

  @query(".bar-track") private _trackEl?: HTMLDivElement;

  private _rafId?: number;
  private _resizeObserver?: ResizeObserver;
  private _intersectionObserver?: IntersectionObserver;
  private _isIntersecting = true;
  private _targetAmplitude = WAVE_AMPLITUDE;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-progress-card-editor");
    return document.createElement(
      "m3-progress-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3ProgressCardConfig {
    const entities = Object.keys(hass?.states ?? {}).filter((eid) =>
      eid.startsWith("sensor."),
    );
    const statusEntity =
      entities.find((eid) => /status|vorgang/.test(eid)) ?? entities[0] ?? "";
    return {
      type: "custom:m3-progress-card",
      entity: statusEntity,
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.entity,
      this._config?.percentage_entity,
      this._config?.remaining_entity,
    ]);
  }

  public setConfig(config: M3ProgressCardConfig): void {
    if (!config.entity) {
      throw new Error(
        "Bitte eine Status-Entität auswählen / Please select a status entity",
      );
    }
    this._config = {
      glass_background: true,
      animation: "auto",
      wave_style: "wavy",
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
  }

  protected firstUpdated(): void {
    if (this._trackEl) {
      this._resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width && Math.abs(width - this._measuredWidth) > 0.5) {
          this._measuredWidth = width;
        }
      });
      this._resizeObserver.observe(this._trackEl);
      this._measuredWidth = this._trackEl.getBoundingClientRect().width || DEFAULT_BAR_WIDTH;
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

  private _resolveColor(value: string): string {
    return resolveThemeColor(value);
  }

  private get _reducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    );
  }

  private _classifyStatus(rawState: string): StatusCategory {
    const s = rawState.toLowerCase();
    const running = this._config?.running_states ?? DEFAULT_RUNNING_STATES;
    const preparing =
      this._config?.preparing_states ?? DEFAULT_PREPARING_STATES;
    const done = this._config?.done_states ?? DEFAULT_DONE_STATES;
    if (running.some((x) => x.toLowerCase() === s)) return "running";
    if (preparing.some((x) => x.toLowerCase() === s)) return "preparing";
    if (done.some((x) => x.toLowerCase() === s)) return "done";
    return "ready";
  }

  private _statusText(
    category: StatusCategory,
    remainingRaw: string | undefined,
  ): string {
    if (category === "running") {
      if (remainingRaw !== undefined) {
        const template =
          this._config?.status_text_running ?? this._t("progress_status_running");
        return template.replace("{remaining}", remainingRaw);
      }
      return this._t("progress_status_running_no_remaining");
    }
    if (category === "preparing") {
      return (
        this._config?.status_text_preparing ??
        this._t("progress_status_preparing")
      );
    }
    if (category === "done") {
      return (
        this._config?.status_text_done ?? this._t("progress_status_done")
      );
    }
    return this._config?.status_text_ready ?? this._t("progress_status_ready");
  }

  private _resolveAccentForCategory(category: StatusCategory): string {
    const stateColors = this._config?.state_colors;
    const override =
      category === "running"
        ? stateColors?.running
        : category === "preparing"
          ? stateColors?.preparing
          : category === "done"
            ? stateColors?.done
            : undefined;
    if (override) return this._resolveColor(override);
    if (this._config?.accent_color)
      return this._resolveColor(this._config.accent_color);
    return DEFAULT_PROGRESS_ACCENT;
  }

  private _startAnimationLoop(): void {
    if (this._rafId !== undefined) return;
    const step = () => {
      this._rafId = requestAnimationFrame(step);
      this._tick();
    };
    this._rafId = requestAnimationFrame(step);
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
      this._displayAmplitude += ampDelta * AMPLITUDE_LERP;
      changed = true;
    } else if (this._displayAmplitude !== this._targetAmplitude) {
      this._displayAmplitude = this._targetAmplitude;
      changed = true;
    }

    if (this._phaseAnimating) {
      this._phase -= WAVE_PHASE_SPEED;
      changed = true;
    }

    if (this._indeterminateActive) {
      changed = true;
    }

    if (!changed) {
      this._stopAnimationLoop();
      return;
    }
    this.requestUpdate();
  }

  private _phaseAnimating = false;
  private _indeterminateActive = false;

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const entity = this.hass.states[this._config.entity];

    if (!entity) {
      return renderMissingEntity(this._config.entity);
    }

    const category = this._classifyStatus(entity.state ?? "");

    if (category === "ready" && this._config.hide_when_ready) {
      return nothing;
    }

    const percentEntity = this._config.percentage_entity
      ? this.hass.states[this._config.percentage_entity]
      : undefined;
    const rawPercent = percentEntity ? parseFloat(percentEntity.state) : NaN;
    const hasPercent =
      !!percentEntity &&
      percentEntity.state !== "unavailable" &&
      percentEntity.state !== "unknown" &&
      !isNaN(rawPercent);
    const percentage = hasPercent
      ? Math.min(100, Math.max(0, rawPercent))
      : undefined;

    const remainingEntity = this._config.remaining_entity
      ? this.hass.states[this._config.remaining_entity]
      : undefined;
    const remainingRaw = remainingEntity?.state;
    const hasRemaining =
      remainingRaw !== undefined &&
      remainingRaw !== "unavailable" &&
      remainingRaw !== "unknown" &&
      !isNaN(parseFloat(remainingRaw));

    const name =
      this._config.name || entity.attributes.friendly_name || this._config.entity;
    const icon = this._config.icon || "mdi:washing-machine";
    const statusText = this._statusText(
      category,
      hasRemaining ? remainingRaw : undefined,
    );

    const showBar = category !== "ready";
    const isIndeterminate =
      (category === "running" || category === "preparing") && !hasPercent;
    const displayPercent = category === "done" ? 100 : hasPercent ? percentage! : 0;

    const accentColor = this._resolveAccentForCategory(category);
    const trackColorCss = this._config.track_color
      ? this._resolveColor(this._config.track_color)
      : tintBackground("var(--primary-text-color)", undefined, 12);
    const dotColorCss = this._config.dot_color
      ? this._resolveColor(this._config.dot_color)
      : tintBackground("var(--primary-text-color)", undefined, 70);
    const iconColorCss = this._config.icon_color
      ? this._resolveColor(this._config.icon_color)
      : accentColor;
    const iconBackgroundCss = this._config.icon_background
      ? this._resolveColor(this._config.icon_background)
      : tintOn(this, iconColorCss, this._config.icon_background_opacity, 18);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_PROGRESS_RADIUS,
      this._config.corners,
    );

    // Decide animation behaviour for this render.
    const mode = this._config.animation ?? "auto";
    const wavyStatic = (this._config.wave_style ?? "wavy") === "wavy";
    const reducedMotion = this._reducedMotion;
    const forceFlat = reducedMotion || (mode === "off" && !wavyStatic);
    this._phaseAnimating =
      !forceFlat &&
      mode !== "off" &&
      (category === "running" || category === "preparing");
    this._indeterminateActive = this._phaseAnimating && isIndeterminate;
    this._targetAmplitude =
      forceFlat || category === "done" || category === "ready"
        ? 0
        : WAVE_AMPLITUDE;

    if (showBar && (this._phaseAnimating || this._targetAmplitude !== this._displayAmplitude)) {
      this._startAnimationLoop();
    } else if (!showBar) {
      this._stopAnimationLoop();
    }

    return html`
      <ha-card
        style=${`--m3p-accent: ${accentColor}; --m3p-track: ${trackColorCss}; --m3p-dot: ${dotColorCss}; --m3p-icon-color: ${foregroundOn(iconColorCss, iconBackgroundCss)}; --m3p-icon-bg: ${iconBackgroundCss}; --m3p-text: ${textColorCss}; --m3p-secondary-text: ${secondaryTextColorCss}; border-radius: ${radius};`}
      >
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="header">
            <div class="icon-swatch">
              <ha-icon icon=${icon}></ha-icon>
            </div>
            <div class="text-block">
              <div class="name">${name}</div>
              <div class="status">${statusText}</div>
            </div>
          </div>

          ${showBar
            ? html`
                <div class="bar-row">
                  <div class="bar-track">
                    ${this._renderBar(
                      this._measuredWidth,
                      displayPercent,
                      isIndeterminate,
                      forceFlat,
                    )}
                  </div>
                  ${isIndeterminate
                    ? nothing
                    : html`<span class="percentage">${Math.round(displayPercent)}%</span>`}
                </div>
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderBar(
    widthPx: number,
    percentage: number,
    isIndeterminate: boolean,
    forceFlat: boolean,
  ): SVGTemplateResult {
    const midY = BAR_SVG_HEIGHT / 2;
    const amplitude = forceFlat ? 0 : this._displayAmplitude;
    const dotSpace = WAVE_DOT_RADIUS * 2;
    const trackEndX = widthPx - WAVE_DOT_RADIUS;

    if (isIndeterminate) {
      const segWidth = widthPx * INDETERMINATE_SEGMENT_FRACTION;
      const travel = Math.max(0, widthPx - segWidth - dotSpace);
      const t = (performance.now() % INDETERMINATE_CYCLE_MS) / INDETERMINATE_CYCLE_MS;
      const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
      const segStartX = tri * travel;
      const segEndX = segStartX + segWidth;
      const wavePath = buildWavePath(
        segStartX,
        segWidth,
        amplitude,
        WAVE_WAVELENGTH,
        this._phase,
        midY,
      );
      return svg`<svg
        class="wave-svg"
        viewBox="0 0 ${widthPx} ${BAR_SVG_HEIGHT}"
        width="100%"
        height="${BAR_SVG_HEIGHT}"
        preserveAspectRatio="none"
      >
        ${segStartX > 0
          ? svg`<line class="wave-track" x1="0" y1=${midY} x2=${segStartX} y2=${midY}></line>`
          : nothing}
        ${wavePath
          ? svg`<path class="wave-active" d=${wavePath} fill="none"></path>`
          : nothing}
        ${segEndX < trackEndX
          ? svg`<line class="wave-track" x1=${segEndX} y1=${midY} x2=${trackEndX} y2=${midY}></line>`
          : nothing}
        <circle class="wave-dot" cx=${trackEndX} cy=${midY} r=${WAVE_DOT_RADIUS}></circle>
      </svg>`;
    }

    const available = Math.max(0, widthPx - WAVE_GAP - dotSpace);
    const activeWidth = available * (percentage / 100);
    const hasActive = activeWidth > 1;
    const trackStartX = hasActive ? activeWidth + WAVE_GAP : 0;
    const activePath = hasActive
      ? buildWavePath(0, activeWidth, amplitude, WAVE_WAVELENGTH, this._phase, midY)
      : "";

    return svg`<svg
      class="wave-svg"
      viewBox="0 0 ${widthPx} ${BAR_SVG_HEIGHT}"
      width="100%"
      height="${BAR_SVG_HEIGHT}"
      preserveAspectRatio="none"
    >
      ${activePath
        ? svg`<path class="wave-active" d=${activePath} fill="none"></path>`
        : nothing}
      ${trackEndX > trackStartX
        ? svg`<line class="wave-track" x1=${trackStartX} y1=${midY} x2=${trackEndX} y2=${midY}></line>`
        : nothing}
      <circle class="wave-dot" cx=${trackEndX} cy=${midY} r=${WAVE_DOT_RADIUS}></circle>
    </svg>`;
  }

  static styles = [
    glassCardStyles,
    css`
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
    }

    .icon-swatch {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--m3p-icon-bg);
      color: var(--m3p-icon-color);
    }

    .icon-swatch ha-icon {
      --mdc-icon-size: 22px;
    }

    .text-block {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .name {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--m3p-text);
    }

    .status {
      font-size: 13px;
      opacity: 0.65;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--m3p-secondary-text);
    }

    .bar-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .bar-track {
      flex: 1;
      min-width: 0;
      height: 24px;
    }

    .wave-svg {
      display: block;
      overflow: visible;
    }

    .wave-active {
      stroke: var(--m3p-accent);
      stroke-width: 6px;
      stroke-linecap: round;
    }

    .wave-track {
      stroke: var(--m3p-track);
      stroke-width: 6px;
      stroke-linecap: round;
    }

    .wave-dot {
      fill: var(--m3p-dot);
    }

    .percentage {
      flex-shrink: 0;
      font-size: 15px;
      font-weight: 700;
      color: var(--m3p-accent);
    }
  `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-progress-card": M3ProgressCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-progress-card",
  name: "M3 Progress Card",
  description:
    "Eine Material-3-Expressive-Fortschrittskarte für Haushaltsgeräte (Waschmaschine, Trockner, Spülmaschine) mit wellenförmigem Fortschrittsbalken.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
