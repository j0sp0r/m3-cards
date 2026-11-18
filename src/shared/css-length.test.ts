import { describe, expect, it } from "vitest";
import { cssLength } from "./css-length";

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
