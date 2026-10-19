import { describe, expect, it } from "vitest";
import { cssIdent, cssUrl } from "./css-safe";

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
