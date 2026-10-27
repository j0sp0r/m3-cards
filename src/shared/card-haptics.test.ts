import { describe, expect, it } from "vitest";
import { isControl } from "./card-haptics";

/** Just enough of an element for isControl: a tag, attributes and an input type. */
function el(tagName: string, attrs: Record<string, string> = {}, type?: string): Element {
  return {
    tagName,
    type,
    getAttribute: (name: string) => attrs[name] ?? null,
  } as unknown as Element;
}

describe("isControl", () => {
  it("counts buttons, links and switches", () => {
    expect(isControl(el("BUTTON"))).toBe(true);
    expect(isControl(el("A"))).toBe(true);
    expect(isControl(el("HA-SWITCH"))).toBe(true);
  });

  it("counts a slider input but not a text field", () => {
    expect(isControl(el("INPUT", {}, "range"))).toBe(true);
    expect(isControl(el("INPUT", {}, "checkbox"))).toBe(true);
    // Typing is not a tap: a vibration on every focus of a text field is noise.
    expect(isControl(el("INPUT", {}, "text"))).toBe(false);
    expect(isControl(el("INPUT", {}, "search"))).toBe(false);
  });

  it("reads what an element says it is", () => {
    expect(isControl(el("DIV", { role: "button" }))).toBe(true);
    expect(isControl(el("DIV", { role: "slider" }))).toBe(true);
    expect(isControl(el("DIV", { role: "img" }))).toBe(false);
  });

  it("counts a surface that shows the pointer cursor", () => {
    expect(isControl(el("DIV"), "pointer")).toBe(true);
    expect(isControl(el("DIV"), "grab")).toBe(true);
    expect(isControl(el("DIV"), "auto")).toBe(false);
    expect(isControl(el("DIV"))).toBe(false);
  });
});
