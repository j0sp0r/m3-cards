import { LitElement, html, css, unsafeCSS, nothing , type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  HassEntity,
  M3UpdatesCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  UpdateGroup,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_UPDATES_RADIUS,
  DEFAULT_UPDATES_MAX_VISIBLE,
  DEFAULT_UPDATES_NO_INSTALL,
  UPDATES_COLOR_OK,
  UPDATES_COLOR_AVAILABLE,
  UPDATES_COLOR_ADDON,
  UPDATES_COLOR_HACS,
  UPDATES_COLOR_FIRMWARE,
  UPDATES_COLOR_REMOTE,
  UPDATES_COLOR_BACKUP_WARN,
  UPDATES_COLOR_BACKUP_MISSING,
  UPDATES_CHIP_HEIGHT,
  UPDATES_CHIP_RADIUS,
  UPDATES_COMPACT_ROW_HEIGHT,
  UPDATES_COMPACT_ROW_RADIUS,
  DEFAULT_UPDATES_BACKUP_WARN_DAYS,
  UPDATES_GROUP_ORDER,
  UPDATES_ROW_HEIGHT,
  UPDATES_ROW_RADIUS,
  UPDATES_ROW_ICON_SIZE,
  UPDATES_ROW_ICON_RADIUS,
  UPDATES_TOGGLE_HEIGHT,
  UPDATES_TOGGLE_RADIUS,
  UPDATES_CORE_PADDING,
  UPDATES_CORE_RADIUS,
  UPDATES_CORE_ICON_SIZE,
  UPDATES_CORE_ICON_RADIUS,
  UPDATES_BUTTON_SIZE,
  UPDATES_BUTTON_RADIUS,
  UPDATES_BUTTON_RADIUS_BUSY,
  UPDATES_PROGRESS_HEIGHT,
  UPDATES_CONFIRM_TIMEOUT_MS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, tintInk, foregroundOn , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { activateOnKey } from "./shared/a11y";
import { localize, type TranslationKey } from "./localize";
import { discoveryChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-UPDATES-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

interface UpdateRow {
  entity: string;
  name: string;
  group: UpdateGroup;
  installed?: string;
  latest?: string;
  pending: boolean;
  inProgress: boolean;
  percentage?: number;
  autoUpdate: boolean;
  picture?: string;
  skipped: boolean;
}

// Which registry platform an update entity comes from is a far more reliable
// signal than its entity_id: a mirrored second instance exposes entities named
// exactly like the local ones (home_assistant_core_update_2), so matching on
// "home_assistant_core" alone would render two indistinguishable core boxes.
const PLATFORM_GROUPS: Record<string, UpdateGroup> = {
  hacs: "hacs",
  remote_homeassistant: "remote",
};

const CORE_PATTERNS: [RegExp, UpdateGroup][] = [
  [/home_?assistant_core/, "core"],
  [/operating_system/, "os"],
  [/supervisor/, "supervisor"],
];

const GROUP_ICONS: Record<UpdateGroup, string> = {
  core: "mdi:home-assistant",
  os: "mdi:harddisk",
  supervisor: "mdi:server-network",
  addon: "mdi:puzzle-outline",
  hacs: "mdi:storefront-outline",
  firmware: "mdi:chip",
  remote: "mdi:lan-connect",
  other: "mdi:package-variant",
};

// The three components that make up Home Assistant itself. They get their own
// boxes with a version jump and an install button; everything else is a row.
const CORE_GROUPS = new Set<UpdateGroup>(["core", "os", "supervisor"]);

// Home Assistant ships calendar versions (2026.8.1), most add-ons and HACS
// repos ship SemVer. A leading four-digit number that looks like a year is the
// only reliable way to tell them apart, and it decides which position counts
// as "the big jump": year/month for calendar, the first number for SemVer.
function versionParts(version: string): number[] {
  return version
    .split(/[.\-+_]/)
    .map((part) => parseInt(part, 10))
    .filter((n) => Number.isFinite(n));
}

function isMajorJump(installed?: string, latest?: string): boolean {
  if (!installed || !latest) return false;
  const a = versionParts(installed);
  const b = versionParts(latest);
  if (!a.length || !b.length) return false;
  const calendar = a[0] >= 2000 && a[0] <= 2100 && b[0] >= 2000 && b[0] <= 2100;
  if (calendar) return a[0] !== b[0] || (a[1] ?? 0) !== (b[1] ?? 0);
  return a[0] !== b[0];
}

const GROUP_LABELS: Record<UpdateGroup, TranslationKey> = {
  core: "updates_group_core",
  os: "updates_group_os",
  supervisor: "updates_group_supervisor",
  addon: "updates_group_addon",
  hacs: "updates_group_hacs",
  firmware: "updates_group_firmware",
  remote: "updates_group_remote",
  other: "updates_group_other",
};

// `friendly_name` on an update entity reads "M3 Cards Update", repeating the
// word the card already says in its own heading. Add-ons and integrations
// carry a clean `title`; HACS entities do not, so there the suffix is trimmed.
// Kept in step with the notification template in the editor.
function updateName(attrs: Record<string, any>, id: string): string {
  const friendly: string | undefined = attrs.friendly_name;
  return attrs.title || friendly?.replace(/ Update$/, "") || friendly || id;
}

@customElement("m3-updates-card")
export class M3UpdatesCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3UpdatesCardConfig;
  @state() private _expanded = false;
  @state() private _expandedOk = false;
  @state() private _expandedOff = false;
  @state() private _platforms: Record<string, string> = {};
  /** Entity whose install button is currently asking "are you sure?". */
  @state() private _confirming?: string;
  /**
   * Entities Home Assistant restored from the registry but never got a value
   * for — a disconnected remote instance, an offline device. Kept as rows so
   * they can be listed on demand, not just counted.
   */
  private _unavailableRows: UpdateRow[] = [];
  private _confirmTimer?: number;
  /**
   * Name of the update that was installing when the connection was last up.
   * A core update restarts Home Assistant, so the websocket drops mid-install
   * and the card would otherwise just freeze on a stale banner.
   */
  private _lastRunning?: string;

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._confirmTimer) window.clearTimeout(this._confirmTimer);
  }

  public setConfig(config: M3UpdatesCardConfig): void {
    this._config = {
      auto_discover: true,
      max_visible: DEFAULT_UPDATES_MAX_VISIBLE,
      show_uptodate: true,
      show_skipped: true,
      show_release_notes: true,
      require_confirm: true,
      ...config,
    };
    this._loadPlatforms();
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-updates-card-editor");
    return document.createElement("m3-updates-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): Partial<M3UpdatesCardConfig> {
    return { auto_discover: true };
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", min_rows: 3 };
  }

  // The registry is only needed for the platform → group mapping, so it's
  // fetched once rather than on every render.
  private async _loadPlatforms(): Promise<void> {
    if (!this.hass || Object.keys(this._platforms).length) return;
    try {
      const reg = await this.hass.callWS<Array<{ entity_id: string; platform: string }>>({
        type: "config/entity_registry/list",
      });
      const map: Record<string, string> = {};
      for (const e of reg) if (e.entity_id.startsWith("update.")) map[e.entity_id] = e.platform;
      this._platforms = map;
    } catch {
      this._platforms = {}; // fall back to entity_id patterns below
    }
  }

  protected updated(): void {
    if (this.hass && !Object.keys(this._platforms).length) this._loadPlatforms();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _groupFor(entityId: string, st: HassEntity): UpdateGroup {
    for (const [needle, group] of Object.entries(this._config?.type_patterns ?? {})) {
      if (entityId.includes(needle)) return group;
    }
    const platform = this._platforms[entityId];
    const mapped = platform ? PLATFORM_GROUPS[platform] : undefined;
    if (mapped) return mapped;
    if (platform === "hassio" || !platform) {
      for (const [re, group] of CORE_PATTERNS) if (re.test(entityId)) return group;
      if (platform === "hassio") return "addon";
    }
    // Everything else that isn't the supervisor or HACS is device firmware —
    // including integrations that never set device_class (e.g. tapo_control).
    if (platform) return "firmware";
    return st.attributes.device_class === "firmware" ? "firmware" : "other";
  }

  private _groupOrder(): UpdateGroup[] {
    const custom = this._config?.group_order ?? [];
    const rest = UPDATES_GROUP_ORDER.filter((g) => !custom.includes(g));
    return [...custom, ...rest] as UpdateGroup[];
  }

  /** Entity ids the last render read. Not reactive: writing it must not
   * schedule another render. */
  private _watchedIds: string[] = [];

  private _buildRows(): UpdateRow[] {
    if (!this.hass || !this._config) return [];
    const cfg = this._config;
    const excluded = new Set(cfg.exclude_entities ?? []);
    const ids = cfg.auto_discover
      ? Object.keys(this.hass.states).filter((id) => id.startsWith("update.") && !excluded.has(id))
      : (cfg.entities ?? []).filter((id) => !excluded.has(id));
    this._watchedIds = ids;

    const include = cfg.include_types?.length ? new Set(cfg.include_types) : undefined;
    const rows: UpdateRow[] = [];
    this._unavailableRows = [];
    for (const id of ids) {
      const st = this.hass.states[id];
      if (!st) continue;
      // A restored entity is one HA could not reach on startup: no version, no
      // name, no state. Counting those as "watched" would overstate coverage,
      // and listing them would add nameless rows, so they are surfaced as a
      // note instead.
      if (st.attributes.restored || st.state === "unavailable" || st.state === "unknown") {
        // No title and no friendly_name is normal here — the integration never
        // reported one — so the entity_id is the only usable label.
        this._unavailableRows.push({
          entity: id,
          name: updateName(st.attributes, id),
          group: this._groupFor(id, st),
          pending: false,
          inProgress: false,
          autoUpdate: false,
          skipped: false,
        });
        continue;
      }
      const group = this._groupFor(id, st);
      if (include && !include.has(group)) continue;
      const a = st.attributes;
      rows.push({
        entity: id,
        name: updateName(a, id),
        group,
        installed: a.installed_version,
        latest: a.latest_version,
        pending: st.state === "on",
        inProgress: !!a.in_progress,
        percentage: typeof a.update_percentage === "number" ? a.update_percentage : undefined,
        autoUpdate: !!a.auto_update,
        picture: a.entity_picture,
        skipped: st.state === "off" && !!a.skipped_version,
      });
    }

    const order = this._groupOrder();
    return rows.sort((x, y) => {
      const d = order.indexOf(x.group) - order.indexOf(y.group);
      return d !== 0 ? d : x.name.localeCompare(y.name);
    });
  }

  private _installAllowed(group: UpdateGroup): boolean {
    const blocked = this._config?.no_install_types ?? DEFAULT_UPDATES_NO_INSTALL;
    return !blocked.includes(group);
  }

  private _moreInfo(entityId: string): () => void {
    return () => fireEvent(this, "hass-more-info", { entityId });
  }

  // A core update reboots the instance, so by default the button asks once
  // before firing. The armed state resets itself — a stray tap must not leave
  // a one-tap-installs-Home-Assistant button sitting on the dashboard.
  private _install(row: UpdateRow): void {
    if (!this.hass) return;
    if ((this._config?.require_confirm ?? true) && this._confirming !== row.entity) {
      this._confirming = row.entity;
      if (this._confirmTimer) window.clearTimeout(this._confirmTimer);
      this._confirmTimer = window.setTimeout(() => {
        this._confirming = undefined;
      }, UPDATES_CONFIRM_TIMEOUT_MS);
      return;
    }
    if (this._confirmTimer) window.clearTimeout(this._confirmTimer);
    this._confirming = undefined;
    this.hass.callService("update", "install", {}, { entity_id: row.entity });
  }

  // HA's own more-info dialog renders release_summary and release_url, so the
  // version line just opens it rather than shipping a second changelog view.
  private _openReleaseNotes(entityId: string): void {
    if (this._config?.show_release_notes === false) return;
    fireEvent(this, "hass-more-info", { entityId });
  }

  private _releaseNotesClick(entityId: string): (e: Event) => void {
    return (e: Event) => {
      e.stopPropagation();
      this._openReleaseNotes(entityId);
    };
  }

  private _groupColor(group: UpdateGroup): string {
    const c = this._config;
    switch (group) {
      case "addon":
        return c?.addon_color ? resolveThemeColor(c.addon_color) : UPDATES_COLOR_ADDON;
      case "hacs":
        return c?.hacs_color ? resolveThemeColor(c.hacs_color) : UPDATES_COLOR_HACS;
      case "firmware":
        return c?.firmware_color ? resolveThemeColor(c.firmware_color) : UPDATES_COLOR_FIRMWARE;
      case "remote":
        return c?.remote_color ? resolveThemeColor(c.remote_color) : UPDATES_COLOR_REMOTE;
      default:
        return c?.update_color ? resolveThemeColor(c.update_color) : UPDATES_COLOR_AVAILABLE;
    }
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    // Recorded during the last render rather than recomputed here: in
    // auto_discover mode the list comes from scanning every entity id, and
    // doing that on each hass tick would cost more than the render it saves.
    // discoveryChangeMatters still lets a change in the entity count through,
    // which is what brings a newly added update entity into the list.
    return discoveryChangeMatters(changed, this.hass, this._watchedIds);
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const rows = this._buildRows();
    const pending = rows.filter((r) => r.pending && !r.skipped);
    const running = pending.find((r) => r.inProgress);
    const skipped = rows.filter((r) => r.skipped);
    // A skipped update is still an update, so it belongs neither in the
    // pending list nor in the "up to date" count.
    const upToDate = rows.filter((r) => !r.pending && !r.skipped);

    const okColor = this._config.ok_color ? resolveThemeColor(this._config.ok_color) : UPDATES_COLOR_OK;
    const updColor = this._config.update_color
      ? resolveThemeColor(this._config.update_color)
      : UPDATES_COLOR_AVAILABLE;
    const statusColor = running ? updColor : pending.length ? updColor : okColor;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_UPDATES_RADIUS, this._config.corners);
    const animClass = shouldAnimate(this._config.animation) ? "" : "no-animations";

    // Core, OS and Supervisor get their own boxes above the list, so they must
    // not also appear as rows — and max_visible only limits the rest.
    const corePending = pending.filter((r) => CORE_GROUPS.has(r.group));
    const restPending = pending.filter((r) => !CORE_GROUPS.has(r.group));
    const maxVisible = this._config.max_visible ?? DEFAULT_UPDATES_MAX_VISIBLE;
    const visible = maxVisible > 0 ? restPending.slice(0, maxVisible) : restPending;
    const overflow = maxVisible > 0 ? restPending.slice(maxVisible) : [];

    // Losing the connection during a core update is the expected course of
    // events, not an error — say so instead of showing a frozen banner.
    const offline = this.hass.connected === false;
    if (!offline) this._lastRunning = running?.name;
    const installingOffline = offline && this._lastRunning;

    const title = installingOffline
      ? this._t("updates_status_offline").replace("{name}", this._lastRunning as string)
      : running
      ? this._t("updates_status_running").replace("{name}", running.name)
      : pending.length
        ? this._t(pending.length === 1 ? "updates_status_one" : "updates_status_many").replace(
            "{n}",
            String(pending.length),
          )
        : this._t("updates_status_ok");

    const statusIcon = installingOffline
      ? "mdi:lan-disconnect"
      : running
        ? "mdi:progress-download"
        : pending.length
          ? "mdi:package-up"
          : "mdi:check-circle-outline";

    // Same header grammar as the other list cards: the card's own name on the
    // left with the status as subtitle, counters on the right.
    const backupChip = this._renderBackupChip();
    const countChip = pending.length
      ? html`<div class="count-chip">
          <ha-icon icon="mdi:package-up"></ha-icon>
          <span>${pending.length}</span>
        </div>`
      : nothing;
    const headerChips =
      backupChip === nothing && countChip === nothing
        ? undefined
        : html`<div class="header-chips">${backupChip}${countChip}</div>`;

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, statusColor, this._config.accent_opacity, 18);
    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "m3p-icon-color": foregroundOn(statusColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "upd-status": statusColor,
      "upd-accent": updColor,
      "upd-core-bg": tintOn(this, updColor, undefined, 9),
      "upd-core-icon-bg": tintOn(this, updColor, undefined, 20),
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3p-icon-color": statusColor,
        "upd-accent": updColor,
      }),
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animClass}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon: this._config.icon ?? statusIcon,
            name: this._config.name || this._t("updates_default_name"),
            subtitle: installingOffline ? this._t("updates_offline_hint") : title,
            right: headerChips,
          })}

          ${rows.length === 0
            ? html`<div class="empty-state">${this._t("updates_empty")}</div>`
            : nothing}

          ${corePending.length
            ? html`<div class="core-list">
                ${repeat(corePending, (r) => r.entity, (r) => this._renderCoreBox(r))}
              </div>`
            : nothing}

          ${visible.length
            ? html`<div class="row-list">
                ${repeat(visible, (r) => r.entity, (r) => this._renderRow(r))}
              </div>`
            : nothing}

          ${overflow.length
            ? html`
                <button
                  class="toggle accent-toggle ${this._expanded ? "open" : ""}"
                  @click=${() => (this._expanded = !this._expanded)}
                >
                  <ha-icon icon="mdi:package-up"></ha-icon>
                  <span>
                    ${overflow.length}
                    ${this._expanded
                      ? this._t(overflow.length === 1 ? "updates_hide_more_one" : "updates_hide_more")
                      : this._t(overflow.length === 1 ? "updates_show_more_one" : "updates_show_more")}
                  </span>
                  <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
                </button>
                ${this._expanded
                  ? html`<div class="row-list">
                      ${repeat(overflow, (r) => r.entity, (r) => this._renderRow(r))}
                    </div>`
                  : nothing}
              `
            : nothing}

          ${this._config.show_skipped !== false && skipped.length
            ? html`<div class="row-list skipped-list">
                ${repeat(skipped, (r) => r.entity, (r) => this._renderRow(r, true))}
              </div>`
            : nothing}

          ${this._config.show_uptodate !== false && upToDate.length
            ? html`
                <button
                  class="toggle uptodate-toggle ${this._expandedOk ? "open" : ""}"
                  @click=${() => (this._expandedOk = !this._expandedOk)}
                >
                  <ha-icon class="ok-check" icon="mdi:check-circle-outline"></ha-icon>
                  <span>${this._t("updates_uptodate").replace("{n}", String(upToDate.length))}</span>
                  <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
                </button>
                ${this._expandedOk
                  ? html`<div class="compact-list">
                      ${repeat(upToDate, (r) => r.entity, (r) => this._renderCompactRow(r))}
                    </div>`
                  : nothing}
              `
            : nothing}

          ${this._unavailableRows.length
            ? html`
                <button
                  class="note-pill ${this._expandedOff ? "open" : ""}"
                  @click=${() => (this._expandedOff = !this._expandedOff)}
                >
                  <ha-icon icon="mdi:cloud-off-outline"></ha-icon>
                  <span>
                    ${this._t("updates_unavailable").replace("{n}", String(this._unavailableRows.length))}
                  </span>
                  <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
                </button>
                ${this._expandedOff
                  ? html`<div class="compact-list">
                      ${repeat(
                        this._unavailableRows,
                        (r) => r.entity,
                        (r) => this._renderUnavailableRow(r),
                      )}
                    </div>`
                  : nothing}
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  // The backup entity is a timestamp sensor (the backup integration's
  // "last successful automatic backup"), so its state is parsed as a date
  // rather than read as a number.
  private _backupAgeDays(): number | undefined {
    const id = this._config?.backup_entity;
    const st = id ? this.hass?.states[id] : undefined;
    if (!st || st.state === "unknown" || st.state === "unavailable") return undefined;
    const date = new Date(st.state);
    if (Number.isNaN(date.getTime())) return undefined;
    return Math.floor((Date.now() - date.getTime()) / 86400000);
  }

  private _renderBackupChip() {
    if (!this._config?.backup_entity) return nothing;
    const days = this._backupAgeDays();
    const warnDays = this._config.backup_warn_days ?? DEFAULT_UPDATES_BACKUP_WARN_DAYS;
    if (days === undefined) {
      return html`<div
        class="backup-chip"
        style=${`background: ${tintOn(this, UPDATES_COLOR_BACKUP_MISSING, undefined, 20)}; color: ${tintInk(this, UPDATES_COLOR_BACKUP_MISSING, undefined, 20)};`}
        @click=${this._moreInfo(this._config.backup_entity)}
      >
        <ha-icon icon="mdi:backup-restore"></ha-icon>
        <span>${this._t("updates_backup_missing")}</span>
      </div>`;
    }
    const color = days > warnDays ? UPDATES_COLOR_BACKUP_WARN : UPDATES_COLOR_OK;
    const age =
      days <= 0
        ? this._t("updates_backup_today")
        : days === 1
          ? this._t("updates_backup_yesterday")
          : this._t("updates_backup_days_ago").replace("{n}", String(days));
    return html`<div
      class="backup-chip"
      style=${`background: ${tintOn(this, color, undefined, 20)}; color: ${tintInk(this, color, undefined, 20)};`}
      @click=${this._moreInfo(this._config.backup_entity)}
    >
      <ha-icon icon="mdi:backup-restore"></ha-icon>
      <span>${this._t("updates_backup").replace("{age}", age)}</span>
    </div>`;
  }

  // Un-skipping is a separate button rather than a whole-row tap: the row's
  // tap target already means "open more-info" everywhere else in this card,
  // and silently repurposing it here would be a trap.
  private _clearSkipped(entityId: string): (e: Event) => void {
    return (e: Event) => {
      e.stopPropagation();
      this.hass?.callService("update", "clear_skipped", {}, { entity_id: entityId });
    };
  }

  private _renderCompactRow(row: UpdateRow) {
    return html`
      <div
        class="compact-row"
        role="button"
        tabindex="0"
        title=${row.name}
        @click=${this._moreInfo(row.entity)}
        @keydown=${activateOnKey(this._moreInfo(row.entity))}
      >
        <ha-icon class="ok-check" icon="mdi:check"></ha-icon>
        <span class="compact-name">${row.name}</span>
        <span class="compact-version">${row.installed ?? ""}</span>
      </div>
    `;
  }

  private _renderUnavailableRow(row: UpdateRow) {
    return html`
      <div
        class="compact-row unreachable"
        role="button"
        tabindex="0"
        title=${row.entity}
        @click=${this._moreInfo(row.entity)}
        @keydown=${activateOnKey(this._moreInfo(row.entity))}
      >
        <ha-icon class="off-icon" icon="mdi:cloud-off-outline"></ha-icon>
        <span class="compact-name">${row.name}</span>
        <span class="compact-version">${this._t(GROUP_LABELS[row.group])}</span>
      </div>
    `;
  }

  private _renderCoreBox(row: UpdateRow) {
    const major = isMajorJump(row.installed, row.latest);
    const readOnly = !this._installAllowed(row.group);
    const armed = this._confirming === row.entity;
    const percent = row.percentage;
    const notes = this._config?.show_release_notes !== false;
    return html`
      <div class="core-box">
        <div class="core-icon">
          <ha-icon icon=${GROUP_ICONS[row.group]}></ha-icon>
        </div>
        <div class="core-text">
          <div class="core-title">
            ${this._t(GROUP_LABELS[row.group])}
            ${row.autoUpdate
              ? html`<ha-icon class="auto" icon="mdi:autorenew" title=${this._t("updates_auto_update")}></ha-icon>`
              : nothing}
            ${major ? html`<span class="major">${this._t("updates_major")}</span>` : nothing}
          </div>
          <div
            class="core-version ${notes ? "tappable" : ""}"
            role=${notes ? "button" : nothing}
            tabindex=${notes ? 0 : nothing}
            @click=${this._releaseNotesClick(row.entity)}
            @keydown=${activateOnKey(() => this._openReleaseNotes(row.entity))}
          >
            <span class="from">${row.installed ?? "?"}</span>
            <ha-icon class="arrow" icon="mdi:arrow-right"></ha-icon>
            <span class="to">${row.latest ?? "?"}</span>
          </div>
        </div>
        ${row.autoUpdate || readOnly
          ? nothing
          : html`
              <button
                class="core-btn ${row.inProgress ? "busy" : ""} ${armed ? "armed" : ""}"
                ?disabled=${row.inProgress}
                title=${this._t(armed ? "updates_confirm" : "updates_install")}
                @click=${() => this._install(row)}
              >
                ${row.inProgress
                  ? html`<span class="btn-label"
                      >${percent === undefined ? this._t("updates_installing") : `${Math.round(percent)} %`}</span
                    >`
                  : armed
                    ? html`<span class="btn-label">${this._t("updates_confirm")}</span>`
                    : html`<ha-icon icon="mdi:tray-arrow-down"></ha-icon>`}
              </button>
            `}
        ${row.inProgress
          ? html`<div class="core-progress">
              <div class="core-progress-fill" style=${`width: ${percent ?? 0}%;`}></div>
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderRow(row: UpdateRow, isSkipped = false) {
    const color = this._groupColor(row.group);
    const readOnly = !this._installAllowed(row.group);
    const inline = this._config?.inline_install === true && !readOnly && !row.autoUpdate && !isSkipped;
    return html`
      <div
        class="row ${isSkipped ? "skipped" : ""}"
        role="button"
        tabindex="0"
        title=${row.name}
        @click=${this._moreInfo(row.entity)}
        @keydown=${activateOnKey(this._moreInfo(row.entity))}
      >
        <div class="row-icon" style=${`background: ${tintOn(this, color, undefined, 20)}; color: ${tintInk(this, color, undefined, 20, 3)};`}>
          ${row.picture
            ? html`<img src=${row.picture} alt="" />`
            : html`<ha-icon icon=${GROUP_ICONS[row.group]}></ha-icon>`}
        </div>
        <div class="row-text">
          <div class="row-name">${row.name}</div>
          <div class="row-type">
            ${this._t(GROUP_LABELS[row.group])}
            ${row.autoUpdate ? html`· <ha-icon class="auto" icon="mdi:autorenew"></ha-icon>` : nothing}
            ${readOnly ? html`· ${this._t("updates_readonly")}` : nothing}
            ${isSkipped ? html`· ${this._t("updates_skipped")}` : nothing}
          </div>
        </div>
        <div class="row-version" style=${`color: ${color};`}>${row.latest ?? ""}</div>
        ${isSkipped
          ? html`<button
              class="row-btn"
              title=${this._t("updates_unskip")}
              @click=${this._clearSkipped(row.entity)}
            >
              <ha-icon icon="mdi:undo-variant"></ha-icon>
            </button>`
          : nothing}
        ${inline
          ? html`<button
              class="row-btn accent"
              ?disabled=${row.inProgress}
              title=${this._t("updates_install")}
              style=${`background: ${tintOn(this, color, undefined, 22)}; color: ${tintInk(this, color, undefined, 22)};`}
              @click=${(e: Event) => {
                e.stopPropagation();
                this._install(row);
              }}
            >
              ${row.inProgress
                ? html`<span class="btn-label"
                    >${row.percentage === undefined ? this._t("updates_installing") : `${Math.round(row.percentage)} %`}</span
                  >`
                : this._confirming === row.entity
                  ? html`<span class="btn-label">${this._t("updates_confirm")}</span>`
                  : html`<ha-icon icon="mdi:tray-arrow-down"></ha-icon>`}
            </button>`
          : nothing}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
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

      .header-chips {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .count-chip {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        height: ${UPDATES_CHIP_HEIGHT}px;
        padding: 0 10px;
        border-radius: ${UPDATES_CHIP_RADIUS}px;
        background: var(--m3p-icon-bg);
        color: var(--m3p-icon-color-fg, var(--m3p-icon-color));
        font-size: 13px;
        font-weight: 700;
      }

      .count-chip ha-icon {
        --mdc-icon-size: 16px;
      }

      .backup-chip {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 5px;
        height: ${UPDATES_CHIP_HEIGHT}px;
        padding: 0 10px;
        border-radius: ${UPDATES_CHIP_RADIUS}px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }

      .backup-chip ha-icon {
        --mdc-icon-size: 15px;
      }

      .core-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .core-box {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: ${UPDATES_CORE_PADDING}px;
        border-radius: ${UPDATES_CORE_RADIUS}px;
        background: var(--upd-core-bg);
        overflow: hidden;
        min-width: 0;
      }

      .core-icon {
        flex-shrink: 0;
        width: ${UPDATES_CORE_ICON_SIZE}px;
        height: ${UPDATES_CORE_ICON_SIZE}px;
        border-radius: ${UPDATES_CORE_ICON_RADIUS}px;
        background: var(--upd-core-icon-bg);
        color: var(--upd-accent-fg, var(--upd-accent));
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .core-icon ha-icon {
        --mdc-icon-size: 22px;
      }

      .core-text {
        flex: 1;
        min-width: 0;
      }

      .core-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 700;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .core-title .auto {
        --mdc-icon-size: 13px;
        opacity: 0.55;
      }

      .major {
        flex-shrink: 0;
        border-radius: 8px;
        padding: 1px 6px;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.04em;
        background: var(--upd-core-icon-bg);
        color: var(--upd-accent-fg, var(--upd-accent));
      }

      .core-version {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--m3p-secondary-text);
      }

      .core-version.tappable {
        cursor: pointer;
      }

      .core-version .from {
        opacity: 0.55;
      }

      .core-version .arrow {
        --mdc-icon-size: 13px;
        color: var(--upd-accent-fg, var(--upd-accent));
      }

      .core-version .to {
        font-weight: 700;
        color: var(--upd-accent-fg, var(--upd-accent));
      }

      .core-btn {
        flex-shrink: 0;
        min-width: ${UPDATES_BUTTON_SIZE}px;
        height: ${UPDATES_BUTTON_SIZE}px;
        padding: 0 12px;
        border: none;
        border-radius: ${UPDATES_BUTTON_RADIUS}px;
        background: var(--upd-accent);
        color: #14181c;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: border-radius 350ms ${unsafeCSS(STANDARD_EASING)};
      }

      .core-btn.armed,
      .core-btn.busy {
        border-radius: ${UPDATES_BUTTON_RADIUS_BUSY}px;
      }

      .core-btn.busy {
        cursor: default;
        opacity: 0.75;
      }

      .core-btn ha-icon {
        --mdc-icon-size: 20px;
      }

      .core-progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: ${UPDATES_PROGRESS_HEIGHT}px;
        background: color-mix(in srgb, var(--upd-accent) 20%, var(--ha-card-background, var(--card-background-color)));
      }

      .core-progress-fill {
        height: 100%;
        background: var(--upd-accent);
        transition: width 500ms ${unsafeCSS(STANDARD_EASING)};
      }

      .card-inner.no-animations .core-btn,
      .card-inner.no-animations .core-progress-fill {
        transition: none;
      }

      .row-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        height: ${UPDATES_ROW_HEIGHT}px;
        border-radius: ${UPDATES_ROW_RADIUS}px;
        padding: 0 12px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        cursor: pointer;
        min-width: 0;
      }

      .row-icon {
        flex-shrink: 0;
        width: ${UPDATES_ROW_ICON_SIZE}px;
        height: ${UPDATES_ROW_ICON_SIZE}px;
        border-radius: ${UPDATES_ROW_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .row-icon ha-icon {
        --mdc-icon-size: 18px;
      }

      .row-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .row-text {
        flex: 1;
        min-width: 0;
      }

      .row-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row-type {
        font-size: 10px;
        opacity: 0.5;
        color: var(--m3p-secondary-text);
        display: flex;
        align-items: center;
        gap: 3px;
      }

      .row-type .auto {
        --mdc-icon-size: 11px;
      }

      .row-version {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 700;
      }

      .toggle {
        width: 100%;
        height: ${UPDATES_TOGGLE_HEIGHT}px;
        border-radius: ${UPDATES_TOGGLE_RADIUS}px;
        border: none;
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: border-radius 350ms ${unsafeCSS(STANDARD_EASING)};
      }

      .toggle.accent-toggle {
        background: color-mix(in srgb, var(--upd-accent) 14%, var(--ha-card-background, var(--card-background-color)));
        color: var(--upd-accent-fg, var(--upd-accent));
      }

      .toggle ha-icon {
        --mdc-icon-size: 18px;
      }

      .toggle.open {
        border-radius: 12px;
      }

      .chevron {
        --mdc-icon-size: 18px;
        transition: transform 350ms ${unsafeCSS(STANDARD_EASING)};
      }

      .toggle.open .chevron {
        transform: rotate(180deg);
      }

      .card-inner.no-animations .toggle,
      .card-inner.no-animations .chevron {
        transition: none;
      }

      .row-list.skipped-list .row {
        opacity: 0.45;
      }

      .row-btn {
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 11px;
        background: color-mix(in srgb, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: inherit;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
      }

      .row-btn.accent {
        width: auto;
        min-width: 30px;
        padding: 0 8px;
      }

      .row-btn ha-icon {
        --mdc-icon-size: 16px;
      }

      .uptodate-toggle {
        background: color-mix(in srgb, ${unsafeCSS(UPDATES_COLOR_OK)} 14%, var(--ha-card-background, var(--card-background-color)));
        color: ${unsafeCSS(UPDATES_COLOR_OK)};
      }

      .uptodate-toggle .ok-check {
        --mdc-icon-size: 18px;
      }

      .compact-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        opacity: 0.7;
      }

      .compact-row {
        display: flex;
        align-items: center;
        gap: 8px;
        height: ${UPDATES_COMPACT_ROW_HEIGHT}px;
        border-radius: ${UPDATES_COMPACT_ROW_RADIUS}px;
        padding: 0 12px;
        background: color-mix(in srgb, var(--primary-text-color) 4%, var(--ha-card-background, var(--card-background-color)));
        cursor: pointer;
        min-width: 0;
      }

      .compact-row .ok-check {
        flex-shrink: 0;
        --mdc-icon-size: 15px;
        color: ${unsafeCSS(UPDATES_COLOR_OK)};
      }

      .compact-name {
        flex: 1;
        min-width: 0;
        font-size: 11px;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .compact-version {
        flex-shrink: 0;
        font-size: 10px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }

      .note-pill {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: ${UPDATES_COMPACT_ROW_HEIGHT}px;
        border: none;
        border-radius: ${UPDATES_TOGGLE_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 5%, var(--ha-card-background, var(--card-background-color)));
        font-size: 12px;
        font-family: inherit;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
        cursor: pointer;
        transition: border-radius 350ms ${unsafeCSS(STANDARD_EASING)};
      }

      .note-pill.open {
        border-radius: 12px;
      }

      .note-pill ha-icon {
        --mdc-icon-size: 16px;
      }

      .note-pill .chevron {
        --mdc-icon-size: 18px;
        transition: transform 350ms ${unsafeCSS(STANDARD_EASING)};
      }

      .note-pill.open .chevron {
        transform: rotate(180deg);
      }

      .card-inner.no-animations .note-pill,
      .card-inner.no-animations .note-pill .chevron {
        transition: none;
      }

      .compact-row.unreachable .off-icon {
        flex-shrink: 0;
        --mdc-icon-size: 15px;
        opacity: 0.5;
        color: var(--m3p-secondary-text);
      }

      .compact-row.unreachable {
        opacity: 0.75;
      }

      .empty-state {
        font-size: 13px;
        opacity: 0.7;
        color: var(--m3p-secondary-text);
        padding: 8px 4px;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .core-progress {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .row {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .toggle.accent-toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .row-btn {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .uptodate-toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .compact-row {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .note-pill {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-updates-card": M3UpdatesCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-updates-card",
  name: "M3 Updates Card",
  description:
    "Übersicht aller verfügbaren Updates (Core, OS, Supervisor, Add-ons, HACS, Firmware) mit Statuszeile und Install-Buttons.",
  // false: this card reads the entity registry over the websocket and scans
  // every update entity in the house. HA's card-picker preview would run
  // both just to draw a thumbnail. See m3-battery-card.ts.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
