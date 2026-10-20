import { describe, it, expect } from "vitest";
import {
  gradeBy,
  normalizeNegativeDb,
  withMinusSign,
  DEFAULT_RSRP_THRESHOLDS,
  DEFAULT_NR_RSRP_THRESHOLDS,
  DEFAULT_SNR_THRESHOLDS,
  toBitsPerSecond,
  scaleThroughput,
  throughputDecimals,
  formatGigabytes,
  splitVolume,
  limitGrade,
  tidyValue,
  shortenBand,
  isWarnValue,
  linkStateOf,
  normalizeTempUnit,
  gradeTemp,
  throttleStateOf,
  discoverRouterEntities,
  discoverTemperatureEntities,
  discoverThrottleEntities,
  guessRouterPrefix,
  GRADE_BARS,
} from "./router";

// The author's own ZTE MC801A, as a pyscript app publishes it. Every id here
// was read off the live instance, so a change that breaks this list breaks the
// card that prompted all of this.
const ZTE = [
  "binary_sensor.zte_download_dead",
  "binary_sensor.zte_reachable",
  "sensor.zte_5g_rsrp",
  "sensor.zte_5g_sinr",
  "sensor.zte_cell_id",
  "sensor.zte_download_bps",
  "sensor.zte_lte_pci",
  "sensor.zte_lte_rsrp",
  "sensor.zte_lte_rsrq",
  "sensor.zte_lte_snr",
  "sensor.zte_modem_main_state",
  "sensor.zte_monthly_rx_gb",
  "sensor.zte_monthly_total_gb",
  "sensor.zte_monthly_tx_gb",
  "sensor.zte_nr5g_action_band",
  "sensor.zte_nr5g_pci",
  "sensor.zte_pm_modem_5g",
  "sensor.zte_pm_sensor_mdm",
  "sensor.zte_pm_sensor_pa1",
  "sensor.zte_ppp_status",
  "sensor.zte_therm_pa_frl_level",
  "sensor.zte_therm_pa_level",
  "sensor.zte_therm_tj_level",
  "sensor.zte_upload_bps",
  "sensor.zte_wan_active_band",
  "sensor.zte_wan_lte_ca",
  "sensor.zte_watchdog_problem_seconds",
];

describe("gradeBy", () => {
  it("returns the first step the value clears", () => {
    expect(gradeBy(-75, DEFAULT_RSRP_THRESHOLDS)).toBe("excellent");
    expect(gradeBy(-80, DEFAULT_RSRP_THRESHOLDS)).toBe("excellent");
    expect(gradeBy(-81, DEFAULT_RSRP_THRESHOLDS)).toBe("good");
    expect(gradeBy(-94, DEFAULT_RSRP_THRESHOLDS)).toBe("fair");
    expect(gradeBy(-105, DEFAULT_RSRP_THRESHOLDS)).toBe("weak");
    expect(gradeBy(-130, DEFAULT_RSRP_THRESHOLDS)).toBe("bad");
  });

  it("does not trust the config's ordering", () => {
    const jumbled = [
      { min: -110, grade: "weak" as const },
      { min: -80, grade: "excellent" as const },
      { min: -100, grade: "fair" as const },
      { min: -90, grade: "good" as const },
    ];
    expect(gradeBy(-85, jumbled)).toBe("good");
  });

  it("grades NR about a step stricter than LTE", () => {
    expect(gradeBy(-88, DEFAULT_RSRP_THRESHOLDS)).toBe("good");
    expect(gradeBy(-88, DEFAULT_NR_RSRP_THRESHOLDS)).toBe("fair");
    // The author's own 5G reading, which the two scales disagree about by
    // exactly one step at the other end of the range.
    expect(gradeBy(-78, DEFAULT_RSRP_THRESHOLDS)).toBe("excellent");
    expect(gradeBy(-78, DEFAULT_NR_RSRP_THRESHOLDS)).toBe("good");
  });

  it("sorts SNR the right way up", () => {
    expect(gradeBy(16.5, DEFAULT_SNR_THRESHOLDS)).toBe("good");
    expect(gradeBy(1.2, DEFAULT_SNR_THRESHOLDS)).toBe("fair");
    expect(gradeBy(-9, DEFAULT_SNR_THRESHOLDS)).toBe("bad");
  });

  it("calls a non-number the worst case rather than throwing", () => {
    expect(gradeBy(NaN, DEFAULT_RSRP_THRESHOLDS)).toBe("bad");
  });

  it("fills a bar count for every grade", () => {
    expect(GRADE_BARS[gradeBy(-75, DEFAULT_RSRP_THRESHOLDS)]).toBe(5);
    expect(GRADE_BARS[gradeBy(-94, DEFAULT_RSRP_THRESHOLDS)]).toBe(3);
  });
});

