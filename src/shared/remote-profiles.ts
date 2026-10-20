// What each integration calls each button, and what the card may draw as a
// result.
//
// One card with profiles rather than one card per brand: the devices differ in
// their key names and in which blocks make sense, not in the shape of a remote
// control. A profile is therefore a table of defaults, and every entry of it
// stays overridable from the config.

import type { HomeAssistant } from "../types";

export type RemoteProfile = "generic" | "samsung" | "google_tv" | "lg_webos" | "appletv" | "kodi";

export const REMOTE_PROFILES: RemoteProfile[] = [
  "generic", "samsung", "google_tv", "lg_webos", "appletv", "kodi",
];

/** Every button the card knows how to draw, by what it *means*. */
export type RemoteKey =
  | "up" | "down" | "left" | "right" | "ok"
  | "back" | "home" | "menu" | "info" | "more" | "settings" | "exit" | "guide"
  | "volume_up" | "volume_down" | "mute"
  | "channel_up" | "channel_down" | "channel_list"
  | "play_pause" | "play" | "pause" | "stop" | "rewind" | "fast_forward"
  | "previous" | "next"
  | "assistant" | "keyboard" | "source"
  | "digit_0" | "digit_1" | "digit_2" | "digit_3" | "digit_4"
  | "digit_5" | "digit_6" | "digit_7" | "digit_8" | "digit_9"
  | "dash" | "enter";

/**
 * How a key is sent.
 *
 * `command` goes through `remote.send_command`; `service` is a plain service
 * call on the media entity. A key with neither is one this device cannot do,
 * and the card leaves it out rather than drawing a button that fails silently.
 */
export interface KeyBinding {
  command?: string;
  service?: string;
  /** Extra service data, e.g. `{ is_volume_muted: true }`. */
  data?: Record<string, unknown>;
  /** The domain to call, when it is not the media entity's own. */
  domain?: string;
}

export type KeyMap = Partial<Record<RemoteKey, KeyBinding>>;

// ---- the key tables ---------------------------------------------------------

/**
 * Samsung's websocket vocabulary, as the `samsungtv` integration forwards it.
 *
 * `remote.send_command` passes these through untouched, so the list is the
 * TV's own, not Home Assistant's. Volume and transport are routed through the
 * media_player instead where the integration supports them: those are the keys
 * that also move the slider in HA's own UI, and a TV that is muted by KEY_MUTE
 * does not tell the media_player about it.
 */
const SAMSUNG_KEYS: KeyMap = {
  up: { command: "KEY_UP" },
  down: { command: "KEY_DOWN" },
  left: { command: "KEY_LEFT" },
  right: { command: "KEY_RIGHT" },
  ok: { command: "KEY_ENTER" },
  back: { command: "KEY_RETURN" },
  home: { command: "KEY_HOME" },
  menu: { command: "KEY_MENU" },
  info: { command: "KEY_INFO" },
  more: { command: "KEY_MORE" },
  exit: { command: "KEY_EXIT" },
  guide: { command: "KEY_GUIDE" },
  source: { command: "KEY_SOURCE" },
  volume_up: { service: "volume_up" },
  volume_down: { service: "volume_down" },
  mute: { service: "volume_mute" },
  channel_up: { command: "KEY_CHUP" },
  channel_down: { command: "KEY_CHDOWN" },
  channel_list: { command: "KEY_CH_LIST" },
  play_pause: { command: "KEY_PLAY_PAUSE" },
  play: { service: "media_play" },
  pause: { service: "media_pause" },
  stop: { service: "media_stop" },
  rewind: { command: "KEY_REWIND" },
  fast_forward: { command: "KEY_FF" },
  previous: { service: "media_previous_track" },
  next: { service: "media_next_track" },
  digit_0: { command: "KEY_0" }, digit_1: { command: "KEY_1" },
  digit_2: { command: "KEY_2" }, digit_3: { command: "KEY_3" },
  digit_4: { command: "KEY_4" }, digit_5: { command: "KEY_5" },
  digit_6: { command: "KEY_6" }, digit_7: { command: "KEY_7" },
  digit_8: { command: "KEY_8" }, digit_9: { command: "KEY_9" },
  dash: { command: "KEY_MINUS" },
  enter: { command: "KEY_ENTER" },
};

