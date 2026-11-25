// Phone notifications for the demo, and the scenarios that cause them.
//
// The cards can set up automations that notify a phone: an appliance that is
// done, water under the sink, a device that stays unreachable, a battery
// running low. Here the same events raise the same texts as a notification
// sliding in at the top of the page, with a shade behind the bell that keeps
// the last few. The scenarios menu makes those events happen on demand.

import { CAMERA_SCENES } from "./camera-scenes.js";

const TEXT = {
  en: {
    app: "Home Assistant",
    now: "now",
    empty: "No notifications yet. Try a scenario.",
    clear: "Clear all",
    scenarios: "What happens if…",
    done: (n) => `${n} is done.`,
    started: (n, end) => `${n} has started. Done around ${end}.`,
    leak: (n) => `Water detected: ${n}`,
    leakTitle: "Water alarm",
    valve: "The main water valve was closed.",
    offline: (n, m) => `${n} has been unreachable for ${m} min.`,
    back: (n) => `${n} is reachable again.`,
    battery: (n, v) => `${n} is at ${v} %. Time for a new battery.`,
    batteryTitle: "Battery low",
    alarm: (by) => `Alarm triggered — ${by}`,
    alarmTitle: "Intruder alarm",
    ring: "Someone is at the front door.",
    ringTitle: "Doorbell",
    door: (n) => `${n} is open while nobody is home.`,
    s: {
      leak: ["mdi:water-alert", "Water under the sink", "The leak sensor reports water; the valve closes."],
      reel: ["mdi:fast-forward", "A busy household", "Washer, dishwasher and dryer finish in fast forward, the vacuum makes its round."],
      washer: ["mdi:washing-machine", "The washer finishes", "The countdown runs out; the card offers “Emptied”."],
      offline: ["mdi:wifi-off", "A sensor drops out", "Leo's room sensor goes unreachable for a while."],
      alarm: ["mdi:shield-alert", "Someone at the terrace door", "The alarm is armed and the door opens."],
      battery: ["mdi:battery-alert-variant-outline", "A battery runs low", "The remote drops below 10 %."],
      doorbell: ["mdi:doorbell-video", "Someone rings", "A visitor at the front door: the camera card goes live and offers to open the door."],
      reset: ["mdi:restore", "Back to normal", "Everything as it was."],
    },
  },
  de: {
    app: "Home Assistant",
    now: "jetzt",
    empty: "Noch keine Benachrichtigungen. Probier ein Szenario.",
    clear: "Alle löschen",
    scenarios: "Was passiert, wenn …",
    done: (n) => `${n} ist fertig.`,
    started: (n, end) => `${n} läuft. Fertig gegen ${end}.`,
    leak: (n) => `Wasser erkannt: ${n}`,
    leakTitle: "Wasseralarm",
    valve: "Der Hauptwasserhahn wurde geschlossen.",
    offline: (n, m) => `${n} ist seit ${m} Min. nicht erreichbar.`,
    back: (n) => `${n} ist wieder erreichbar.`,
    battery: (n, v) => `${n} ist bei ${v} %. Zeit für eine neue Batterie.`,
    batteryTitle: "Batterie schwach",
    alarm: (by) => `Alarm ausgelöst — ${by}`,
    alarmTitle: "Einbruchalarm",
    ring: "Jemand steht vor der Haustür.",
    ringTitle: "Klingel",
    door: (n) => `${n} ist offen, obwohl niemand zuhause ist.`,
    s: {
      leak: ["mdi:water-alert", "Wasser unter der Spüle", "Der Wassersensor schlägt an, das Ventil schließt."],
      reel: ["mdi:fast-forward", "Ein Tag im Haushalt", "Waschmaschine, Spülmaschine und Trockner laufen im Zeitraffer fertig, der Sauger dreht seine Runde."],
      washer: ["mdi:washing-machine", "Die Waschmaschine wird fertig", "Die Restzeit läuft ab, die Kachel bietet „Ausgeräumt“."],
      offline: ["mdi:wifi-off", "Ein Sensor fällt aus", "Der Sensor in Leos Zimmer ist eine Weile nicht erreichbar."],
      alarm: ["mdi:shield-alert", "Jemand an der Terrassentür", "Die Alarmanlage ist scharf, die Tür geht auf."],
      battery: ["mdi:battery-alert-variant-outline", "Eine Batterie wird schwach", "Die Fernbedienung fällt unter 10 %."],
      doorbell: ["mdi:doorbell-video", "Es klingelt", "Besuch an der Haustür: Die Kamerakarte schaltet live und bietet an, die Tür zu öffnen."],
      reset: ["mdi:restore", "Alles wieder normal", "Alles wie vorher."],
    },
  },
};

