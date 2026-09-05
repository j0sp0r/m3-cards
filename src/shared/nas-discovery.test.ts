import { describe, it, expect } from "vitest";
import {
  discoverHostEntities,
  labelFromUniqueId,
  prettyLabel,
  prettyMount,
  prettySynologyVolume,
  resolveDiskSize,
  synologyKey,
  synologyLabel,
  systemMonitorLabel,
  volumeHealth,
  type HostRegistryEntry,
} from "./nas-discovery";

const GLANCES_ENTRY = "01hglances";

/** Shape of a Glances registry entry: `<config_entry_id>-<mount>-<key>`. */
function glances(key: string, label: string, entityId: string): HostRegistryEntry {
  return {
    entity_id: entityId,
    platform: "glances",
    translation_key: key,
    unique_id: `${GLANCES_ENTRY}-${label}-${key}`,
    config_entry_id: GLANCES_ENTRY,
  };
}

/**
 * Verbatim from a live Synology DSM instance's entity registry (DS with one
 * volume and one drive). Serial and API path are the real ones — the parser
 * has to survive both.
 */
const SYNOLOGY_REGISTRY: HostRegistryEntry[] = [
  {
    entity_id: "sensor.nas_cpu_utilization_total",
    platform: "synology_dsm",
    translation_key: "cpu_total_load",
    unique_id: "2240QDNAXTY69_SYNO.Core.System.Utilization:cpu_total_load",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_cpu_load_average_5_min",
    platform: "synology_dsm",
    translation_key: "cpu_5min_load",
    unique_id: "2240QDNAXTY69_SYNO.Core.System.Utilization:cpu_5min_load",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_memory_usage_real",
    platform: "synology_dsm",
    translation_key: "memory_real_usage",
    unique_id: "2240QDNAXTY69_SYNO.Core.System.Utilization:memory_real_usage",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_memory_total_real",
    platform: "synology_dsm",
    translation_key: "memory_total_real",
    unique_id: "2240QDNAXTY69_SYNO.Core.System.Utilization:memory_total_real",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_download_throughput",
    platform: "synology_dsm",
    translation_key: "network_down",
    unique_id: "2240QDNAXTY69_SYNO.Core.System.Utilization:network_down",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_upload_throughput",
    platform: "synology_dsm",
    translation_key: "network_up",
    unique_id: "2240QDNAXTY69_SYNO.Core.System.Utilization:network_up",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_volume_1_volume_used",
    platform: "synology_dsm",
    translation_key: "volume_percentage_used",
    unique_id: "2240QDNAXTY69_SYNO.Storage.CGI.Storage:volume_percentage_used_volume_1",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_volume_1_used_space",
    platform: "synology_dsm",
    translation_key: "volume_size_used",
    unique_id: "2240QDNAXTY69_SYNO.Storage.CGI.Storage:volume_size_used_volume_1",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_volume_1_total_size",
    platform: "synology_dsm",
    translation_key: "volume_size_total",
    unique_id: "2240QDNAXTY69_SYNO.Storage.CGI.Storage:volume_size_total_volume_1",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_volume_1_status",
    platform: "synology_dsm",
    translation_key: "volume_status",
    unique_id: "2240QDNAXTY69_SYNO.Storage.CGI.Storage:volume_status_volume_1",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_drive_1_temperature",
    platform: "synology_dsm",
    translation_key: "disk_temp",
    unique_id: "2240QDNAXTY69_SYNO.Storage.CGI.Storage:disk_temp_sda",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_temperature",
    platform: "synology_dsm",
    translation_key: "temperature",
    unique_id: "2240QDNAXTY69_SYNO.DSM.Info:temperature",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "sensor.nas_drive_1_status",
    platform: "synology_dsm",
    translation_key: "disk_status",
    unique_id: "2240QDNAXTY69_SYNO.Storage.CGI.Storage:disk_status_sda",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "binary_sensor.nas_security_status",
    platform: "synology_dsm",
    translation_key: "status",
    unique_id: "2240QDNAXTY69_SYNO.Core.SecurityScan.Status:status",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "select.nas_fan_speed_mode",
    platform: "synology_dsm",
    translation_key: "fan_speed_mode",
    unique_id: "2240QDNAXTY69_SYNO.Core.Hardware:fan_speed_mode",
    config_entry_id: "01KZDX5AZZ",
  },
  {
    entity_id: "update.nas_dsm_update",
    platform: "synology_dsm",
    translation_key: "update",
    unique_id: "2240QDNAXTY69_SYNO.Core.Upgrade:update",
    config_entry_id: "01KZDX5AZZ",
  },
  // Uptime carries no translation_key at all — it has to be found by unique_id.
  {
    entity_id: "sensor.nas_uptime",
    platform: "synology_dsm",
    translation_key: null,
    unique_id: "2240QDNAXTY69_SYNO.DSM.Info:uptime",
    config_entry_id: "01KZDX5AZZ",
  },
];

