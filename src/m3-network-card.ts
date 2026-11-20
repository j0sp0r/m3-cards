import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3NetworkCardConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_NETWORK_ICON,
  DEFAULT_NETWORK_MAX_ITEMS,
  DEFAULT_NETWORK_RADIUS,
  DEFAULT_NETWORK_RECONNECTS,
  DEFAULT_NETWORK_SIGNAL_FAIR,
  DEFAULT_NETWORK_SIGNAL_GOOD,
  DEFAULT_NETWORK_WEAK_SIGNAL,
  NETWORK_BAD_COLOR,
  NETWORK_HISTORY_MS,
  NETWORK_ICON_RADIUS,
  NETWORK_ICON_SIZE,
  NETWORK_NEW_COLOR,
  NETWORK_OK_COLOR,
  NETWORK_ROW_HEIGHT,
  NETWORK_TICK_MS,
  NETWORK_WARN_COLOR,
  NEW_CARD_ACCENT,
  AVAILABILITY_HEADER_ICON,
  AVAILABILITY_HEADER_RADIUS,
  AVAILABILITY_ROW_GAP,
  AVAILABILITY_ROW_RADIUS,
  AVAILABILITY_ROW_RADIUS_ACTIVE,
  resolveCornerRadius,
} from "./const";
import { buildCssVars, foregroundColor, foregroundOn, resolveCommonColors, resolveThemeColor, tintOn } from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { isReducedMotion, shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { captureRowRects, flipRows } from "./shared/list-row";
import { localize, type TranslationKey } from "./localize";
import { TemplatedCard } from "./shared/templated-card";
import { openEntityDetail } from "./shared/entity-detail";
import { showSnackbar } from "./shared/snackbar";
import { formatNumber } from "./shared/formatting";
import { loadUserData, saveUserData } from "./shared/user-data";
import {
  applyRandomMacs,
  countFilters,
  countReconnects,
  deviceIcon,
  deviceName,
  findOverride,
  fromList,
  fromTracker,
  ipConflicts,
  matchesFilter,
  matchesSearch,
  mergeDevices,
  problemsOf,
  routerQuality,
  signalBars,
  sortRows,
  toMbit,
  type Filter,
  type NetDevice,
  type Problem,
  type Row,
} from "./shared/network";
import { NETWORK_KNOWN_KEY, isNew, parseKnown, updateKnown, withEntry, type KnownEntry, type KnownMap } from "./shared/network-known";
import "./shared/network-sheet";
import type { M3NetworkSheet, NetSheetFact } from "./shared/network-sheet";

console.info(
  `%c M3-NETWORK-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #6ba7dc; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #6ba7dc; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const FLIP_MS = 260;
const FILTERS: Filter[] = ["all", "new", "problems", "wifi", "lan", "offline"];

interface RouterView {
  online?: boolean;
  since?: number;
  connection?: string;
  down?: { value: string; unit: string };
  up?: { value: string; unit: string };
  signal?: { value: number; quality?: "good" | "fair" | "weak" };
  dataUsed?: string;
}

/**
 * The router and the devices on the network: what is new, what has
 * problems, what is offline. Devices come from device_trackers, from the
 * trackers of whole integrations, or from a list entity, merged by MAC (see
 * shared/network.ts); what the card has met is kept per user
 * (shared/network-known.ts).
 */
@customElement("m3-network-card")
export class M3NetworkCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3NetworkCardConfig;
  @state() private _filter: Filter = "all";
  @state() private _query = "";
  @state() private _showAll = false;
  @state() private _known: KnownMap = {};
  @state() private _now = Date.now();
  @state() private _reconnects = new Map<string, number>();
  @state() private _custom = new Map<string, string>();

  private _knownLoaded = false;
  private _knownReady = false;
  private _tick?: number;
  private _signature = "";
  private _devices: NetDevice[] = [];
  private _historyAt = 0;
  private _historyKey = "";
  private _tplKey = "";
  private _tplUnsub?: Promise<() => void>;
  private _rects?: Map<string, DOMRect>;

  public setConfig(config: M3NetworkCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this._config = config;
    this._signature = "";
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-network-card-editor");
    return document.createElement("m3-network-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3NetworkCardConfig {
    return { type: "custom:m3-network-card", glass_background: true, accent_color: NEW_CARD_ACCENT };
  }

  public getCardSize(): number {
    return 6;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._tick = window.setInterval(() => (this._now = Date.now()), NETWORK_TICK_MS);
    this._now = Date.now();
    if (this._tplKey) {
      this._tplKey = "";
      this._signature = "";
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tick) window.clearInterval(this._tick);
    this._unsubscribeTemplate();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- sources ----------------------------------------------------------------

  /** The device_tracker entities the config names, listed first, then by integration. */
  private _trackerIds(): string[] {
    const cfg = this._config!;
    const hass = this.hass!;
    const ids = [...(cfg.device_trackers ?? [])];
    const integrations = new Set(cfg.integrations ?? []);
    if (integrations.size) {
      for (const e of Object.values((hass.entities ?? {}) as Record<string, { entity_id: string; platform?: string; hidden?: boolean }>)) {
        if (e.entity_id.startsWith("device_tracker.") && e.platform && integrations.has(e.platform) && !ids.includes(e.entity_id)) ids.push(e.entity_id);
      }
    }
    return ids.filter((id) => hass.states[id]);
  }

  /** What the device list depends on, cheaply: to skip renders between ticks. */
  private _sourceSignature(): string {
    const hass = this.hass!;
    const cfg = this._config!;
    const parts: string[] = [];
    for (const id of this._trackerIds()) parts.push(`${id}:${hass.states[id]?.last_updated}`);
    if (cfg.clients_entity) parts.push(`${cfg.clients_entity}:${hass.states[cfg.clients_entity]?.last_updated}`);
    for (const o of cfg.overrides ?? []) if (o.signal) parts.push(`${o.signal}:${hass.states[o.signal]?.state}`);
    const r = cfg.router ?? {};
    for (const id of [r.status, r.uptime, r.connection_type, r.download, r.upload, r.signal, r.data_used]) if (id) parts.push(`${id}:${hass.states[id]?.state}`);
    return parts.join("|");
  }

  private _collect(): NetDevice[] {
    const hass = this.hass!;
    const cfg = this._config!;
    const regs = (hass.entities ?? {}) as Record<string, { device_id?: string }>;
    const devs = (hass.devices ?? {}) as Record<string, { name?: string | null; name_by_user?: string | null; manufacturer?: string | null }>;
    const trackers = this._trackerIds().map((id) => {
      const dev = regs[id]?.device_id ? devs[regs[id].device_id!] : undefined;
      return fromTracker(id, hass.states[id] as never, {
        name: dev ? (dev.name_by_user || dev.name || undefined) : undefined,
        manufacturer: dev?.manufacturer || undefined,
      });
    });
    const sources: NetDevice[][] = [trackers];
    if (cfg.clients_entity) {
      const list = hass.states[cfg.clients_entity]?.attributes?.[cfg.clients_attribute || "clients"];
      sources.push(fromList(list));
    }
    let devices = applyRandomMacs(mergeDevices(sources), cfg.random_mac_handling ?? "flag");
    // A signal entity from an override fills in what the source does not say.
    devices = devices.map((d) => {
      const o = findOverride(d, cfg.overrides);
      if (!o?.signal) return d;
      const v = parseFloat(hass.states[o.signal]?.state ?? "");
      return Number.isFinite(v) ? { ...d, signal: v } : d;
    });
    return devices;
  }

  // ---- known devices -------------------------------------------------------------

  private async _loadKnown(): Promise<void> {
    if (this._knownLoaded) return;
    this._knownLoaded = true;
    this._known = parseKnown(await loadUserData<unknown>(this.hass, NETWORK_KNOWN_KEY));
    this._knownReady = true;
    this._signature = "";
    this.requestUpdate();
  }

  private _saveKnown(next: KnownMap): void {
    this._known = next;
    void saveUserData(this.hass, NETWORK_KNOWN_KEY, next);
  }

  /** Online devices into the store; new ones notified once, if asked for. */
  private _syncKnown(): void {
    if (!this._knownReady) return;
    const online = this._devices.filter((d) => d.online).map((d) => ({ key: d.key, ip: d.ip, host: d.host }));
    if (!online.length) return;
    let next = updateKnown(this._known, online, this._now);
    const cfg = this._config!;
    const targets = cfg.notify_service ?? [];
    if (cfg.notify_new && targets.length) {
      for (const d of this._devices) {
        const e = next[d.key];
        if (!d.online || !isNew(e) || e.notified) continue;
        // Private addresses change by design; telling about each would be noise.
        if (d.randomMac) continue;
        const name = deviceName(d, this._override(d)) ?? this._t("net_unknown");
        const message = this._t("net_notify_new").replace("{name}", name).replace("{ip}", d.ip ?? "–");
        for (const t of targets) void this.hass?.callService("notify", t, { title: cfg.title || this._t("net_title"), message });
        next = withEntry(next, d.key, { ...e!, notified: true });
      }
    }
    if (next !== this._known) this._saveKnown(next);
  }

  private _override(d: NetDevice): { name?: string; icon?: string; fixed_ip?: boolean } | undefined {
    const fromConfig = findOverride(d, this._config?.overrides);
    const stored = this._known[d.key];
    if (!fromConfig && !stored?.name && !stored?.icon) return undefined;
    return { name: stored?.name || fromConfig?.name, icon: stored?.icon || fromConfig?.icon, fixed_ip: fromConfig?.fixed_ip };
  }

  // ---- problems from the recorder and a template -------------------------------

  private async _maybeFetchReconnects(): Promise<void> {
    const cfg = this._config!;
    if (!cfg.reconnects || !this.hass) return;
    const pairs = this._devices.filter((d) => d.entity).map((d) => [d.entity!, d.key] as const);
    const key = pairs.map((p) => p[0]).join(",");
    if (!pairs.length || (key === this._historyKey && Date.now() - this._historyAt < NETWORK_HISTORY_MS)) return;
    this._historyKey = key;
    this._historyAt = Date.now();
    try {
      const res = await this.hass.callWS<Record<string, { s: string }[]>>({
        type: "history/history_during_period",
        start_time: new Date(Date.now() - 86_400_000).toISOString(),
        entity_ids: pairs.map((p) => p[0]),
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const next = new Map<string, number>();
      for (const [entity, k] of pairs) next.set(k, countReconnects(res?.[entity]));
      this._reconnects = next;
    } catch {
      // No recorder access: the rule stays quiet.
    }
  }

  private _unsubscribeTemplate(): void {
    const u = this._tplUnsub;
    this._tplUnsub = undefined;
    if (u) void u.then((f) => f()).catch(() => undefined);
  }

  /**
   * One subscription for every device: the user's template runs once per
   * device with `device` set, and the results come back as one map.
   */
  private _maybeSubscribeTemplate(): void {
    const tpl = this._config?.problem_template?.trim();
    const hass = this.hass;
    const key = tpl ? `${tpl}|${this._devices.map((d) => d.key).join(",")}` : "";
    if (key === this._tplKey) return;
    this._tplKey = key;
    this._unsubscribeTemplate();
    if (!tpl || !hass) {
      if (this._custom.size) this._custom = new Map();
      return;
    }
    const template =
      "{% set ns = namespace(out={}) %}{% for device in devices %}{% set t %}" +
      tpl +
      "{% endset %}{% set ns.out = dict(ns.out, **{device.key: t | trim}) %}{% endfor %}{{ ns.out | tojson }}";
    const devices = this._devices.map((d) => ({
      key: d.key,
      mac: d.mac,
      ip: d.ip,
      host: d.host,
      name: deviceName(d, this._override(d)),
      online: d.online,
      connection: d.connection,
      signal: d.signal,
      entity: d.entity,
    }));
    const connection = (hass as unknown as {
      connection?: {
        subscribeMessage: (cb: (msg: { result?: unknown }) => void, msg: Record<string, unknown>) => Promise<() => void>;
      };
    }).connection;
    if (!connection) return;
    this._tplUnsub = connection
      .subscribeMessage(
        (msg: { result?: unknown }) => {
          try {
            const raw = msg.result;
            const obj = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, string>;
            this._custom = new Map(Object.entries(obj ?? {}).filter(([, v]) => typeof v === "string" && v.trim()));
          } catch {
            this._custom = new Map();
          }
        },
        { type: "render_template", template, variables: { devices }, strict: false },
      )
      .catch(() => () => undefined);
  }

  // ---- lifecycle -------------------------------------------------------------------

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (!changed.has("hass") || changed.size > 1) return true;
    const prev = changed.get("hass") as HomeAssistant | undefined;
    const hass = this.hass;
    if (!prev || !hass || !this._config) return true;
    if (prev.locale !== hass.locale || prev.themes !== hass.themes || prev.language !== hass.language || prev.entities !== hass.entities || prev.devices !== hass.devices) return true;
    return this._sourceSignature() !== this._signature;
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate?.(changed);
    if (!this.hass || !this._config) return;
    if (!this._knownLoaded) void this._loadKnown();
    const sig = this._sourceSignature();
    if (sig !== this._signature || changed.has("_config") || changed.has("_now")) {
      this._signature = sig;
      this._devices = this._collect();
      this._syncKnown();
      void this._maybeFetchReconnects();
      this._maybeSubscribeTemplate();
    }
    if (this._animate) this._rects = captureRowRects(this.renderRoot);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this._rects && this._animate) flipRows(this.renderRoot, this._rects, FLIP_MS);
    this._rects = undefined;
  }

  private get _animate(): boolean {
    return shouldAnimate(this._config?.animation) && !isReducedMotion();
  }

  // ---- model for the view ---------------------------------------------------------

  private _rows(): Row[] {
    const cfg = this._config!;
    const conflicts = ipConflicts(this._devices);
    const rules = {
      weakBelow: cfg.weak_signal_below ?? DEFAULT_NETWORK_WEAK_SIGNAL,
      reconnectThreshold: cfg.reconnects ? (cfg.reconnect_threshold ?? DEFAULT_NETWORK_RECONNECTS) : undefined,
      ipConflict: cfg.ip_conflict !== false,
    };
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const d of this._devices) {
      seen.add(d.key);
      const e = this._known[d.key];
      if (e?.ignored) continue;
      const o = this._override(d);
      rows.push({
        device: d,
        name: deviceName(d, o),
        icon: deviceIcon(d, o),
        isNew: d.online && isNew(e),
        firstSeen: e?.first,
        lastSeen: d.lastSeen ?? e?.last,
        problems: problemsOf(d, rules, { conflicts, reconnects: this._reconnects, custom: this._custom }),
        fixedIp: !!o?.fixed_ip,
      });
    }
    // Known devices a list source no longer lists: offline, from the store.
    for (const [key, e] of Object.entries(this._known)) {
      if (seen.has(key) || e.ignored || !e.known) continue;
      const d: NetDevice = { key, mac: key.includes(":") && !key.startsWith("ip:") && !key.startsWith("entity:") ? key : undefined, ip: e.ip, host: e.host, online: false, randomMac: false, lastSeen: e.last };
      const o = this._override(d);
      rows.push({ device: d, name: deviceName(d, o), icon: deviceIcon(d, o), isNew: false, firstSeen: e.first, lastSeen: e.last, problems: [], fixedIp: !!o?.fixed_ip });
    }
    return sortRows(rows, new Intl.Collator(this._language, { sensitivity: "base", numeric: true }));
  }

  private _router(): RouterView | undefined {
    const r = this._config?.router;
    const hass = this.hass!;
    if (!r) return undefined;
    const st = (id?: string) => (id ? hass.states[id] : undefined);
    const usable = (s?: { state: string }) => !!s && s.state !== "unavailable" && s.state !== "unknown";
    const view: RouterView = {};
    const status = st(r.status);
    if (usable(status)) {
      const v = status!.state.toLowerCase();
      view.online = ["on", "online", "connected", "up", "home", "true", "ipv4_ipv6_connected", "ipv4_connected", "ipv6_connected"].includes(v) || v.includes("connected") && !v.includes("disconnected");
    }
    const up = st(r.uptime);
    if (usable(up)) {
      const ts = Date.parse(up!.state);
      const n = parseFloat(up!.state);
      if (up!.attributes.device_class === "timestamp" || (!/^\d+(\.\d+)?$/.test(up!.state) && Number.isFinite(ts))) view.since = ts;
      else if (Number.isFinite(n)) {
        const unit = String(up!.attributes.unit_of_measurement ?? "s");
        const f = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : unit === "min" ? 60_000 : 1000;
        view.since = this._now - n * f;
      }
    }
    const ct = st(r.connection_type);
    if (usable(ct)) view.connection = ct!.state;
    const rate = (s?: { state: string; attributes: Record<string, unknown> }) => {
      if (!usable(s)) return undefined;
      const v = parseFloat(s!.state);
      const unit = s!.attributes.unit_of_measurement as string | undefined;
      const mbit = toMbit(Number.isFinite(v) ? v : undefined, unit);
      if (mbit !== undefined) return { value: formatNumber(this._language, mbit, { maximumFractionDigits: mbit < 100 ? 1 : 0 }), unit: "Mbit/s" };
      return Number.isFinite(v) ? { value: formatNumber(this._language, v, { maximumFractionDigits: 1 }), unit: unit ?? "" } : undefined;
    };
    view.down = rate(st(r.download));
    view.up = rate(st(r.upload));
    const sig = st(r.signal);
    if (usable(sig)) {
      const v = parseFloat(sig!.state);
      if (Number.isFinite(v)) {
        view.signal = {
          value: v,
          quality: routerQuality(v, {
            good: r.signal_thresholds?.good ?? DEFAULT_NETWORK_SIGNAL_GOOD,
            fair: r.signal_thresholds?.fair ?? DEFAULT_NETWORK_SIGNAL_FAIR,
          }),
        };
      }
    }
    const du = st(r.data_used);
    if (usable(du)) {
      const v = parseFloat(du!.state);
      view.dataUsed = Number.isFinite(v)
        ? `${formatNumber(this._language, v, { maximumFractionDigits: 1 })} ${du!.attributes.unit_of_measurement ?? ""}`.trim()
        : du!.state;
    }
    return view;
  }

  // ---- actions -----------------------------------------------------------------------

  private _setEntry(row: Row, entry: KnownEntry | undefined, message: string): void {
    const key = row.device.key;
    const previous = this._known[key];
    this._saveKnown(withEntry(this._known, key, entry));
    showSnackbar({
      message,
      action: { label: this._t("net_undo"), onAction: () => this._saveKnown(withEntry(this._known, key, previous)) },
    });
  }

  private _entryFor(row: Row): KnownEntry {
    return this._known[row.device.key] ?? { first: this._now, last: row.device.online ? this._now : undefined, known: false, ip: row.device.ip, host: row.device.host };
  }

  private _label(row: Row): string {
    return row.name ?? this._t("net_unknown");
  }

  private _markKnown(row: Row): void {
    this._setEntry(row, { ...this._entryFor(row), known: true }, this._t("net_marked_known").replace("{name}", this._label(row)));
  }

  private _rename(row: Row, name: string, icon: string): void {
    const e = { ...this._entryFor(row), known: true, name: name || undefined, icon: icon || undefined };
    this._setEntry(row, e, this._t("net_renamed").replace("{name}", name || this._label(row)));
  }

  private _forget(row: Row): void {
    this._setEntry(row, { ...this._entryFor(row), known: false, notified: true }, this._t("net_unknown_again").replace("{name}", this._label(row)));
  }

  private _ignore(row: Row): void {
    const e = this._entryFor(row);
    this._setEntry(row, { ...e, ignored: !e.ignored }, this._t("net_ignored").replace("{name}", this._label(row)));
  }

  private _openSheet(row: Row, opener: HTMLElement, rename = false): void {
    const sheet = this.renderRoot.querySelector<M3NetworkSheet>("m3-network-sheet");
    if (!sheet) return;
    if (!rename && row.device.entity && this._config?.detail_mode === "more_info") {
      openEntityDetail(this, row.device.entity);
      return;
    }
    const e = this._known[row.device.key];
    const d = row.device;
    const facts: NetSheetFact[] = [];
    if (d.ip) facts.push({ label: this._t("net_d_ip"), value: d.ip, mono: true });
    if (d.mac) facts.push({ label: this._t("net_d_mac"), value: d.mac + (d.randomMac ? ` · ${this._t("net_private")}` : ""), mono: true });
    if (d.manufacturer) facts.push({ label: this._t("net_d_maker"), value: d.manufacturer });
    facts.push({ label: this._t("net_d_connection"), value: this._connectionText(row) || "–" });
    if (e?.first) facts.push({ label: this._t("net_d_first"), value: this._dateTime(e.first) });
    facts.push({ label: this._t("net_d_last"), value: d.online ? this._t("net_d_now") : row.lastSeen ? this._dateTime(row.lastSeen) : "–" });
    const tone = this._tone(row);
    sheet.view = {
      title: this._label(row),
      icon: row.icon,
      tint: `--ns-icon-bg: ${tintOn(this, tone, undefined, 22)}; --ns-icon-fg: ${foregroundOn(tone, tintOn(this, tone, undefined, 22), 3, this)};`,
      facts,
      name: e?.name ?? row.name ?? "",
      iconValue: e?.icon ?? "",
      isNew: row.isNew,
      isKnown: !!e?.known,
      ignored: !!e?.ignored,
    };
    sheet.labels = {
      close: this._t("net_d_close"),
      name: this._t("net_d_name"),
      icon: this._t("net_d_icon"),
      save: this._t("net_d_save"),
      cancel: this._t("net_d_cancel"),
      rename: this._t("net_name_it"),
      known: this._t("net_known"),
      forget: this._t("net_d_forget"),
      ignore: this._t("net_d_ignore"),
      unignore: this._t("net_d_unignore"),
    };
    sheet.onSave = (name, icon) => this._rename(row, name, icon);
    sheet.onKnown = () => this._markKnown(row);
    sheet.onForget = () => this._forget(row);
    sheet.onIgnore = () => this._ignore(row);
    sheet.glass = this._config?.glass_background !== false;
    sheet.animated = this._animate;
    sheet.open(opener, rename);
  }

  // ---- text ---------------------------------------------------------------------------

  private _duration(since: number): string {
    const minutes = Math.max(0, Math.floor((this._now - since) / 60_000));
    if (minutes < 60) return this._t("net_dur_minutes").replace("{n}", String(Math.max(1, minutes)));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this._t("net_dur_hours").replace("{n}", String(hours));
    const days = Math.floor(hours / 24);
    return days === 1 ? this._t("net_dur_day") : this._t("net_dur_days").replace("{n}", String(days));
  }

  private _dateTime(ms: number): string {
    return new Intl.DateTimeFormat(this._language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  }

  private _connectionText(row: Row): string {
    const d = row.device;
    if (!d.online) return row.lastSeen ? this._t("net_offline_since").replace("{t}", this._duration(row.lastSeen)) : this._t("net_f_offline");
    if (d.connection === "wired") return this._t("net_lan");
    if (d.connection === "wireless") return [this._t("net_wireless"), d.band, d.ssid, d.signal !== undefined ? `${d.signal} dBm` : undefined].filter(Boolean).join(" · ");
    return "";
  }

  private _problemText(p: Problem): string {
    switch (p.kind) {
      case "weak":
        return this._t("net_p_weak");
      case "reconnects":
        return this._t("net_p_reconnects").replace("{n}", p.detail ?? "");
      case "ip_conflict":
        return this._t("net_p_ip_conflict");
      default:
        return p.detail ?? "";
    }
  }

  private _tone(row: Row): string {
    if (row.isNew) return NETWORK_NEW_COLOR;
    if (row.problems.length) return NETWORK_WARN_COLOR;
    if (!row.device.online) return "var(--secondary-text-color)";
    return this._accent();
  }

  private _accent(): string {
    const a = this._config?.accent_color;
    return a && a !== NEW_CARD_ACCENT ? resolveThemeColor(a) : NETWORK_OK_COLOR;
  }

  // ---- render ---------------------------------------------------------------------------

  private _renderBars(dbm: number | undefined): TemplateResult | typeof nothing {
    const n = signalBars(dbm);
    if (n === undefined) return nothing;
    const cls = n >= 3 ? "good" : n === 2 ? "fair" : "weak";
    return html`<span class="bars ${cls}" role="img" aria-label=${this._t("net_bars").replace("{n}", String(n))}>
      ${[1, 2, 3, 4].map((i) => html`<i class=${i <= n ? "on" : ""} style=${`height: ${3 + i * 2.5}px;`}></i>`)}
    </span>`;
  }

  private _renderSub(row: Row): TemplateResult {
    const d = row.device;
    const parts: (TemplateResult | string)[] = [];
    if (d.ip) parts.push(html`<span class="ip">${d.ip}</span>`);
    if (row.isNew && row.firstSeen) {
      parts.push(html`<span class="new-text">${this._t("net_new_ago").replace("{t}", this._duration(row.firstSeen))}</span>`);
    } else {
      if (row.problems.length) {
        const first = this._problemText(row.problems[0]);
        const more = row.problems.length > 1 ? ` ${this._t("net_p_more").replace("{n}", String(row.problems.length - 1))}` : "";
        parts.push(html`<span class="problem-text">${first}${more}</span>`);
      }
      if (!d.online) parts.push(html`<span>${this._connectionText(row)}</span>`);
      else if (d.connection === "wired") parts.push(html`<span class="conn"><ha-icon icon="mdi:ethernet"></ha-icon>${this._t("net_lan")}</span>`);
      else if (d.connection === "wireless") parts.push(html`<span class="conn">${this._renderBars(d.signal)}${d.band ?? this._t("net_wireless")}</span>`);
    }
    if (d.randomMac && !row.isNew) parts.push(html`<span class="private">${this._t("net_private")}</span>`);
    return html`${parts.map((p, i) => html`${i ? html`<span class="sep">·</span>` : nothing}${p}`)}`;
  }

  private _renderRow(row: Row, cls: string): TemplateResult {
    const d = row.device;
    const state = row.isNew ? "new" : row.problems.length ? "problem" : d.online ? "online" : "offline";
    const label = `${this._label(row)}${d.ip ? `, ${d.ip}` : ""}`;
    return html`
      <div
        class="row ${state} ${cls}"
        data-row-key=${d.key}
        role="button"
        tabindex="0"
        aria-label=${label}
        @click=${(e: Event) => this._openSheet(row, e.currentTarget as HTMLElement)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._openSheet(row, e.currentTarget as HTMLElement);
          }
        }}
      >
        <div class="ricon">
          <ha-icon icon=${row.icon}></ha-icon>
          ${state === "online" ? nothing : html`<span class="badge"></span>`}
        </div>
        <div class="rtext">
          <div class="rname">${this._label(row)}</div>
          <div class="rsub">${this._renderSub(row)}</div>
        </div>
        ${row.isNew
          ? row.name
            ? html`<button class="act" @click=${(e: Event) => { e.stopPropagation(); this._markKnown(row); }}>${this._t("net_known")}</button>`
            : html`<button class="act" @click=${(e: Event) => { e.stopPropagation(); this._openSheet(row, e.currentTarget as HTMLElement, true); }}>${this._t("net_name_it")}</button>`
          : row.fixedIp
            ? html`<ha-icon class="pin" icon="mdi:pin-outline" title=${this._t("net_fixed_ip")}></ha-icon>`
            : nothing}
      </div>
    `;
  }

  protected render() {
    const cfg = this._config;
    const hass = this.hass;
    if (!cfg || !hass) return nothing;

    const rows = this._rows();
    const counts = countFilters(rows);
    const filter = this._filter !== "all" && counts[this._filter] === 0 ? "all" : this._filter;
    const searching = this._query.trim() !== "";
    const showOffline = cfg.show_offline === true;
    const listed = rows.filter((r) => matchesSearch(r, this._query) && (filter === "all" ? r.device.online || showOffline || searching : matchesFilter(r, filter)));
    const maxItems = cfg.max_items ?? DEFAULT_NETWORK_MAX_ITEMS;
    const limited = filter === "all" && !searching && !this._showAll && maxItems > 0;
    const shown = limited ? listed.slice(0, maxItems) : listed;
    const hidden = listed.length - shown.length;

    const router = this._router();
    const onlineCount = counts.all;
    const newCount = counts.new;
    const problemCount = counts.problems;
    const routerOffline = router?.online === false;
    const noSource = !cfg.device_trackers?.length && !cfg.integrations?.length && !cfg.clients_entity;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const ok = this._accent();
    const head = routerOffline ? NETWORK_BAD_COLOR : ok;
    const headBg = tintOn(this, head, undefined, 22);
    const newBg = tintOn(this, NETWORK_NEW_COLOR, undefined, 20);
    const warnBg = tintOn(this, NETWORK_WARN_COLOR, undefined, 20);
    const cssVars = buildCssVars({
      "nw-text": textColorCss,
      "nw-secondary": secondaryTextColorCss,
      "nw-head-bg": headBg,
      "nw-head-fg": foregroundOn(head, headBg, 3, this),
      "nw-hero": foregroundColor(this, ok),
      "nw-new": NETWORK_NEW_COLOR,
      "nw-new-bg": newBg,
      "nw-new-fg": foregroundOn(NETWORK_NEW_COLOR, newBg, 4.5, this),
      "nw-new-text": foregroundColor(this, NETWORK_NEW_COLOR),
      "nw-warn": NETWORK_WARN_COLOR,
      "nw-warn-bg": warnBg,
      "nw-warn-fg": foregroundOn(NETWORK_WARN_COLOR, warnBg, 4.5, this),
      "nw-warn-text": foregroundColor(this, NETWORK_WARN_COLOR),
      "nw-bad": NETWORK_BAD_COLOR,
      "nw-ok": ok,
      "nw-ok-text": foregroundColor(this, ok),
      "nw-row-h": `${NETWORK_ROW_HEIGHT}px`,
      "nw-row-r": `${AVAILABILITY_ROW_RADIUS}px`,
      "nw-row-r-in": `${Math.round(AVAILABILITY_ROW_RADIUS_ACTIVE / 2)}px`,
      "nw-icon": `${NETWORK_ICON_SIZE}px`,
      "nw-icon-r": `${NETWORK_ICON_RADIUS}px`,
      "nw-head-icon": `${AVAILABILITY_HEADER_ICON}px`,
      "nw-head-r": `${AVAILABILITY_HEADER_RADIUS}px`,
      "nw-gap": `${AVAILABILITY_ROW_GAP / 2}px`,
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_NETWORK_RADIUS, cfg.corners);
    const title = cfg.router?.name || cfg.title || this._t("net_title");
    const subtitle = routerOffline
      ? this._t("net_router_offline")
      : [router?.connection, router?.since ? this._t("net_online_since").replace("{t}", this._duration(router.since)) : undefined].filter(Boolean).join(" · ");

    const tiles: TemplateResult[] = [];
    if (router?.down) tiles.push(html`<div class="tile"><div class="tlabel"><ha-icon icon="mdi:arrow-down"></ha-icon>${this._t("net_download")}</div><div class="tvalue">${router.down.value}<span class="tunit"> ${router.down.unit}</span></div></div>`);
    if (router?.up) tiles.push(html`<div class="tile"><div class="tlabel"><ha-icon icon="mdi:arrow-up"></ha-icon>${this._t("net_upload")}</div><div class="tvalue">${router.up.value}<span class="tunit"> ${router.up.unit}</span></div></div>`);
    if (router?.signal)
      tiles.push(html`<div class="tile"><div class="tlabel"><ha-icon icon="mdi:signal"></ha-icon>${this._t("net_signal")}</div><div class="tvalue q-${router.signal.quality}">${router.signal.quality ? this._t(`net_q_${router.signal.quality}` as TranslationKey) : ""}<span class="tunit"> ${formatNumber(this._language, router.signal.value, { maximumFractionDigits: 0 })} dBm</span></div></div>`);

    const hint =
      newCount > 0
        ? { kind: "new", icon: "mdi:creation-outline", title: newCount === 1 ? this._t("net_new_title_one") : this._t("net_new_title_many").replace("{n}", String(newCount)), sub: this._t("net_new_sub"), filter: "new" as Filter }
        : problemCount > 0
          ? { kind: "problem", icon: "mdi:alert-outline", title: problemCount === 1 ? this._t("net_problem_title_one") : this._t("net_problem_title_many").replace("{n}", String(problemCount)), sub: this._t("net_problem_sub"), filter: "problems" as Filter }
          : undefined;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${this._animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="header">
            <div class="head-icon"><ha-icon icon=${routerOffline ? "mdi:router-wireless-off" : cfg.icon || DEFAULT_NETWORK_ICON}></ha-icon></div>
            <div class="head-text">
              <div class="title">${title}</div>
              ${subtitle ? html`<div class="subtitle">${subtitle}</div>` : nothing}
            </div>
            ${noSource
              ? nothing
              : html`<div class="hero" aria-label=${`${onlineCount} ${this._t("net_devices")} ${this._t("net_online")}`}>
                  <div class="hero-line"><span class="hero-n">${onlineCount}</span><span class="hero-unit">${this._t("net_devices")}</span></div>
                  <div class="hero-of">${this._t("net_online")}</div>
                </div>`}
          </div>

          ${tiles.length ? html`<div class="tiles" style=${`grid-template-columns: repeat(${tiles.length}, minmax(0, 1fr));`}>${tiles}</div>` : nothing}
          ${router?.dataUsed ? html`<div class="chips-row"><span class="info-chip"><ha-icon icon="mdi:chart-donut"></ha-icon>${this._t("net_data_used")} ${router.dataUsed}</span></div>` : nothing}

          <div class="hint-slot" aria-live="polite">
            ${hint
              ? html`<button class="hint ${hint.kind}" @click=${() => { this._filter = hint.filter; this._showAll = false; }}>
                  <ha-icon class="hint-icon" icon=${hint.icon}></ha-icon>
                  <span class="hint-text"><span class="hint-title">${hint.title}</span><span class="hint-sub">${hint.sub}</span></span>
                  <ha-icon class="hint-chev" icon="mdi:chevron-right"></ha-icon>
                </button>`
              : nothing}
          </div>

          ${noSource
            ? html`<div class="empty">${this._t("net_no_source")}</div>`
            : html`
                ${cfg.show_search !== false
                  ? html`<label class="search">
                      <ha-icon icon="mdi:magnify"></ha-icon>
                      <input
                        type="search"
                        .value=${this._query}
                        placeholder=${this._t("net_search")}
                        aria-label=${this._t("net_search")}
                        @input=${(e: Event) => (this._query = (e.target as HTMLInputElement).value)}
                      />
                      ${this._query
                        ? html`<button class="clear" aria-label=${this._t("net_clear_search")} @click=${() => (this._query = "")}><ha-icon icon="mdi:close"></ha-icon></button>`
                        : nothing}
                    </label>`
                  : nothing}
                ${cfg.show_filters !== false
                  ? html`<div class="chips" role="tablist">
                      ${FILTERS.filter((f) => f === "all" || counts[f] > 0).map(
                        (f) => html`<button
                          class="chip ${filter === f ? "active" : ""}"
                          role="tab"
                          aria-selected=${filter === f ? "true" : "false"}
                          @click=${() => {
                            this._filter = f;
                            this._showAll = false;
                          }}
                        >
                          <span>${this._t(`net_f_${f}` as TranslationKey)}</span><span class="chip-n">${counts[f]}</span>
                        </button>`,
                      )}
                    </div>`
                  : nothing}
                ${shown.length
                  ? html`<div class="group-rows">
                      ${repeat(
                        shown,
                        (r) => r.device.key,
                        (r, i) => this._renderRow(r, `${i === 0 ? "first" : ""} ${i === shown.length - 1 ? "last" : ""}`),
                      )}
                    </div>`
                  : html`<div class="empty">${this._t("net_none")}</div>`}
                ${hidden > 0 || (this._showAll && filter === "all" && !searching && listed.length > maxItems && maxItems > 0)
                  ? html`<button class="more" @click=${() => (this._showAll = !this._showAll)}>
                      ${this._showAll ? this._t("net_less") : this._t("net_more").replace("{n}", String(hidden))}
                    </button>`
                  : nothing}
              `}
        </div>
      </ha-card>
      <m3-network-sheet></m3-network-sheet>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      .card-inner {
        gap: var(--m3-card-gap, 12px);
      }
      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: var(--nw-head-icon);
      }
      .head-icon {
        flex: 0 0 auto;
        width: var(--nw-head-icon);
        height: var(--nw-head-icon);
        border-radius: var(--nw-head-r);
        display: grid;
        place-items: center;
        background: var(--nw-head-bg);
        color: var(--nw-head-fg);
        --mdc-icon-size: 24px;
      }
      .head-text {
        flex: 1;
        min-width: 0;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        color: var(--nw-text, var(--primary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .subtitle {
        font-size: 13px;
        color: var(--nw-secondary, var(--secondary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hero {
        flex: 0 0 auto;
        text-align: right;
      }
      .hero-line {
        display: flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: 4px;
        color: var(--nw-hero);
      }
      .hero-n {
        font-size: 36px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.02em;
      }
      .hero-unit {
        font-size: 15px;
        font-weight: 600;
      }
      .hero-of {
        font-size: 12px;
        color: var(--nw-secondary, var(--secondary-text-color));
      }

      .tiles {
        display: grid;
        gap: 8px;
      }
      .tile {
        min-width: 0;
        padding: 10px 12px;
        border-radius: 16px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
      }
      .tlabel {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--nw-secondary, var(--secondary-text-color));
        --mdc-icon-size: 14px;
      }
      .tvalue {
        margin-top: 2px;
        font-size: 18px;
        font-weight: 700;
        color: var(--nw-text, var(--primary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-variant-numeric: tabular-nums;
      }
      .tunit {
        font-size: 12px;
        font-weight: 500;
        color: var(--nw-secondary, var(--secondary-text-color));
      }
      .tvalue.q-good {
        color: var(--nw-ok-text);
      }
      .tvalue.q-fair {
        color: var(--nw-warn-text);
      }
      .tvalue.q-weak {
        color: var(--nw-bad);
      }
      .chips-row {
        display: flex;
        gap: 8px;
      }
      .info-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px;
        border-radius: 15px;
        font-size: 13px;
        font-weight: 600;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        color: var(--nw-secondary, var(--secondary-text-color));
        --mdc-icon-size: 16px;
      }

      .hint-slot:empty {
        display: none;
      }
      .hint {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 56px;
        padding: 8px 14px;
        border: none;
        border-radius: 22px;
        font: inherit;
        text-align: left;
        cursor: pointer;
        animation: nw-in 320ms ${unsafeCSS(STANDARD_EASING)} both;
        --mdc-icon-size: 22px;
      }
      .hint.new {
        background: var(--nw-new-bg);
        color: var(--nw-new-fg);
      }
      .hint.problem {
        background: var(--nw-warn-bg);
        color: var(--nw-warn-fg);
      }
      .hint-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .hint-title {
        font-size: 15px;
        font-weight: 700;
      }
      .hint-sub {
        font-size: 13px;
        opacity: 0.85;
      }
      @keyframes nw-in {
        from {
          opacity: 0;
          transform: translateY(-6px);
        }
      }

      .search {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 6px 0 14px;
        border-radius: 22px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        color: var(--nw-secondary, var(--secondary-text-color));
        --mdc-icon-size: 20px;
      }
      .search input {
        flex: 1;
        min-width: 0;
        border: none;
        background: transparent;
        color: var(--nw-text, var(--primary-text-color));
        font: inherit;
        font-size: 15px;
        outline: none;
      }
      .search input::-webkit-search-cancel-button {
        display: none;
      }
      .search:focus-within {
        outline: 2px solid var(--primary-color);
        outline-offset: 1px;
      }
      .clear {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 16px;
        background: transparent;
        color: inherit;
        display: grid;
        place-items: center;
        cursor: pointer;
        --mdc-icon-size: 18px;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        height: 36px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 18px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        background: transparent;
        color: var(--nw-text, var(--primary-text-color));
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: border-radius 220ms ${unsafeCSS(STANDARD_EASING)}, background 220ms ease;
      }
      .chip .chip-n {
        opacity: 0.6;
      }
      .chip.active {
        border-radius: 10px;
        border-color: transparent;
        background: color-mix(in srgb, var(--primary-color) 22%, var(--ha-card-background, var(--card-background-color)));
      }

      .group-rows {
        display: flex;
        flex-direction: column;
        gap: var(--nw-gap);
      }
      .row {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: var(--nw-row-h);
        padding: 8px 8px 8px 10px;
        box-sizing: border-box;
        border-radius: var(--nw-row-r-in);
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        cursor: pointer;
        transition: border-radius 200ms ease;
        -webkit-tap-highlight-color: transparent;
      }
      .row.first {
        border-top-left-radius: var(--nw-row-r);
        border-top-right-radius: var(--nw-row-r);
      }
      .row.last {
        border-bottom-left-radius: var(--nw-row-r);
        border-bottom-right-radius: var(--nw-row-r);
      }
      .row:active {
        border-radius: var(--nw-row-r);
      }
      .row.offline {
        opacity: 0.6;
      }
      .ricon {
        position: relative;
        flex: 0 0 auto;
        width: var(--nw-icon);
        height: var(--nw-icon);
        border-radius: var(--nw-icon-r);
        display: grid;
        place-items: center;
        background: color-mix(in srgb, var(--primary-text-color) 9%, var(--ha-card-background, var(--card-background-color)));
        color: var(--nw-text, var(--primary-text-color));
        --mdc-icon-size: 22px;
      }
      .row.new .ricon {
        background: var(--nw-new-bg);
        color: var(--nw-new-fg);
      }
      .row.problem .ricon {
        background: var(--nw-warn-bg);
        color: var(--nw-warn-fg);
      }
      .badge {
        position: absolute;
        right: -3px;
        bottom: -3px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color, #1c1c1c));
        background: var(--nw-secondary, var(--secondary-text-color));
      }
      .row.new .badge {
        background: var(--nw-new);
      }
      .row.problem .badge {
        background: var(--nw-warn);
      }
      .rtext {
        flex: 1;
        min-width: 0;
      }
      .rname {
        font-size: 15px;
        font-weight: 600;
        color: var(--nw-text, var(--primary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rsub {
        display: flex;
        align-items: center;
        min-width: 0;
        font-size: 13px;
        color: var(--nw-secondary, var(--secondary-text-color));
        white-space: nowrap;
        overflow: hidden;
      }
      /* What the row is about (new, the problem) never shrinks; the IP and the
         connection give way, with an ellipsis rather than a cut. */
      .rsub > span {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rsub .sep {
        flex: 0 0 auto;
        margin: 0 5px;
      }
      .rsub .new-text,
      .rsub .problem-text,
      .rsub .ip {
        flex: 0 0 auto;
      }
      /* In a new device's row "new 12 min ago" is the news; the IP gives way. */
      .row.new .rsub .ip {
        flex: 0 1 auto;
      }
      .ip {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12.5px;
      }
      .new-text {
        color: var(--nw-new-text);
        font-weight: 600;
      }
      .problem-text {
        color: var(--nw-warn-text);
        font-weight: 600;
      }
      .private {
        font-style: italic;
      }
      .conn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        --mdc-icon-size: 14px;
      }
      .bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 1.5px;
        height: 13px;
      }
      .bars i {
        width: 3px;
        border-radius: 1px;
        background: color-mix(in srgb, var(--primary-text-color) 22%, transparent);
      }
      .bars.good i.on {
        background: var(--nw-ok);
      }
      .bars.fair i.on {
        background: var(--nw-warn);
      }
      .bars.weak i.on {
        background: var(--nw-bad);
      }
      .act {
        flex: 0 0 auto;
        height: 40px;
        padding: 0 14px;
        border-radius: 20px;
        border: none;
        background: var(--nw-new-bg);
        color: var(--nw-new-fg);
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: border-radius 200ms ease;
      }
      .act:active {
        border-radius: 12px;
      }
      .pin {
        flex: 0 0 auto;
        color: var(--nw-secondary, var(--secondary-text-color));
        --mdc-icon-size: 18px;
        margin-right: 8px;
      }
      .more {
        height: 44px;
        border-radius: 22px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        background: transparent;
        color: var(--nw-ok-text);
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
      }
      .empty {
        padding: 12px;
        text-align: center;
        font-size: 13px;
        color: var(--nw-secondary, var(--secondary-text-color));
      }
      .chip:focus-visible,
      .row:focus-visible,
      .more:focus-visible,
      .act:focus-visible,
      .hint:focus-visible,
      .clear:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }
      .no-animations .row,
      .no-animations .chip,
      .no-animations .act {
        transition: none;
      }
      .no-animations .hint {
        animation: none;
      }
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .tile,
        .search,
        .row,
        .ricon,
        .chip.active,
        .info-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-network-card": M3NetworkCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-network-card",
  name: "M3 Network Card",
  description: "The router and the devices on the network: what is new, what has problems, what is offline.",
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