/** How long a notification stays, and the pause before the next. The show reel
 * (sim.js) spaces its appliances by the sum, so none has to wait. */
export const TOAST_MS = 6000;
export const TOAST_GAP_MS = 2000;

const STYLE = `
.m3n-btn{position:relative}
.m3n-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--error-color);color:#1c1c1c;font:700 10px/16px "Roboto Flex",Roboto,sans-serif;text-align:center;box-sizing:border-box}
.m3n-badge[hidden]{display:none}
/* A notification takes the header's place for a moment, so it never covers a card.
   Inside the phone frame (no header) it drops in under the status bar, like a phone's. */
.m3n-toasts{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;padding:6px 12px;pointer-events:none}
body.embed .m3n-toasts{position:fixed;inset:44px 0 auto 0;z-index:720;padding:0 10px}
/* While one shows, the header steps back behind it, so it doesn't sit half over the buttons. */
header>.m3n-toasts{transition:background .2s}
header>.m3n-toasts:has(.m3n-note:not(.out)){background:var(--primary-background-color)}
.m3n-toasts .m3n-note{width:min(520px,100%);box-sizing:border-box;padding:8px 14px;gap:0 12px;border-radius:20px;background:var(--card-background-color);box-shadow:0 6px 20px rgba(0,0,0,.3)}
.m3n-toasts .m3n-note .m3n-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m3n-toasts .m3n-note .m3n-title{font-size:14px}
.m3n-toasts .m3n-note .m3n-app,.m3n-toasts .m3n-note .m3n-time{font-size:11px}
.m3n-note{pointer-events:auto;display:grid;grid-template-columns:40px 1fr auto;gap:4px 12px;align-items:start;padding:14px 16px;border-radius:24px;
  background:color-mix(in srgb,var(--card-background-color) 92%,transparent);backdrop-filter:blur(18px);color:var(--primary-text-color);
  box-shadow:0 12px 32px rgba(0,0,0,.35);cursor:pointer;animation:m3n-in .38s cubic-bezier(.05,.7,.1,1)}
.m3n-note.out{animation:m3n-out .22s cubic-bezier(.3,0,.8,.15) forwards}
@keyframes m3n-in{from{transform:translateY(-16px) scale(.96);opacity:0}}
@keyframes m3n-out{to{transform:translateX(24px);opacity:0}}
.m3n-icon{grid-row:span 3;width:40px;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--note-color,var(--primary-color)) 22%,transparent);color:var(--note-color,var(--primary-color))}
.m3n-app{font:500 12px "Roboto Flex",Roboto,sans-serif;color:var(--secondary-text-color)}
.m3n-time{font:500 12px "Roboto Flex",Roboto,sans-serif;color:var(--secondary-text-color)}
.m3n-title{grid-column:2/4;font:700 15px "Roboto Flex",Roboto,sans-serif}
.m3n-text{grid-column:2/4;font:400 14px/1.35 "Roboto Flex",Roboto,sans-serif;color:var(--secondary-text-color)}
.m3n-panel{position:fixed;top:72px;right:16px;z-index:710;width:min(400px,calc(100vw - 32px));max-height:min(70vh,640px);overflow:auto;padding:12px;border-radius:28px;
  background:color-mix(in srgb,var(--card-background-color) 96%,transparent);backdrop-filter:blur(20px);box-shadow:0 16px 40px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:8px}
.m3n-panel[hidden]{display:none}
.m3n-panel h3{margin:6px 8px 4px;font:700 16px "Roboto Flex",Roboto,sans-serif;display:flex;justify-content:space-between;align-items:center}
.m3n-panel h3 button{all:unset;cursor:pointer;font:600 13px "Roboto Flex",Roboto,sans-serif;color:var(--primary-color)}
.m3n-panel .m3n-note{animation:none;box-shadow:none;background:color-mix(in srgb,var(--primary-text-color) 6%,transparent)}
.m3n-empty{padding:16px;color:var(--secondary-text-color);font:400 14px "Roboto Flex",Roboto,sans-serif}
.m3n-scn{all:unset;cursor:pointer;display:grid;grid-template-columns:40px 1fr;gap:2px 12px;align-items:center;padding:12px 14px;border-radius:20px;background:color-mix(in srgb,var(--primary-text-color) 6%,transparent)}
.m3n-scn:hover{background:color-mix(in srgb,var(--primary-text-color) 11%,transparent)}
.m3n-scn .m3n-icon{grid-row:span 2}
.m3n-scn b{font:700 14px "Roboto Flex",Roboto,sans-serif}
.m3n-scn span{font:400 13px "Roboto Flex",Roboto,sans-serif;color:var(--secondary-text-color)}
`;