function ids(list: { entityId: string }[] | undefined): string[] {
  return (list ?? []).map((e) => e.entityId);
}

describe("discoverHostEntities — glances", () => {
  const registry: HostRegistryEntry[] = [
    glances("disk_usage", "/rootfs", "sensor.glances_rootfs_disk_used_percent"),
    glances("disk_used", "/rootfs", "sensor.glances_rootfs_disk_used"),
    glances("disk_size", "/rootfs", "sensor.glances_rootfs_disk_size"),
    glances("disk_free", "/rootfs", "sensor.glances_rootfs_disk_free"),
    glances("disk_usage", "/rootfs/srv/dev-disk-by-uuid-43ab00ff", "sensor.glances_srv_disk_used_percent"),
    glances("cpu_usage", "cpu", "sensor.glances_cpu_used"),
    glances("memory_usage", "memory", "sensor.glances_memory_used_percent"),
    glances("temperature", "nvme0", "sensor.glances_nvme0_temperature"),
    glances("network_rx", "eth0", "sensor.glances_eth0_rx"),
    glances("network_tx", "eth0", "sensor.glances_eth0_tx"),
    glances("uptime", "uptime", "sensor.glances_uptime"),
    glances("container_cpu_usage", "addon", "sensor.glances_addon_cpu"),
  ];

  it("maps every Glances key onto the internal vocabulary", () => {
    const { byMetric } = discoverHostEntities(registry, "glances");
    expect(ids(byMetric.disk_usage)).toEqual([
      "sensor.glances_rootfs_disk_used_percent",
      "sensor.glances_srv_disk_used_percent",
    ]);
    expect(ids(byMetric.disk_used)).toEqual(["sensor.glances_rootfs_disk_used"]);
    expect(ids(byMetric.disk_size)).toEqual(["sensor.glances_rootfs_disk_size"]);
    expect(ids(byMetric.disk_free)).toEqual(["sensor.glances_rootfs_disk_free"]);
    expect(ids(byMetric.cpu_usage)).toEqual(["sensor.glances_cpu_used"]);
    expect(ids(byMetric.memory_usage)).toEqual(["sensor.glances_memory_used_percent"]);
    expect(ids(byMetric.temperature)).toEqual(["sensor.glances_nvme0_temperature"]);
    expect(ids(byMetric.network_rx)).toEqual(["sensor.glances_eth0_rx"]);
    expect(ids(byMetric.network_tx)).toEqual(["sensor.glances_eth0_tx"]);
    expect(ids(byMetric.uptime)).toEqual(["sensor.glances_uptime"]);
    // Nothing Glances-only leaks in, and no source grew a volume_status.
    expect(byMetric.volume_status).toBeUndefined();
  });

  it("labels Glances entities with the mount point from the unique_id", () => {
    const { byMetric } = discoverHostEntities(registry, "glances");
    expect(byMetric.disk_usage?.map((e) => e.label)).toEqual([
      "/rootfs",
      "/rootfs/srv/dev-disk-by-uuid-43ab00ff",
    ]);
    expect(byMetric.temperature?.[0].label).toBe("nvme0");
  });

  it("narrows to one config entry and skips disabled entities", () => {
    const other = { ...glances("disk_usage", "/data", "sensor.other_disk"), config_entry_id: "01hother" };
    const disabled = { ...glances("cpu_usage", "cpu", "sensor.disabled_cpu"), disabled_by: "integration" };
    const { byMetric } = discoverHostEntities([...registry, other, disabled], "glances", GLANCES_ENTRY);
    expect(ids(byMetric.disk_usage)).not.toContain("sensor.other_disk");
    expect(ids(byMetric.cpu_usage)).toEqual(["sensor.glances_cpu_used"]);
  });

  it("collects Syncthing folders regardless of the chosen source", () => {
    const sync: HostRegistryEntry = {
      entity_id: "sensor.syncthing_media",
      platform: "syncthing",
      unique_id: "syncthing-media",
    };
    const off: HostRegistryEntry = { ...sync, entity_id: "sensor.syncthing_off", disabled_by: "user" };
    for (const source of ["glances", "systemmonitor", "synology_dsm"] as const) {
      expect(discoverHostEntities([...registry, sync, off], source).sync).toEqual([
        "sensor.syncthing_media",
      ]);
    }
  });
});

