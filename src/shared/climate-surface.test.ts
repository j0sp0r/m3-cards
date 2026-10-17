import { describe, it, expect } from "vitest";
import { resolveSetpointSurface } from "./climate-surface";
import { foregroundOn } from "./color-config";
import { contrastRatio, parseColor } from "./contrast";
import {
  MODE_PILL_INK_TARGET,
  MODE_PILL_LINE_PERCENT,
  MODE_PILL_WASH_PERCENT,
  SETPOINT_INK_TARGET,
  SETPOINT_LINE_PERCENT,
  SETPOINT_WASH_PERCENT,
} from "../const";

// These run without a DOM, so `tintOn` cannot measure against a real surface
// and falls back to handing the mix to the browser as CSS. That fallback is
// the interesting contract here: the percentages still have to arrive in the
// right place, and a colour that cannot be resolved must degrade to a
// color-mix() the browser can finish rather than to a broken value.
const HEAT = "#e57368";

describe("resolveSetpointSurface", () => {
  it("washes the surface at the wash percentage and draws the outline at the line percentage", () => {
    const s = resolveSetpointSurface(
      undefined,
      HEAT,
      undefined,
      SETPOINT_WASH_PERCENT,
      SETPOINT_LINE_PERCENT,
    );
    expect(s.bg).toContain(`${HEAT} ${SETPOINT_WASH_PERCENT}%`);
    expect(s.line).toContain(`${HEAT} ${SETPOINT_LINE_PERCENT}%`);
  });

  it("keeps the mode pill quieter than the setpoint oval", () => {
    // The setpoint carries the value, so it must stay the louder of the two
    // ovals — if these constants ever cross, the card's hierarchy inverts.
    expect(MODE_PILL_WASH_PERCENT).toBeLessThan(SETPOINT_WASH_PERCENT);
    expect(MODE_PILL_LINE_PERCENT).toBeLessThan(SETPOINT_LINE_PERCENT);
  });

  it("applies a per-card opacity override to the wash only, never to the outline", () => {
    // plus_opacity/minus_opacity-style overrides are about the fill; letting
    // one drag the hairline along would turn the ring into a solid band.
    const s = resolveSetpointSurface(
      undefined,
      HEAT,
      40,
      SETPOINT_WASH_PERCENT,
      SETPOINT_LINE_PERCENT,
    );
    expect(s.bg).toContain(`${HEAT} 40%`);
    expect(s.line).toContain(`${HEAT} ${SETPOINT_LINE_PERCENT}%`);
  });

  it("passes a theme custom property through for the browser to resolve", () => {
    // A theme colour is not parseable here; handing back the var() untouched
    // is what keeps a themed card from falling back to a hardcoded colour.
    const s = resolveSetpointSurface(
      undefined,
      "var(--primary-color)",
      undefined,
      SETPOINT_WASH_PERCENT,
      SETPOINT_LINE_PERCENT,
    );
    expect(s.bg).toContain("var(--primary-color)");
    expect(s.line).toContain("var(--primary-color)");
    expect(s.ink).toBe("var(--primary-color)");
  });

  it("holds the mode pill's ink to the small-text floor, not the graphics one", () => {
    // What the two ovals carry differs: a 22px numeral in the setpoint, a 13px
    // label in the mode pill. `test/contrast-audit.js` reported the mode
    // button at 3.01-3.23 in the light theme because both were corrected to 3.
    //
    // The wash below is the light-theme surface that run measured behind the
    // heat pill. It is written out rather than taken from
    // `resolveSetpointSurface` because without a DOM `tintOn` cannot mix
    // against a real surface, so the ink recipe is checked where it is decided.
    const wash = "#feefee";
    const gegen = (css: string) =>
      contrastRatio(parseColor(css)!, parseColor(wash)!);

    expect(gegen(foregroundOn(HEAT, wash, SETPOINT_INK_TARGET))).toBeLessThan(
      MODE_PILL_INK_TARGET,
    );
    expect(
      gegen(foregroundOn(HEAT, wash, MODE_PILL_INK_TARGET)),
    ).toBeGreaterThanOrEqual(MODE_PILL_INK_TARGET);
  });

  it("is stable for the same inputs", () => {
    const a = resolveSetpointSurface(undefined, HEAT, undefined, 9, 34);
    const b = resolveSetpointSurface(undefined, HEAT, undefined, 9, 34);
    expect(a).toEqual(b);
  });
});