/**
 * Android TV, as the `androidtv_remote` integration names the keycodes.
 *
 * These are Android's own `KEYCODE_*` names with the prefix dropped, which is
 * what that integration expects. A command it does not recognise as a keycode
 * is **typed as text**, which is what makes the keyboard dialog possible at
 * all.
 */
const ANDROID_TV_KEYS: KeyMap = {
  up: { command: "DPAD_UP" },
  down: { command: "DPAD_DOWN" },
  left: { command: "DPAD_LEFT" },
  right: { command: "DPAD_RIGHT" },
  ok: { command: "DPAD_CENTER" },
  back: { command: "BACK" },
  home: { command: "HOME" },
  menu: { command: "MENU" },
  settings: { command: "SETTINGS" },
  info: { command: "INFO" },
  volume_up: { command: "VOLUME_UP" },
  volume_down: { command: "VOLUME_DOWN" },
  mute: { command: "VOLUME_MUTE" },
  channel_up: { command: "CHANNEL_UP" },
  channel_down: { command: "CHANNEL_DOWN" },
  play_pause: { command: "MEDIA_PLAY_PAUSE" },
  play: { command: "MEDIA_PLAY" },
  pause: { command: "MEDIA_PAUSE" },
  stop: { command: "MEDIA_STOP" },
  rewind: { command: "MEDIA_REWIND" },
  fast_forward: { command: "MEDIA_FAST_FORWARD" },
  previous: { command: "MEDIA_PREVIOUS" },
  next: { command: "MEDIA_NEXT" },
  assistant: { command: "SEARCH" },
  source: { command: "TV_INPUT" },
  digit_0: { command: "0" }, digit_1: { command: "1" },
  digit_2: { command: "2" }, digit_3: { command: "3" },
  digit_4: { command: "4" }, digit_5: { command: "5" },
  digit_6: { command: "6" }, digit_7: { command: "7" },
  digit_8: { command: "8" }, digit_9: { command: "9" },
  enter: { command: "ENTER" },
};

/** LG webOS. Its buttons go through `webostv.button`, not `remote.send_command`. */
const WEBOS_KEYS: KeyMap = {
  up: { domain: "webostv", service: "button", data: { button: "UP" } },
  down: { domain: "webostv", service: "button", data: { button: "DOWN" } },
  left: { domain: "webostv", service: "button", data: { button: "LEFT" } },
  right: { domain: "webostv", service: "button", data: { button: "RIGHT" } },
  ok: { domain: "webostv", service: "button", data: { button: "ENTER" } },
  back: { domain: "webostv", service: "button", data: { button: "BACK" } },
  home: { domain: "webostv", service: "button", data: { button: "HOME" } },
  menu: { domain: "webostv", service: "button", data: { button: "MENU" } },
  info: { domain: "webostv", service: "button", data: { button: "INFO" } },
  exit: { domain: "webostv", service: "button", data: { button: "EXIT" } },
  channel_up: { domain: "webostv", service: "button", data: { button: "CHANNELUP" } },
  channel_down: { domain: "webostv", service: "button", data: { button: "CHANNELDOWN" } },
  volume_up: { service: "volume_up" },
  volume_down: { service: "volume_down" },
  mute: { service: "volume_mute" },
  play_pause: { service: "media_play_pause" },
  previous: { service: "media_previous_track" },
  next: { service: "media_next_track" },
};

/** Apple TV, whose `remote.send_command` takes lower-case names. */
const APPLETV_KEYS: KeyMap = {
  up: { command: "up" },
  down: { command: "down" },
  left: { command: "left" },
  right: { command: "right" },
  ok: { command: "select" },
  back: { command: "menu" },
  home: { command: "home" },
  menu: { command: "home_hold" },
  volume_up: { command: "volume_up" },
  volume_down: { command: "volume_down" },
  play_pause: { command: "play_pause" },
  play: { command: "play" },
  pause: { command: "pause" },
  stop: { command: "stop" },
  rewind: { command: "skip_backward" },
  fast_forward: { command: "skip_forward" },
  previous: { command: "previous" },
  next: { command: "next" },
  settings: { command: "top_menu" },
};