describe("discoverHostEntities — system monitor", () => {
  const registry: HostRegistryEntry[] = [
    { entity_id: "sensor.disk_use_percent", platform: "systemmonitor", translation_key: "disk_use_percent", unique_id: "disk_use_percent" },
    { entity_id: "sensor.disk_use_percent_media", platform: "systemmonitor", translation_key: "disk_use_percent", unique_id: "disk_use_percent_media" },
    { entity_id: "sensor.disk_free_media", platform: "systemmonitor", translation_key: "disk_free", unique_id: "disk_free_media" },
    { entity_id: "sensor.processor_use", platform: "systemmonitor", translation_key: "processor_use", unique_id: "processor_use" },
    { entity_id: "sensor.network_in", platform: "systemmonitor", translation_key: "throughput_network_in", unique_id: "throughput_network_in_end0" },
    // last_boot has no translation_key — the unique_id is the signal.
    { entity_id: "sensor.last_boot", platform: "systemmonitor", translation_key: null, unique_id: "last_boot" },
  ];

  it("keeps matching last_boot through the unique_id fallback", () => {
    const { byMetric } = discoverHostEntities(registry, "systemmonitor");
    expect(ids(byMetric.uptime)).toEqual(["sensor.last_boot"]);
  });

  it("strips the key so used and free of one volume share a label", () => {
    const { byMetric } = discoverHostEntities(registry, "systemmonitor");
    expect(byMetric.disk_usage?.map((e) => e.label)).toEqual(["/", "media"]);
    expect(byMetric.disk_free?.[0].label).toBe("media");
    expect(byMetric.network_rx?.[0].label).toBe("end0");
  });
});

describe("discoverHostEntities — synology dsm", () => {
  it("maps the live registry onto the card's sections", () => {
    const { byMetric } = discoverHostEntities(SYNOLOGY_REGISTRY, "synology_dsm");
    expect(ids(byMetric.disk_usage)).toEqual(["sensor.nas_volume_1_volume_used"]);
    expect(ids(byMetric.disk_used)).toEqual(["sensor.nas_volume_1_used_space"]);
    expect(ids(byMetric.disk_size)).toEqual(["sensor.nas_volume_1_total_size"]);
    expect(ids(byMetric.volume_status)).toEqual(["sensor.nas_volume_1_status"]);
    expect(ids(byMetric.cpu_usage)).toEqual(["sensor.nas_cpu_utilization_total"]);
    expect(ids(byMetric.memory_usage)).toEqual(["sensor.nas_memory_usage_real"]);
    expect(ids(byMetric.network_rx)).toEqual(["sensor.nas_download_throughput"]);
    expect(ids(byMetric.network_tx)).toEqual(["sensor.nas_upload_throughput"]);
    expect(ids(byMetric.uptime)).toEqual(["sensor.nas_uptime"]);
  });

  it("takes drive and chassis temperature, and labels the drive so it wins", () => {
    const { byMetric } = discoverHostEntities(SYNOLOGY_REGISTRY, "synology_dsm");
    expect(byMetric.temperature).toEqual([
      { entityId: "sensor.nas_drive_1_temperature", label: "sda" },
      // Chassis sensor: nothing follows the key, so it keeps no drive-shaped
      // label and only shows up when no per-drive sensor exists.
      { entityId: "sensor.nas_temperature", label: "sensor.nas_temperature" },
    ]);
  });

  it("labels volumes with the DSM volume id, not a mount path", () => {
    const { byMetric } = discoverHostEntities(SYNOLOGY_REGISTRY, "synology_dsm");
    expect(byMetric.disk_usage?.[0].label).toBe("volume_1");
    expect(byMetric.disk_used?.[0].label).toBe("volume_1");
    expect(byMetric.disk_size?.[0].label).toBe("volume_1");
    expect(byMetric.volume_status?.[0].label).toBe("volume_1");
  });

  it("leaves out what has no home in the existing sections", () => {
    const { byMetric } = discoverHostEntities(SYNOLOGY_REGISTRY, "synology_dsm");
    const matched = new Set(Object.values(byMetric).flatMap((l) => ids(l)));
    for (const skipped of [
      "sensor.nas_cpu_load_average_5_min",
      "sensor.nas_memory_total_real",
      "sensor.nas_drive_1_status",
      "binary_sensor.nas_security_status",
      "select.nas_fan_speed_mode",
      "update.nas_dsm_update",
    ]) {
      expect(matched.has(skipped)).toBe(false);
    }
    // Synology has no free-space sensor, so that section stays empty rather
    // than rendering a zero.
    expect(byMetric.disk_free).toBeUndefined();
  });

  it("narrows to one NAS when several config entries exist", () => {
    const second = SYNOLOGY_REGISTRY.map((e) => ({
      ...e,
      entity_id: `${e.entity_id}_2`,
      config_entry_id: "01OTHERNAS",
    }));
    const { byMetric } = discoverHostEntities([...SYNOLOGY_REGISTRY, ...second], "synology_dsm", "01OTHERNAS");
    expect(ids(byMetric.disk_usage)).toEqual(["sensor.nas_volume_1_volume_used_2"]);
  });

  it("skips disabled entities", () => {
    const disabled = SYNOLOGY_REGISTRY.map((e) => ({ ...e, disabled_by: "integration" }));
    const { byMetric } = discoverHostEntities(disabled, "synology_dsm");
    expect(byMetric.disk_usage).toBeUndefined();
  });
});

