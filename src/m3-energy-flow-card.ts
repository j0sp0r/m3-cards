import {
  LitElement,
  html,
  css,
  nothing,
  svg,
  type PropertyValues,
  type SVGTemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3EnergyFlowCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_FLOW_RADIUS,
  DEFAULT_FLOW_ICON,
  FLOW_NODE_PV_COLOR,
  FLOW_NODE_GRID_COLOR,
  FLOW_NODE_HOME_COLOR,
  FLOW_NODE_BATTERY_COLOR,
  FLOW_SELF_SUFFICIENCY_COLOR,
  FLOW_REFRESH_MS,
  FLOW_NODE_SIZE,
  FLOW_NODE_RX,
  FLOW_MIN_STROKE,
  FLOW_MAX_STROKE,
  FLOW_DOT_DURATION_MS,
  resolveCornerRadius,
} from "./const";
import {
  resolveThemeColor,
  buildCssVars,
  resolveCommonColors,
  tintOn, foregroundOn, fillColor, foregroundColor,
} from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate } from "./shared/animation";
import { getEnergyDashboardEntities, fetchTodayChangeSum } from "./shared/ha-energy";
import { localize, type TranslationKey } from "./localize";
import { formatNumber } from "./shared/formatting";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-ENERGY-FLOW-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #f0a24a; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #f0a24a; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const HALF = FLOW_NODE_SIZE / 2;
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 250;
const VIEW_HEIGHT_WITH_BATTERY = 310;
const PV_POS = { x: 160, y: 46 };
const GRID_POS = { x: 52, y: 160 };
const HOME_POS = { x: 268, y: 160 };
const BATTERY_POS = { x: HOME_POS.x, y: HOME_POS.y + 90 };
const SPLIT_BEND_Y = 145;
const CORNER_RADIUS = 20;

interface FlowNodeData {
  key: "pv" | "grid" | "home" | "battery";
  x: number;
  y: number;
  color: string;
  icon: string;
  value: number;
  label: string;
}

interface FlowLineData {
  key: string;
  path: string;
  color: string;
  value: number;
}

function elbowPath(x1: number, y1: number, bendY: number, x2: number): string {
  const vDir = bendY > y1 ? 1 : -1;
  const hDir = x2 > x1 ? 1 : -1;
  const cornerStartY = bendY - vDir * CORNER_RADIUS;
  const cornerEndX = x1 + hDir * CORNER_RADIUS;
  return `M ${x1} ${y1} L ${x1} ${cornerStartY} Q ${x1} ${bendY} ${cornerEndX} ${bendY} L ${x2} ${bendY}`;
}