export function setupNotifications(sim, header) {
  const t = () => TEXT[sim.language] ?? TEXT.en;
  const name = (id) => sim.hass.states[id]?.attributes?.friendly_name ?? id;
  const time = () => new Date().toLocaleTimeString(sim.language === "de" ? "de-DE" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  // Header buttons: scenarios and the bell.
  const before = header.querySelector(".sep");
  const scnBtn = document.createElement("button");
  scnBtn.className = "m3n-btn";
  scnBtn.innerHTML = `<ha-icon icon="mdi:play-circle-outline"></ha-icon><span class="lbl m3n-scn-label"></span>`;
  const bell = document.createElement("button");
  bell.className = "m3n-btn";
  bell.innerHTML = `<ha-icon icon="mdi:bell-outline"></ha-icon><span class="lbl m3n-bell-label"></span><span class="m3n-badge" hidden></span>`;
  header.insertBefore(scnBtn, before);
  header.insertBefore(bell, before);

  const toasts = document.createElement("div");
  toasts.className = "m3n-toasts";
  const shade = document.createElement("div");
  shade.className = "m3n-panel";
  shade.hidden = true;
  const menu = document.createElement("div");
  menu.className = "m3n-panel";
  menu.hidden = true;
  // In the header when there is one; inside the phone frame the page has none.
  (document.body.classList.contains("embed") ? document.body : header).append(toasts);
  document.body.append(shade, menu);

  const log = [];
  let unread = 0;

  const noteEl = (n) => {
    const el = document.createElement("div");
    el.className = "m3n-note";
    if (n.color) el.style.setProperty("--note-color", n.color);
    el.innerHTML = `<div class="m3n-icon"><ha-icon></ha-icon></div><span class="m3n-app"></span><span class="m3n-time"></span><span class="m3n-title"></span><span class="m3n-text"></span>`;
    el.querySelector("ha-icon").icon = n.icon;
    el.querySelector(".m3n-app").textContent = t().app;
    el.querySelector(".m3n-time").textContent = n.time;
    el.querySelector(".m3n-title").textContent = n.title;
    el.querySelector(".m3n-text").textContent = n.text;
    return el;
  };

  const updateBadge = () => {
    const badge = bell.querySelector(".m3n-badge");
    badge.hidden = unread === 0;
    badge.textContent = String(unread);
  };

  const renderShade = () => {
    shade.replaceChildren();
    const h = document.createElement("h3");
    h.textContent = sim.language === "de" ? "Benachrichtigungen" : "Notifications";
    const clear = document.createElement("button");
    clear.textContent = t().clear;
    clear.onclick = () => {
      log.length = 0;
      renderShade();
    };
    if (log.length) h.appendChild(clear);
    shade.appendChild(h);
    if (!log.length) {
      const e = document.createElement("div");
      e.className = "m3n-empty";
      e.textContent = t().empty;
      shade.appendChild(e);
    }
    for (const n of [...log].reverse()) shade.appendChild(noteEl(n));
  };

  /**
   * A notification from the card on `view`. It slides in only while that page
   * is open, so a new visitor sees it beside the card that caused it; from
   * another page it goes quietly into the shade behind the bell.
   */
  const push = (title, text, icon, color, view) => {
    // With the phone frame up, the phone shows its own notifications.
    if (window.m3DemoScenarioTarget?.()) return;
    const here = !view || window.m3DemoView?.() === view;
    const n = { title, text, icon, color, time: time() };
    log.push(n);
    if (log.length > 20) log.shift();
    if (shade.hidden) unread++;
    updateBadge();
    if (!shade.hidden) renderShade();
    if (!here) return;
    queue.push(n);
    showNext();
  };

  // One at a time, never overlapping: each stays TOAST_MS (or until tapped),
  // and the next follows TOAST_GAP_MS after it has gone.
  const queue = [];
  let showing = false;
  const showNext = () => {
    if (showing || !queue.length) return;
    showing = true;
    const el = noteEl(queue.shift());
    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      el.classList.add("out");
      setTimeout(() => el.remove(), 230);
      setTimeout(() => { showing = false; showNext(); }, TOAST_GAP_MS);
    };
    el.onclick = dismiss;
    toasts.append(el);
    setTimeout(dismiss, TOAST_MS);
  };

  // ---- the rules: what the cards' automations would send ----------------------

  const timers = {};
  sim.changeListeners.add((id, before, after) => {
    const tx = t();
    if (id === "sensor.washer_state" || id === "sensor.dishwasher_state" || id === "sensor.dryer_state") {
      if (after === "finished") push(name(id), tx.done(name(id)), "mdi:check-circle-outline", "#9dd67d", "household");
      if (after === "run" && before !== "run" && !sim.quiet) {
        const left = Number(sim.get(id.replace("_state", "_remaining"))?.state) || 60;
        const end = new Date(Date.now() + left * 60e3).toLocaleTimeString(sim.language === "de" ? "de-DE" : "en-GB", { hour: "2-digit", minute: "2-digit" });
        push(name(id), tx.started(name(id), end), "mdi:play-circle-outline", "#8db4e6", "household");
      }
    }
    if (id.startsWith("binary_sensor.") && id.endsWith("_leak") && after === "on") {
      push(tx.leakTitle, tx.leak(name(id)), "mdi:water-alert", "#6ba7dc", "security");
    }
    if (id === "event.front_door_ding" && after !== before) {
      push(tx.ringTitle, tx.ring, "mdi:doorbell-video", "#6ba7dc", "security");
    }
    if (id === "valve.main_water" && after === "closed" && before === "open") {
      push(name(id), tx.valve, "mdi:valve-closed", "#6ba7dc", "security");
    }
    if (id === "alarm_control_panel.home" && after === "triggered") {
      push(tx.alarmTitle, tx.alarm(sim.get(id).attributes.changed_by ?? "—"), "mdi:shield-alert", "#ee7d68", "security");
    }
    // Availability: the card's automation waits its delay first; here a few seconds.
    if (after === "unavailable" && before !== "unavailable") {
      const dev = sim.entities[id]?.device_id;
      if (dev && !timers[dev]) {
        timers[dev] = setTimeout(() => {
          delete timers[dev];
          const still = Object.values(sim.entities).filter((e) => e.device_id === dev).every((e) => sim.get(e.entity_id)?.state === "unavailable");
          if (still) push(sim.language === "de" ? "Gerät nicht erreichbar" : "Device unreachable", tx.offline(sim.devices[dev].name, 30), "mdi:wifi-off", "#f0c46e", "security");
        }, 3500);
      }
    }
    if (before === "unavailable" && after !== "unavailable") {
      const dev = sim.entities[id]?.device_id;
      if (dev && !timers["back" + dev]) {
        timers["back" + dev] = setTimeout(() => delete timers["back" + dev], 2000);
        push(sim.language === "de" ? "Wieder erreichbar" : "Back online", tx.back(sim.devices[dev].name), "mdi:wifi-check", "#9dd67d", "security");
      }
    }
    if (sim.get(id)?.attributes?.device_class === "battery" && Number(after) < 10 && !(Number(before) < 10) && id !== "sensor.battery_soc") {
      push(tx.batteryTitle, tx.battery(name(id), after), "mdi:battery-alert-variant-outline", "#f0c46e", "security");
    }
  });

  // ---- scenarios ---------------------------------------------------------------

  const saved = {};
  const remember = (...ids) => {
    for (const id of ids) if (!(id in saved)) saved[id] = { state: sim.get(id).state, attributes: { ...sim.get(id).attributes } };
  };
  /** The page each scenario plays on: the one with the cards it moves. */
  const SCENARIO_VIEW = { reel: "household", washer: "household", leak: "security", offline: "security", alarm: "security", battery: "security", doorbell: "security" };
  /** Opens the scenario's page first, then lets it happen there. */
  const play = (key) => {
    const view = SCENARIO_VIEW[key];
    const moved = view && window.m3DemoView?.() !== view;
    if (moved) {
      window.m3DemoNoReel?.();
      window.m3DemoGo?.(view);
    }
    setTimeout(() => SCENARIOS[key]?.(), moved ? 900 : 0);
  };
  const SCENARIOS = {
    reel: () => sim.showReel(),
    // A visitor walks up, is seen, rings, and leaves again a little later.
    doorbell: () => {
      remember("binary_sensor.front_door_person", "camera.front_door", "lock.front_door");
      sim.set("camera.front_door", undefined, { entity_picture: CAMERA_SCENES.frontPerson });
      sim.set("binary_sensor.front_door_person", "on");
      sim.flush();
      setTimeout(() => {
        sim.set("event.front_door_ding", new Date().toISOString(), { event_type: "ding" });
        sim.flush();
      }, 1500);
      setTimeout(() => {
        sim.set("binary_sensor.front_door_person", "off");
        sim.set("camera.front_door", undefined, { entity_picture: CAMERA_SCENES.front });
        sim.flush();
      }, 45_000);
    },
    leak: () => {
      remember("binary_sensor.kitchen_leak", "valve.main_water");
      sim.set("binary_sensor.kitchen_leak", "on");
      sim.flush();
      setTimeout(() => {
        sim.set("valve.main_water", "closed");
        sim.flush();
      }, 1800);
    },
    washer: () => {
      remember("sensor.washer_state", "sensor.washer_remaining", "sensor.washer_progress");
      if (sim.get("sensor.washer_state").state !== "run") {
        sim.set("sensor.washer_state", "run");
        sim.set("sensor.washer_remaining", 3);
        sim.set("sensor.washer_progress", 97);
      } else {
        sim.set("sensor.washer_remaining", 2);
        sim.set("sensor.washer_progress", 98);
      }
      sim.flush();
    },
    offline: () => {
      const ids = Object.values(sim.entities).filter((e) => e.device_id === "kids_climate").map((e) => e.entity_id);
      remember(...ids);
      for (const id of ids) sim.set(id, "unavailable");
      sim.flush();
      setTimeout(() => {
        for (const id of ids) sim.set(id, saved[id]?.state ?? "20");
        sim.flush();
      }, 15000);
    },
    alarm: () => {
      remember("alarm_control_panel.home", "binary_sensor.terrace_door");
      sim.set("alarm_control_panel.home", "armed_away", { changed_by: "Alex" });
      sim.flush();
      setTimeout(() => {
        sim.set("binary_sensor.terrace_door", "on");
        sim.set("alarm_control_panel.home", "triggered", { changed_by: name("binary_sensor.terrace_door") });
        sim.flush();
      }, 1500);
    },
    battery: () => {
      remember("sensor.living_remote_battery");
      sim.set("sensor.living_remote_battery", 7);
      sim.flush();
    },
    reset: () => {
      for (const [id, s] of Object.entries(saved)) sim.set(id, s.state, s.attributes);
      for (const k of Object.keys(saved)) delete saved[k];
      sim.flush();
    },
  };

  const renderMenu = () => {
    menu.replaceChildren();
    const h = document.createElement("h3");
    h.textContent = t().scenarios;
    menu.appendChild(h);
    for (const [key, run] of Object.entries(SCENARIOS)) {
      const [icon, title, text] = t().s[key];
      const b = document.createElement("button");
      b.className = "m3n-scn";
      b.innerHTML = `<div class="m3n-icon"><ha-icon></ha-icon></div><b></b><span></span>`;
      b.querySelector("ha-icon").icon = icon;
      b.querySelector("b").textContent = title;
      b.querySelector("span").textContent = text;
      b.onclick = () => {
        menu.hidden = true;
        // Shown in the phone frame, the scenario happens in the phone.
        const target = window.m3DemoScenarioTarget?.();
        if (target?.m3DemoRun) target.m3DemoRun(key);
        else play(key);
      };
      menu.appendChild(b);
    }
  };

  scnBtn.onclick = (e) => {
    e.stopPropagation();
    shade.hidden = true;
    renderMenu();
    menu.hidden = !menu.hidden;
  };
  bell.onclick = (e) => {
    e.stopPropagation();
    menu.hidden = true;
    shade.hidden = !shade.hidden;
    if (!shade.hidden) {
      unread = 0;
      updateBadge();
      renderShade();
    }
  };
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) menu.hidden = true;
    if (!shade.contains(e.target)) shade.hidden = true;
  });

  const label = () => {
    scnBtn.querySelector(".m3n-scn-label").textContent = sim.language === "de" ? "Szenarien" : "Scenarios";
    scnBtn.title = t().scenarios;
    bell.title = sim.language === "de" ? "Benachrichtigungen" : "Notifications";
    bell.querySelector(".m3n-bell-label").textContent = sim.language === "de" ? "Mitteilungen" : "Notifications";
  };
  label();
  window.m3DemoRun = (key) => play(key);
  return { relabel: label };
}