describe("normalizeNegativeDb", () => {
  it("flips a sign-stripped reading", () => {
    expect(normalizeNegativeDb(94)).toBe(-94);
  });
  it("leaves a proper negative alone", () => {
    expect(normalizeNegativeDb(-94)).toBe(-94);
  });
  it("passes undefined through", () => {
    expect(normalizeNegativeDb(undefined)).toBeUndefined();
    expect(normalizeNegativeDb(NaN)).toBeUndefined();
  });
});

describe("withMinusSign", () => {
  it("uses U+2212, not a hyphen", () => {
    expect(withMinusSign("-94")).toBe("−94");
    expect(withMinusSign("-94").charCodeAt(0)).toBe(0x2212);
  });
});

describe("toBitsPerSecond", () => {
  it("reads the unit off the entity rather than assuming", () => {
    expect(toBitsPerSecond(6106, "bit/s")).toBe(6106);
    expect(toBitsPerSecond(6.106, "Mbit/s")).toBeCloseTo(6_106_000);
    expect(toBitsPerSecond(1, "kbit/s")).toBe(1000);
  });

  it("converts byte units, which are the same quantity", () => {
    expect(toBitsPerSecond(1, "MB/s")).toBe(8e6);
    expect(toBitsPerSecond(1, "B/s")).toBe(8);
  });

  it("treats an unknown unit as the raw bit/s reading", () => {
    expect(toBitsPerSecond(500, "widgets")).toBe(500);
    expect(toBitsPerSecond(500, undefined)).toBe(500);
  });
});

describe("scaleThroughput", () => {
  it("picks the unit the number reads best in", () => {
    expect(scaleThroughput(6106).unit).toBe("kbit/s");
    expect(scaleThroughput(43894).unit).toBe("kbit/s");
    expect(scaleThroughput(412_000_000).unit).toBe("Mbit/s");
    expect(scaleThroughput(0).unit).toBe("bit/s");
    expect(scaleThroughput(2.4e9).unit).toBe("Gbit/s");
  });

  it("keeps the bit/s figure alongside the scaled one", () => {
    const t = scaleThroughput(6_106_000);
    expect(t.bps).toBe(6_106_000);
    expect(t.value).toBeCloseTo(6.106);
  });

  it("shows fewer decimals as the number grows", () => {
    expect(throughputDecimals(0.4)).toBe(2);
    expect(throughputDecimals(6.1)).toBe(1);
    expect(throughputDecimals(41.2)).toBe(1);
    expect(throughputDecimals(412)).toBe(0);
  });
});

describe("data volume", () => {
  it("formats gigabytes and rolls over to terabytes", () => {
    expect(formatGigabytes("en", 579.54)).toBe("579.5 GB");
    expect(formatGigabytes("en", 1420)).toBe("1.42 TB");
  });

  it("writes the decimal separator the locale uses, not a point", () => {
    expect(formatGigabytes("de", 579.54)).toBe("579,5 GB");
    expect(formatGigabytes("de", 1420)).toBe("1,42 TB");
  });

  it("does not print NaN for a sensor that is not reporting", () => {
    expect(formatGigabytes("de", NaN)).toBe("–");
  });

  it("splits the bar by share", () => {
    const s = splitVolume(413.47, 166.06)!;
    expect(s.total).toBeCloseTo(579.53);
    expect(s.downShare).toBeCloseTo(0.7134, 3);
    expect(s.downShare + s.upShare).toBeCloseTo(1);
  });

  it("does not divide by zero on a fresh billing month", () => {
    const s = splitVolume(0, 0)!;
    expect(s.downShare).toBe(0.5);
    expect(Number.isFinite(s.downShare)).toBe(true);
  });

  it("returns nothing when neither direction is known", () => {
    expect(splitVolume(undefined, undefined)).toBeUndefined();
  });

  it("grades an allowance at 80 and 95 percent", () => {
    expect(limitGrade(500, 1000)).toBe("ok");
    expect(limitGrade(800, 1000)).toBe("warn");
    expect(limitGrade(960, 1000)).toBe("critical");
    expect(limitGrade(500, 0)).toBe("ok");
  });
});