describe("source isolation", () => {
  it("finds nothing when the registry belongs to another integration", () => {
    expect(discoverHostEntities(SYNOLOGY_REGISTRY, "glances").byMetric).toEqual({});
    expect(discoverHostEntities(SYNOLOGY_REGISTRY, "systemmonitor").byMetric).toEqual({});
  });

  it("does not pick up Glances entities under the Synology source", () => {
    const registry = [glances("disk_usage", "/rootfs", "sensor.glances_rootfs")];
    expect(discoverHostEntities(registry, "synology_dsm").byMetric).toEqual({});
  });
});

describe("label helpers", () => {
  it("keeps the Glances mount parsing intact", () => {
    expect(labelFromUniqueId("01hglances-/rootfs/srv/dev-disk-by-uuid-43ab-disk_usage", "01hglances")).toBe(
      "/rootfs/srv/dev-disk-by-uuid-43ab",
    );
    expect(labelFromUniqueId("someone-elses-id", "01hglances")).toBeUndefined();
    expect(prettyMount("/rootfs/boot")).toBe("/boot");
    expect(prettyMount("/rootfs")).toBe("/");
    expect(prettyMount("/srv/dev-disk-by-uuid-43ab00ff-1122")).toBe("Volume 43ab00ff");
    expect(systemMonitorLabel("disk_use_media", "disk_use")).toBe("media");
    expect(systemMonitorLabel("disk_use", "disk_use")).toBe("/");
  });

  it("reads the Synology key from behind the API prefix", () => {
    expect(synologyKey("2240QDNAXTY69_SYNO.DSM.Info:uptime")).toBe("uptime");
    expect(synologyKey("2240QDNAXTY69_SYNO.Storage.CGI.Storage:disk_temp_sda")).toBe("disk_temp_sda");
    // Buttons carry no API path at all; nothing may throw on them.
    expect(synologyKey("2240QDNAXTY69_reboot")).toBe("2240QDNAXTY69_reboot");
    expect(synologyLabel("2240QDNAXTY69_SYNO.Storage.CGI.Storage:disk_temp_sda", "disk_temp")).toBe("sda");
    expect(synologyLabel("2240QDNAXTY69_SYNO.DSM.Info:temperature", "temperature")).toBeUndefined();
  });

  it("prettifies each source's identifier its own way", () => {
    expect(prettySynologyVolume("volume_1")).toBe("Volume 1");
    expect(prettySynologyVolume("volume_12")).toBe("Volume 12");
    expect(prettySynologyVolume("something_else")).toBe("something_else");
    expect(prettyLabel("synology_dsm", "volume_2")).toBe("Volume 2");
    // Glances keeps its own prettifier — a mount path is never volume-ified.
    expect(prettyLabel("glances", "/rootfs/boot")).toBe("/boot");
    expect(prettyLabel("systemmonitor", "media")).toBe("media");
  });
});

describe("resolveDiskSize", () => {
  it("prefers the source's own total-size sensor", () => {
    expect(resolveDiskSize(500, 120, 380)).toBe(500);
  });

  it("adds used and free when there is no total-size sensor", () => {
    expect(resolveDiskSize(undefined, 120, 380)).toBe(500);
  });

  it("has no total when only 'used' is known — Synology's default", () => {
    // volume_size_used is enabled, volume_size_total is not, and there is no
    // free-space sensor at all: the row must drop the "used / total" line
    // rather than print "5 / NaN TB".
    expect(resolveDiskSize(undefined, 4.624, undefined)).toBeUndefined();
    expect(resolveDiskSize(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe("volumeHealth", () => {
  it("flags only states DSM means as trouble", () => {
    expect(volumeHealth("crashed")).toBe("critical");
    expect(volumeHealth("degrade")).toBe("critical");
    expect(volumeHealth("Degraded")).toBe("critical");
    expect(volumeHealth("attention")).toBe("warn");
    expect(volumeHealth("normal")).toBeUndefined();
    expect(volumeHealth("background")).toBeUndefined();
    expect(volumeHealth("unavailable")).toBeUndefined();
    expect(volumeHealth(undefined)).toBeUndefined();
  });
});
