import type { HomeAssistant, M3NavCardConfig } from "../types";

/**
 * The nav card config on another view of this dashboard, for `config_from`
 * (#38). Lovelace has no card that lives on several views, so a bar shared by
 * seven views was seven copies to keep in step; this reads the one copy.
 *
 * Every user may read the dashboard config (`lovelace/config` is not
 * admin-only), so it works for a kiosk or family account too. Concurrent
 * requests for the same dashboard share one fetch — seven views' bars are
 * seven setConfig calls at once — but nothing is kept beyond that, so a
 * saved change to the template is seen on the next load of the view.
 */
const navTemplateFetches = new Map<string, Promise<unknown>>();

export async function loadNavTemplate(
  hass: HomeAssistant | undefined,
  from: string,
): Promise<M3NavCardConfig | undefined> {
  const conn = hass ?? (document.querySelector("home-assistant") as unknown as { hass?: HomeAssistant } | null)?.hass;
  if (!conn?.callWS) return undefined;
  const dashboard = location.pathname.split("/")[1] ?? "";
  const urlPath = dashboard === "lovelace" || dashboard === "" ? null : dashboard;
  const key = urlPath ?? "";
  let fetch = navTemplateFetches.get(key);
  if (!fetch) {
    fetch = conn.callWS({ type: "lovelace/config", url_path: urlPath }).catch(() => undefined);
    navTemplateFetches.set(key, fetch);
    void fetch.finally(() => setTimeout(() => navTemplateFetches.delete(key), 2000));
  }
  const dash = (await fetch) as { views?: { path?: string }[] } | undefined;
  return findNavTemplate(dash, from);
}

/** The first nav card (one that is not itself pointing elsewhere) on the view named by path or index. */
export function findNavTemplate(
  dash: { views?: { path?: string }[] } | undefined,
  from: string,
): M3NavCardConfig | undefined {
  const views = dash?.views ?? [];
  const key = from.replace(/^\/+/, "").split("/").pop() ?? "";
  const view = views.find((v) => v.path === key) ?? (/^\d+$/.test(key) ? views[Number(key)] : undefined);
  if (!view) return undefined;
  let found: M3NavCardConfig | undefined;
  const walk = (node: unknown): void => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.type === "custom:m3-nav-card" && !obj.config_from) {
      found = obj as unknown as M3NavCardConfig;
      return;
    }
    Object.values(obj).forEach(walk);
  };
  walk(view);
  return found;
}