describe("tidyValue", () => {
  it("shortens a band the way the modem will not", () => {
    expect(shortenBand("LTE BAND 3")).toBe("LTE B3");
    expect(shortenBand("NR BAND 78")).toBe("NR B78");
    expect(shortenBand("n1")).toBe("n1");
  });

  it("translates the vocabulary these routers publish", () => {
    expect(tidyValue("ca_activated")).toBe("An");
    expect(tidyValue("ca_deactivated")).toBe("Aus");
    expect(tidyValue("ipv4_ipv6_connected")).toBe("IPv4 + IPv6");
  });

  it("lets the config win over the built-in table", () => {
    expect(tidyValue("ca_activated", { ca_activated: "CA läuft" })).toBe("CA läuft");
  });

  it("marks the values that are not the happy case", () => {
    expect(isWarnValue("ca_deactivated")).toBe(true);
    expect(isWarnValue("ca_activated")).toBe(false);
  });
});

describe("linkStateOf", () => {
  it("reads a binary_sensor", () => {
    expect(linkStateOf("on")).toBe("online");
    expect(linkStateOf("off")).toBe("offline");
  });

  it("reads the modem's own PPP vocabulary", () => {
    expect(linkStateOf("ipv4_ipv6_connected")).toBe("online");
    expect(linkStateOf("ppp_disconnected")).toBe("offline");
  });

  it("treats an unknown connectivity state as offline, not online", () => {
    expect(linkStateOf("wobble", "connectivity")).toBe("offline");
  });

  it("treats an unrecognised free-text status as reporting something", () => {
    expect(linkStateOf("Verbunden mit LTE")).toBe("online");
  });

  it("does not invent a verdict with nothing to go on", () => {
    expect(linkStateOf(undefined)).toBe("unknown");
    expect(linkStateOf("unavailable")).toBe("unknown");
  });
});

describe("temperature", () => {
  it("turns the ZTE's bare C into a degree sign", () => {
    expect(normalizeTempUnit("C")).toBe("°C");
    expect(normalizeTempUnit("°C")).toBe("°C");
    expect(normalizeTempUnit("F")).toBe("°F");
    expect(normalizeTempUnit(undefined)).toBe("°C");
  });

  it("grades against the defaults", () => {
    expect(gradeTemp(52)).toBe("ok");
    expect(gradeTemp(64)).toBe("warn");
    expect(gradeTemp(72)).toBe("hot");
  });
});

describe("throttleStateOf", () => {
  it("is quiet while every level reads zero", () => {
    const s = throttleStateOf([
      { name: "PA", value: 0 },
      { name: "TJ", value: 0 },
    ]);
    expect(s.active).toBe(false);
    expect(s.offenders).toEqual([]);
  });

  it("names the sensor that tripped", () => {
    const s = throttleStateOf([
      { name: "PA", value: 0 },
      { name: "TJ", value: 2 },
    ]);
    expect(s.active).toBe(true);
    expect(s.offenders).toEqual(["TJ"]);
  });

  it("ignores a sensor that is not reporting", () => {
    expect(throttleStateOf([{ name: "PA", value: undefined }]).active).toBe(false);
  });
});

