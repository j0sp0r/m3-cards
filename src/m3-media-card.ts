import { LitElement, html, css, svg, unsafeCSS, nothing, type PropertyValues } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3MediaCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_MEDIA_RADIUS,
  DEFAULT_MEDIA_ACCENT,
  MEDIA_ARTWORK_SIZE,
  MEDIA_ARTWORK_RADIUS,
  MEDIA_PLAY_BTN_SIZE,
  MEDIA_PLAY_BTN_RADIUS_PLAYING,
  MEDIA_PLAY_BTN_RADIUS_PAUSED,
  MEDIA_PLAY_ICON_SIZE,
  MEDIA_TRANSPORT_BTN_SIZE,
  MEDIA_TRANSPORT_BTN_RADIUS,
  MEDIA_TRANSPORT_ICON_SIZE,
  MEDIA_PILL_BTN_SIZE,
  MEDIA_PILL_BTN_RADIUS,
  MEDIA_PILL_ICON_SIZE,
  MEDIA_ICON_MORPH_MS,
  MEDIA_PROGRESS_HEIGHT,
  MEDIA_PROGRESS_STROKE,
  MEDIA_PROGRESS_AMPLITUDE,
  MEDIA_PROGRESS_WAVELENGTH,
  MEDIA_PROGRESS_DOT_RADIUS,
  MEDIA_PROGRESS_AMPLITUDE_LERP,
  MEDIA_PROGRESS_PHASE_SPEED,
  MEDIA_INDETERMINATE_FRACTION,
  MEDIA_INDETERMINATE_CYCLE_MS,
  MEDIA_SEEK_THROTTLE_MS,
  MEDIA_PRESS_RADIUS,
  MEDIA_PROGRESS_GAP,
  MEDIA_PROGRESS_HANDLE_RADIUS,
  MEDIA_VOLUME_WAVE_HEIGHT,
  MEDIA_VOLUME_AMPLITUDE,
  MEDIA_VOLUME_WAVELENGTH,
  MEDIA_VOLUME_GAP,
  MEDIA_VOLUME_DOT_RADIUS,
  MEDIA_VOLUME_THROTTLE_MS,
  MEDIA_MUTE_BTN_HEIGHT,
  MEDIA_ARTWORK_COLOR_CACHE_SIZE,
  MEDIA_CHIP_HEIGHT,
  MEDIA_CHIP_RADIUS,
  MEDIA_ACCENT_MIN_CONTRAST,
  MEDIA_ARTWORK_SAMPLE_SIZE,
  MEDIA_ARTWORK_HUE_BUCKETS,
  MEDIA_ARTWORK_MIN_LIGHTNESS,
  MEDIA_ARTWORK_MAX_LIGHTNESS,
  MEDIA_ARTWORK_MIN_SATURATION,
  MEDIA_ACCENT_FADE_MS,
  MEDIA_BROWSE_TOGGLE_HEIGHT,
  MEDIA_BROWSE_TOGGLE_RADIUS,
  MEDIA_BROWSE_TAB_HEIGHT,
  MEDIA_BROWSE_TAB_RADIUS,
  MEDIA_BROWSE_TAB_RADIUS_ACTIVE,
  MEDIA_BROWSE_ROW_HEIGHT,
  MEDIA_BROWSE_ROW_RADIUS,
  MEDIA_BROWSE_ROW_ICON_SIZE,
  MEDIA_BROWSE_ROW_ICON_RADIUS,
  MEDIA_BROWSE_SKELETON_ROWS,
  MEDIA_BROWSE_MAX_ROWS,
  DEFAULT_MEDIA_BROWSE_HEIGHT,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, foregroundOn , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { buildWavePath } from "./shared/wave";
import { stopSwipe } from "./shared/swipe";
import { fireEvent } from "./shared/editor-helpers";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { cssUrl } from "./shared/css-safe";

console.info(
  `%c M3-MEDIA-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #a58fe8; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #a58fe8; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);

const FEATURE = {
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  VOLUME_STEP: 1024,
  SELECT_SOURCE: 2048,
  STOP: 4096,
  BROWSE_MEDIA: 131072,
  PLAY: 16384,
  SHUFFLE_SET: 32768,
  REPEAT_SET: 262144,
} as const;

const AUDIO_FILE_RE = /\.(mp3|flac|m4a|aac|wav|ogg|opus|wma|alac|aiff?)$/i;
// Library-root folders that are never an artist/album name.
const GENERIC_FOLDERS = new Set([
  "media",
  "local",
  "music",
  "musik",
  "media_source",
  "audio",
  "songs",
  "downloads",
]);

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Leading track numbers ("02 - ", "3. ", "07 – ") are a file-naming artifact,
// not part of the title. Bounded to one or two digits on purpose: a title that
// genuinely opens with a number ("365 Dreams - My Way", "1979") must survive.
const TRACK_NUMBER_RE = /^\d{1,2}\s*[-–.)]\s*/;

function stripTrackNumber(title: string): string {
  const out = title.replace(TRACK_NUMBER_RE, "").trim();
  return out || title;
}

// A path-derived title often repeats the folder it came from
// ("2 Chainz/…/2 Chainz - Birthday Song.mp3"). Real metadata never does this,
// so the trim is applied only to the content-id fallback.
function dropLeadingArtist(title: string, artist?: string): string {
  if (!artist) return title;
  const lead = artist.toLowerCase() + " - ";
  if (title.toLowerCase().startsWith(lead)) {
    return title.slice(lead.length).trim() || title;
  }
  return title;
}

interface MediaInfo {
  title?: string;
  artist?: string;
  album?: string;
}

// Some players (e.g. a Chromecast running the Default Media Receiver on a local
// file) report no media_title/artist at all — only a media_content_id file URL.
// A tidy library is laid out as .../<Artist>/<Album>/<track>.<ext>, so derive
// what we can from the path: the filename (track number stripped) as the title,
// and the two parent folders as album and artist. Best-effort fallback only —
// real metadata always wins upstream.
function mediaInfoFromContentId(contentId?: string): MediaInfo {
  if (!contentId) return {};
  const path = contentId.split("?")[0];
  if (!AUDIO_FILE_RE.test(path)) return {};
  const parts = path.split("/").map(decodeSegment).filter(Boolean);
  const file = parts.pop();
  if (!file) return {};
  const bareName = file.replace(/\.[^.]+$/, "").trim();
  // Strip a leading track number like "02 - ", "02. ", "3) ".
  const title = bareName.replace(/^\d{1,3}\s*[-.)]\s*/, "").trim() || bareName;
  const folder = (name?: string): string | undefined =>
    name && !GENERIC_FOLDERS.has(name.toLowerCase()) ? name : undefined;
  const album = folder(parts.pop());
  const artist = folder(parts.pop());
  return { title: dropLeadingArtist(title, artist) || undefined, artist, album };
}

interface BrowseItem {
  title: string;
  media_class?: string;
  media_content_id: string;
  media_content_type: string;
  can_play?: boolean;
  can_expand?: boolean;
  thumbnail?: string | null;
  children?: BrowseItem[];
  children_media_class?: string;
}

interface BrowseCrumb {
  title: string;
  id?: string;
  type?: string;
}

// media_class values come from HA's MediaClass enum. A live library here
// returns only "directory", "music" and "app", but the map covers the whole
// enum so other integrations (Plex, Jellyfin, podcasts, TV) read correctly too.
const MEDIA_CLASS_ICONS: Record<string, string> = {
  album: "mdi:album",
  app: "mdi:application",
  artist: "mdi:account-music",
  channel: "mdi:television-classic",
  composer: "mdi:music-clef-treble",
  contributing_artist: "mdi:account-music",
  directory: "mdi:folder",
  episode: "mdi:play-box",
  game: "mdi:gamepad-variant",
  genre: "mdi:tag",
  image: "mdi:image",
  movie: "mdi:movie",
  music: "mdi:music-note",
  playlist: "mdi:playlist-music",
  podcast: "mdi:podcast",
  season: "mdi:playlist-play",
  track: "mdi:music-note",
  tv_show: "mdi:television-classic",
  url: "mdi:link-variant",
  video: "mdi:video",
};

function browseIcon(item: BrowseItem): string {
  const byClass = item.media_class && MEDIA_CLASS_ICONS[item.media_class];
  if (byClass) return byClass;
  return item.can_expand ? "mdi:folder" : "mdi:play-circle-outline";
}

const OFF_STATES = new Set(["off", "unavailable", "unknown"]);
const IDLE_STATES = new Set(["idle", "standby"]);

// Small module-level LRU cache so the (fairly expensive) canvas color
// extraction only runs once per distinct artwork URL, shared across every
// m3-media-card instance and re-renders of the same card.
const artworkColorCache = new Map<string, string>();

function clampLuminanceRgb(r: number, g: number, b: number): [number, number, number] {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luma > 200) {
    const t = (luma - 200) / 55;
    return [r * (1 - t * 0.5), g * (1 - t * 0.5), b * (1 - t * 0.5)];
  }
  return [r, g, b];
}

// WCAG relative luminance of an 8-bit sRGB triple.
function relativeLuminance(r: number, g: number, b: number): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// The built-in palette is all light pastels, so a fixed dark ink (#1c1c1c) is
// always legible on a filled accent. An artwork-derived accent carries no such
// guarantee — a dark album cover yielded #4c3d56, a 1.71:1 ratio against that
// ink, i.e. an all-but-invisible play glyph. Lighten toward white until the
// filled button clears the AA bar for large graphics. Hue is preserved because
// every channel moves toward white by the same fraction.
function ensureInkContrast(r: number, g: number, b: number): [number, number, number] {
  const inkLum = relativeLuminance(0x1c, 0x1c, 0x1c);
  let lo = 0;
  let hi = 1;
  if (contrastRatio(relativeLuminance(r, g, b), inkLum) >= MEDIA_ACCENT_MIN_CONTRAST) {
    return [r, g, b];
  }
  // White always passes, so a bisection on "fraction blended toward white"
  // converges on the least-changed color that still clears the bar.
  for (let i = 0; i < 12; i++) {
    const t = (lo + hi) / 2;
    const [tr, tg, tb] = [r, g, b].map((c) => c + (255 - c) * t) as [number, number, number];
    if (contrastRatio(relativeLuminance(tr, tg, tb), inkLum) >= MEDIA_ACCENT_MIN_CONTRAST) hi = t;
    else lo = t;
  }
  return [r, g, b].map((c) => c + (255 - c) * hi) as [number, number, number];
}

// Hue/saturation/lightness of an 8-bit sRGB triple. Only the three values the
// dominant-colour vote needs, so no full HSL round-trip.
function hsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

// Picks the artwork's dominant *saturated* colour rather than averaging every
// pixel. An average is the sum of a cover's backdrop and its subject, which on
// most covers is a desaturated brown-grey — "Inner Light" averaged to #4c3d56,
// a muddy near-black that failed contrast outright. Instead: bucket the pixels
// by hue, weight each vote by its saturation so a small vivid area outvotes a
// large flat one, then average the winning bucket's actual pixels. A genuinely
// greyscale cover has no saturated pixels at all and falls back to the mean.
function dominantColor(data: Uint8ClampedArray): [number, number, number] | undefined {
  const buckets = new Array(MEDIA_ARTWORK_HUE_BUCKETS).fill(0);
  const sums = Array.from({ length: MEDIA_ARTWORK_HUE_BUCKETS }, () => [0, 0, 0, 0]);
  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  let meanCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    meanR += r;
    meanG += g;
    meanB += b;
    meanCount++;

    const { h, s, l } = hsl(r, g, b);
    if (l < MEDIA_ARTWORK_MIN_LIGHTNESS || l > MEDIA_ARTWORK_MAX_LIGHTNESS) continue;
    if (s < MEDIA_ARTWORK_MIN_SATURATION) continue;
    const idx = Math.min(
      MEDIA_ARTWORK_HUE_BUCKETS - 1,
      Math.floor((h / 360) * MEDIA_ARTWORK_HUE_BUCKETS),
    );
    // Saturation-weighted so vividness counts, not just area.
    buckets[idx] += s;
    sums[idx][0] += r * s;
    sums[idx][1] += g * s;
    sums[idx][2] += b * s;
    sums[idx][3] += s;
  }

  if (meanCount === 0) return undefined;

  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] > bestWeight) {
      bestWeight = buckets[i];
      best = i;
    }
  }
  if (best < 0 || sums[best][3] === 0) {
    return [meanR / meanCount, meanG / meanCount, meanB / meanCount];
  }
  const w = sums[best][3];
  return [sums[best][0] / w, sums[best][1] / w, sums[best][2] / w];
}

async function extractArtworkColor(url: string): Promise<string | undefined> {
  const cached = artworkColorCache.get(url);
  if (cached) return cached;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
    });
    img.src = url;
    await loaded;
    const size = MEDIA_ARTWORK_SAMPLE_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, size, size);
    const dom = dominantColor(ctx.getImageData(0, 0, size, size).data);
    if (!dom) return undefined;
    const [lr, lg, lb] = clampLuminanceRgb(dom[0], dom[1], dom[2]);
    const [cr, cg, cb] = ensureInkContrast(lr, lg, lb);
    const hex = `#${[cr, cg, cb].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
    if (artworkColorCache.size >= MEDIA_ARTWORK_COLOR_CACHE_SIZE) {
      const firstKey = artworkColorCache.keys().next().value;
      if (firstKey) artworkColorCache.delete(firstKey);
    }
    artworkColorCache.set(url, hex);
    return hex;
  } catch {
    // Cross-origin/proxy failures fall back to the configured/default accent.
    return undefined;
  }
}