/** Kodi, driven through its JSON-RPC bridge rather than a remote entity. */
const KODI_KEYS: KeyMap = {
  up: { domain: "kodi", service: "call_method", data: { method: "Input.Up" } },
  down: { domain: "kodi", service: "call_method", data: { method: "Input.Down" } },
  left: { domain: "kodi", service: "call_method", data: { method: "Input.Left" } },
  right: { domain: "kodi", service: "call_method", data: { method: "Input.Right" } },
  ok: { domain: "kodi", service: "call_method", data: { method: "Input.Select" } },
  back: { domain: "kodi", service: "call_method", data: { method: "Input.Back" } },
  home: { domain: "kodi", service: "call_method", data: { method: "Input.Home" } },
  info: { domain: "kodi", service: "call_method", data: { method: "Input.Info" } },
  menu: { domain: "kodi", service: "call_method", data: { method: "Input.ContextMenu" } },
  volume_up: { service: "volume_up" },
  volume_down: { service: "volume_down" },
  mute: { service: "volume_mute" },
  play_pause: { service: "media_play_pause" },
  stop: { service: "media_stop" },
  previous: { service: "media_previous_track" },
  next: { service: "media_next_track" },
};

/**
 * Nothing brand-specific: only what every `media_player` offers.
 *
 * This is also what a Chromecast gets, and the reason the card has to cope
 * with having no directional keys at all.
 */
const GENERIC_KEYS: KeyMap = {
  volume_up: { service: "volume_up" },
  volume_down: { service: "volume_down" },
  mute: { service: "volume_mute" },
  play_pause: { service: "media_play_pause" },
  play: { service: "media_play" },
  pause: { service: "media_pause" },
  stop: { service: "media_stop" },
  previous: { service: "media_previous_track" },
  next: { service: "media_next_track" },
};

export const PROFILE_KEYS: Record<RemoteProfile, KeyMap> = {
  generic: GENERIC_KEYS,
  samsung: SAMSUNG_KEYS,
  google_tv: ANDROID_TV_KEYS,
  lg_webos: WEBOS_KEYS,
  appletv: APPLETV_KEYS,
  kodi: KODI_KEYS,
};

// ---- what each profile shows ------------------------------------------------

export type RightColumn = "auto" | "channel" | "assistant" | "custom" | "none";

export interface ProfileDefaults {
  icon: string;
  accent: string;
  rightColumn: Exclude<RightColumn, "auto" | "custom">;
  showNowPlaying: boolean;
  showTransport: boolean;
  appStyle: "chips" | "tiles";
  functionKeys: RemoteKey[];
  /** True when the integration can type arbitrary text. */
  textEntry: boolean;
}

export const PROFILE_DEFAULTS: Record<RemoteProfile, ProfileDefaults> = {
  generic: {
    icon: "mdi:television",
    accent: "#85b7eb",
    rightColumn: "none",
    showNowPlaying: true,
    showTransport: true,
    appStyle: "chips",
    functionKeys: ["back", "home", "menu", "info", "more"],
    textEntry: false,
  },
  samsung: {
    icon: "mdi:television",
    accent: "#f0c46e",
    rightColumn: "channel",
    // A TV is watched, not browsed: the title of what is on a broadcast
    // channel is not something the integration knows, so the bar would be a
    // permanently empty row.
    showNowPlaying: false,
    showTransport: true,
    appStyle: "chips",
    functionKeys: ["back", "home", "menu", "info", "more"],
    textEntry: false,
  },
  google_tv: {
    icon: "mdi:android",
    accent: "#85b7eb",
    rightColumn: "assistant",
    showNowPlaying: true,
    // Transport lives in the now-playing bar on a device that always knows
    // what it is playing; a second copy underneath is furniture.
    showTransport: false,
    appStyle: "tiles",
    functionKeys: ["back", "home", "rewind", "fast_forward", "settings"],
    textEntry: true,
  },
  lg_webos: {
    icon: "mdi:television",
    accent: "#e57368",
    rightColumn: "channel",
    showNowPlaying: false,
    showTransport: true,
    appStyle: "chips",
    functionKeys: ["back", "home", "menu", "info", "exit"],
    textEntry: false,
  },
  appletv: {
    icon: "mdi:apple",
    accent: "#b8c4c9",
    rightColumn: "none",
    showNowPlaying: true,
    showTransport: false,
    appStyle: "tiles",
    functionKeys: ["back", "home", "rewind", "fast_forward", "settings"],
    textEntry: false,
  },
  kodi: {
    icon: "mdi:play-box-outline",
    accent: "#5dcaa5",
    rightColumn: "none",
    showNowPlaying: true,
    showTransport: true,
    appStyle: "chips",
    functionKeys: ["back", "home", "menu", "info", "more"],
    textEntry: false,
  },
};

