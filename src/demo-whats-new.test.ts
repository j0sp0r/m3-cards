import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import { WHATS_NEW } from "../demo/whats-new.js";

// The demo's "New" view shows the latest release. When a release bumps the
// version, this fails until demo/whats-new.js shows that release.
describe("live demo: What's new", () => {
  it("shows the version in package.json", () => {
    expect(WHATS_NEW.version).toBe(pkg.version);
  });
  it("has cards to show", () => {
    const sections = WHATS_NEW.sections((en) => en);
    expect(sections.flatMap(([, cards]) => cards).length).toBeGreaterThan(0);
  });
});
