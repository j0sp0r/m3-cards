import { describe, expect, it } from "vitest";
import {
  applyRandomMacs,
  countFilters,
  countReconnects,
  deviceIcon,
  deviceName,
  fromList,
  fromTracker,
  ipConflicts,
  isRandomMac,
  maskMac,
  matchesFilter,
  matchesSearch,
  mergeDevices,
  normalizeMac,
  problemsOf,
  routerQuality,
  signalBars,
  sortRows,
  toMbit,
  type NetDevice,
  type Row,
} from "./network";
import { isNew, parseKnown, updateKnown, LAST_SEEN_WRITE_MS } from "./network-known";

const dev = (p: Partial<NetDevice>): NetDevice => ({ key: p.mac ?? "k", online: true, randomMac: isRandomMac(p.mac), ...p });
const row = (d: NetDevice, p: Partial<Row> = {}): Row => ({ device: d, name: d.host, icon: "x", isNew: false, problems: [], fixedIp: false, ...p });

describe("MAC", () => {
  it("normalises and spots private addresses", () => {
    expect(normalizeMac("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac("aabb.ccdd.eeff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac("nope")).toBeUndefined();
    expect(isRandomMac("DA:A1:19:00:00:01")).toBe(true);
    expect(isRandomMac("00:1A:2B:3C:4D:5E")).toBe(false);
    for (const p of ["x2", "x6", "xA", "xE"]) expect(isRandomMac(`${p.replace("x", "0")}:00:00:00:00:00`)).toBe(true);
    expect(maskMac("00:1A:2B:3C:4D:5E")).toBe("00:1A:2B:…");
  });
});

describe("sources and merging", () => {
  it("reads a tracker and a list, and merges by MAC with the first source winning", () => {
    const t = fromTracker("device_tracker.phone", {
      state: "home",
      attributes: { mac: "aa:bb:cc:dd:ee:01", ip: "192.168.0.42", host_name: "galaxy", essid: "Home", rssi: -71, band: "5GHz", friendly_name: "Phone" },
    });
    expect(t).toMatchObject({ key: "AA:BB:CC:DD:EE:01", connection: "wireless", band: "5 GHz", signal: -71, ssid: "Home", online: true });
    const l = fromList([
      { mac: "AA:BB:CC:DD:EE:01", ip: "192.168.0.99", hostname: "other", connection: "wireless" },
      { mac_addr: "AA:BB:CC:DD:EE:02", ip_addr: "192.168.0.30", hostname: "desktop", connection: "lan" },
      { hostname: "--", ip_addr: "--" },
    ]);
    expect(l).toHaveLength(2);
    expect(fromList([{ mac: "AC:00:00:00:00:09", ip: "192.168.0.9" }], "wired")[0].connection).toBe("wired");
    // An access point's list first, the router's (everything "wired") after:
    // a device on both stays wireless, one only the router knows is LAN.
    const ap = fromList([{ mac: "AC:00:00:00:00:09", signal: -50, band: "5GHz", connection: "wireless" }]);
    const rt = fromList([{ mac: "AC:00:00:00:00:09", hostname: "phone" }, { mac: "AC:00:00:00:00:10", hostname: "nas" }], "wired");
    const both = mergeDevices([ap, rt]);
    expect(both.find((d) => d.host === "phone")?.connection).toBe("wireless");
    expect(both.find((d) => d.host === "nas")?.connection).toBe("wired");
    expect(l[1]).toMatchObject({ connection: "wired", host: "desktop" });
    const m = mergeDevices([[t], l]);
    expect(m).toHaveLength(2);
    expect(m[0].ip).toBe("192.168.0.42");
  });

  it("handles private addresses as configured", () => {
    const stable = dev({ mac: "AC:00:00:00:00:01", key: "AC:00:00:00:00:01", host: "pixel" });
    const priv = dev({ mac: "3A:00:00:00:00:02", key: "3A:00:00:00:00:02", host: "Pixel", ip: "192.168.0.9" });
    expect(applyRandomMacs([stable, priv], "ignore")).toHaveLength(1);
    expect(applyRandomMacs([stable, priv], "flag")).toHaveLength(2);
    const merged = applyRandomMacs([priv, stable], "merge_by_name");
    expect(merged).toHaveLength(1);
    expect(merged[0].mac).toBe("AC:00:00:00:00:01");
  });
});

describe("names, icons, signal", () => {
  it("resolves names and guesses icons", () => {
    const d = dev({ host: "Pias-MBP", haName: undefined });
    expect(deviceName(d)).toBe("Pias-MBP");
    expect(deviceName(d, { name: "Laptop Anna" })).toBe("Laptop Anna");
    expect(deviceName(dev({}))).toBeUndefined();
    expect(deviceIcon(d)).toBe("mdi:laptop");
    expect(deviceIcon(dev({ host: "openmediavault" }))).toBe("mdi:server");
    expect(deviceIcon(dev({ host: "Samsung-Washer" }))).toBe("mdi:washing-machine");
    expect(deviceIcon(dev({}))).toBe("mdi:help-network-outline");
    expect(deviceIcon(d, { icon: "mdi:cat" })).toBe("mdi:cat");
  });

  it("grades signal and throughput", () => {
    expect([-50, -60, -70, -80].map((v) => signalBars(v))).toEqual([4, 3, 2, 1]);
    expect(routerQuality(-88, { good: -90, fair: -105 })).toBe("good");
    expect(routerQuality(-110, { good: -90, fair: -105 })).toBe("weak");
    expect(toMbit(84_200_000, "bit/s")).toBeCloseTo(84.2);
    expect(toMbit(1000, "KiB/s")).toBeCloseTo(8.192);
    expect(toMbit(12.6, "Mbit/s")).toBe(12.6);
    expect(toMbit(5, "%")).toBeUndefined();
  });
});

describe("problems", () => {
  it("finds weak signals, reconnects, IP conflicts and custom text", () => {
    const a = dev({ mac: "A8:00:00:00:00:01", key: "a", ip: "192.168.0.5", signal: -80 });
    const b = dev({ mac: "A8:00:00:00:00:02", key: "b", ip: "192.168.0.5" });
    const conflicts = ipConflicts([a, b]);
    expect(conflicts).toEqual(new Set(["a", "b"]));
    const p = problemsOf(a, { weakBelow: -75, reconnectThreshold: 10 }, { conflicts, reconnects: new Map([["a", 14]]), custom: new Map([["a", "Akku leer"]]) });
    expect(p.map((x) => x.kind)).toEqual(["weak", "reconnects", "ip_conflict", "custom"]);
    expect(problemsOf(dev({ signal: -70 }), { weakBelow: -75 }, { conflicts: new Set() })).toEqual([]);
    expect(problemsOf(a, { weakBelow: -75, ipConflict: false }, { conflicts })).toHaveLength(1);
    // A repeater: its own address and a private second one on one IP.
    const ap = dev({ mac: "8C:90:2D:00:00:01", key: "ap", ip: "192.168.0.243" });
    const apPriv = dev({ mac: "8A:80:2D:00:00:01", key: "ap2", ip: "192.168.0.243" });
    expect(ipConflicts([ap, apPriv]).size).toBe(0);
  });

  it("counts switches between home and away", () => {
    expect(countReconnects([{ s: "home" }, { s: "not_home" }, { s: "home" }, { s: "unavailable" }, { s: "home" }])).toBe(2);
    expect(countReconnects(undefined)).toBe(0);
  });
});

describe("filters, search, order", () => {
  const n = row(dev({ key: "n", host: "zeta" }), { isNew: true });
  const p = row(dev({ key: "p", host: "yankee", connection: "wireless" }), { problems: [{ kind: "weak" }] });
  const w = row(dev({ key: "w", host: "alpha", connection: "wired", ip: "192.168.0.30", mac: "AA:BB:CC:00:00:01" }));
  const o = row(dev({ key: "o", host: "beta", online: false }));
  it("sorts new, problems, online, offline", () => {
    expect(sortRows([o, w, p, n], new Intl.Collator("de")).map((r) => r.device.key)).toEqual(["n", "p", "w", "o"]);
  });
  it("filters and searches together", () => {
    expect(matchesFilter(w, "lan")).toBe(true);
    expect(matchesFilter(o, "lan")).toBe(false);
    expect(matchesSearch(w, "0.30")).toBe(true);
    expect(matchesSearch(w, "aabbcc")).toBe(true);
    expect(matchesSearch(w, "beta")).toBe(false);
    const c = countFilters([n, p, w, o]);
    expect(c).toMatchObject({ all: 3, new: 1, problems: 1, wifi: 1, lan: 1, offline: 1 });
  });
});

describe("known devices", () => {
  it("takes everything on the first run as known, then marks newcomers", () => {
    const first = updateKnown({}, ["a", "b"], 1000);
    expect(Object.values(first).every((e) => e.known)).toBe(true);
    const later = updateKnown(first, ["a", "b", "c"], 2000);
    expect(isNew(later.c)).toBe(true);
    expect(later.c.first).toBe(2000);
    expect(isNew(later.a)).toBe(false);
  });
  it("writes last seen only now and then", () => {
    const m = updateKnown({}, ["a"], 0);
    expect(updateKnown(m, ["a"], LAST_SEEN_WRITE_MS - 1)).toBe(m);
    expect(updateKnown(m, ["a"], LAST_SEEN_WRITE_MS).a.last).toBe(LAST_SEEN_WRITE_MS);
  });
  it("reads only sound entries", () => {
    expect(parseKnown({ a: { first: 1, known: true, name: "x" }, b: { first: "x" }, c: 3 })).toEqual({ a: { first: 1, last: undefined, known: true, name: "x", icon: undefined, ignored: undefined, notified: undefined, ip: undefined, host: undefined } });
  });
});
