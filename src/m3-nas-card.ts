import { LitElement, html, css, unsafeCSS, nothing , type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  M3NasCardConfig,
  HostSource,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_NAS_RADIUS,
  DEFAULT_NAS_ICON,
  DEFAULT_NAS_MAX_VISIBLE,
  DEFAULT_NAS_DISK_WARN,
  DEFAULT_NAS_DISK_CRITICAL,
  DEFAULT_NAS_TEMP_WARN,
  DEFAULT_NAS_TEMP_CRITICAL,
  NAS_COLOR_OK,
  NAS_COLOR_WARN,
  NAS_COLOR_CRITICAL,
  NAS_COLOR_OFFLINE,
  NAS_COLOR_ACCENT,
  NAS_ROW_HEIGHT,
  NAS_ROW_RADIUS,
  NAS_ROW_RADIUS_ACTIVE,
  NAS_ICON_SIZE,
  NAS_ICON_RADIUS,
  NAS_ROW_GAP,
  NAS_TILE_RADIUS,
  NAS_TILE_PADDING,
  NAS_TOGGLE_HEIGHT,
  NAS_TOGGLE_RADIUS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, foregroundOn , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { renderListRow, listRowStyles } from "./shared/list-row";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { localize, type TranslationKey } from "./localize";
import { discoveryChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import {
  discoverHostEntities,
  prettyLabel,
  resolveDiskSize,
  volumeHealth,
  type HostEntity,
  type HostMetric,
  type HostRegistryEntry,
  type VolumeHealth,
} from "./shared/nas-discovery";

console.info(
  `%c M3-NAS-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

// Drive temperature sensors as exposed by NVMe/SATA controllers; anything
// else (bigcore0_thermal, soc_thermal, ...) is board instrumentation.
const DRIVE_TEMP_LABEL = /^(composite|sensor \d|nvme|sd[a-z]|hdd|drive|disk)/i;

interface SyncRow {
  entity: string;
  name: string;
  state: string;
  bytes: number;
  completion: number;
  errors: number;
}

interface DiskRow {
  mount: string;
  name: string;
  percent: number;
  usedEntity?: string;
  sizeEntity?: string;
  /** Free space, when the source has no total-size sensor to read instead. */
  freeValue?: number;
  percentEntity: string;
  /** Synology only: the volume's own health, independent of how full it is. */
  health?: VolumeHealth;
}

// Folder sizes span three orders of magnitude here (an empty ssl folder next
// to 1.4 TB of media), so the unit follows the value.
function formatBytes(bytes: number): string {
  if (!bytes) return "0";
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} kB`;
}

@customElement("m3-nas-card")
export class M3NasCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() protected _config?: M3NasCardConfig;
  @state() private _expanded = false;
  /** translation_key → entities, built once from the entity registry. */
  @state() private _byKey: Partial<Record<HostMetric, HostEntity[]>> = {};
  /** Syncthing folder sensors, discovered alongside the Glances ones. */
  @state() private _syncEntities: string[] = [];
  private _registryLoaded = false;

  public setConfig(config: M3NasCardConfig): void {
    this._config = {
      auto_discover: true,
      max_visible: DEFAULT_NAS_MAX_VISIBLE,
      show_cpu: true,
      show_memory: true,
      show_temperature: true,
      show_network: true,
      show_uptime: true,
      ...config,
    };
    this._registryLoaded = false;
    this._loadRegistry();
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-nas-card-editor");
    return document.createElement("m3-nas-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): Partial<M3NasCardConfig> {
    return { auto_discover: true };
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", min_rows: 3 };
  }

  protected updated(): void {
    if (this.hass && !this._registryLoaded) this._loadRegistry();
  }

  private async _loadRegistry(): Promise<void> {
    if (!this.hass || this._registryLoaded) return;
    this._registryLoaded = true;
    try {
      const reg = await this.hass.callWS<HostRegistryEntry[]>({ type: "config/entity_registry/list" });
      const { byMetric, sync } = discoverHostEntities(reg, this._source, this._config?.config_entry_id);
      this._byKey = byMetric;
      this._syncEntities = sync;
    } catch {
      this._byKey = {}; // no registry access — the card renders its empty state
      this._syncEntities = [];
    }
  }

  protected get _source(): HostSource {
    return this._config?.source ?? "glances";
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _num(entityId?: string): number | undefined {
    if (!entityId || !this.hass) return undefined;
    const st = this.hass.states[entityId];
    if (!st || st.state === "unknown" || st.state === "unavailable") return undefined;
    const n = Number(st.state);
    return Number.isFinite(n) ? n : undefined;
  }

  private _unit(entityId?: string): string {
    if (!entityId || !this.hass) return "";
    return this.hass.states[entityId]?.attributes.unit_of_measurement ?? "";
  }

  /** The NAS is considered offline when nothing Glances should always emit reports. */
  private get _offline(): boolean {
    const probes = [
      ...(this._byKey.cpu_usage ?? []),
      ...(this._byKey.memory_usage ?? []),
      ...(this._byKey.disk_usage ?? []),
    ];
    if (!probes.length) return false; // nothing discovered yet — not a verdict
    return probes.every((p) => this._num(p.entityId) === undefined);
  }

  /**
   * The row identifier as the config addresses it. Glances and System Monitor
   * report a mount point; Synology has none and reports a DSM volume id
   * (`volume_1`) instead, so that is what `mount_names`, `exclude_mounts` and
   * `disks[].mount` key on there.
   */
  private _prettyLabel(label: string): string {
    return prettyLabel(this._source, label);
  }

  private _diskRows(): DiskRow[] {
    const cfg = this._config;
    if (!cfg) return [];
    const excluded = new Set(cfg.exclude_mounts ?? []);
    const byMount = new Map<string, DiskRow>();

    for (const e of this._byKey.disk_usage ?? []) {
      if (excluded.has(e.label)) continue;
      const percent = this._num(e.entityId);
      if (percent === undefined) continue;
      byMount.set(e.label, {
        mount: e.label,
        name: cfg.mount_names?.[e.label] ?? this._prettyLabel(e.label),
        percent,
        percentEntity: e.entityId,
      });
    }

    // System Monitor ships its percentage sensor disabled by default, so with
    // only "used" and "free" the ratio is derived rather than the volume being
    // dropped from the card entirely.
    if (!byMount.size) {
      const free = new Map((this._byKey.disk_free ?? []).map((e) => [e.label, e]));
      for (const e of this._byKey.disk_used ?? []) {
        if (excluded.has(e.label)) continue;
        const used = this._num(e.entityId);
        const freeVal = this._num(free.get(e.label)?.entityId);
        if (used === undefined || freeVal === undefined || used + freeVal <= 0) continue;
        byMount.set(e.label, {
          mount: e.label,
          name: cfg.mount_names?.[e.label] ?? this._prettyLabel(e.label),
          percent: (used / (used + freeVal)) * 100,
          percentEntity: e.entityId,
          usedEntity: e.entityId,
          freeValue: freeVal,
        });
      }
    }
    for (const e of this._byKey.disk_used ?? []) {
      const row = byMount.get(e.label);
      if (row) row.usedEntity = e.entityId;
    }
    for (const e of this._byKey.disk_size ?? []) {
      const row = byMount.get(e.label);
      if (row) row.sizeEntity = e.entityId;
    }
    // Synology reports a per-volume state next to the percentage. A crashed or
    // degraded volume is worth the warning colour whatever its fill level says,
    // so it rides the row's existing colour rather than adding anything to the
    // layout. Sources without such a sensor leave every row's health undefined.
    for (const e of this._byKey.volume_status ?? []) {
      const row = byMount.get(e.label);
      if (row) row.health = volumeHealth(this.hass?.states[e.entityId]?.state);
    }

    // An explicit `disks` list wins over discovery for both order and naming;
    // anything it doesn't mention still follows, sorted fullest first so the
    // volume that needs attention is the one you see without scrolling.
    const explicit = cfg.disks ?? [];
    if (explicit.length) {
      const ordered: DiskRow[] = [];
      for (const d of explicit) {
        const row = byMount.get(d.mount);
        if (row) {
          ordered.push({ ...row, name: d.name ?? row.name });
          byMount.delete(d.mount);
        }
      }
      return [...ordered, ...[...byMount.values()].sort((a, b) => b.percent - a.percent)];
    }
    return [...byMount.values()].sort((a, b) => b.percent - a.percent);
  }

  private _temperatures(): number[] {
    const wanted = this._config?.temperature_labels;
    const all = this._byKey.temperature ?? [];
    // Glances reports drive sensors and SoC/core thermals side by side, and the
    // SoC always runs hotter. On a NAS the drives are what a temperature
    // reading is expected to mean, so they win when both exist; a card that
    // showed 49 °C while the disks sat at 32 °C would just look alarming.
    const drives = all.filter((e) => DRIVE_TEMP_LABEL.test(e.label));
    const pool = wanted?.length ? all.filter((e) => wanted.includes(e.label)) : drives.length ? drives : all;
    return pool.map((e) => this._num(e.entityId)).filter((n): n is number => n !== undefined);
  }

  private _syncRows(): SyncRow[] {
    const cfg = this._config;
    if (!cfg || !this.hass || cfg.show_sync === false) return [];
    const ids = cfg.sync_entities?.length ? cfg.sync_entities : this._syncEntities;
    const rows: SyncRow[] = [];
    for (const id of ids) {
      const st = this.hass.states[id];
      if (!st || st.state === "unavailable") continue;
      const a = st.attributes;
      const global = Number(a.global_bytes) || 0;
      const need = Number(a.need_bytes) || 0;
      rows.push({
        entity: id,
        name: a.label || a.id || id,
        state: st.state,
        bytes: global,
        // A folder with nothing to transfer is complete; without a global size
        // there is no meaningful ratio, so it counts as complete rather than 0 %.
        completion: global > 0 ? Math.max(0, Math.min(1, (global - need) / global)) : 1,
        errors: Number(a.errors) || 0,
      });
    }
    return rows;
  }

  private _syncColor(row: SyncRow): string {
    const c = this._config;
    if (row.errors > 0 || row.state === "error") {
      return c?.critical_color ? resolveThemeColor(c.critical_color) : NAS_COLOR_CRITICAL;
    }
    if (row.state === "paused") return c?.offline_color ? resolveThemeColor(c.offline_color) : NAS_COLOR_OFFLINE;
    if (row.state === "idle") return c?.ok_color ? resolveThemeColor(c.ok_color) : NAS_COLOR_OK;
    return NAS_COLOR_ACCENT; // syncing / scanning / cleaning
  }

  private _diskColor(percent: number): string {
    const c = this._config;
    const crit = c?.disk_critical ?? DEFAULT_NAS_DISK_CRITICAL;
    const warn = c?.disk_warn ?? DEFAULT_NAS_DISK_WARN;
    if (percent >= crit) return c?.critical_color ? resolveThemeColor(c.critical_color) : NAS_COLOR_CRITICAL;
    if (percent >= warn) return c?.warn_color ? resolveThemeColor(c.warn_color) : NAS_COLOR_WARN;
    return c?.ok_color ? resolveThemeColor(c.ok_color) : NAS_COLOR_OK;
  }

  /** A volume's own bad health outranks its fill level; both use the same slot. */
  private _diskRowColor(row: DiskRow): string {
    const c = this._config;
    if (row.health === "critical") {
      return c?.critical_color ? resolveThemeColor(c.critical_color) : NAS_COLOR_CRITICAL;
    }
    if (row.health === "warn") {
      return c?.warn_color ? resolveThemeColor(c.warn_color) : NAS_COLOR_WARN;
    }
    return this._diskColor(row.percent);
  }

  private _tempColor(temp: number): string {
    const c = this._config;
    const crit = c?.temp_critical ?? DEFAULT_NAS_TEMP_CRITICAL;
    const warn = c?.temp_warn ?? DEFAULT_NAS_TEMP_WARN;
    if (temp >= crit) return c?.critical_color ? resolveThemeColor(c.critical_color) : NAS_COLOR_CRITICAL;
    if (temp >= warn) return c?.warn_color ? resolveThemeColor(c.warn_color) : NAS_COLOR_WARN;
    return NAS_COLOR_ACCENT;
  }

  private _moreInfo(entityId: string): () => void {
    return () => fireEvent(this, "hass-more-info", { entityId });
  }

  // HA's Glances integration exposes uptime as a timestamp sensor holding the
  // boot time, not a duration — printing its state verbatim puts an ISO date
  // on the dashboard. Verified against a live instance.
  private _uptimeText(): string | undefined {
    const e = this._byKey.uptime?.[0];
    if (!e || !this.hass) return undefined;
    const st = this.hass.states[e.entityId];
    if (!st || st.state === "unknown" || st.state === "unavailable") return undefined;
    const boot = new Date(st.state).getTime();
    if (Number.isNaN(boot)) return st.state; // unexpected format — show it raw
    const minutes = Math.floor((Date.now() - boot) / 60000);
    if (minutes < 60) return this._t("nas_uptime_minutes").replace("{n}", String(Math.max(0, minutes)));
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return this._t("nas_uptime_hours").replace("{n}", String(hours));
    return this._t("nas_uptime_days").replace("{n}", String(Math.floor(hours / 24)));
  }

  // _byKey holds everything discovery found, and every read goes through it or
  // through the sync list, so together they are the full set this card reads.
  private _watchedEntities(): string[] {
    const cfg = this._config;
    const glance = Object.values(this._byKey).flatMap((list) =>
      (list ?? []).map((e) => e.entityId),
    );
    const sync = cfg?.sync_entities?.length ? cfg.sync_entities : this._syncEntities;
    return [...glance, ...sync];
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return discoveryChangeMatters(changed, this.hass, this._watchedEntities());
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const cfg = this._config;
    const disks = this._diskRows();
    const offline = this._offline;
    const temps = this._temperatures();
    const maxTemp = temps.length ? Math.max(...temps) : undefined;
    const cpu = this._num(this._byKey.cpu_usage?.[0]?.entityId);
    const mem = this._num(this._byKey.memory_usage?.[0]?.entityId);
    const rx = this._num(this._byKey.network_rx?.[0]?.entityId);
    const tx = this._num(this._byKey.network_tx?.[0]?.entityId);
    const fullest = disks.length ? Math.max(...disks.map((d) => d.percent)) : undefined;
    const sync = this._syncRows();

    const offlineColor = cfg.offline_color ? resolveThemeColor(cfg.offline_color) : NAS_COLOR_OFFLINE;
    const statusColor = offline
      ? offlineColor
      : fullest !== undefined
        ? this._diskColor(fullest)
        : NAS_COLOR_ACCENT;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_NAS_RADIUS, cfg.corners);
    const animClass = shouldAnimate(cfg.animation) ? "" : "no-animations";

    const uptime = this._uptimeText();
    const subtitle = offline
      ? this._t("nas_offline")
      : cfg.show_uptime !== false && uptime
        ? this._t("nas_uptime").replace("{v}", uptime)
        : this._t("nas_online");

    const maxVisible = cfg.max_visible ?? DEFAULT_NAS_MAX_VISIBLE;
    const visible = maxVisible > 0 ? disks.slice(0, maxVisible) : disks;
    const overflow = maxVisible > 0 ? disks.slice(maxVisible) : [];

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, statusColor, cfg.accent_opacity, 18);
    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "m3p-icon-color": foregroundOn(statusColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "nas-status": statusColor,
      "lr-row-height": `${NAS_ROW_HEIGHT}px`,
      "lr-row-radius": `${NAS_ROW_RADIUS}px`,
      "lr-row-radius-active": `${NAS_ROW_RADIUS_ACTIVE}px`,
      "lr-icon-size": `${NAS_ICON_SIZE}px`,
      "lr-icon-radius": `${NAS_ICON_RADIUS}px`,
      "lr-row-gap": `${NAS_ROW_GAP}px`,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3p-icon-color": statusColor,
        "nas-status": statusColor,
      }),
    });

    const nothingFound = !disks.length && cpu === undefined && mem === undefined && !offline;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${animClass}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon: cfg.icon ?? (offline ? "mdi:nas" : DEFAULT_NAS_ICON),
            name: cfg.name || this._t("nas_default_name"),
            subtitle,
            right:
              fullest !== undefined && !offline
                ? html`<div class="fill-chip">
                    <ha-icon icon="mdi:harddisk"></ha-icon>
                    <span>${Math.round(fullest)} %</span>
                  </div>`
                : undefined,
          })}

          ${nothingFound
            ? html`<div class="empty-state">
                ${this._t(this._source === "synology_dsm" ? "nas_empty_synology" : "nas_empty")}
              </div>`
            : nothing}

          ${visible.length
            ? html`<div class="row-list">
                ${repeat(visible, (d) => d.mount, (d) => this._renderDisk(d))}
              </div>`
            : nothing}

          ${overflow.length
            ? html`
                <button
                  class="toggle ${this._expanded ? "open" : ""}"
                  @click=${() => (this._expanded = !this._expanded)}
                >
                  <ha-icon icon="mdi:harddisk"></ha-icon>
                  <span>
                    ${overflow.length}
                    ${this._t(this._expanded ? "nas_hide_more" : "nas_show_more")}
                  </span>
                  <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
                </button>
                ${this._expanded
                  ? html`<div class="row-list">
                      ${repeat(overflow, (d) => d.mount, (d) => this._renderDisk(d))}
                    </div>`
                  : nothing}
              `
            : nothing}

          ${offline ? nothing : this._renderStats(cpu, mem, maxTemp, rx, tx)}

          ${sync.length
            ? html`<div class="sync-section">
                <div class="section-label">${this._t("nas_sync")}</div>
                <div class="sync-list">
                  ${repeat(sync, (r) => r.entity, (r) => this._renderSync(r))}
                </div>
              </div>`
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderDisk(row: DiskRow) {
    const color = this._diskRowColor(row);
    const used = this._num(row.usedEntity);
    const size = resolveDiskSize(this._num(row.sizeEntity), used, row.freeValue);
    const unit = this._unit(row.sizeEntity) || this._unit(row.usedEntity);
    const detail =
      used !== undefined && size !== undefined
        ? `${used.toFixed(0)} / ${size.toFixed(0)} ${unit}`
        : undefined;

    return renderListRow({
      host: this,
      key: row.mount,
      label: row.name,
      icon: "mdi:harddisk",
      iconColor: color,
      iconBackground: tintOn(this, color, undefined, 20),
      barFraction: row.percent / 100,
      barColor: color,
      onClick: this._moreInfo(row.percentEntity),
      middle: html`
        <div class="disk-name">${row.name}</div>
        ${detail ? html`<div class="disk-detail">${detail}</div>` : nothing}
      `,
      right: html`<span class="disk-percent" style=${`color: ${color};`}
        >${row.percent.toFixed(0)} %</span
      >`,
    });
  }

  private _renderSync(row: SyncRow) {
    const color = this._syncColor(row);
    const icon =
      row.errors > 0 || row.state === "error"
        ? "mdi:alert-circle-outline"
        : row.state === "paused"
          ? "mdi:pause-circle-outline"
          : row.state === "idle"
            ? "mdi:check-circle-outline"
            : "mdi:sync";
    // While a folder is transferring, the percentage is the useful number;
    // once it is idle the size says more than a permanent "100 %". The size
    // column never falls back to the state text — that is the column next to
    // it, and printing it twice reads like a rendering bug.
    const right =
      row.state === "idle" || row.state === "paused" ? formatBytes(row.bytes) : `${Math.round(row.completion * 100)} %`;

    return html`
      <div class="sync-row" role="button" tabindex="0" @click=${this._moreInfo(row.entity)}>
        <ha-icon class="sync-icon" icon=${icon} style=${`color: ${color};`}></ha-icon>
        <span class="sync-name">${row.name}</span>
        <span class="sync-state">${this._t(`nas_sync_state_${row.state}` as TranslationKey)}</span>
        <span class="sync-value" style=${`color: ${color};`}>${right}</span>
      </div>
    `;
  }

  private _renderStats(
    cpu?: number,
    mem?: number,
    temp?: number,
    rx?: number,
    tx?: number,
  ) {
    const cfg = this._config!;
    const tiles: Array<{ icon: string; label: string; value: string; color?: string; entity?: string }> = [];

    if (cfg.show_cpu !== false && cpu !== undefined) {
      tiles.push({
        icon: "mdi:cpu-64-bit",
        label: this._t("nas_cpu"),
        value: `${cpu.toFixed(0)} %`,
        entity: this._byKey.cpu_usage?.[0]?.entityId,
      });
    }
    if (cfg.show_memory !== false && mem !== undefined) {
      tiles.push({
        icon: "mdi:memory",
        label: this._t("nas_memory"),
        value: `${mem.toFixed(0)} %`,
        entity: this._byKey.memory_usage?.[0]?.entityId,
      });
    }
    if (cfg.show_temperature !== false && temp !== undefined) {
      tiles.push({
        icon: "mdi:thermometer",
        label: this._t("nas_temperature"),
        value: `${temp.toFixed(0)} °C`,
        color: this._tempColor(temp),
      });
    }
    if (cfg.show_network !== false && (rx !== undefined || tx !== undefined)) {
      // Glances reports Mbit/s, System Monitor MB/s — printing a fixed unit
      // would be off by a factor of eight on one of them.
      const unit = this._unit(this._byKey.network_rx?.[0]?.entityId) || this._unit(this._byKey.network_tx?.[0]?.entityId);
      const digits = unit.startsWith("MB") ? 2 : 1;
      tiles.push({
        icon: "mdi:swap-vertical",
        label: unit || this._t("nas_network"),
        value: `${(rx ?? 0).toFixed(digits)} / ${(tx ?? 0).toFixed(digits)}`,
      });
    }

    if (!tiles.length) return nothing;

    return html`
      <div class="stat-grid">
        ${tiles.map(
          (t) => html`
            <div
              class="stat-tile ${t.entity ? "tappable" : ""}"
              @click=${t.entity ? this._moreInfo(t.entity) : undefined}
            >
              <ha-icon icon=${t.icon} style=${t.color ? `color: ${t.color};` : ""}></ha-icon>
              <div class="stat-value" style=${t.color ? `color: ${t.color};` : ""}>${t.value}</div>
              <div class="stat-label">${t.label}</div>
            </div>
          `,
        )}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    listRowStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      .card-inner {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }

      .fill-chip {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        height: 30px;
        padding: 0 10px;
        border-radius: 15px;
        background: var(--m3p-icon-bg);
        color: var(--m3p-icon-color-fg, var(--m3p-icon-color));
        font-size: 13px;
        font-weight: 700;
      }

      .fill-chip ha-icon {
        --mdc-icon-size: 16px;
      }

      .row-list {
        display: flex;
        flex-direction: column;
        gap: ${NAS_ROW_GAP}px;
      }

      .disk-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .disk-detail {
        font-size: 11px;
        opacity: 0.55;
        color: var(--m3p-secondary-text);
      }

      .disk-percent {
        font-size: 14px;
        font-weight: 700;
      }

      .stat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
        gap: 6px;
      }

      .stat-tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: ${NAS_TILE_PADDING}px 6px;
        border-radius: ${NAS_TILE_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        min-width: 0;
      }

      .stat-tile.tappable {
        cursor: pointer;
      }

      .stat-tile ha-icon {
        --mdc-icon-size: 18px;
        opacity: 0.7;
        color: var(--m3p-secondary-text);
      }

      .stat-value {
        font-size: 14px;
        font-weight: 700;
        color: var(--m3p-text);
        white-space: nowrap;
      }

      .stat-label {
        font-size: 10px;
        opacity: 0.5;
        color: var(--m3p-secondary-text);
        white-space: nowrap;
      }

      .toggle {
        width: 100%;
        height: ${NAS_TOGGLE_HEIGHT}px;
        border-radius: ${NAS_TOGGLE_RADIUS}px;
        border: none;
        background: color-mix(in srgb, var(--nas-status) 14%, var(--ha-card-background, var(--card-background-color)));
        color: var(--nas-status-fg, var(--nas-status));
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: border-radius 350ms ${unsafeCSS(STANDARD_EASING)};
      }

      .toggle.open {
        border-radius: 12px;
      }

      .toggle ha-icon {
        --mdc-icon-size: 18px;
      }

      .chevron {
        transition: transform 350ms ${unsafeCSS(STANDARD_EASING)};
      }

      .toggle.open .chevron {
        transform: rotate(180deg);
      }

      .card-inner.no-animations .toggle,
      .card-inner.no-animations .chevron {
        transition: none;
      }

      .section-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.03em;
        opacity: 0.5;
        color: var(--m3p-secondary-text);
        padding: 2px 2px 0;
      }

      .sync-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .sync-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .sync-row {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        border-radius: 14px;
        padding: 0 12px;
        background: color-mix(in srgb, var(--primary-text-color) 5%, var(--ha-card-background, var(--card-background-color)));
        cursor: pointer;
        min-width: 0;
      }

      .sync-icon {
        flex-shrink: 0;
        --mdc-icon-size: 16px;
      }

      .sync-name {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .sync-state {
        flex-shrink: 0;
        font-size: 10px;
        opacity: 0.45;
        color: var(--m3p-secondary-text);
      }

      .sync-value {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 700;
        min-width: 46px;
        text-align: right;
      }

      .empty-state {
        font-size: 13px;
        opacity: 0.7;
        color: var(--m3p-secondary-text);
        padding: 8px 4px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-nas-card": M3NasCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-nas-card",
  name: "M3 NAS Card",
  description:
    "Speicherbelegung, CPU, RAM und Temperatur eines NAS über die Glances- oder die Synology-DSM-Integration.",
  // false: setConfig() pulls the whole entity registry over the websocket to
  // find the Glances entities. HA's card-picker preview would pay that
  // round-trip too, just to draw a thumbnail. See m3-battery-card.ts.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
