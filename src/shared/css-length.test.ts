import { describe, expect, it } from "vitest";
import { cssLength, popupSize } from "./css-length";

describe("cssLength", () => {
  it("takes numbers as pixels and keeps a unit", () => {
    expect(cssLength(700)).toBe("700px");
    expect(cssLength("600")).toBe("600px");
    expect(cssLength(" 80vw ")).toBe("80vw");
    expect(cssLength("70VH")).toBe("70vh");
    expect(cssLength("37.5rem")).toBe("37.5rem");
  });

  it("drops anything that is not a plain length", () => {
    for (const v of ["", "auto", "calc(100% - 10px)", "700px; color: red", "-5px", "0", 0, -3, NaN, null, undefined, {}])
      expect(cssLength(v)).toBeUndefined();
  });
});

describe("popupSize", () => {
  it("leaves everything automatic without a size", () => {
    expect(popupSize({})).toEqual({ width: undefined, height: undefined, mobileWidth: undefined, mobileHeight: undefined });
  });

  it("carries the height to the phone, not the width", () => {
    expect(popupSize({ width: "700px", height: 500 })).toEqual({ width: "700px", height: "500px", mobileWidth: undefined, mobileHeight: "500px" });
  });

  it("takes the phone's own sizes, and auto gives its height back to the content", () => {
    expect(popupSize({ height: "70vh", mobile_height: "90dvh", mobile_width: "92vw" })).toMatchObject({ mobileWidth: "92vw", mobileHeight: "90dvh" });
    expect(popupSize({ height: "70vh", mobile_height: "auto" }).mobileHeight).toBeUndefined();
  });
});