/** The icon each key is drawn with. */
export const KEY_ICONS: Record<RemoteKey, string> = {
  up: "mdi:chevron-up", down: "mdi:chevron-down",
  left: "mdi:chevron-left", right: "mdi:chevron-right",
  ok: "mdi:circle-small",
  back: "mdi:arrow-u-left-top", home: "mdi:home-outline",
  menu: "mdi:menu", info: "mdi:information-outline",
  more: "mdi:dots-vertical", settings: "mdi:cog-outline",
  exit: "mdi:close", guide: "mdi:table-of-contents",
  volume_up: "mdi:plus", volume_down: "mdi:minus", mute: "mdi:volume-high",
  channel_up: "mdi:chevron-up", channel_down: "mdi:chevron-down",
  channel_list: "mdi:format-list-bulleted",
  play_pause: "mdi:play-pause", play: "mdi:play", pause: "mdi:pause",
  stop: "mdi:stop", rewind: "mdi:rewind-10", fast_forward: "mdi:fast-forward-10",
  previous: "mdi:skip-previous", next: "mdi:skip-next",
  assistant: "mdi:microphone", keyboard: "mdi:keyboard-outline",
  source: "mdi:import",
  digit_0: "mdi:numeric-0", digit_1: "mdi:numeric-1", digit_2: "mdi:numeric-2",
  digit_3: "mdi:numeric-3", digit_4: "mdi:numeric-4", digit_5: "mdi:numeric-5",
  digit_6: "mdi:numeric-6", digit_7: "mdi:numeric-7", digit_8: "mdi:numeric-8",
  digit_9: "mdi:numeric-9",
  dash: "mdi:minus", enter: "mdi:keyboard-return",
};

// ---- detection --------------------------------------------------------------

/** Which profile an integration implies. */
export function profileForPlatform(platform: string | undefined): RemoteProfile {
  switch (platform) {
    case "samsungtv": return "samsung";
    case "androidtv_remote": return "google_tv";
    case "webostv": return "lg_webos";
    case "apple_tv": return "appletv";
    case "kodi": return "kodi";
    default: return "generic";
  }
}

/** MediaPlayerEntityFeature, as far as this card cares. */
export const MP_FEATURE = {
  PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16, NEXT_TRACK: 32, TURN_ON: 128, TURN_OFF: 256,
  PLAY_MEDIA: 512, VOLUME_STEP: 1024, SELECT_SOURCE: 2048, STOP: 4096,
  PLAY: 16384, BROWSE_MEDIA: 131072,
} as const;

export function hasFeature(supported: number | undefined, bit: number): boolean {
  return ((supported ?? 0) & bit) === bit;
}

export interface Capabilities {
  /** A `remote.*` entity is present, so `send_command` keys can be sent. */
  sendCommand: boolean;
  volume: boolean;
  transport: boolean;
  selectSource: boolean;
  power: boolean;
  /** The media entity reports what it is playing. */
  metadata: boolean;
}

/**
 * What this pair of entities can actually do.
 *
 * The point is to **leave buttons out** rather than draw ones that do nothing.
 * A Chromecast has no `remote` entity and no volume feature, so it gets a
 * now-playing bar and a transport row and no directional ring at all — which
 * is the honest card for that device, and a good deal better than a ring whose
 * every press is swallowed.
 */