@customElement("m3-media-card")
export class M3MediaCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3MediaCardConfig;
  @state() private _displayPosition = 0;
  @state() private _artworkColor?: string;
  @state() private _dragging = false;
  @state() private _dragVolume?: number;
  // Real pixel width of the volume slider. The wave is drawn into a viewBox of
  // this exact width so the end-dot renders as a circle (a fixed viewBox with
  // preserveAspectRatio="none" would stretch it into an ellipse).
  @state() private _volumeWidth = 220;
  // Seeking (scrubbing) through the track.
  @state() private _seeking = false;
  @state() private _seekPosition?: number;
  @state() private _progressWidth = 260;
  // Browser section. `_browseCrumbs` is the navigation stack: index 0 is the
  // player's own root, each further entry a level the user drilled into.
  @state() private _browseOpen = false;
  @state() private _browseTab: "queue" | "library" = "library";
  @state() private _browseCrumbs: BrowseCrumb[] = [];
  @state() private _browseItems: BrowseItem[] = [];
  @state() private _browseLoading = false;
  @state() private _browseError = false;
  @state() private _queueItems?: BrowseItem[];
  // undefined = not probed yet, false = this player has no queue (tab hidden).
  @state() private _queueAvailable?: boolean;
  // Phase of the flowing volume wave. Deliberately NOT @state: the animation
  // advances it every frame and repaints just the one SVG path directly (see
  // _syncWaveAnimation), so it must not trigger a full card re-render.
  private _wavePhase = 0;
  // Progress wave: phase advances every frame, amplitude eases toward its
  // target (0 when paused). Neither is @state — the animation repaints the one
  // path directly, so a 60fps re-render of the whole card never happens.
  // Sub-second position, for the wave only. Deliberately NOT @state: it
  // changes every frame, and a reactive field here re-renders the card on
  // every animation frame — which is exactly the render loop this replaces.
  private _precisePosition = 0;
  private _progressPhase = 0;
  private _progressAmplitude = 0;
  private _progressRafId?: number;
  private _visible = true;
  private _visibilityObserver?: IntersectionObserver;
  private _seekThrottleTimer?: number;
  private _lastSeekTs = 0;
  private _pressTimer?: number;

  @query(".volume-slider") private _volumeSliderEl?: HTMLDivElement;
  @query(".progress-slider") private _progressSliderEl?: HTMLDivElement;

  private _lastArtworkUrl?: string;
  private _volumeThrottleTimer?: number;
  private _pendingVolume?: number;
  private _lastVolumeCallTs = 0;
  private _volumeResizeObserver?: ResizeObserver;
  private _progressResizeObserver?: ResizeObserver;
  private _waveRafId?: number;

  private get _duration(): number {
    return (this._entity?.attributes.media_duration as number | undefined) ?? 0;
  }

  private get _reducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    );
  }

  // Drives the flowing volume wave by repainting ONLY the one SVG path each
  // frame — never this.requestUpdate(), so the rest of the card (and the wider
  // dashboard) isn't re-rendered 60×/s, which would jank other interactions.
  // requestAnimationFrame pauses itself while the tab is hidden, so no extra
  // visibility handling is needed.
  private _syncWaveAnimation(animate: boolean): void {
    if (animate) {
      if (this._waveRafId !== undefined) return;
      const step = () => {
        this._waveRafId = requestAnimationFrame(step);
        this._wavePhase -= 0.08;
        const path = this.renderRoot?.querySelector(".volume-active");
        const width = this._volumeActiveWidth();
        if (path && width > 1) {
          path.setAttribute(
            "d",
            buildWavePath(
              0,
              width,
              MEDIA_VOLUME_AMPLITUDE,
              MEDIA_VOLUME_WAVELENGTH,
              this._wavePhase,
              MEDIA_VOLUME_WAVE_HEIGHT / 2,
            ),
          );
        }
      };
      this._waveRafId = requestAnimationFrame(step);
    } else if (this._waveRafId !== undefined) {
      cancelAnimationFrame(this._waveRafId);
      this._waveRafId = undefined;
    }
  }

  // Active (filled) width of the volume wave from current state — shared by the
  // render and the animation frame so they stay in sync.
  private _volumeActiveWidth(): number {
    const attrs = this._entity?.attributes ?? {};
    const muted = !!attrs.is_volume_muted;
    const entityVol = (attrs.volume_level as number | undefined) ?? 0;
    const vol = this._dragging ? (this._dragVolume ?? entityVol) : entityVol;
    const effVol = muted ? 0 : vol;
    const available = Math.max(
      0,
      this._volumeWidth - MEDIA_VOLUME_GAP - MEDIA_VOLUME_DOT_RADIUS * 2,
    );
    return available * effVol;
  }

  public static getStubConfig(hass: HomeAssistant): M3MediaCardConfig {
    const entities = Object.keys(hass?.states ?? {}).filter((eid) => eid.startsWith("media_player."));
    return {
      type: "custom:m3-media-card",
      entity: entities[0] ?? "",
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._config?.entity]);
  }

  public setConfig(config: M3MediaCardConfig): void {
    if (!config.entity) {
      throw new Error("Bitte eine media_player-Entität auswählen / Please select a media_player entity");
    }
    this._config = {
      glass_background: true,
      animation: "auto",
      use_artwork_color: true,
      show_source_select: false,
      show_shuffle_repeat: false,
      ...config,
    };
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 2 };
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-media-card-editor");
    return document.createElement("m3-media-card-editor") as unknown as LovelaceCardEditor;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    // Re-arm after a move in the DOM: disconnectedCallback tore the loop and
    // the observer down, and without this the card would sit still until some
    // unrelated state update happened to restart it.
    this._visible = true;
    this._syncPositionTimer();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._volumeThrottleTimer !== undefined) clearTimeout(this._volumeThrottleTimer);
    this._volumeResizeObserver?.disconnect();
    this._volumeResizeObserver = undefined;
    this._progressResizeObserver?.disconnect();
    this._progressResizeObserver = undefined;
    this._syncWaveAnimation(false);
    this._stopProgressAnimation();
    this._visibilityObserver?.disconnect();
    this._visibilityObserver = undefined;
    if (this._seekThrottleTimer !== undefined) clearTimeout(this._seekThrottleTimer);
    if (this._pressTimer !== undefined) clearTimeout(this._pressTimer);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._syncPositionTimer();
    this._maybeExtractColor();
    this._observeVolumeWidth();
    this._observeProgressWidth();
    this._observeVisibility();
  }

  // requestAnimationFrame already pauses in a hidden tab, but a card scrolled
  // far off a long dashboard keeps animating. This stops that too.
  private _observeVisibility(): void {
    if (this._visibilityObserver || typeof IntersectionObserver === "undefined") return;
    // Deliberately re-syncs on every callback rather than only on a change.
    // An element observed before it is laid out reports "not intersecting"
    // once, which stops the loop; comparing against the previous value could
    // then swallow the restart and leave the wave frozen for the card's whole
    // life. The observer fires rarely, so the extra sync costs nothing.
    this._visibilityObserver = new IntersectionObserver((entries) => {
      this._visible = entries.some((e) => e.isIntersecting);
      this._syncPositionTimer();
    });
    this._visibilityObserver.observe(this);
  }

  // The volume slider mounts/unmounts with the VOLUME_SET feature, so the
  // observer is (re)attached whenever the element appears.
  private _observeVolumeWidth(): void {
    const el = this._volumeSliderEl;
    if (!el) {
      this._volumeResizeObserver?.disconnect();
      this._volumeResizeObserver = undefined;
      return;
    }
    if (this._volumeResizeObserver) return;
    this._volumeResizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && Math.abs(width - this._volumeWidth) > 0.5) {
        this._volumeWidth = width;
      }
    });
    this._volumeResizeObserver.observe(el);
    const w = el.getBoundingClientRect().width;
    if (w) this._volumeWidth = w;
  }

  // The progress slider mounts/unmounts with media_duration, so the observer is
  // (re)attached whenever the element appears. Measured width keeps the handle
  // circular and the clientX→position math correct.
  private _observeProgressWidth(): void {
    const el = this._progressSliderEl;
    if (!el) {
      this._progressResizeObserver?.disconnect();
      this._progressResizeObserver = undefined;
      return;
    }
    if (this._progressResizeObserver) return;
    this._progressResizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && Math.abs(width - this._progressWidth) > 0.5) {
        this._progressWidth = width;
      }
    });
    this._progressResizeObserver.observe(el);
    const w = el.getBoundingClientRect().width;
    if (w) this._progressWidth = w;
  }

  private _positionFromClientX(clientX: number): number {
    const el = this._progressSliderEl;
    const duration = this._duration;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const pct = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.min(duration, Math.max(0, pct * duration));
  }

  private _handleSeekPointerDown = (e: PointerEvent): void => {
    if (!this._progressSliderEl || this._duration <= 0) return;
    e.preventDefault();
    this._progressSliderEl.setPointerCapture(e.pointerId);
    this._seeking = true;
    this._seekPosition = this._positionFromClientX(e.clientX);
  };

  private _handleSeekPointerMove = (e: PointerEvent): void => {
    if (!this._seeking) return;
    this._seekPosition = this._positionFromClientX(e.clientX);
    this._throttledSeek();
  };

  // Scrubbing sends intermediate seeks so the player follows the drag, but at
  // most one every MEDIA_SEEK_THROTTLE_MS — a raw pointermove stream would
  // flood it with a call per frame.
  private _throttledSeek(): void {
    const now = Date.now();
    const wait = MEDIA_SEEK_THROTTLE_MS - (now - this._lastSeekTs);
    if (wait <= 0) {
      this._lastSeekTs = now;
      if (this._seekPosition !== undefined) {
        this._callService("media_seek", { seek_position: Math.round(this._seekPosition) });
      }
      return;
    }
    if (this._seekThrottleTimer !== undefined) return;
    this._seekThrottleTimer = window.setTimeout(() => {
      this._seekThrottleTimer = undefined;
      if (!this._seeking || this._seekPosition === undefined) return;
      this._lastSeekTs = Date.now();
      this._callService("media_seek", { seek_position: Math.round(this._seekPosition) });
    }, wait);
  }

  private _handleSeekPointerUp = (): void => {
    if (!this._seeking) return;
    this._seeking = false;
    if (this._seekPosition !== undefined) {
      this._callService("media_seek", { seek_position: Math.round(this._seekPosition) });
      // Optimistically hold the scrubbed position until the player reports back.
      this._precisePosition = this._seekPosition;
      this._displayPosition = Math.floor(this._seekPosition);
    }
    this._seekPosition = undefined;
  };

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _entity() {
    if (!this.hass || !this._config) return undefined;
    return this.hass.states[this._config.entity];
  }

  private _computeDisplayPosition(): void {
    const entity = this._entity;
    if (!entity) return;
    const position = entity.attributes.media_position as number | undefined;
    const updatedAt = entity.attributes.media_position_updated_at as string | undefined;
    if (position === undefined) {
      this._precisePosition = 0;
      this._displayPosition = 0;
      return;
    }
    if (entity.state === "playing" && updatedAt) {
      const elapsed = (Date.now() - new Date(updatedAt).getTime()) / 1000;
      this._precisePosition = Math.max(0, position + elapsed);
    } else {
      this._precisePosition = position;
    }
    // The label reads m:ss, so only whole seconds are reactive. Assigning the
    // sub-second value here would make every render schedule the next one:
    // updated() → recompute → new value → update → … a loop that saturates the
    // main thread and starves the animation frames.
    this._displayPosition = Math.floor(this._precisePosition);
  }

  // The position is interpolated locally from media_position and
  // media_position_updated_at rather than waiting for the player's state
  // updates, which arrive seconds apart and would make the bar tick.
  private _syncPositionTimer(): void {
    const entity = this._entity;
    const playing = entity?.state === "playing";
    this._computeDisplayPosition();
    this._syncProgressAnimation(!!playing && this._visible);
  }

  private _stopProgressAnimation(): void {
    if (this._progressRafId !== undefined) {
      cancelAnimationFrame(this._progressRafId);
      this._progressRafId = undefined;
    }
  }

  private _syncProgressAnimation(run: boolean): void {
    const wantsFrames = run || this._progressAmplitude > 0.05;
    if (!wantsFrames) {
      this._stopProgressAnimation();
      this._progressAmplitude = 0;
      this._repaintProgress();
      return;
    }
    if (this._progressRafId !== undefined) return;
    const step = (ts: number) => {
      this._progressRafId = requestAnimationFrame(step);
      const entity = this._entity;
      const playing = entity?.state === "playing" && this._visible;
      // Amplitude eases toward its target, so pausing settles the wave flat
      // instead of snapping it.
      const target = playing && !this._reducedMotion ? MEDIA_PROGRESS_AMPLITUDE : 0;
      this._progressAmplitude += (target - this._progressAmplitude) * MEDIA_PROGRESS_AMPLITUDE_LERP;
      if (playing) this._progressPhase -= MEDIA_PROGRESS_PHASE_SPEED;
      void ts;
      this._computeDisplayPosition();
      this._repaintProgress();
      if (!playing && this._progressAmplitude < 0.05) {
        this._progressAmplitude = 0;
        this._repaintProgress();
        this._stopProgressAnimation();
      }
    };
    this._progressRafId = requestAnimationFrame(step);
  }

  // Repaints only the progress path, never the card.
  private _repaintProgress(): void {
    const path = this.renderRoot?.querySelector(".progress-active");
    if (!path) return;
    const geo = this._progressGeometry();
    if (!geo) return;
    path.setAttribute("d", geo.d);
    const track = this.renderRoot?.querySelector(".progress-track");
    if (track) {
      track.setAttribute("x1", String(geo.trackStart));
      track.setAttribute("x2", String(geo.trackEnd));
    }
  }

  private _maybeExtractColor(): void {
    if (!this._config?.use_artwork_color) return;
    const entity = this._entity;
    const picture = entity?.attributes.entity_picture as string | undefined;
    if (!picture) {
      this._artworkColor = undefined;
      this._lastArtworkUrl = undefined;
      return;
    }
    if (picture === this._lastArtworkUrl) return;
    this._lastArtworkUrl = picture;
    const url = picture.startsWith("http") ? picture : `${location.origin}${picture}`;
    extractArtworkColor(url).then((color) => {
      if (this._lastArtworkUrl === picture) this._artworkColor = color;
    });
  }

  private _callService(service: string, data?: Record<string, unknown>): void {
    if (!this.hass || !this._config) return;
    this.hass.callService("media_player", service, { entity_id: this._config.entity, ...data });
  }

  private _fireMoreInfo(): void {
    fireEvent(this, "hass-more-info", { entityId: this._config?.entity });
  }

  private _handleVolumePointerDown = (e: PointerEvent): void => {
    if (!this._volumeSliderEl) return;
    e.preventDefault();
    this._volumeSliderEl.setPointerCapture(e.pointerId);
    this._dragging = true;
    const value = this._volumeFromClientX(e.clientX);
    this._dragVolume = value;
    this._throttledSetVolume(value);
  };

  private _handleVolumePointerMove = (e: PointerEvent): void => {
    if (!this._dragging) return;
    const value = this._volumeFromClientX(e.clientX);
    if (value === this._dragVolume) return;
    this._dragVolume = value;
    this._throttledSetVolume(value);
  };

  private _handleVolumePointerUp = (): void => {
    if (!this._dragging) return;
    this._dragging = false;
    if (this._dragVolume !== undefined) this._setVolumeNow(this._dragVolume);
    this._dragVolume = undefined;
  };

  private _volumeFromClientX(clientX: number): number {
    if (!this._volumeSliderEl) return 0;
    const rect = this._volumeSliderEl.getBoundingClientRect();
    const pct = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.min(1, Math.max(0, pct));
  }

  private _throttledSetVolume(value: number): void {
    this._pendingVolume = value;
    const now = performance.now();
    const elapsed = now - this._lastVolumeCallTs;
    if (elapsed >= MEDIA_VOLUME_THROTTLE_MS) {
      this._lastVolumeCallTs = now;
      this._pendingVolume = undefined;
      this._setVolumeNow(value);
    } else if (this._volumeThrottleTimer === undefined) {
      this._volumeThrottleTimer = window.setTimeout(() => {
        this._volumeThrottleTimer = undefined;
        if (this._pendingVolume !== undefined) {
          this._lastVolumeCallTs = performance.now();
          this._setVolumeNow(this._pendingVolume);
          this._pendingVolume = undefined;
        }
      }, MEDIA_VOLUME_THROTTLE_MS - elapsed);
    }
  }

  private _setVolumeNow(value: number): void {
    this._callService("volume_set", { volume_level: value });
  }

  private _formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const entity = this.hass.states[this._config.entity];
    if (!entity) return renderMissingEntity(this._config.entity);

    const state = entity.state;
    const attrs = entity.attributes;
    const name = this._config.name || attrs.friendly_name || this._config.entity;
    const isPlaybackState = !OFF_STATES.has(state) && !IDLE_STATES.has(state);

    const configuredAccent = this._config.accent_color ? resolveThemeColor(this._config.accent_color) : undefined;
    const accentColor =
      configuredAccent ?? (this._config.use_artwork_color ? this._artworkColor : undefined) ?? DEFAULT_MEDIA_ACCENT;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_MEDIA_RADIUS, this._config.corners);
    const animClass = shouldAnimate(this._config.animation) ? "" : "no-animations";

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, accentColor, this._config.accent_opacity, 18);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(accentColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "mc-accent": accentColor,
      "m3p-power-btn-bg": tintOn(this, accentColor, this._config.accent_opacity, 14),
      "m3p-artwork-bg": tintOn(this, accentColor, this._config.accent_opacity, 18),
      "m3p-transport-btn-bg": tintOn(this, accentColor, this._config.accent_opacity, 8),
      "m3p-pill-active-bg": tintOn(this, accentColor, this._config.accent_opacity, 24),
      "m3p-mute-active-bg": tintOn(this, accentColor, this._config.accent_opacity, 20),
      "m3p-source-active-bg": tintOn(this, accentColor, this._config.accent_opacity, 22),
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3p-icon-color": accentColor,
        "mc-accent": accentColor,
      }),
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animClass}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${isPlaybackState ? this._renderPlayback(entity, attrs, name) : this._renderCompact(entity, attrs, name)}
        </div>
      </ha-card>
    `;
  }

  private _renderCompact(entity: { state: string }, attrs: Record<string, unknown>, name: string) {
    const off = OFF_STATES.has(entity.state);
    const statusText = entity.state === "unavailable" ? this._t("unavailable") : off ? this._t("media_off") : this._t("media_idle");
    const canTurnOn = ((attrs.supported_features as number) ?? 0) & (FEATURE.TURN_ON | FEATURE.TURN_OFF);

    return html`
      <div
        class="compact-row"
        role="button"
        tabindex="0"
        aria-label=${name}
        @click=${() => this._fireMoreInfo()}
        @keydown=${activateOnKey(() => this._fireMoreInfo())}
      >
        <div class="icon-swatch">
          <ha-icon icon="mdi:speaker"></ha-icon>
        </div>
        <div class="compact-text">
          <div class="compact-name">${name}</div>
          <div class="compact-status">${statusText}</div>
        </div>
        ${canTurnOn
          ? html`
              <button
                class="power-btn"
                ?disabled=${entity.state === "unavailable"}
                aria-label=${this._t("media_power")}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._callService(off ? "turn_on" : "turn_off");
                }}
              >
                <ha-icon icon="mdi:power"></ha-icon>
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private _tv(key: TranslationKey, vars: Record<string, string | number>): string {
    let out = this._t(key);
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  }

  private get _browseHeight(): number {
    return this._config?.browse_height ?? DEFAULT_MEDIA_BROWSE_HEIGHT;
  }

  private async _browseCall(id?: string, type?: string): Promise<BrowseItem> {
    return this.hass!.callWS<BrowseItem>({
      type: "media_player/browse_media",
      entity_id: this._config!.entity,
      ...(id !== undefined ? { media_content_id: id, media_content_type: type ?? "" } : {}),
    });
  }

  // Probed once per card. The spec's queue source is a browse level of type
  // "queue"; integrations without one simply reject the call, and the tab is
  // hidden rather than shown empty.
  private async _probeQueue(): Promise<void> {
    if (this._queueAvailable !== undefined) return;
    try {
      const res = await this._browseCall("", "queue");
      const items = (res.children ?? []).filter((c) => c.can_play);
      this._queueItems = items;
      this._queueAvailable = items.length > 0;
    } catch {
      this._queueAvailable = false;
      this._queueItems = undefined;
    }
    if (this._queueAvailable === false && this._browseTab === "queue") this._browseTab = "library";
  }

  private async _loadBrowseLevel(): Promise<void> {
    this._browseLoading = true;
    this._browseError = false;
    const last = this._browseCrumbs[this._browseCrumbs.length - 1];
    try {
      const res = await this._browseCall(last?.id, last?.type);
      this._browseItems = res.children ?? [];
      if (this._browseCrumbs.length === 0) {
        this._browseCrumbs = [{ title: res.title || this._t("media_browse_root") }];
      }
    } catch {
      this._browseError = true;
      this._browseItems = [];
    } finally {
      this._browseLoading = false;
    }
  }

  private _toggleBrowse = (): void => {
    this._browseOpen = !this._browseOpen;
    if (!this._browseOpen) return;
    this._browseTab = this._config?.default_tab ?? "library";
    void this._probeQueue();
    if (this._browseItems.length === 0 && !this._browseLoading) void this._loadBrowseLevel();
  };

  private _openItem(item: BrowseItem): void {
    if (item.can_expand) {
      this._browseCrumbs = [
        ...this._browseCrumbs,
        { title: item.title, id: item.media_content_id, type: item.media_content_type },
      ];
      this._browseItems = [];
      void this._loadBrowseLevel();
      return;
    }
    if (item.can_play) this._playItem(item);
  }

  private _playItem(item: BrowseItem): void {
    this._callService("play_media", {
      media_content_id: item.media_content_id,
      media_content_type: item.media_content_type,
    });
  }

  private _crumbTo(index: number): void {
    if (index >= this._browseCrumbs.length - 1) return;
    this._browseCrumbs = this._browseCrumbs.slice(0, index + 1);
    this._browseItems = [];
    void this._loadBrowseLevel();
  }

  private _renderPlayback(entity: { state: string }, attrs: Record<string, unknown>, name: string) {
    const features = (attrs.supported_features as number) ?? 0;
    const parsed = mediaInfoFromContentId(attrs.media_content_id as string | undefined);
    const rawTitle = (attrs.media_title as string) || parsed.title || name;
    const title = this._config?.strip_track_number === false ? rawTitle : stripTrackNumber(rawTitle);
    // Radio streams carry no artist; media_channel holds the station instead.
    const channel = attrs.media_channel as string | undefined;
    const artist = (attrs.media_artist as string | undefined) || parsed.artist || channel;
    const album = (attrs.media_album_name as string | undefined) || parsed.album;
    const year = attrs.media_year as number | string | undefined;
    // Third line: album, with the year appended when the integration has one.
    // For radio, where there is no album, the station name takes the slot —
    // but only if it is not already standing in as the artist line.
    const albumLine = album
      ? year
        ? `${album} · ${year}`
        : album
      : artist === channel
        ? undefined
        : channel;
    const picture = attrs.entity_picture as string | undefined;
    const duration = attrs.media_duration as number | undefined;
    const isPlaying = entity.state === "playing";
    const volume = (attrs.volume_level as number | undefined) ?? 0;
    const displayVolume = this._dragging ? (this._dragVolume ?? volume) : volume;
    const muted = !!attrs.is_volume_muted;

    // Play/pause is the row's state indicator. A player that cannot pause but
    // can stop (many streaming/radio sources) gets a stop glyph instead, so the
    // button never offers an action the player would reject.
    const canPause = (features & FEATURE.PAUSE) !== 0;
    const canStop = (features & FEATURE.STOP) !== 0;
    const hasPlayControl = (features & (FEATURE.PLAY | FEATURE.PAUSE | FEATURE.STOP)) !== 0;
    const stopsInsteadOfPausing = !canPause && canStop;
    const pauseIcon = stopsInsteadOfPausing ? "mdi:stop" : "mdi:pause";
    const playAction = isPlaying
      ? stopsInsteadOfPausing
        ? "media_stop"
        : "media_pause"
      : "media_play";
    const playLabel: TranslationKey = isPlaying
      ? stopsInsteadOfPausing
        ? "media_stop"
        : "media_pause"
      : "media_play";
    const repeatOn = !!attrs.repeat && attrs.repeat !== "off";
    // While scrubbing the clock must follow the handle, not the player.
    const shownPosition =
      this._seeking && this._seekPosition !== undefined ? this._seekPosition : this._displayPosition;

    // The volume wave flows only while sound is actually coming out.
    this._syncWaveAnimation(
      isPlaying && !muted && displayVolume > 0 && !this._reducedMotion,
    );

    return html`
      <div class="playback">
        <div class="playback-top">
          <div
            class="artwork ${picture ? "" : "fallback"}"
            style=${cssUrl(picture) ? `background-image: ${cssUrl(picture)};` : ""}
          >
            ${!picture
              ? html`<ha-icon icon=${album ? "mdi:album" : "mdi:music-note"}></ha-icon>`
              : nothing}
          </div>
          <div class="meta">
            <div class="meta-title">${title}</div>
            ${artist
              ? html`<div class="meta-artist">
                  <ha-icon icon=${artist === channel ? "mdi:radio-tower" : "mdi:account-music"}></ha-icon
                  ><span>${artist}</span>
                </div>`
              : nothing}
            ${albumLine
              ? html`<div class="meta-source">
                  <ha-icon icon="mdi:album"></ha-icon><span>${albumLine}</span>
                </div>`
              : nothing}
            ${this._renderMetaChips(attrs, name, !!album && !!year)}
          </div>
        </div>

        <div class="progress">
          ${this._renderProgress(duration ?? 0, features)}
          <div class="progress-times">
            <span>${this._formatTime(shownPosition)}</span>
            ${duration
              ? html`<span
                  >${this._config?.time_display === "total"
                    ? this._formatTime(duration)
                    : `-${this._formatTime(Math.max(0, duration - shownPosition))}`}</span
                >`
              : html`<span class="live-chip">${this._t("media_live")}</span>`}
          </div>
        </div>

        <div class="transport-row">
          ${this._config?.show_shuffle_repeat && features & FEATURE.SHUFFLE_SET
            ? html`
                <button
                  class="pill-toggle ${attrs.shuffle ? "active" : ""}"
                  aria-label=${this._t("media_shuffle")}
                  aria-pressed=${attrs.shuffle ? "true" : "false"}
                  @click=${(e: Event) => { this._pressMorph(e); this._callService("shuffle_set", { shuffle: !attrs.shuffle }); }}
                >
                  <ha-icon icon="mdi:shuffle-variant"></ha-icon>
                </button>
              `
            : nothing}
          ${features & FEATURE.PREVIOUS_TRACK
            ? html`
                <button
                  class="transport-btn"
                  aria-label=${this._t("media_previous")}
                  @click=${(e: Event) => { this._pressMorph(e); this._callService("media_previous_track"); }}
                >
                  <ha-icon icon="mdi:skip-previous"></ha-icon>
                </button>
              `
            : nothing}
          ${hasPlayControl
            ? html`
                <button
                  class="play-btn ${isPlaying ? "playing" : ""}"
                  aria-label=${this._t(playLabel)}
                  @click=${(e: Event) => { this._pressMorph(e); this._callService(playAction); }}
                >
                  <span class="icon-stack">
                    <span class="icon-layer ${isPlaying ? "" : "swapped"}">
                      <ha-icon icon=${pauseIcon}></ha-icon>
                    </span>
                    <span class="icon-layer ${isPlaying ? "swapped" : ""}">
                      <ha-icon icon="mdi:play"></ha-icon>
                    </span>
                  </span>
                </button>
              `
            : nothing}
          ${features & FEATURE.NEXT_TRACK
            ? html`
                <button
                  class="transport-btn"
                  aria-label=${this._t("media_next")}
                  @click=${(e: Event) => { this._pressMorph(e); this._callService("media_next_track"); }}
                >
                  <ha-icon icon="mdi:skip-next"></ha-icon>
                </button>
              `
            : nothing}
          ${this._config?.show_shuffle_repeat && features & FEATURE.REPEAT_SET
            ? html`
                <button
                  class="pill-toggle ${repeatOn ? "active" : ""}"
                  aria-label=${this._t("media_repeat")}
                  aria-pressed=${repeatOn ? "true" : "false"}
                  @click=${(e: Event) => {
                    this._pressMorph(e);
                    // off → all → one → off, matching HA's repeat modes.
                    const next =
                      attrs.repeat === "off" || !attrs.repeat
                        ? "all"
                        : attrs.repeat === "all"
                          ? "one"
                          : "off";
                    this._callService("repeat_set", { repeat: next });
                  }}
                >
                  <ha-icon icon=${attrs.repeat === "one" ? "mdi:repeat-once" : "mdi:repeat"}></ha-icon>
                </button>
              `
            : nothing}
        </div>

        ${features & FEATURE.VOLUME_SET ? this._renderVolume(displayVolume, muted, features) : nothing}

        ${this._config?.show_source_select && attrs.source_list
          ? this._renderSourceSelect(attrs.source_list as string[], attrs.source as string | undefined)
          : nothing}

        ${this._renderBrowser(features)}
      </div>
    `;
  }

  // Device + source always; anything else only when the player actually
  // reports it. HA has no standard bitrate attribute — a few integrations add
  // media_bitrate, most do not, so that chip is usually absent by design.
  // Every transport button briefly pulls its corners in on tap. Driven by a
  // class rather than :active so the morph plays out for its full duration
  // even on a quick tap, where :active would already be gone.
  private _pressMorph = (e: Event): void => {
    const el = (e.currentTarget as HTMLElement) ?? null;
    if (!el || !shouldAnimate(this._config?.animation)) return;
    el.classList.add("pressed");
    if (this._pressTimer !== undefined) clearTimeout(this._pressTimer);
    this._pressTimer = window.setTimeout(() => {
      el.classList.remove("pressed");
      this._pressTimer = undefined;
    }, MEDIA_ICON_MORPH_MS);
  };

  private _renderMetaChips(attrs: Record<string, unknown>, name: string, yearShown: boolean) {
    const source = (attrs.source as string | undefined) || (attrs.app_name as string | undefined);
    const extras = this._config?.meta_chips ?? [];
    const chips: { text: string; icon: string; accent?: boolean }[] = [];

    chips.push({ text: name, icon: "mdi:speaker", accent: true });
    if (source) chips.push({ text: source, icon: "mdi:music-box-outline" });

    if (extras.includes("track")) {
      const track = attrs.media_track as number | undefined;
      const total = attrs.media_playlist as string | number | undefined;
      if (typeof track === "number") {
        chips.push({
          text:
            typeof total === "number"
              ? this._tv("media_track_of", { n: track, total })
              : this._tv("media_track_no", { n: track }),
          icon: "mdi:pound",
        });
      }
    }
    // Skipped when the album line already carries it — the year appended to
    // "Violator · 1990" and a "1990" chip beside it is the same fact twice.
    if (extras.includes("year") && !yearShown) {
      const year = attrs.media_year as string | number | undefined;
      if (year) chips.push({ text: String(year), icon: "mdi:calendar" });
    }
    if (extras.includes("bitrate")) {
      const br = attrs.media_bitrate as string | number | undefined;
      if (br) chips.push({ text: `${br} kbit/s`, icon: "mdi:sine-wave" });
    }

    if (chips.length === 0) return nothing;
    return html`
      <div class="meta-chips">
        ${chips.map(
          (c) => html`
            <span class="meta-chip ${c.accent ? "accent" : ""}">
              <ha-icon icon=${c.icon}></ha-icon><span>${c.text}</span>
            </span>
          `,
        )}
      </div>
    `;
  }

  private _renderBrowser(features: number) {
    if (this._config?.show_browser === false) return nothing;
    if (!(features & FEATURE.BROWSE_MEDIA)) return nothing;

    const next = this._queueItems?.[0];
    const label = next
      ? this._tv("media_browse_next", { title: next.title })
      : this._t("media_browse_open");

    return html`
      <div class="browser">
        <button
          class="browse-toggle ${this._browseOpen ? "open" : ""}"
          aria-expanded=${this._browseOpen ? "true" : "false"}
          aria-label=${this._t("media_browse_toggle")}
          @click=${this._toggleBrowse}
        >
          <span class="browse-toggle-icon">
            <ha-icon icon=${next ? "mdi:playlist-music" : "mdi:music-box-multiple"}></ha-icon>
          </span>
          <span class="browse-toggle-label">${label}</span>
          <ha-icon class="browse-chevron" icon="mdi:chevron-down"></ha-icon>
        </button>
        ${this._browseOpen ? this._renderBrowsePanel() : nothing}
      </div>
    `;
  }

  private _renderBrowsePanel() {
    const showQueueTab = this._queueAvailable === true;
    return html`
      <div class="browse-panel">
        ${showQueueTab
          ? html`
              <div class="browse-tabs" role="tablist">
                ${(["queue", "library"] as const).map(
                  (tab) => html`
                    <button
                      class="browse-tab ${this._browseTab === tab ? "active" : ""}"
                      role="tab"
                      aria-selected=${this._browseTab === tab ? "true" : "false"}
                      @click=${() => (this._browseTab = tab)}
                    >
                      ${this._t(tab === "queue" ? "media_browse_tab_queue" : "media_browse_tab_library")}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing}
        ${this._browseTab === "queue" && showQueueTab
          ? this._renderQueueList()
          : this._renderLibraryList()}
      </div>
    `;
  }

  private _renderQueueList() {
    const items = this._queueItems ?? [];
    return html`
      <div class="browse-list" style=${`max-height: ${this._browseHeight}px;`}>
        ${items.map(
          (item, i) => html`
            <button class="browse-row" @click=${() => this._playItem(item)}>
              <span class="browse-num">${i + 1}</span>
              <span class="browse-text">
                <span class="browse-title">${item.title}</span>
              </span>
            </button>
          `,
        )}
      </div>
    `;
  }

  private _renderLibraryList() {
    const crumbs = this._browseCrumbs;
    const shown = this._browseItems.slice(0, MEDIA_BROWSE_MAX_ROWS);
    const hidden = this._browseItems.length - shown.length;

    return html`
      ${crumbs.length > 1
        ? html`
            <div class="browse-crumbs">
              ${crumbs.map((c, i) =>
                i === crumbs.length - 1
                  ? html`<span class="crumb current">${c.title}</span>`
                  : html`<button class="crumb" @click=${() => this._crumbTo(i)}>${c.title}</button>
                      <ha-icon class="crumb-sep" icon="mdi:chevron-right"></ha-icon>`,
              )}
            </div>
          `
        : nothing}
      <div class="browse-list" style=${`max-height: ${this._browseHeight}px;`}>
        ${this._browseLoading
          ? // Skeleton rows: the list visibly takes shape. A spinner in this
            // spot reads as "something may be wrong" rather than "loading".
            Array.from(
              { length: MEDIA_BROWSE_SKELETON_ROWS },
              () => html`<div class="browse-row skeleton"><span class="sk-icon"></span><span class="sk-line"></span></div>`,
            )
          : this._browseError
            ? html`<div class="browse-note">${this._t("media_browse_error")}</div>`
            : shown.length === 0
              ? html`<div class="browse-note">${this._t("media_browse_empty")}</div>`
              : html`
                  ${shown.map((item) => {
                    // Hoisted out of the template: this list re-renders on
                    // every hass tick, and the thumbnail only needs checking
                    // once per item, not twice.
                    const thumb = cssUrl(item.thumbnail);
                    return html`
                      <button
                        class="browse-row"
                        aria-label=${this._tv(item.can_expand ? "media_browse_enter" : "media_browse_play", {
                          title: item.title,
                        })}
                        @click=${() => this._openItem(item)}
                      >
                        <span
                          class="browse-icon"
                          style=${thumb ? `background-image: ${thumb};` : ""}
                        >
                          ${thumb ? nothing : html`<ha-icon icon=${browseIcon(item)}></ha-icon>`}
                        </span>
                        <span class="browse-text">
                          <span class="browse-title">${item.title}</span>
                        </span>
                        ${item.can_expand
                          ? html`<ha-icon class="browse-arrow" icon="mdi:chevron-right"></ha-icon>`
                          : nothing}
                      </button>
                    `;
                  })}
                  ${hidden > 0
                    ? html`<div class="browse-note">${this._tv("media_browse_more", { n: hidden })}</div>`
                    : nothing}
                `}
      </div>
    `;
  }

  // Shared by the render and the animation frame so both draw the same wave.
  private _progressGeometry():
    | { d: string; trackStart: number; trackEnd: number; tipX: number }
    | undefined {
    const width = this._progressWidth;
    if (width <= 1) return undefined;
    const midY = MEDIA_PROGRESS_HEIGHT / 2;
    const trackEnd = width - MEDIA_PROGRESS_DOT_RADIUS;
    const duration = this._duration;

    // No duration: a short wave segment travels the bar instead of a position.
    if (duration <= 0) {
      const span = trackEnd * MEDIA_INDETERMINATE_FRACTION;
      const t = (Date.now() % MEDIA_INDETERMINATE_CYCLE_MS) / MEDIA_INDETERMINATE_CYCLE_MS;
      const from = t * (trackEnd + span) - span;
      const a = Math.max(0, from);
      const b = Math.min(trackEnd, from + span);
      return {
        d: b > a ? buildWavePath(a, b, this._progressAmplitude, MEDIA_PROGRESS_WAVELENGTH, this._progressPhase, midY) : "",
        trackStart: 0,
        trackEnd,
        tipX: b,
      };
    }

    const pos =
      this._seeking && this._seekPosition !== undefined ? this._seekPosition : this._precisePosition;
    const pct = Math.min(1, Math.max(0, pos / duration));
    const tipX = pct * trackEnd;
    const activeEnd = Math.max(0, tipX);
    return {
      d:
        activeEnd > 1
          ? buildWavePath(0, activeEnd, this._progressAmplitude, MEDIA_PROGRESS_WAVELENGTH, this._progressPhase, midY)
          : "",
      trackStart: Math.min(trackEnd, tipX + MEDIA_PROGRESS_GAP),
      trackEnd,
      tipX,
    };
  }

  private _renderProgress(duration: number, features: number) {
    const seekable = (features & FEATURE.SEEK) !== 0 && duration > 0;
    const width = this._progressWidth;
    const midY = MEDIA_PROGRESS_HEIGHT / 2;
    const geo = this._progressGeometry();
    const trackEnd = width - MEDIA_PROGRESS_DOT_RADIUS;

    const svg_ = svg`<svg
      class="progress-svg"
      viewBox="0 0 ${width} ${MEDIA_PROGRESS_HEIGHT}"
      preserveAspectRatio="none"
    >
      <path class="progress-active" d=${geo?.d ?? ""} fill="none"></path>
      <line
        class="progress-track"
        x1=${geo?.trackStart ?? 0}
        y1=${midY}
        x2=${geo?.trackEnd ?? trackEnd}
        y2=${midY}
      ></line>
      <circle class="progress-dot" cx=${trackEnd} cy=${midY} r=${MEDIA_PROGRESS_DOT_RADIUS}></circle>
      ${this._seeking
        ? svg`<circle class="progress-handle" cx=${geo?.tipX ?? 0} cy=${midY} r=${MEDIA_PROGRESS_HANDLE_RADIUS}></circle>`
        : nothing}
    </svg>`;

    if (!seekable) {
      return html`<div class="progress-slider static">${svg_}</div>`;
    }
    const pos = this._seeking && this._seekPosition !== undefined ? this._seekPosition : this._displayPosition;
    return html`
      <div
        class="progress-slider"
        role="slider"
        aria-label=${this._t("media_seek_label")}
        aria-valuemin="0"
        aria-valuemax=${Math.round(duration)}
        aria-valuenow=${Math.round(pos)}
        tabindex="0"
        @pointerdown=${this._handleSeekPointerDown}
        @pointermove=${this._handleSeekPointerMove}
        @pointerup=${this._handleSeekPointerUp}
        @pointercancel=${this._handleSeekPointerUp}
        @touchstart=${stopSwipe}
        @touchmove=${stopSwipe}
        @mousedown=${stopSwipe}
        @mousemove=${stopSwipe}
      >
        ${svg_}
      </div>
    `;
  }

  private _renderVolume(volume: number, muted: boolean, features: number) {
    // Same wavy form as the progress-card ("washing machine") bar: a visible
    // wave for the active portion, a gap, a straight track, and a round dot at
    // the end. Drawn at the measured pixel width so the dot stays circular.
    const width = this._volumeWidth;
    const midY = MEDIA_VOLUME_WAVE_HEIGHT / 2;
    const trackEndX = width - MEDIA_VOLUME_DOT_RADIUS;
    // Muted collapses the bar to empty (just track + end dot).
    const activeWidth = this._volumeActiveWidth();
    const hasActive = activeWidth > 1;
    const trackStartX = hasActive ? activeWidth + MEDIA_VOLUME_GAP : 0;
    const activePath = hasActive
      ? buildWavePath(0, activeWidth, MEDIA_VOLUME_AMPLITUDE, MEDIA_VOLUME_WAVELENGTH, this._wavePhase, midY)
      : "";
    return html`
      <div class="volume-row">
        ${features & FEATURE.VOLUME_MUTE
          ? html`
              <button
                class="mute-btn ${muted ? "active" : ""}"
                aria-label=${this._t(muted ? "media_unmute" : "media_mute")}
                aria-pressed=${muted ? "true" : "false"}
                @click=${() => this._callService("volume_mute", { is_volume_muted: !muted })}
              >
                <ha-icon icon=${muted ? "mdi:volume-off" : "mdi:volume-high"}></ha-icon>
              </button>
            `
          : nothing}
        <div
          class="volume-slider"
          role="slider"
          aria-label=${this._t("media_volume_label")}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${Math.round(volume * 100)}
          tabindex="0"
          @pointerdown=${this._handleVolumePointerDown}
          @pointermove=${this._handleVolumePointerMove}
          @pointerup=${this._handleVolumePointerUp}
          @pointercancel=${this._handleVolumePointerUp}
          @touchstart=${stopSwipe}
          @touchmove=${stopSwipe}
          @mousedown=${stopSwipe}
          @mousemove=${stopSwipe}
        >
          <svg class="volume-svg" viewBox="0 0 ${width} ${MEDIA_VOLUME_WAVE_HEIGHT}" preserveAspectRatio="none">
            ${hasActive
              ? svg`<path class="volume-active" d=${activePath} fill="none"></path>`
              : nothing}
            ${trackEndX > trackStartX
              ? svg`<line class="volume-track" x1=${trackStartX} y1=${midY} x2=${trackEndX} y2=${midY}></line>`
              : nothing}
            <circle class="volume-dot" cx=${trackEndX} cy=${midY} r=${MEDIA_VOLUME_DOT_RADIUS}></circle>
          </svg>
        </div>
      </div>
    `;
  }

  private _renderSourceSelect(sources: string[], current: string | undefined) {
    return html`
      <div class="source-row">
        ${sources.map(
          (s) => html`
            <button
              class="source-pill ${s === current ? "active" : ""}"
              @click=${() => this._callService("select_source", { source: s })}
            >
              ${s}
            </button>
          `,
        )}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      .compact-row {
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }

      .compact-row:focus-visible {
        outline: 2px solid var(--mc-accent);
        outline-offset: 2px;
        border-radius: 8px;
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
        color: var(--m3p-icon-color-fg, var(--m3p-icon-color));
      }

      .compact-text {
        flex: 1;
        min-width: 0;
      }

      .compact-name {
        font-size: 15px;
        font-weight: 700;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .compact-status {
        font-size: 12px;
        opacity: 0.65;
        color: var(--m3p-secondary-text);
      }

      .power-btn {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border: none;
        border-radius: 14px;
        background: var(--m3p-power-btn-bg);
        color: var(--mc-accent-fg, var(--mc-accent));
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .playback {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .playback-top {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .artwork {
        flex-shrink: 0;
        width: ${MEDIA_ARTWORK_SIZE}px;
        height: ${MEDIA_ARTWORK_SIZE}px;
        border-radius: ${MEDIA_ARTWORK_RADIUS}px;
        background-color: var(--m3p-artwork-bg);
        background-size: cover;
        overflow: hidden;
        background-position: center;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--mc-accent-fg, var(--mc-accent));
      }

      .artwork ha-icon {
        --mdc-icon-size: 30px;
      }

      /* No cover: a soft accent gradient rather than a flat tint, so the
         placeholder reads as deliberate instead of unloaded. */
      .artwork.fallback {
        background-image: linear-gradient(
          145deg,
          color-mix(in srgb, var(--mc-accent) 34%, transparent),
          color-mix(in srgb, var(--mc-accent) 12%, transparent)
        );
      }

      .artwork.fallback ha-icon {
        --mdc-icon-size: 34px;
        opacity: 0.9;
      }

      .meta {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .meta-title {
        font-size: 16px;
        font-weight: 700;
        line-height: 1.25;
        color: var(--m3p-text);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .meta-artist,
      .meta-source {
        display: flex;
        align-items: center;
        gap: 5px;
        color: var(--m3p-secondary-text);
        min-width: 0;
      }

      .meta-artist span,
      .meta-source span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .meta-artist ha-icon,
      .meta-source ha-icon {
        flex-shrink: 0;
        --mdc-icon-size: 14px;
        opacity: 0.8;
      }

      .meta-artist {
        font-size: 13px;
        opacity: 0.75;
      }

      .meta-source {
        font-size: 11px;
        opacity: 0.45;
      }

      .meta-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 5px;
        /* The chip row must never widen the card past the meta column. */
        min-width: 0;
      }

      .meta-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: ${MEDIA_CHIP_HEIGHT}px;
        max-width: 100%;
        padding: 0 8px;
        border-radius: ${MEDIA_CHIP_RADIUS}px;
        background: var(--m3p-transport-btn-bg);
        color: var(--m3p-secondary-text);
        font-size: 11px;
        font-weight: 600;
        min-width: 0;
      }

      .meta-chip.accent {
        background: var(--m3p-icon-bg);
        color: var(--mc-accent-fg, var(--mc-accent));
      }

      .meta-chip ha-icon {
        flex-shrink: 0;
        --mdc-icon-size: 13px;
      }

      .meta-chip span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .progress {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .progress-slider {
        width: 100%;
        height: ${MEDIA_PROGRESS_HEIGHT}px;
        cursor: pointer;
        touch-action: none;
        outline: none;
      }

      .progress-slider.static {
        cursor: default;
      }

      .progress-slider:focus-visible {
        outline: 2px solid var(--mc-accent);
        outline-offset: 2px;
        border-radius: 8px;
      }

      .progress-svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .progress-active {
        stroke: var(--mc-accent);
        stroke-width: ${MEDIA_PROGRESS_STROKE}px;
        stroke-linecap: round;
        fill: none;
      }

      .progress-dot {
        fill: var(--mc-accent);
      }

      .live-chip {
        padding: 1px 7px;
        border-radius: 7px;
        background: var(--m3p-icon-bg);
        color: var(--mc-accent-fg, var(--mc-accent));
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .progress-track {
        stroke: color-mix(in srgb, var(--primary-text-color) 16%, var(--ha-card-background, var(--card-background-color)));
        stroke-width: ${MEDIA_PROGRESS_STROKE}px;
        stroke-linecap: round;
      }

      .progress-dot {
        fill: var(--mc-accent);
      }

      .progress-handle {
        fill: var(--mc-accent);
        stroke: var(--card-background-color, #1c1c1c);
        stroke-width: 2px;
      }

      /* Tap morph: corners pull in, then settle back. */
      .transport-btn.pressed,
      .play-btn.pressed,
      .pill-toggle.pressed,
      .mute-btn.pressed {
        border-radius: ${MEDIA_PRESS_RADIUS}px;
      }

      .transport-btn,
      .pill-toggle,
      .mute-btn {
        transition:
          border-radius ${MEDIA_ICON_MORPH_MS}ms ${EASING},
          background-color ${MEDIA_ACCENT_FADE_MS}ms ease,
          color ${MEDIA_ACCENT_FADE_MS}ms ease;
      }

      .progress-times {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        opacity: 0.55;
        color: var(--m3p-text);
      }

      .transport-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }

      .transport-btn {
        flex-shrink: 0;
        width: ${MEDIA_TRANSPORT_BTN_SIZE}px;
        height: ${MEDIA_TRANSPORT_BTN_SIZE}px;
        border: none;
        border-radius: ${MEDIA_TRANSPORT_BTN_RADIUS}px;
        background: var(--m3p-transport-btn-bg);
        /* 90% of the text color rather than a literal rgba(255,255,255,.9):
           the reference design is dark-theme, this reads correctly in both. */
        color: color-mix(in srgb, var(--m3p-text) 90%, transparent);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .play-btn {
        flex-shrink: 0;
        width: ${MEDIA_PLAY_BTN_SIZE}px;
        height: ${MEDIA_PLAY_BTN_SIZE}px;
        border: none;
        /* Paused is a full circle; playing morphs to a squircle. The button
           is the transport row's state indicator, so the shape carries it. */
        border-radius: ${MEDIA_PLAY_BTN_RADIUS_PAUSED}px;
        background: var(--mc-accent);
        /* Dark ink on a filled accent, same value as todo/time/counter — the
           suite's accents are all light pastels, so a fixed dark glyph is
           readable in either theme where white would not be. */
        color: #1c1c1c;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
          border-radius ${MEDIA_ICON_MORPH_MS}ms ${EASING},
          background-color ${MEDIA_ACCENT_FADE_MS}ms ease;
      }

      .play-btn.playing {
        border-radius: ${MEDIA_PLAY_BTN_RADIUS_PLAYING}px;
      }

      .play-btn ha-icon {
        --mdc-icon-size: ${MEDIA_PLAY_ICON_SIZE}px;
      }

      .transport-btn ha-icon {
        --mdc-icon-size: ${MEDIA_TRANSPORT_ICON_SIZE}px;
      }

      .pill-toggle ha-icon {
        --mdc-icon-size: ${MEDIA_PILL_ICON_SIZE}px;
      }

      /* Both glyphs sit stacked so the swap cross-fades without a layout
         jump — the outgoing one shrinks out, the incoming one scales in. */
      .icon-stack {
        position: relative;
        width: ${MEDIA_PLAY_ICON_SIZE}px;
        height: ${MEDIA_PLAY_ICON_SIZE}px;
      }

      .icon-layer {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 1;
        transform: scale(1);
        transition:
          opacity ${MEDIA_ICON_MORPH_MS}ms ${EASING},
          transform ${MEDIA_ICON_MORPH_MS}ms ${EASING};
      }

      .icon-layer.swapped {
        opacity: 0;
        transform: scale(0.8);
      }

      .card-inner.no-animations .icon-layer {
        transition: none;
      }

      .card-inner.no-animations .play-btn {
        transition: none;
      }

      .pill-toggle {
        flex-shrink: 0;
        width: ${MEDIA_PILL_BTN_SIZE}px;
        height: ${MEDIA_PILL_BTN_SIZE}px;
        border: none;
        border-radius: ${MEDIA_PILL_BTN_RADIUS}px;
        background: var(--m3p-transport-btn-bg);
        color: color-mix(in srgb, var(--m3p-text) 75%, transparent);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Active fills with the accent, so the glyph flips to dark ink — the
         same pairing as the play button. */
      .pill-toggle.active {
        background: var(--mc-accent);
        color: #1c1c1c;
      }

      .volume-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .mute-btn {
        flex-shrink: 0;
        height: ${MEDIA_MUTE_BTN_HEIGHT}px;
        width: ${MEDIA_MUTE_BTN_HEIGHT}px;
        border: none;
        border-radius: 20px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: border-radius 300ms ${EASING};
      }

      .mute-btn.active {
        border-radius: 12px;
        background: var(--m3p-mute-active-bg);
        color: var(--mc-accent-fg, var(--mc-accent));
      }

      .card-inner.no-animations .mute-btn {
        transition: none;
      }

      .volume-slider {
        flex: 1;
        height: ${MEDIA_VOLUME_WAVE_HEIGHT}px;
        cursor: pointer;
        touch-action: none;
        outline: none;
      }

      .volume-slider:focus-visible {
        outline: 2px solid var(--mc-accent);
        outline-offset: 2px;
        border-radius: 8px;
      }

      .volume-svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .volume-active {
        stroke: var(--mc-accent);
        stroke-width: 6px;
        stroke-linecap: round;
      }

      .volume-track {
        stroke: color-mix(in srgb, var(--primary-text-color) 16%, var(--ha-card-background, var(--card-background-color)));
        stroke-width: 6px;
        stroke-linecap: round;
      }

      .volume-dot {
        fill: var(--mc-accent);
      }

      /* ---- Browser (Warteschlange + Bibliothek) ---- */
      .browser {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .browse-toggle {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        height: ${MEDIA_BROWSE_TOGGLE_HEIGHT}px;
        padding: 0 12px;
        border: none;
        border-radius: ${MEDIA_BROWSE_TOGGLE_RADIUS}px;
        background: var(--m3p-transport-btn-bg);
        color: var(--m3p-text);
        cursor: pointer;
        text-align: left;
        transition:
          border-radius ${MEDIA_ICON_MORPH_MS}ms ${EASING},
          background-color ${MEDIA_ACCENT_FADE_MS}ms ease;
      }

      .browse-toggle.open {
        border-radius: ${MEDIA_BROWSE_TAB_RADIUS_ACTIVE}px;
      }

      .card-inner.no-animations .browse-toggle,
      .card-inner.no-animations .browse-chevron,
      .card-inner.no-animations .browse-tab {
        transition: none;
      }

      .browse-toggle-icon {
        flex-shrink: 0;
        width: ${MEDIA_BROWSE_ROW_ICON_SIZE}px;
        height: ${MEDIA_BROWSE_ROW_ICON_SIZE}px;
        border-radius: ${MEDIA_BROWSE_ROW_ICON_RADIUS}px;
        background: var(--m3p-icon-bg);
        color: var(--mc-accent-fg, var(--mc-accent));
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .browse-toggle-icon ha-icon {
        --mdc-icon-size: 18px;
      }

      .browse-toggle-label {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .browse-chevron {
        flex-shrink: 0;
        --mdc-icon-size: 20px;
        color: var(--m3p-secondary-text);
        transition: transform ${MEDIA_ICON_MORPH_MS}ms ${EASING};
      }

      .browse-toggle.open .browse-chevron {
        transform: rotate(180deg);
      }

      .browse-panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .browse-tabs {
        display: flex;
        gap: 6px;
      }

      .browse-tab {
        height: ${MEDIA_BROWSE_TAB_HEIGHT}px;
        padding: 0 14px;
        border: none;
        border-radius: ${MEDIA_BROWSE_TAB_RADIUS}px;
        background: var(--m3p-transport-btn-bg);
        color: var(--m3p-secondary-text);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition:
          border-radius ${MEDIA_ICON_MORPH_MS}ms ${EASING},
          background-color ${MEDIA_ACCENT_FADE_MS}ms ease,
          color ${MEDIA_ACCENT_FADE_MS}ms ease;
      }

      .browse-tab.active {
        border-radius: ${MEDIA_BROWSE_TAB_RADIUS_ACTIVE}px;
        background: var(--mc-accent);
        color: #1c1c1c;
      }

      .browse-crumbs {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 2px;
        font-size: 11px;
        color: var(--m3p-secondary-text);
      }

      .crumb {
        border: none;
        background: none;
        padding: 2px 4px;
        font: inherit;
        color: var(--mc-accent-fg, var(--mc-accent));
        cursor: pointer;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .crumb.current {
        color: var(--m3p-secondary-text);
        cursor: default;
        font-weight: 600;
      }

      .crumb-sep {
        --mdc-icon-size: 14px;
        opacity: 0.5;
      }

      .browse-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      .browse-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
        width: 100%;
        height: ${MEDIA_BROWSE_ROW_HEIGHT}px;
        padding: 0 10px;
        border: none;
        border-radius: ${MEDIA_BROWSE_ROW_RADIUS}px;
        background: var(--m3p-transport-btn-bg);
        color: var(--m3p-text);
        cursor: pointer;
        text-align: left;
      }

      .browse-row:hover {
        background: var(--m3p-pill-active-bg);
      }

      .browse-icon {
        flex-shrink: 0;
        width: ${MEDIA_BROWSE_ROW_ICON_SIZE}px;
        height: ${MEDIA_BROWSE_ROW_ICON_SIZE}px;
        border-radius: ${MEDIA_BROWSE_ROW_ICON_RADIUS}px;
        background: var(--m3p-icon-bg) center/cover no-repeat;
        color: var(--mc-accent-fg, var(--mc-accent));
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .browse-icon ha-icon {
        --mdc-icon-size: 18px;
      }

      .browse-num {
        flex-shrink: 0;
        width: ${MEDIA_BROWSE_ROW_ICON_SIZE}px;
        height: ${MEDIA_BROWSE_ROW_ICON_SIZE}px;
        border-radius: ${MEDIA_BROWSE_ROW_ICON_RADIUS}px;
        background: var(--m3p-icon-bg);
        color: var(--mc-accent-fg, var(--mc-accent));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
      }

      .browse-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .browse-title {
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .browse-arrow {
        flex-shrink: 0;
        --mdc-icon-size: 18px;
        color: var(--m3p-secondary-text);
      }

      .browse-note {
        padding: 10px;
        font-size: 12px;
        color: var(--m3p-secondary-text);
        text-align: center;
      }

      /* Skeletons statt Spinner: die Liste nimmt sichtbar Gestalt an. */
      .browse-row.skeleton {
        cursor: default;
        opacity: 0.5;
      }

      .sk-icon {
        width: ${MEDIA_BROWSE_ROW_ICON_SIZE}px;
        height: ${MEDIA_BROWSE_ROW_ICON_SIZE}px;
        border-radius: ${MEDIA_BROWSE_ROW_ICON_RADIUS}px;
        background: var(--m3p-icon-bg);
        flex-shrink: 0;
      }

      .sk-line {
        height: 10px;
        border-radius: 5px;
        flex: 1;
        background: var(--m3p-icon-bg);
        animation: sk-pulse 1.4s ease-in-out infinite;
      }

      .card-inner.no-animations .sk-line {
        animation: none;
      }

      @keyframes sk-pulse {
        0%, 100% { opacity: 0.45; }
        50% { opacity: 0.9; }
      }

      /* The accent arrives as a CSS variable, so every property that consumes
         it cross-fades on a track change instead of snapping. SVG stroke and
         fill are transitionable, which is what keeps the waves from jumping. */
      .progress-active,
      .volume-active {
        transition: stroke ${MEDIA_ACCENT_FADE_MS}ms ease;
      }

      .progress-dot,
      .progress-handle,
      .volume-dot {
        transition: fill ${MEDIA_ACCENT_FADE_MS}ms ease;
      }

      .artwork,
      .icon-swatch,
      .browse-toggle-icon,
      .browse-icon,
      .browse-num,
      .meta-chip,
      .live-chip,
      .crumb,
      .browse-row {
        transition:
          background-color ${MEDIA_ACCENT_FADE_MS}ms ease,
          color ${MEDIA_ACCENT_FADE_MS}ms ease;
      }

      .card-inner.no-animations .progress-active,
      .card-inner.no-animations .volume-active,
      .card-inner.no-animations .progress-dot,
      .card-inner.no-animations .volume-dot,
      .card-inner.no-animations .artwork,
      .card-inner.no-animations .meta-chip,
      .card-inner.no-animations .browse-row {
        transition: none;
      }

      .source-row {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 2px;
      }

      .source-pill {
        flex-shrink: 0;
        height: 30px;
        padding: 0 12px;
        border: none;
        border-radius: 15px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        transition: border-radius 300ms ${EASING};
      }

      .source-pill.active {
        background: var(--m3p-source-active-bg);
        color: var(--mc-accent-fg, var(--mc-accent));
        border-radius: 10px;
      }

      .card-inner.no-animations .source-pill {
        transition: none;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-media-card": M3MediaCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-media-card",
  name: "M3 Media Card",
  description: "Steuerkarte für media_player-Entities mit Cover-Farbextraktion, Fortschritt und Lautstärke-Slider.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
