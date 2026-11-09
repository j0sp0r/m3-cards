import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3AlarmCardConfig,
} from "./types";
import {
  ALARM_ERROR_COLOR,
  ALARM_FOLD_MS,
  ALARM_HEADER_ICON,
  ALARM_HEADER_ICON_RADIUS,
  ALARM_ICON_TINT,
  ALARM_MODE_GAP,
  ALARM_MODE_HEIGHT,
  ALARM_MODE_ICONS,
  ALARM_MODE_RADIUS_INNER,
  ALARM_MODE_RADIUS_OUTER,
  ALARM_NEUTRAL_COLOR,
  ALARM_PULSE_MS,
  ALARM_TRIGGERED_TINT,
  ALARM_WARNING_COLOR,
  CARD_VERSION,
  DEFAULT_ALARM_RADIUS,
  INDETERMINATE_CYCLE_MS,
  STATUS_PILL_TINT,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import {
  buildCssVars,
  fillColor,
  foregroundOn,
  inkOn,
  resolveCommonColors,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { glassCardClass, glassCardStyles, renderMissingEntity } from "./shared/glass-card";
import { hassChangeMatters } from "./shared/should-update";
import { activateOnKey } from "./shared/a11y";
import { openEntityDetail } from "./shared/entity-detail";
import { TemplatedCard } from "./shared/templated-card";
import { VisibleTicker } from "./shared/visible-ticker";
import {
  alarmChangedBy,
  alarmCountdown,
  alarmMode,
  alarmPhase,
  alarmSensors,
  alarmService,
  codeFormat,
  codeNeeded,
  resolveModes,
  secondsLeft,
  type AlarmMode,
  type AlarmModeConfig,
  type AlarmPhase,
} from "./shared/alarm";
import { keypadStyles, renderKeypad } from "./shared/alarm-keypad";

const EASING = unsafeCSS(STANDARD_EASING);

console.info(
  `%c M3-ALARM-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #ffa600; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #ffa600; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/** A code being typed: what it is for, and the digits so far. Never stored beyond this. */
interface CodeEntry {
  target: AlarmMode;
  code: string;
  error?: string;
  shake: number;
}

/**
 * An alarm panel (#47) in the suite's frame. The header says the state in the
 * theme's own colours — neutral disarmed, the accent armed, the warning colour
 * while arming or counting down an entry delay, the whole card in the error
 * colour once triggered — and the mode buttons switch it, asking for a code
 * only when the panel wants one. Every colour comes from the theme or a
 * configured accent through the suite's colour helpers, so light and dark
 * both come out right without UIX or card-mod, which is what the issue asked.
 */
@customElement("m3-alarm-card")
export class M3AlarmCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: M3AlarmCardConfig;
  @state() private _entry?: CodeEntry;
  @state() private _busy = false;
  @state() private _expanded = false;
  @state() private _now = Date.now();
  private readonly _ticker = new VisibleTicker(this, (now) => {
    this._now = now;
  });

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-alarm-card-editor");
    return document.createElement("m3-alarm-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3AlarmCardConfig {
    const entity = Object.keys(hass?.states ?? {}).find((e) => e.startsWith("alarm_control_panel.")) ?? "";
    return { type: "custom:m3-alarm-card", entity };
  }

  public setConfig(config: M3AlarmCardConfig): void {
    if (!config?.entity) throw new Error("m3-alarm-card: 'entity' is required");
    this._config = { glass_background: true, animation: "auto", ...config };
  }

  public getCardSize(): number {
    return this._config?.compact ? 1 : 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._ticker.connect();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ticker.disconnect();
    // A half-typed code does not outlive the card.
    this._entry = undefined;
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size > 1 || !changed.has("hass")) return true;
    const cfg = this._config;
    const open = alarmSensors(this._entity, undefined, undefined).open;
    return hassChangeMatters(changed, this.hass, [cfg?.entity, ...(cfg?.sensors ?? []), ...open]);
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate?.(changed);
    const phase = this._phase;
    // A second tick only while something counts down; the minute otherwise.
    this._ticker.setCadence(phase === "arming" || phase === "pending" ? "second" : "minute");
    if (changed.has("hass")) {
      const before = (changed.get("hass") as HomeAssistant | undefined)?.states[this._config?.entity ?? ""]?.state;
      const now = this._entity?.state;
      if (before !== now) this._onStateChange(alarmPhase(before), phase);
    }
  }

  /**
   * An entry delay or a triggered alarm opens the code entry by itself (it is
   * what the next tap would be for anyway). A state reached from elsewhere —
   * an automation, the panel by the door — closes a code entry that no longer
   * fits: a disarm code is pointless once the panel is disarmed.
   */
  private _onStateChange(before: AlarmPhase, after: AlarmPhase): void {
    if (after === "pending" && codeNeeded(this._entity, "disarm")) {
      this._entry = { target: "disarmed", code: "", shake: 0 };
    }
    if (after === "pending" || after === "triggered") this._expanded = true;
    if (this._entry?.target === "disarmed" && (after === "disarmed" || after === "disarming")) this._entry = undefined;
    if (before !== after && after === "unavailable") this._entry = undefined;
  }

  private get _entity() {
    return this._config ? this.hass?.states[this._config.entity] : undefined;
  }

  private get _phase(): AlarmPhase {
    return alarmPhase(this._entity?.state);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _modeName(m: AlarmModeConfig | AlarmMode): string {
    const cfg = typeof m === "string" ? this._modes.find((x) => x.mode === m) ?? { mode: m } : m;
    return cfg.name ?? this._t(`alarm_mode_${cfg.mode}` as TranslationKey);
  }

  private get _modes(): AlarmModeConfig[] {
    return resolveModes(this._config?.modes, this._entity);
  }

  private _time(ms: number): string {
    const hour12 =
      this.hass?.locale?.time_format === "12" ? true : this.hass?.locale?.time_format === "24" ? false : undefined;
    return new Intl.DateTimeFormat(this._language, { hour: "2-digit", minute: "2-digit", hour12 }).format(ms);
  }

  // ---- actions ----------------------------------------------------------------

  /** A mode button: switch, or ask for the code first when the panel wants one. */
  private _press(mode: AlarmMode): void {
    const entity = this._entity;
    const phase = this._phase;
    if (!entity || phase === "unavailable" || this._busy) return;
    const current = alarmMode(entity);
    if (phase === "armed" && current === mode) return;
    if (phase === "disarmed" && mode === "disarmed") return;
    const action = mode === "disarmed" ? "disarm" : "arm";
    if (codeNeeded(entity, action)) {
      this._entry = { target: mode, code: "", shake: 0 };
      this._expanded = true;
      return;
    }
    void this._call(mode, undefined);
  }

  private async _call(mode: AlarmMode, code: string | undefined): Promise<void> {
    if (!this.hass || !this._config) return;
    this._busy = true;
    try {
      await this.hass.callService("alarm_control_panel", alarmService(mode), {
        entity_id: this._config.entity,
        ...(code ? { code } : {}),
      });
      this._entry = undefined;
    } catch {
      // The panel said no — almost always the code. The message stays
      // generic: the error text from an integration is not for the screen.
      if (this._entry) {
        this._entry = {
          ...this._entry,
          code: "",
          error: this._t("alarm_code_rejected"),
          shake: this._entry.shake + 1,
        };
      }
    } finally {
      this._busy = false;
    }
  }

  private _submit = (): void => {
    const entry = this._entry;
    if (!entry || this._busy) return;
    const code = entry.code;
    // Cleared before the call, so nothing of it lingers whatever comes back.
    this._entry = { ...entry, code: "" };
    void this._call(entry.target, code || undefined);
  };

  private _cancel = (): void => {
    this._entry = undefined;
  };

  private _digit = (d: string): void => {
    if (!this._entry || this._busy) return;
    this._entry = { ...this._entry, code: this._entry.code + d, error: undefined };
  };

  private _delete = (): void => {
    if (!this._entry) return;
    this._entry = { ...this._entry, code: this._entry.code.slice(0, -1), error: undefined };
  };

  private _input = (value: string): void => {
    if (!this._entry) return;
    this._entry = { ...this._entry, code: value, error: undefined };
  };

  private _onHeader = (): void => {
    if (this._config?.compact) {
      this._expanded = !this._expanded;
      return;
    }
    openEntityDetail(this, this._config?.entity);
  };

  private _disarmFromTriggered = (): void => {
    this._press("disarmed");
  };

  // ---- render -----------------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;
    const entity = this._entity;
    if (!entity) return renderMissingEntity(cfg.entity);

    const phase = this._phase;
    const mode = alarmMode(entity);
    const countdown = alarmCountdown(entity);
    const left = countdown ? secondsLeft(countdown, this._now) : undefined;
    const since = Date.parse(entity.last_changed);

    const accent = resolveThemeColor(cfg.accent_color ?? "primary");
    const color =
      phase === "armed"
        ? accent
        : phase === "arming" || phase === "pending"
          ? ALARM_WARNING_COLOR
          : phase === "triggered"
            ? ALARM_ERROR_COLOR
            : ALARM_NEUTRAL_COLOR;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_ALARM_RADIUS, cfg.corners);
    const iconBg = tintOn(this, color, undefined, ALARM_ICON_TINT);
    const pillBg = tintOn(this, color, undefined, STATUS_PILL_TINT);
    const accentFill = fillColor(this, accent);
    const warnFill = fillColor(this, ALARM_WARNING_COLOR);
    const errorFill = fillColor(this, ALARM_ERROR_COLOR);
    const triggeredBg = tintOn(this, ALARM_ERROR_COLOR, undefined, ALARM_TRIGGERED_TINT);
    const surface = phase === "triggered" ? triggeredBg : undefined;
    const keyBg = tintOn(this, "var(--primary-text-color)", undefined, 8);
    const confirmFill = phase === "triggered" || phase === "pending" ? errorFill : accentFill;

    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "alarm-icon-bg": iconBg,
      "alarm-icon-ink": foregroundOn(color, iconBg, 3, this),
      "alarm-pill-bg": pillBg,
      "alarm-pill-ink": foregroundOn(color, pillBg, 4.5, this),
      "alarm-bar": fillColor(this, color),
      "alarm-accent-fill": accentFill,
      "alarm-accent-ink": inkOn(accentFill, this),
      "alarm-accent-fg": foregroundOn(accent, surface ?? "var(--card-background-color)", 3, this),
      "alarm-warn-fill": warnFill,
      "alarm-warn-ink": inkOn(warnFill, this),
      "alarm-error-fill": errorFill,
      "alarm-error-ink": inkOn(errorFill, this),
      "alarm-error-fg": foregroundOn(ALARM_ERROR_COLOR, surface ?? "var(--card-background-color)", 4.5, this),
      "alarm-mode-bg": tintOn(this, "var(--primary-text-color)", undefined, 6),
      "alarm-key-bg": keyBg,
      "alarm-confirm-bg": confirmFill,
      "alarm-confirm-ink": inkOn(confirmFill, this),
      "alarm-sensor-warn-bg": tintOn(this, ALARM_WARNING_COLOR, undefined, 18),
      "alarm-sensor-warn-ink": foregroundOn(ALARM_WARNING_COLOR, tintOn(this, ALARM_WARNING_COLOR, undefined, 18), 4.5, this),
    });

    const name = cfg.name ?? (entity.attributes.friendly_name as string | undefined) ?? this._t("alarm_default_name");
    const { title, subtitle, icon } = this._headline(phase, mode, since, name, entity);
    const unavailable = phase === "unavailable";
    const compact = !!cfg.compact;
    const open = !compact || this._expanded || phase === "pending" || phase === "triggered" || !!this._entry;
    const animate = shouldAnimate(cfg.animation);

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} phase-${phase} ${animate ? "" : "no-animations"} ${unavailable ? "unavailable" : ""}"
          style=${`border-radius: ${radius};${surface ? ` background: ${surface}; border-color: ${tintOn(this, ALARM_ERROR_COLOR, undefined, 45)};` : cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <span class="sr-only" aria-live=${phase === "triggered" || phase === "pending" ? "assertive" : "polite"}>${title}</span>
          <div
            class="header"
            role="button"
            tabindex="0"
            aria-label=${name}
            aria-expanded=${compact ? String(open) : nothing}
            @click=${this._onHeader}
            @keydown=${activateOnKey(this._onHeader)}
          >
            <div class="squircle ${phase === "arming" || phase === "pending" || phase === "triggered" ? "pulse" : ""}">
              <ha-icon icon=${icon}></ha-icon>
            </div>
            <div class="text">
              <div class="title">${title}</div>
              ${subtitle ? html`<div class="subtitle">${subtitle}</div>` : nothing}
            </div>
            ${this._renderPill(phase, left)}
          </div>
          ${phase === "arming" || phase === "pending"
            ? html`<div class="bar" role="progressbar" aria-label=${title}>
                ${countdown && left !== undefined
                  ? html`<div class="bar-fill" style=${`width: ${Math.min(100, Math.max(0, ((countdown.endsAt - this._now) / countdown.total) * 100))}%;`}></div>`
                  : html`<div class="bar-fill indeterminate"></div>`}
              </div>`
            : nothing}
          <div class="fold ${open ? "open" : ""}" aria-hidden=${open ? "false" : "true"}>
            <div class="fold-inner">${open ? this._renderBody(phase, mode, unavailable) : nothing}</div>
          </div>
        </div>
      </ha-card>
    `;
  }

  private _headline(
    phase: AlarmPhase,
    mode: AlarmMode | undefined,
    since: number,
    name: string,
    entity: { attributes: Record<string, unknown> },
  ): { title: string; subtitle?: string; icon: string } {
    const sinceText = Number.isFinite(since) ? this._t("alarm_since").replace("{time}", this._time(since)) : undefined;
    switch (phase) {
      case "disarmed":
        return { title: this._t("alarm_disarmed"), subtitle: sinceText ?? name, icon: "mdi:shield-off-outline" };
      case "armed":
        return {
          title: this._t("alarm_armed").replace("{mode}", mode ? this._modeName(mode) : ""),
          subtitle: sinceText,
          icon: (mode && (this._modes.find((m) => m.mode === mode)?.icon ?? ALARM_MODE_ICONS[mode])) || "mdi:shield-check",
        };
      case "arming":
        return {
          title: this._t("alarm_arming"),
          subtitle: mode ? this._t("alarm_to").replace("{mode}", this._modeName(mode)) : name,
          icon: "mdi:shield-sync-outline",
        };
      case "pending":
        return { title: this._t("alarm_pending"), subtitle: name, icon: "mdi:shield-alert-outline" };
      case "triggered": {
        const by = alarmChangedBy(entity as never);
        const at = Number.isFinite(since) ? this._t("alarm_at").replace("{time}", this._time(since)) : "";
        return { title: this._t("alarm_triggered"), subtitle: [by, at].filter(Boolean).join(" · ") || name, icon: "mdi:bell-ring" };
      }
      case "disarming":
        return { title: this._t("alarm_disarming"), subtitle: name, icon: "mdi:shield-sync-outline" };
      default:
        return { title: this._t("alarm_unavailable"), subtitle: name, icon: "mdi:shield-off" };
    }
  }

  private _renderPill(phase: AlarmPhase, left: number | undefined) {
    if (phase === "armed") {
      return html`<span class="pill"><ha-icon icon="mdi:lock"></ha-icon>${this._t("alarm_secured")}</span>`;
    }
    if ((phase === "arming" || phase === "pending") && left !== undefined) {
      return html`<span class="pill countdown" aria-live="off">${this._t("alarm_seconds").replace("{n}", String(left))}</span>`;
    }
    return nothing;
  }

  private _renderBody(phase: AlarmPhase, mode: AlarmMode | undefined, unavailable: boolean) {
    const entry = this._entry;
    const cfg = this._config!;
    const showSensors = cfg.show_sensors !== false && (phase === "disarmed" || phase === "arming");
    return html`
      ${phase === "triggered" && !entry
        ? html`<button class="disarm-now" ?disabled=${this._busy} @click=${this._disarmFromTriggered}>
            <ha-icon icon="mdi:shield-off-outline"></ha-icon>${this._t("alarm_disarm_now")}
          </button>`
        : nothing}
      ${phase !== "triggered" && phase !== "pending" ? this._renderModes(phase, mode, unavailable) : nothing}
      ${entry ? this._renderEntry(entry) : nothing}
      ${showSensors ? this._renderSensors() : nothing}
    `;
  }

  private _renderModes(phase: AlarmPhase, mode: AlarmMode | undefined, unavailable: boolean) {
    const modes = this._modes;
    if (!modes.length) return nothing;
    return html`<div class="modes" role="group" aria-label=${this._config?.name ?? this._t("alarm_default_name")}>
      ${modes.map((m) => {
        const active =
          (phase === "armed" && mode === m.mode) || (phase === "disarmed" && m.mode === "disarmed");
        const target = phase === "arming" && mode === m.mode;
        const icon = m.icon ?? ALARM_MODE_ICONS[m.mode];
        return html`<button
          class="mode ${active ? "active" : ""} ${target ? "target" : ""}"
          aria-pressed=${String(active)}
          ?disabled=${unavailable || this._busy || phase === "disarming"}
          @click=${() => this._press(m.mode)}
        >
          <ha-icon icon=${icon}></ha-icon>
          <span class="mode-label">${this._modeName(m)}</span>
        </button>`;
      })}
    </div>`;
  }

  private _renderEntry(entry: CodeEntry) {
    const format = codeFormat(this._entity) ?? "number";
    const title =
      entry.target === "disarmed"
        ? this._t("alarm_code_disarm")
        : this._t("alarm_code_arm").replace("{mode}", this._modeName(entry.target));
    return renderKeypad({
      format,
      title,
      code: entry.code,
      error: entry.error,
      shake: entry.shake,
      busy: this._busy,
      labels: {
        confirm: this._t("alarm_confirm"),
        cancel: this._t("alarm_cancel"),
        delete: this._t("alarm_delete"),
        code: this._t("alarm_code_label"),
      },
      onDigit: this._digit,
      onDelete: this._delete,
      onInput: this._input,
      onSubmit: this._submit,
      onCancel: this._cancel,
    });
  }

  private _renderSensors() {
    const { open, ok } = alarmSensors(this._entity, this._config?.sensors, this.hass?.states);
    if (!open.length && !ok) return nothing;
    const name = (id: string) => (this.hass?.states[id]?.attributes.friendly_name as string | undefined) ?? id;
    return html`<div class="sensors">
      ${open.map(
        (id) => html`<button class="sensor open" @click=${() => openEntityDetail(this, id)}>
          <ha-icon icon="mdi:alert-circle-outline"></ha-icon>${name(id)}
        </button>`,
      )}
      ${ok
        ? html`<span class="sensor ok"
            ><ha-icon icon="mdi:check-circle-outline"></ha-icon>${ok === 1
              ? this._t("alarm_sensors_ok_one")
              : this._t("alarm_sensors_ok").replace("{n}", String(ok))}</span
          >`
        : nothing}
    </div>`;
  }

  static styles = [
    glassCardStyles,
    keypadStyles,
    css`
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      .card-inner {
        transition: background-color 300ms ${EASING}, border-color 300ms ${EASING};
      }

      .card-inner.unavailable .modes,
      .card-inner.unavailable .squircle {
        opacity: 0.5;
      }

      /* ---- header ---- */
      .header {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
        cursor: pointer;
        border-radius: 16px;
      }

      .header:focus-visible {
        outline: 2px solid var(--alarm-accent-fg);
        outline-offset: 2px;
      }

      .squircle {
        flex-shrink: 0;
        width: ${unsafeCSS(ALARM_HEADER_ICON)}px;
        height: ${unsafeCSS(ALARM_HEADER_ICON)}px;
        border-radius: ${unsafeCSS(ALARM_HEADER_ICON_RADIUS)}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--alarm-icon-bg);
        color: var(--alarm-icon-ink);
        --mdc-icon-size: 28px;
        transition: background-color 300ms ${EASING}, color 300ms ${EASING};
      }

      .squircle.pulse {
        animation: alarm-pulse ${unsafeCSS(ALARM_PULSE_MS)}ms ${EASING} infinite;
      }

      @keyframes alarm-pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(0.92);
        }
      }

      .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .title {
        font-size: 18px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .phase-triggered .title {
        color: var(--alarm-error-fg);
      }

      .subtitle {
        font-size: 13px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pill {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 14px;
        border-radius: 16px;
        background: var(--alarm-pill-bg);
        color: var(--alarm-pill-ink);
        font-size: 13px;
        font-weight: 700;
        --mdc-icon-size: 16px;
      }

      .pill.countdown {
        font-variant-numeric: tabular-nums;
        min-width: 52px;
        justify-content: center;
      }

      /* ---- countdown bar ---- */
      .bar {
        position: relative;
        height: 4px;
        border-radius: 2px;
        overflow: hidden;
        background: var(--alarm-pill-bg);
      }

      .bar-fill {
        height: 100%;
        border-radius: 2px;
        background: var(--alarm-bar);
        transition: width 1s linear;
      }

      .bar-fill.indeterminate {
        position: absolute;
        width: 30%;
        animation: alarm-indeterminate ${unsafeCSS(INDETERMINATE_CYCLE_MS)}ms ${EASING} infinite;
      }

      @keyframes alarm-indeterminate {
        0% {
          left: -30%;
        }
        100% {
          left: 100%;
        }
      }

      /* ---- fold (compact) ---- */
      .fold {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows ${unsafeCSS(ALARM_FOLD_MS)}ms ${EASING};
      }

      .fold.open {
        grid-template-rows: 1fr;
      }

      .fold-inner {
        min-height: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: var(--m3-card-gap, 12px);
      }

      /* The card's own gap would sit under a closed fold. */
      .fold:not(.open) {
        margin-top: calc(-1 * var(--m3-card-gap, 12px));
      }

      /* ---- modes: a connected button group ---- */
      .modes {
        display: flex;
        flex-wrap: wrap;
        gap: ${unsafeCSS(ALARM_MODE_GAP)}px;
      }

      .mode {
        flex: 1 1 0;
        min-width: 64px;
        height: ${unsafeCSS(ALARM_MODE_HEIGHT)}px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 0 6px;
        border: none;
        border-radius: ${unsafeCSS(ALARM_MODE_RADIUS_INNER)}px;
        background: var(--alarm-mode-bg);
        color: var(--m3p-text, var(--primary-text-color));
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        --mdc-icon-size: 22px;
        transition:
          border-radius 300ms ${EASING},
          background-color 300ms ${EASING},
          color 300ms ${EASING};
        -webkit-tap-highlight-color: transparent;
      }

      .mode:first-child {
        border-top-left-radius: ${unsafeCSS(ALARM_MODE_RADIUS_OUTER)}px;
        border-bottom-left-radius: ${unsafeCSS(ALARM_MODE_RADIUS_OUTER)}px;
      }

      .mode:last-child {
        border-top-right-radius: ${unsafeCSS(ALARM_MODE_RADIUS_OUTER)}px;
        border-bottom-right-radius: ${unsafeCSS(ALARM_MODE_RADIUS_OUTER)}px;
      }

      /* The active mode morphs into a full pill. */
      .mode.active {
        border-radius: ${unsafeCSS(ALARM_MODE_HEIGHT / 2)}px;
        background: var(--alarm-accent-fill);
        color: var(--alarm-accent-ink);
      }

      .phase-disarmed .mode.active {
        background: var(--alarm-icon-bg);
        color: var(--m3p-text, var(--primary-text-color));
      }

      .mode.target {
        border-radius: ${unsafeCSS(ALARM_MODE_HEIGHT / 2)}px;
        background: var(--alarm-warn-fill);
        color: var(--alarm-warn-ink);
      }

      .mode:active:not(:disabled) {
        border-radius: ${unsafeCSS(ALARM_MODE_RADIUS_OUTER)}px;
      }

      .mode:disabled {
        cursor: default;
        opacity: 0.55;
      }

      .mode.active:disabled,
      .mode.target:disabled {
        opacity: 1;
      }

      .mode:focus-visible,
      .disarm-now:focus-visible,
      .sensor:focus-visible {
        outline: 2px solid var(--alarm-accent-fg);
        outline-offset: 2px;
      }

      .mode-label {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---- triggered ---- */
      .disarm-now {
        height: 52px;
        border: none;
        border-radius: 26px;
        background: var(--alarm-error-fill);
        color: var(--alarm-error-ink);
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        --mdc-icon-size: 20px;
      }

      /* ---- sensors ---- */
      .sensors {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .sensor {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border-radius: 16px;
        border: none;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        --mdc-icon-size: 16px;
      }

      .sensor.open {
        background: var(--alarm-sensor-warn-bg);
        color: var(--alarm-sensor-warn-ink);
        cursor: pointer;
      }

      .sensor.ok {
        background: var(--alarm-mode-bg);
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .no-animations *,
      .no-animations {
        animation: none !important;
        transition: none !important;
      }

      @media (prefers-reduced-motion: reduce) {
        .squircle.pulse,
        .bar-fill.indeterminate {
          animation: none;
        }

        .bar-fill.indeterminate {
          width: 100%;
          left: 0;
          opacity: 0.6;
        }

        .fold,
        .mode,
        .card-inner {
          transition: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-alarm-card": M3AlarmCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-alarm-card",
  name: "M3 Alarm Card",
  description: "An alarm panel — Alarmo or any integration — with mode buttons, a keypad and entry-delay countdown, in the theme's own colours.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