function straightPath(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

@customElement("m3-energy-flow-card")
export class M3EnergyFlowCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3EnergyFlowCardConfig;
  @state() private _solarTotal = 0;
  @state() private _gridImport = 0;
  @state() private _gridExport = 0;
  @state() private _batteryCharge = 0;
  @state() private _batteryDischarge = 0;
  @state() private _hasSolar = false;
  @state() private _hasBattery = false;
  @state() private _noEnergyDashboard = false;
  @state() private _loading = true;

  private _refreshTimer?: number;
  private _lastFetchKey?: string;
  private _fetchInFlight = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-energy-flow-card-editor");
    return document.createElement(
      "m3-energy-flow-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3EnergyFlowCardConfig {
    return {
      type: "custom:m3-energy-flow-card",
      source: "energy",
      glass_background: true,
    };
  }

  public setConfig(config: M3EnergyFlowCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      source: "energy",
      show_self_sufficiency: true,
      show_battery: "auto",
      flow_speed: "normal",
      ...config,
    };
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: "full",
      rows: "auto",
      min_rows: 4,
    };
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._refreshTimer = window.setInterval(() => {
      this._lastFetchKey = undefined;
      this._maybeFetch();
    }, FLOW_REFRESH_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._refreshTimer !== undefined) {
      window.clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetch();
  }

  private _maybeFetch(): void {
    if (!this.hass || !this._config) return;
    const c = this._config;
    const key =
      c.source === "entities"
        ? `entities|${c.solar_entity}|${c.grid_import_entity}|${c.grid_export_entity}|${c.battery_entity}`
        : "energy";
    if (key === this._lastFetchKey) return;
    this._lastFetchKey = key;
    this._fetchData();
  }

  // Reads a live entity state as kWh, normalizing Wh/MWh-native sensors so
  // the `source: entities` fallback lines up with the kWh-normalized
  // statistics used by the `source: energy` path.
  private _liveValueInKwh(entityId?: string): number {
    if (!entityId || !this.hass) return 0;
    const st = this.hass.states[entityId];
    if (!st) return 0;
    const raw = parseFloat(st.state);
    if (st.state === "unavailable" || st.state === "unknown" || isNaN(raw)) return 0;
    const unit = String(st.attributes.unit_of_measurement ?? "").toLowerCase();
    if (unit === "wh") return raw / 1000;
    if (unit === "mwh") return raw * 1000;
    return raw;
  }

  private async _fetchData(): Promise<void> {
    if (!this.hass || !this._config || this._fetchInFlight) return;
    this._fetchInFlight = true;
    const config = this._config;
    try {
      if (config.source === "entities") {
        this._noEnergyDashboard = false;
        this._hasSolar = !!config.solar_entity;
        this._hasBattery = !!config.battery_entity;
        this._solarTotal = this._liveValueInKwh(config.solar_entity);
        this._gridImport = this._liveValueInKwh(config.grid_import_entity);
        this._gridExport = this._liveValueInKwh(config.grid_export_entity);
        this._batteryDischarge = this._liveValueInKwh(config.battery_entity);
        this._batteryCharge = 0;
      } else {
        const dash = await getEnergyDashboardEntities(this.hass);
        if (!dash) {
          this._noEnergyDashboard = true;
        } else {
          this._noEnergyDashboard = false;
          this._hasSolar = dash.solarFrom.length > 0;
          this._hasBattery = dash.hasBattery;
          const [solar, gridImport, gridExport, batteryCharge, batteryDischarge] =
            await Promise.all([
              fetchTodayChangeSum(this.hass, dash.solarFrom),
              fetchTodayChangeSum(this.hass, dash.gridFrom),
              fetchTodayChangeSum(this.hass, dash.gridTo),
              dash.hasBattery ? fetchTodayChangeSum(this.hass, dash.batteryTo) : Promise.resolve(0),
              dash.hasBattery
                ? fetchTodayChangeSum(this.hass, dash.batteryFrom)
                : Promise.resolve(0),
            ]);
          this._solarTotal = solar;
          this._gridImport = gridImport;
          this._gridExport = gridExport;
          this._batteryCharge = batteryCharge;
          this._batteryDischarge = batteryDischarge;
        }
      }
    } catch (e) {
      console.error("m3-energy-flow-card: failed to load energy data", e);
    } finally {
      this._loading = false;
      this._fetchInFlight = false;
    }
  }

  private _formatNumber(value: number): string {
    return formatNumber(this._language, value, { maximumFractionDigits: 2 });
  }

  private _buildDiagram(
    colors: {
      pv: string;
      grid: string;
      home: string;
      battery: string;
    },
    showBattery: boolean,
  ): { nodes: FlowNodeData[]; flows: FlowLineData[]; viewHeight: number } {
    const homeConsumption =
      this._solarTotal + this._gridImport - this._gridExport - this._batteryCharge + this._batteryDischarge;
    const solarToHome = Math.max(0, this._solarTotal - this._gridExport);

    const nodes: FlowNodeData[] = [
      {
        key: "grid",
        x: GRID_POS.x,
        y: GRID_POS.y,
        color: colors.grid,
        icon: "mdi:transmission-tower",
        value: this._gridImport,
        label: `${this._t("flow_node_grid")} · kWh`,
      },
      {
        key: "home",
        x: HOME_POS.x,
        y: HOME_POS.y,
        color: colors.home,
        icon: "mdi:home",
        value: Math.max(0, homeConsumption),
        label: `${this._t("flow_node_home")} · kWh`,
      },
    ];
    if (this._hasSolar) {
      nodes.unshift({
        key: "pv",
        x: PV_POS.x,
        y: PV_POS.y,
        color: colors.pv,
        icon: "mdi:white-balance-sunny",
        value: this._solarTotal,
        label: `${this._t("flow_node_pv")} · kWh`,
      });
    }

    const flows: FlowLineData[] = [];
    if (this._hasSolar && solarToHome > 0) {
      flows.push({
        key: "pv-home",
        path: elbowPath(PV_POS.x, PV_POS.y + HALF, SPLIT_BEND_Y, HOME_POS.x - HALF),
        color: colors.pv,
        value: solarToHome,
      });
    }
    if (this._hasSolar && this._gridExport > 0) {
      flows.push({
        key: "pv-grid",
        path: elbowPath(PV_POS.x, PV_POS.y + HALF, SPLIT_BEND_Y, GRID_POS.x + HALF),
        color: colors.pv,
        value: this._gridExport,
      });
    }
    if (this._gridImport > 0) {
      flows.push({
        key: "grid-home",
        path: straightPath(GRID_POS.x + HALF, GRID_POS.y, HOME_POS.x - HALF, HOME_POS.y),
        color: colors.grid,
        value: this._gridImport,
      });
    }

    if (showBattery) {
      const charging = this._batteryCharge >= this._batteryDischarge;
      const batteryValue = charging ? this._batteryCharge : this._batteryDischarge;
      nodes.push({
        key: "battery",
        x: BATTERY_POS.x,
        y: BATTERY_POS.y,
        color: colors.battery,
        icon: charging ? "mdi:battery-charging" : "mdi:battery-arrow-down-outline",
        value: batteryValue,
        label: `${this._t("flow_node_battery")} · kWh`,
      });
      if (batteryValue > 0) {
        flows.push({
          key: "battery-home",
          path: charging
            ? straightPath(HOME_POS.x, HOME_POS.y + HALF, BATTERY_POS.x, BATTERY_POS.y - HALF)
            : straightPath(BATTERY_POS.x, BATTERY_POS.y - HALF, HOME_POS.x, HOME_POS.y + HALF),
          color: colors.battery,
          value: batteryValue,
        });
      }
    }

    return { nodes, flows, viewHeight: showBattery ? VIEW_HEIGHT_WITH_BATTERY : VIEW_HEIGHT };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.solar_entity,
      this._config?.grid_import_entity,
      this._config?.grid_export_entity,
      this._config?.battery_entity,
    ]);
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    if (this._config.source !== "entities" && this._noEnergyDashboard) {
      return html`
        <ha-card>
          <div class="card-inner glass">
            <div class="missing-entity">${this._t("gauge_no_energy_dashboard")}</div>
          </div>
        </ha-card>
      `;
    }

    const name = this._config.name || this._t("flow_default_name");
    const icon = this._config.icon || DEFAULT_FLOW_ICON;
    const subtitle = this._t("flow_subtitle_today");

    const pvColor = this._config.pv_color
      ? resolveThemeColor(this._config.pv_color)
      : FLOW_NODE_PV_COLOR;
    const gridColor = this._config.grid_color
      ? resolveThemeColor(this._config.grid_color)
      : FLOW_NODE_GRID_COLOR;
    const homeColor = this._config.home_color
      ? resolveThemeColor(this._config.home_color)
      : FLOW_NODE_HOME_COLOR;
    const selfSufficiencyColor = this._config.self_sufficiency_color
      ? resolveThemeColor(this._config.self_sufficiency_color)
      : FLOW_SELF_SUFFICIENCY_COLOR;
    const batteryColor = this._config.battery_color
      ? resolveThemeColor(this._config.battery_color)
      : FLOW_NODE_BATTERY_COLOR;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_FLOW_RADIUS,
      this._config.corners,
    );

    const showBattery =
      this._config.show_battery === "always"
        ? true
        : this._config.show_battery === "never"
          ? false
          : this._hasBattery;

    const { nodes, flows, viewHeight } = this._buildDiagram(
      { pv: pvColor, grid: gridColor, home: homeColor, battery: batteryColor },
      showBattery,
    );
    const maxFlow = Math.max(1, ...flows.map((f) => f.value));

    const homeConsumption =
      this._solarTotal + this._gridImport - this._gridExport - this._batteryCharge + this._batteryDischarge;
    const selfSufficiency =
      homeConsumption > 0
        ? Math.max(0, Math.min(100, ((homeConsumption - this._gridImport) / homeConsumption) * 100))
        : 0;

    const animate = shouldAnimate(this._config.animation);
    const dotDuration = FLOW_DOT_DURATION_MS[this._config.flow_speed ?? "normal"];

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, textColorCss, this._config.text_opacity, 12);
    const cssVars = buildCssVars({
      "m3p-accent": homeColor,
      "m3p-icon-color": foregroundOn(textColorCss, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({ icon, name, subtitle })}

          <div class="diagram-wrap ${this._loading ? "loading" : ""}">
            <svg
              class="flow-svg"
              viewBox="0 0 ${VIEW_WIDTH} ${viewHeight}"
              preserveAspectRatio="xMidYMid meet"
            >
              ${flows.map((f) => this._renderFlow(f, maxFlow, animate, dotDuration))}
              ${flows.length > 1
                ? svg`<circle class="junction-dot" cx=${PV_POS.x} cy=${SPLIT_BEND_Y} r="3"></circle>`
                : nothing}
              ${nodes.map((n) => this._renderNode(n, this._config?.node_tint_opacity))}
            </svg>
          </div>

          ${this._config.show_self_sufficiency !== false
            ? html`
                <div class="self-sufficiency">
                  <div class="self-sufficiency-row">
                    <span class="self-sufficiency-label">${this._t("flow_self_sufficiency")}</span>
                    <span class="self-sufficiency-value" style=${`color: ${foregroundColor(this, selfSufficiencyColor)};`}>
                      ${Math.round(selfSufficiency)}%
                    </span>
                  </div>
                  <div class="self-sufficiency-track">
                    <div
                      class="self-sufficiency-fill"
                      style=${`width: ${Math.max(4, selfSufficiency)}%; background: ${fillColor(this, selfSufficiencyColor)};`}
                    ></div>
                  </div>
                </div>
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderFlow(
    flow: FlowLineData,
    maxFlow: number,
    animate: boolean,
    dotDurationMs: number,
  ): SVGTemplateResult {
    const width = Math.min(
      FLOW_MAX_STROKE,
      Math.max(FLOW_MIN_STROKE, FLOW_MIN_STROKE + 16 * (flow.value / maxFlow)),
    );
    return svg`
      <path
        class="flow-bg"
        d=${flow.path}
        stroke=${flow.color}
        stroke-width=${width}
      ></path>
      ${animate
        ? svg`
            <path
              class="flow-dots"
              d=${flow.path}
              stroke=${flow.color}
              stroke-width=${Math.max(2, width * 0.4)}
              style=${`animation-duration: ${dotDurationMs}ms;`}
            ></path>
          `
        : nothing}
    `;
  }

  private _renderNode(node: FlowNodeData, nodeTintOpacity: number | undefined): SVGTemplateResult {
    const fill = tintOn(this, node.color, nodeTintOpacity, 18);
    return svg`
      <g class="flow-node">
        <rect
          x=${node.x - HALF}
          y=${node.y - HALF}
          width=${FLOW_NODE_SIZE}
          height=${FLOW_NODE_SIZE}
          rx=${FLOW_NODE_RX}
          fill=${fill}
          stroke=${node.color}
          stroke-width="2"
        ></rect>
        <foreignObject x=${node.x - 14} y=${node.y - 28} width="28" height="28">
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; box-sizing: border-box;"
          >
            <ha-icon icon=${node.icon} style=${`color: ${foregroundOn(node.color, fill)};`}></ha-icon>
          </div>
        </foreignObject>
        <text x=${node.x} y=${node.y + 22} text-anchor="middle" class="node-value">
          ${this._formatNumber(node.value)}
        </text>
        <text x=${node.x} y=${node.y + HALF + 16} text-anchor="middle" class="node-label">
          ${node.label}
        </text>
      </g>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      .diagram-wrap {
        transition: opacity 0.3s ease;
      }

      .diagram-wrap.loading {
        opacity: 0.35;
      }

      .flow-svg {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
      }

      .flow-bg {
        fill: none;
        stroke-linecap: round;
        opacity: 0.35;
      }

      .flow-dots {
        fill: none;
        stroke-linecap: round;
        stroke-dasharray: 0.1 20;
        animation: m3-flow-dash linear infinite;
      }

      @keyframes m3-flow-dash {
        to {
          stroke-dashoffset: -40;
        }
      }

      .junction-dot {
        fill: var(--m3p-text);
        opacity: 0.5;
      }

      .flow-node ha-icon {
        --mdc-icon-size: 22px;
        display: block;
      }

      .node-value {
        font-size: 13px;
        font-weight: 700;
        fill: var(--m3p-text);
        font-family: inherit;
      }

      .node-label {
        font-size: 11px;
        fill: var(--m3p-secondary-text);
        opacity: 0.6;
        font-family: inherit;
      }

      .self-sufficiency-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }

      .self-sufficiency-label {
        font-size: 13px;
        color: var(--m3p-secondary-text);
      }

      .self-sufficiency-value {
        font-size: 15px;
        font-weight: 700;
      }

      .self-sufficiency-track {
        margin-top: 6px;
        height: 10px;
        border-radius: 5px;
        background: color-mix(in srgb, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color)));
        overflow: hidden;
      }

      .self-sufficiency-fill {
        height: 100%;
        border-radius: 5px;
        transition: width 0.5s cubic-bezier(0.2, 0, 0, 1);
      }

      .card-inner.no-animations .self-sufficiency-fill {
        transition: none;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .self-sufficiency-track {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-energy-flow-card": M3EnergyFlowCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-energy-flow-card",
  name: "M3 Energy Flow Card",
  description:
    "Ein Material-3-Knoten-Diagramm der heutigen Energieflüsse zwischen PV, Netz und Haus.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
