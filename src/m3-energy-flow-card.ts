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
import { displayUnit, flowMeasure, toBase, type FlowMeasure } from "./shared/energy-flow-units";
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
const VIEW_HEIGHT_WITH_BATTERY = 330;
const PV_POS = { x: 160, y: 46 };
const GRID_POS = { x: 52, y: 160 };
const HOME_POS = { x: 268, y: 160 };
// Below the PV junction, between grid and home: solar charges it straight
// down, it feeds the home round the corner, and no label sits under another
// node (under the home node its frame covered "Home · kWh").
const BATTERY_POS = { x: PV_POS.x, y: 262 };
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
  /** A second, smaller line under the label (the grid's other direction). */
  sub?: string;
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

/**
 * Battery → home: right from the battery, up beside the home node and into
 * its lower left side. Straight up into its bottom would run through the
 * "Home · kWh" label that sits there.
 */
function batteryHomePath(): string {
  const r = 12;
  const x1 = BATTERY_POS.x + HALF;
  const y1 = BATTERY_POS.y;
  const xUp = HOME_POS.x - HALF - 16;
  const yIn = HOME_POS.y + HALF - 14;
  const xIn = HOME_POS.x - HALF;
  return `M ${x1} ${y1} L ${xUp - r} ${y1} Q ${xUp} ${y1} ${xUp} ${y1 - r} L ${xUp} ${yIn + r} Q ${xUp} ${yIn} ${xUp + r} ${yIn} L ${xIn} ${yIn}`;
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
  /** `home_entity`'s reading; undefined computes the home from the flows. */
  @state() private _homeReading?: number;
  @state() private _hasSolar = false;
  @state() private _hasBattery = false;
  @state() private _noEnergyDashboard = false;
  @state() private _loading = true;
  /** Energy over the day, or power right now (`source: entities` with power sensors). */
  @state() private _measure: FlowMeasure = "energy";

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
    if (this._config?.layout === "compact") return { columns: 6, rows: "auto", min_columns: 3 };
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
    // Own sensors are read as they change (willUpdate); only the Energy
    // dashboard's statistics are fetched, on the refresh timer.
    if (this._config.source === "entities") return;
    if (this._lastFetchKey === "energy") return;
    this._lastFetchKey = "energy";
    this._fetchData();
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate?.(changed);
    if (this._config?.source === "entities" && (changed.has("hass") || changed.has("_config"))) this._readEntities();
  }

  /**
   * The four sensors, read at once and on every change of one of them: a
   * power sensor moves every few seconds, and the five-minute statistics
   * refresh would leave the diagram that far behind. All values are brought
   * to one base unit — kWh, or W when every sensor reports power.
   */
  private _readEntities(): void {
    const c = this._config;
    if (!c || !this.hass) return;
    const ids = [
      c.solar_entity,
      c.grid_import_entity,
      c.grid_export_entity,
      c.battery_entity,
      c.battery_charge_entity,
      c.home_entity,
      c.grid_entity,
    ];
    const sensors = ids
      .filter((id): id is string => !!id && !!this.hass!.states[id])
      .map((id) => {
        const a = this.hass!.states[id].attributes;
        return { unit: a.unit_of_measurement as string | undefined, deviceClass: a.device_class as string | undefined };
      });
    const measure = flowMeasure(sensors);
    const signed = (id?: string): number | undefined => {
      if (!id) return undefined;
      const st = this.hass!.states[id];
      const raw = st ? parseFloat(st.state) : NaN;
      if (!st || isNaN(raw)) return undefined;
      return toBase(raw, st.attributes.unit_of_measurement as string | undefined, measure);
    };
    const read = (id?: string): number => Math.max(0, signed(id) ?? 0);
    this._measure = measure;
    this._noEnergyDashboard = false;
    this._hasSolar = !!c.solar_entity;
    this._hasBattery = !!c.battery_entity || !!c.battery_charge_entity;
    this._solarTotal = read(c.solar_entity);
    // One signed grid sensor carries both directions (#57): positive draws
    // from the grid, negative feeds in, as Home Assistant counts a grid meter.
    if (c.grid_entity) {
      const grid = (signed(c.grid_entity) ?? 0) * (c.grid_invert ? -1 : 1);
      this._gridImport = Math.max(0, grid);
      this._gridExport = Math.max(0, -grid);
    } else {
      this._gridImport = read(c.grid_import_entity);
      this._gridExport = read(c.grid_export_entity);
    }
    // One signed sensor carries both directions; before #54 a negative
    // reading was dropped, so charging never left the home's figure.
    if (c.battery_charge_entity) {
      this._batteryDischarge = read(c.battery_entity);
      this._batteryCharge = read(c.battery_charge_entity);
    } else {
      const battery = (signed(c.battery_entity) ?? 0) * (c.battery_invert ? -1 : 1);
      this._batteryDischarge = Math.max(0, battery);
      this._batteryCharge = Math.max(0, -battery);
    }
    const home = c.home_entity ? signed(c.home_entity) : undefined;
    this._homeReading = home === undefined ? undefined : Math.max(0, home);

    this._loading = false;
  }

  private async _fetchData(): Promise<void> {
    if (!this.hass || !this._config || this._fetchInFlight) return;
    this._fetchInFlight = true;
    const config = this._config;
    try {
      if (config.source === "entities") {
        this._readEntities();
      } else {
        this._measure = "energy";
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
    // Watts are whole numbers; kW and kWh keep up to two places.
    const places = this._measure === "power" && this._unitDivisor === 1 ? 0 : 2;
    return formatNumber(this._language, value / this._unitDivisor, { maximumFractionDigits: places });
  }

  /** Set per render from `displayUnit`: what the numbers are divided by, and the unit under them. */
  private _unitDivisor = 1;
  private _unitLabel = "kWh";

  private _nodeLabel(key: "pv" | "grid" | "home" | "battery", soc?: number): string {
    const c = this._config!;
    const own = { pv: c.pv_name, grid: c.grid_name, home: c.home_name, battery: c.battery_name }[key];
    let name = own || this._t(`flow_node_${key}` as TranslationKey);
    // The state of charge goes with the name, as the node's number is the
    // flow: "Battery 76 % · W".
    if (soc !== undefined) name = `${name} ${formatNumber(this._language, Math.round(soc))} %`;
    return this._unitLabel ? `${name} · ${this._unitLabel}` : name;
  }

  /**
   * What the home uses: `home_entity` when one is set, else what comes in
   * (solar, import, battery discharge) less what goes elsewhere (export,
   * battery charge). A hidden battery still counts — its charge is power
   * the home did not use.
   */
  /** `battery_soc_entity` in %, with either source. */
  private _batterySoc(): number | undefined {
    const id = this._config?.battery_soc_entity;
    const st = id ? this.hass?.states[id] : undefined;
    const soc = st ? parseFloat(st.state) : NaN;
    return isNaN(soc) ? undefined : soc;
  }

  /**
   * The grid node shows whichever way the grid is running (#57). It used to
   * show the import alone, so a house feeding in read "0" beside a line
   * running into the grid. Over a day both happen: the larger one is the
   * number, the other a small line under the label.
   */
  private _gridView(): { icon: string; value: number; label: string; sub?: string; exporting: boolean } {
    const exporting = this._gridExport > this._gridImport;
    const value = exporting ? this._gridExport : this._gridImport;
    const other = exporting ? this._gridImport : this._gridExport;
    const icon = exporting
      ? "mdi:transmission-tower-export"
      : this._gridImport > 0
        ? "mdi:transmission-tower-import"
        : "mdi:transmission-tower";
    const c = this._config!;
    const name = exporting ? this._t("flow_node_export") : c.grid_name || this._t("flow_node_grid");
    const label = this._unitLabel ? `${name} · ${this._unitLabel}` : name;
    const sub =
      other > 0
        ? this._t(exporting ? "flow_import_short" : "flow_export_short").replace("{v}", this._formatNumber(other))
        : undefined;
    return { icon, value, label, sub, exporting };
  }

  private _homeConsumption(): number {
    if (this._config?.source === "entities" && this._homeReading !== undefined) return this._homeReading;
    return this._solarTotal + this._gridImport - this._gridExport - this._batteryCharge + this._batteryDischarge;
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
    const homeConsumption = this._homeConsumption();
    // Solar goes to the battery first (a balcony battery sits between the
    // panels and the house), then out to the grid; the rest is the home's.
    const solarSpare = Math.max(0, this._solarTotal - this._gridExport);
    const chargeFromSolar = this._hasSolar ? Math.min(this._batteryCharge, solarSpare) : 0;
    const solarToHome = Math.max(0, solarSpare - chargeFromSolar);
    const solarToGrid = Math.min(this._gridExport, this._solarTotal);

    const grid = this._gridView();
    const nodes: FlowNodeData[] = [
      {
        key: "grid",
        x: GRID_POS.x,
        y: GRID_POS.y,
        color: colors.grid,
        icon: grid.icon,
        value: grid.value,
        label: grid.label,
        sub: grid.sub,
      },
      {
        key: "home",
        x: HOME_POS.x,
        y: HOME_POS.y,
        color: colors.home,
        icon: "mdi:home",
        value: Math.max(0, homeConsumption),
        label: this._nodeLabel("home"),
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
        label: this._nodeLabel("pv"),
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
    if (this._hasSolar && solarToGrid > 0) {
      flows.push({
        key: "pv-grid",
        path: elbowPath(PV_POS.x, PV_POS.y + HALF, SPLIT_BEND_Y, GRID_POS.x + HALF),
        color: colors.pv,
        value: solarToGrid,
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
        label: this._nodeLabel("battery", this._batterySoc()),
      });
      if (showBattery && chargeFromSolar > 0) {
        flows.push({
          key: "pv-battery",
          path: straightPath(PV_POS.x, PV_POS.y + HALF, BATTERY_POS.x, BATTERY_POS.y - HALF),
          color: colors.pv,
          value: chargeFromSolar,
        });
      }
      if (this._batteryDischarge > 0) {
        flows.push({
          key: "battery-home",
          path: batteryHomePath(),
          color: colors.battery,
          value: this._batteryDischarge,
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
      this._config?.battery_charge_entity,
      this._config?.battery_soc_entity,
      this._config?.home_entity,
      this._config?.grid_entity,
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
    const power = this._measure === "power";
    const subtitle = this._config.subtitle || this._t(power ? "flow_subtitle_now" : "flow_subtitle_today");
    const largest = Math.max(this._solarTotal, this._gridImport, this._gridExport, this._batteryCharge, this._batteryDischarge);
    const shownUnit = displayUnit(this._measure, largest, this._config.unit);
    this._unitDivisor = shownUnit.divisor;
    this._unitLabel = shownUnit.label;

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

    const homeConsumption = this._homeConsumption();
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

    const compact = this._config.layout === "compact";
    const showHeader = this._config.show_header ?? !compact;
    if (compact) {
      return html`
        <ha-card style=${`${cssVars} border-radius: ${radius};`}>
          <div
            class="card-inner compact ${glassCardClass(this._config.glass_background)} ${animate ? "" : "no-animations"}"
            style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
          >
            ${showHeader ? renderCardHeader({ icon, name, subtitle }) : nothing}
            ${this._renderCompact(
              { pv: pvColor, grid: gridColor, home: homeColor, battery: batteryColor },
              showBattery,
              this._config.show_self_sufficiency !== false ? selfSufficiency : undefined,
              animate,
              foregroundColor(this, selfSufficiencyColor),
            )}
          </div>
        </ha-card>
      `;
    }

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${showHeader ? renderCardHeader({ icon, name, subtitle }) : nothing}

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
                    <span class="self-sufficiency-label">${this._t(power ? "flow_self_sufficiency_now" : "flow_self_sufficiency")}</span>
                    <span class="self-sufficiency-value" style=${`color: ${foregroundColor(this, selfSufficiencyColor)};`}>
                      ${Math.round(selfSufficiency)}%
                    </span>
                  </div>
                  <div class="self-sufficiency-track">
                    <div
                      class="self-sufficiency-fill"
                      style=${`width: ${selfSufficiency < 0.5 ? 0 : Math.max(4, selfSufficiency)}%; background: ${fillColor(this, selfSufficiencyColor)};`}
                    ></div>
                  </div>
                </div>
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  /**
   * `layout: compact` (#54): the nodes side by side, home third as the
   * reporter listed them — solar, grid, home, battery — about as tall as a
   * tile. A small arrow under each value says which way it runs relative to
   * the home tile: the tiles left of home point right when they feed it, the
   * battery right of it points left. The home tile carries the
   * self-sufficiency instead of a bar of its own.
   */
  private _renderCompact(
    colors: { pv: string; grid: string; home: string; battery: string },
    showBattery: boolean,
    selfSufficiency: number | undefined,
    animate: boolean,
    selfColor: string,
  ): unknown {
    const c = this._config!;
    type Dir = "toHome" | "fromHome" | undefined;
    interface Tile { key: string; color: string; icon: string; value: number; name: string; dir: Dir; side: "left" | "right" | "home"; note?: string; soc?: number }
    const tiles: Tile[] = [];
    if (this._hasSolar)
      tiles.push({ key: "pv", color: colors.pv, icon: "mdi:white-balance-sunny", value: this._solarTotal, name: c.pv_name || this._t("flow_node_pv"), dir: this._solarTotal > 0 ? "toHome" : undefined, side: "left" });
    const grid = this._gridView();
    tiles.push({
      key: "grid",
      color: colors.grid,
      icon: grid.icon,
      value: grid.value,
      // Always "Grid" here: a narrow tile has no room for "Export", and the
      // icon and the arrow already say which way it runs.
      name: c.grid_name || this._t("flow_node_grid"),
      dir: grid.exporting ? "fromHome" : this._gridImport > 0 ? "toHome" : undefined,
      side: "left",
    });
    tiles.push({
      key: "home",
      color: colors.home,
      icon: "mdi:home",
      value: Math.max(0, this._homeConsumption()),
      name: c.home_name || this._t("flow_node_home"),
      dir: undefined,
      side: "home",
      note: selfSufficiency !== undefined ? this._t("flow_compact_self").replace("{p}", String(Math.round(selfSufficiency))) : undefined,
    });
    if (showBattery) {
      const charging = this._batteryCharge > this._batteryDischarge;
      const soc = this._batterySoc();
      // The state of charge is the icon's fill here, in steps of ten: a narrow
      // tile has no room for "Battery 64 %" (the title carries the number).
      const level = soc !== undefined ? Math.max(10, Math.min(100, Math.round(soc / 10) * 10)) : undefined;
      const levelIcon =
        level === undefined
          ? charging
            ? "mdi:battery-charging"
            : "mdi:battery-arrow-down-outline"
          : charging
            ? `mdi:battery-charging-${level}`
            : level === 100
              ? "mdi:battery"
              : `mdi:battery-${level}`;
      tiles.push({
        key: "battery",
        color: colors.battery,
        icon: levelIcon,
        value: charging ? this._batteryCharge : this._batteryDischarge,
        name: c.battery_name || this._t("flow_node_battery"),
        soc,
        dir: this._batteryDischarge > this._batteryCharge ? "toHome" : charging ? "fromHome" : undefined,
        side: "right",
      });
    }
    const arrowFor = (t: Tile): string | undefined => {
      if (!t.dir) return undefined;
      const right = (t.side === "left") === (t.dir === "toHome");
      return right ? "mdi:chevron-double-right" : "mdi:chevron-double-left";
    };
    return html`
      <div
        class="compact-row"
        style=${`grid-template-columns: repeat(${tiles.length}, minmax(0, 1fr)); --flow-self: ${selfColor};`}
      >
        ${tiles.map((t) => {
          const fill = tintOn(this, t.color, c.node_tint_opacity, t.value > 0 ? 18 : 8);
          const arrow = arrowFor(t);
          return html`
            <div
              class="ctile ${t.side === "home" ? "home" : ""} ${t.value > 0 ? "" : "idle"}"
              title=${`${t.name}${t.soc !== undefined ? ` ${Math.round(t.soc)} %` : ""}: ${this._formatNumber(t.value)} ${this._unitLabel}`}
            >
              <div class="cicon" style=${`background: ${fill}; color: ${foregroundOn(t.color, fill)};`}>
                <ha-icon icon=${t.icon}></ha-icon>
              </div>
              <div class="cvalue">
                ${this._formatNumber(t.value)}<span class="cunit">${this._unitLabel}</span>
              </div>
              <div class="cname">${t.name}</div>
              ${arrow
                ? html`<ha-icon class="carrow ${animate ? "moving" : ""} ${arrow.endsWith("left") ? "left" : "right"}" icon=${arrow} style=${`color: ${foregroundColor(this, t.color)};`}></ha-icon>`
                : t.note
                  ? html`<div class="cnote"><ha-icon icon="mdi:leaf"></ha-icon>${t.note}</div>`
                  : html`<div class="carrow-spacer"></div>`}
            </div>
          `;
        })}
      </div>
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
        ${node.sub
          ? svg`<text x=${node.x} y=${node.y + HALF + 30} text-anchor="middle" class="node-label node-sub">${node.sub}</text>`
          : nothing}
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

      .node-sub {
        font-size: 10px;
      }

      /* layout: compact (#54) */
      .compact-row {
        display: grid;
        gap: 6px;
      }
      .ctile {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        min-width: 0;
        padding: 8px 2px 6px;
        border-radius: 18px;
      }
      .ctile.home {
        background: color-mix(in srgb, var(--m3p-accent) 10%, var(--ha-card-background, var(--card-background-color)));
      }
      .cicon {
        width: 36px;
        height: 36px;
        border-radius: 13px;
        display: grid;
        place-items: center;
        --mdc-icon-size: 20px;
        margin-bottom: 2px;
      }
      .ctile.idle .cicon {
        opacity: 0.6;
      }
      .cvalue {
        font-size: 15px;
        font-weight: 700;
        color: var(--m3p-text);
        white-space: nowrap;
        line-height: 1.2;
      }
      .cunit {
        font-size: 10px;
        font-weight: 600;
        margin-left: 2px;
        opacity: 0.7;
      }
      .cname,
      .cnote {
        max-width: 100%;
        font-size: 10.5px;
        color: var(--m3p-secondary-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.25;
      }
      .cnote {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-weight: 700;
        color: var(--flow-self, var(--m3p-secondary-text));
        --mdc-icon-size: 12px;
      }
      .carrow,
      .carrow-spacer {
        height: 15px;
        --mdc-icon-size: 15px;
      }
      .carrow.moving.right {
        animation: m3-flow-nudge-right 1.4s ease-in-out infinite;
      }
      .carrow.moving.left {
        animation: m3-flow-nudge-left 1.4s ease-in-out infinite;
      }
      @keyframes m3-flow-nudge-right {
        0%, 100% { transform: translateX(-2px); opacity: 0.6; }
        50% { transform: translateX(2px); opacity: 1; }
      }
      @keyframes m3-flow-nudge-left {
        0%, 100% { transform: translateX(2px); opacity: 0.6; }
        50% { transform: translateX(-2px); opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .carrow.moving.right,
        .carrow.moving.left {
          animation: none;
        }
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