export function capabilitiesOf(
  hass: HomeAssistant | undefined,
  remoteEntity: string | undefined,
  mediaEntity: string | undefined,
  profile: RemoteProfile,
): Capabilities {
  const media = mediaEntity ? hass?.states[mediaEntity] : undefined;
  const supported = media?.attributes.supported_features as number | undefined;
  const keys = PROFILE_KEYS[profile];
  // webOS and Kodi reach their directional keys through their own service
  // domain, so they need no remote entity to have a working ring.
  const viaOwnDomain = !!keys.up?.domain;
  return {
    sendCommand: !!remoteEntity || viaOwnDomain,
    volume:
      hasFeature(supported, MP_FEATURE.VOLUME_STEP) ||
      hasFeature(supported, MP_FEATURE.VOLUME_SET) ||
      (!!remoteEntity && !!keys.volume_up?.command),
    transport:
      hasFeature(supported, MP_FEATURE.PLAY) ||
      hasFeature(supported, MP_FEATURE.PAUSE) ||
      (!!remoteEntity && !!keys.play_pause?.command),
    selectSource: hasFeature(supported, MP_FEATURE.SELECT_SOURCE),
    power:
      hasFeature(supported, MP_FEATURE.TURN_OFF) ||
      hasFeature(supported, MP_FEATURE.TURN_ON) ||
      !!remoteEntity,
    metadata: !!media?.attributes.media_title || !!media?.attributes.app_name,
  };
}

// ---- turning a key into a call ---------------------------------------------

export interface ResolvedCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

/**
 * The service call one key means, or undefined when this device cannot.
 *
 * Overrides win over the profile, so a config can fix a single exotic key
 * without restating the table.
 */
export function resolveKey(
  key: RemoteKey,
  profile: RemoteProfile,
  overrides: KeyMap | undefined,
  remoteEntity: string | undefined,
  mediaEntity: string | undefined,
): ResolvedCall | undefined {
  const binding = overrides?.[key] ?? PROFILE_KEYS[profile][key];
  if (!binding) return undefined;

  if (binding.command) {
    if (!remoteEntity) return undefined;
    return {
      domain: "remote",
      service: "send_command",
      data: { entity_id: remoteEntity, command: binding.command },
    };
  }

  if (!binding.service) return undefined;
  const domain = binding.domain ?? "media_player";
  const target = domain === "media_player" ? mediaEntity : (mediaEntity ?? remoteEntity);
  if (!target) return undefined;
  return {
    domain,
    service: binding.service,
    data: { entity_id: target, ...(binding.data ?? {}) },
  };
}

/** The text-entry call, for the integrations that accept free text. */
export function resolveTextEntry(
  text: string,
  profile: RemoteProfile,
  remoteEntity: string | undefined,
): ResolvedCall | undefined {
  if (!remoteEntity || !PROFILE_DEFAULTS[profile].textEntry || !text) return undefined;
  return {
    domain: "remote",
    service: "send_command",
    data: { entity_id: remoteEntity, command: text },
  };
}

// ---- now playing ------------------------------------------------------------

/**
 * Where playback has reached, counted on from the last report.
 *
 * `media_position` only updates when something changes, so a card that drew it
 * raw would show a progress bar frozen at the moment the track started. The
 * integration also tells us *when* it last measured, which is what makes
 * counting on from it correct rather than a guess.
 */
export function currentPosition(
  attributes: Record<string, unknown> | undefined,
  state: string | undefined,
  nowMs = Date.now(),
): number | undefined {
  const base = Number(attributes?.media_position);
  if (!Number.isFinite(base)) return undefined;
  if (state !== "playing") return base;
  const updatedAt = attributes?.media_position_updated_at;
  if (typeof updatedAt !== "string") return base;
  const since = (nowMs - new Date(updatedAt).getTime()) / 1000;
  if (!Number.isFinite(since) || since < 0) return base;
  const duration = Number(attributes?.media_duration);
  const value = base + since;
  return Number.isFinite(duration) && duration > 0 ? Math.min(value, duration) : value;
}

/** `m:ss`, or `h:mm:ss` once it runs past an hour. */
export function formatPosition(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "–";
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * Whether an app entry is the one currently in front.
 *
 * Matched loosely on purpose: a media_player reports `app_name` as "SmartTube"
 * or "YouTube" for what the card's list calls "YouTube", and an exact compare
 * would mark nothing.
 */
export function isAppActive(
  appName: string | undefined,
  source: string | undefined,
  entryName: string,
  entryId?: string,
): boolean {
  const candidates = [appName, source].filter((v): v is string => !!v).map((v) => v.toLowerCase());
  if (!candidates.length) return false;
  const name = entryName.toLowerCase();
  const id = entryId?.toLowerCase();
  return candidates.some((c) => c === name || c === id || c.includes(name) || name.includes(c));
}
