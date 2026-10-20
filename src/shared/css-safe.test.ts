import { describe, expect, it } from "vitest";
import { cssIdent, cssUrl, cssValue, safeImageUrl } from "./css-safe";
import { buildCssVars, resolveThemeColor } from "./color-config";

/**
 * Values from Home Assistant that end up inside a `style` attribute. An
 * entity_picture comes from the integration and an entity's state from
 * whatever writes it, so neither is the card author's text. Raised in the
 * HACS review.
 */
const BASE = "http://homeassistant.local:8123/lovelace/0";

describe("cssUrl", () => {
  it("wraps an ordinary picture path, resolved and quoted", () => {
    expect(cssUrl("/api/media_player_proxy/media_player.tv?token=abc", BASE)).toBe(
      'url("http://homeassistant.local:8123/api/media_player_proxy/media_player.tv?token=abc")',
    );
  });

  it("keeps an absolute https artwork URL", () => {
    expect(cssUrl("https://img.example.com/a.jpg", BASE)).toBe('url("https://img.example.com/a.jpg")');
  });

  it("gives nothing for a missing picture", () => {
    expect(cssUrl(undefined, BASE)).toBeUndefined();
    expect(cssUrl(null, BASE)).toBeUndefined();
    expect(cssUrl("", BASE)).toBeUndefined();
  });

  it("refuses a scheme that is not a picture", () => {
    expect(cssUrl("javascript:alert(1)", BASE)).toBeUndefined();
    expect(cssUrl("data:image/svg+xml,<svg onload=alert(1)>", BASE)).toBeUndefined();
  });

  it("cannot be escaped out of, whatever the value contains", () => {
    // The shape of the attack: end the url(), end the declaration, add rules.
    const böse = '/a.jpg");background:red;--x:url("';
    const out = cssUrl(böse, BASE)!;
    expect(out.startsWith('url("')).toBe(true);
    expect(out.endsWith('")')).toBe(true);
    // No unescaped quote survives inside, so the string cannot be closed early.
    expect(out.slice(5, -2)).not.toMatch(/(?<!\\)"/);
  });
});

describe("cssIdent", () => {
  it("passes an ordinary state through", () => {
    expect(cssIdent("fan_only")).toBe("fan_only");
    expect(cssIdent("unlocked")).toBe("unlocked");
  });

  it("drops anything that could end a custom property name", () => {
    // The shape of the attack: end the var() name, then the declaration.
    expect(cssIdent("on);background:red;--x:var(--y")).toBe("onbackgroundredxvary");
    expect(cssIdent("a b")).toBe("ab");
    expect(cssIdent("ÜBER")).toBe("ber");
  });

  it("survives a missing state", () => {
    expect(cssIdent(undefined)).toBe("");
  });
});

describe("safeImageUrl", () => {
  it("resolves a picture path against the page", () => {
    expect(safeImageUrl("/api/image/serve/abc", BASE)).toBe(
      "http://homeassistant.local:8123/api/image/serve/abc",
    );
  });

  it("refuses a data: payload rather than gluing it onto the origin", () => {
    expect(safeImageUrl("data:image/svg+xml,<svg onload=alert(1)>", BASE)).toBeUndefined();
  });

  it("is a scheme test, not a prefix test", () => {
    // `startsWith("http")` used to pass this.
    expect(safeImageUrl("httpfoo://example.com/a.jpg", BASE)).toBeUndefined();
    expect(safeImageUrl("https://example.com/a.jpg", BASE)).toBe("https://example.com/a.jpg");
  });
});

describe("cssValue", () => {
  it("passes every colour shape the options document", () => {
    for (const good of [
      "red",
      "currentColor",
      "transparent",
      "#fff",
      "#1c1c1c",
      "#aabbccdd",
      "rgb(0, 0, 0)",
      "rgba(0,0,0,.5)",
      "hsl(210 50% 40%)",
      "var(--primary-color)",
      "var(--state-light-on-color, var(--primary-color))",
      "color-mix(in srgb, var(--x) 20%, var(--ha-card-background, #111))",
      "light-dark(#fff, #000)",
    ]) {
      expect(cssValue(good), good).toBe(good);
    }
  });

  it("passes the non-colour values buildCssVars also carries", () => {
    for (const good of ["12px", "min(56px, 78cqh)", "calc(100% - 16px)", "0.5", "300ms"]) {
      expect(cssValue(good), good).toBe(good);
    }
  });

  it("refuses a value that ends its own declaration", () => {
    // The whole attack: a config colour is templatable, so this can be an
    // entity's state. Raised by following the HACS review's own reasoning
    // past the three values it named.
    expect(cssValue("red; position: fixed; top: 0; width: 100vw; height: 100vh")).toBeUndefined();
    expect(cssValue("red;")).toBeUndefined();
  });

  it("refuses anything that would fetch", () => {
    expect(cssValue("url(https://example.invalid/leak)")).toBeUndefined();
    expect(cssValue("image-set(https://example.invalid/a 1x)")).toBeUndefined();
    expect(cssValue("-webkit-image-set(https://example.invalid/a 1x)")).toBeUndefined();
    // A colour that merely spells one of those inside a word is not a call.
    expect(cssValue("burlywood")).toBe("burlywood");
  });

  it("refuses the shapes an escape attempt takes", () => {
    expect(cssValue("red; } .victim { display: none")).toBeUndefined();
    expect(cssValue("red !important")).toBeUndefined();
    expect(cssValue("red /* hidden */")).toBeUndefined();
    expect(cssValue("\\72 ed")).toBeUndefined();
  });

  it("refuses a value leaning on what comes after it to close", () => {
    expect(cssValue("var(--x")).toBeUndefined();
    expect(cssValue("rgb(0,0,0))")).toBeUndefined();
  });

  it("survives nothing at all", () => {
    expect(cssValue(undefined)).toBeUndefined();
    expect(cssValue(null)).toBeUndefined();
    expect(cssValue("   ")).toBeUndefined();
    expect(cssValue("#fff".padEnd(500, "0"))).toBeUndefined();
  });
});

describe("the chokepoints that use it", () => {
  it("resolveThemeColor still answers a curated token and an honest colour", () => {
    expect(resolveThemeColor("#ff0000")).toBe("#ff0000");
    expect(resolveThemeColor("var(--primary-color)")).toBe("var(--primary-color)");
    // A name from the curated list maps to its hex rather than passing through.
    expect(resolveThemeColor("red")).not.toBe("");
  });

  it("resolveThemeColor treats an impossible colour as an unset option", () => {
    expect(resolveThemeColor("red; position: fixed; z-index: 9999")).toBe("var(--primary-color)");
  });

  it("resolveThemeColor leaves an emptied field empty", () => {
    // Clearing a colour in the editor asks for nothing, not for the accent.
    expect(resolveThemeColor("")).toBe("");
    expect(resolveThemeColor("   ")).toBe("   ");
  });

  it("buildCssVars drops a poisoned entry and keeps its neighbours", () => {
    const out = buildCssVars({
      "m3-good": "#ff0000",
      "m3-bad": "red; position: fixed; top: 0",
      "m3-also-good": "var(--primary-color)",
    });
    expect(out).toContain("--m3-good: #ff0000;");
    expect(out).toContain("--m3-also-good: var(--primary-color);");
    expect(out).not.toContain("m3-bad");
    expect(out).not.toContain("position: fixed");
  });
});