describe("discoverRouterEntities against the real ZTE set", () => {
  const found = discoverRouterEntities(ZTE, "zte");

  it("tells the LTE and the 5G radio apart", () => {
    expect(found.rsrp).toBe("sensor.zte_lte_rsrp");
    expect(found.nr_rsrp).toBe("sensor.zte_5g_rsrp");
    expect(found.snr).toBe("sensor.zte_lte_snr");
    expect(found.nr_snr).toBe("sensor.zte_5g_sinr");
    expect(found.pci).toBe("sensor.zte_lte_pci");
    expect(found.nr_pci).toBe("sensor.zte_nr5g_pci");
  });

  it("finds the throughput pair", () => {
    expect(found.download).toBe("sensor.zte_download_bps");
    expect(found.upload).toBe("sensor.zte_upload_bps");
  });

  it("finds the monthly volumes without confusing total with down", () => {
    expect(found.data_down).toBe("sensor.zte_monthly_rx_gb");
    expect(found.data_up).toBe("sensor.zte_monthly_tx_gb");
    expect(found.data_total).toBe("sensor.zte_monthly_total_gb");
  });

  it("finds the band, the cell and the carrier aggregation", () => {
    expect(found.band).toBe("sensor.zte_wan_active_band");
    expect(found.nr_band).toBe("sensor.zte_nr5g_action_band");
    expect(found.cell_id).toBe("sensor.zte_cell_id");
    expect(found.carrier_aggregation).toBe("sensor.zte_wan_lte_ca");
  });

  it("finds the connection entity", () => {
    expect(found.connection).toBe("binary_sensor.zte_reachable");
  });

  it("claims each entity at most once", () => {
    const values = Object.values(found);
    expect(new Set(values).size).toBe(values.length);
  });

  it("finds both modem temperatures by unit, and not the unitless PA sensor", () => {
    // sensor.zte_pm_modem_5g carries "Temp" only in its friendly name, which
    // is why this matches on the unit rather than on the id.
    const hass = {
      states: {
        "sensor.zte_pm_sensor_mdm": { attributes: { unit_of_measurement: "C" } },
        "sensor.zte_pm_modem_5g": { attributes: { unit_of_measurement: "C" } },
        "sensor.zte_pm_sensor_pa1": { attributes: {} },
        "sensor.zte_lte_rsrp": { attributes: { unit_of_measurement: "dBm" } },
      },
    } as unknown as Parameters<typeof discoverTemperatureEntities>[0];
    expect(discoverTemperatureEntities(hass, ZTE, "zte").sort()).toEqual([
      "sensor.zte_pm_modem_5g",
      "sensor.zte_pm_sensor_mdm",
    ]);
  });

  it("finds the throttle levels and nothing else", () => {
    expect(discoverThrottleEntities(ZTE, "zte").sort()).toEqual([
      "sensor.zte_therm_pa_frl_level",
      "sensor.zte_therm_pa_level",
      "sensor.zte_therm_tj_level",
    ]);
  });

  it("guesses the prefix without being told", () => {
    expect(guessRouterPrefix(ZTE)).toBe("zte");
  });

  it("does not claim a foreign entity that happens to be nearby", () => {
    const mixed = [...ZTE, "sensor.waschmaschine_power", "sensor.dobby_batterie"];
    const f = discoverRouterEntities(mixed, "zte");
    expect(Object.values(f)).not.toContain("sensor.waschmaschine_power");
  });
});

describe("discoverRouterEntities without a prefix", () => {
  it("still fills the slots for a Fritzbox-shaped set", () => {
    const fritz = [
      "binary_sensor.fritzbox_7590_connection",
      "sensor.fritzbox_7590_downstream_current",
      "sensor.fritzbox_7590_upstream_current",
      "sensor.fritzbox_7590_uptime",
    ];
    const f = discoverRouterEntities(fritz);
    expect(f.connection).toBe("binary_sensor.fritzbox_7590_connection");
    expect(f.download).toBe("sensor.fritzbox_7590_downstream_current");
    expect(f.upload).toBe("sensor.fritzbox_7590_upstream_current");
    expect(f.uptime).toBe("sensor.fritzbox_7590_uptime");
  });
});
