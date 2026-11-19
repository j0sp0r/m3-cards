import { expect, it, vi } from "vitest";
import { ukrainianCardDescriptions } from "./translations/uk-card-descriptions";

it("registers a Ukrainian picker description for every M3 card", { timeout: 20_000 }, async () => {
  const otherCard = { type: "other-card", description: "Another custom card" };
  const cards = [otherCard];
  vi.stubGlobal("window", Object.assign(new EventTarget(), { customCards: cards }));
  vi.stubGlobal("customElements", { define: vi.fn(), get: () => undefined });
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

  try {
    await import("./index");
    const m3Cards = cards.filter((card) => card.type.startsWith("m3-"));
    expect(m3Cards.map(({ type }) => type).sort()).toEqual([...ukrainianCardDescriptions.keys()].sort());

    const root: { hass?: { locale?: { language: string }; language?: string } } = {};
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === "home-assistant" ? root : null),
    });
    const weather = m3Cards.find(({ type }) => type === "m3-weather-card")!;
    const original = weather.description;
    expect(original).toContain("Wetterkarte");

    root.hass = { locale: { language: "uk-UA" }, language: "en" };
    for (const card of m3Cards) {
      expect(card.description, card.type).toBe(ukrainianCardDescriptions.get(card.type));
    }
    expect(otherCard.description).toBe("Another custom card");

    root.hass = { locale: { language: "de" }, language: "uk" };
    expect(weather.description).toBe(original);
    root.hass = { language: "uk" };
    expect(weather.description).toBe(ukrainianCardDescriptions.get(weather.type));

    weather.description = "Custom weather description";
    expect(weather.description).toBe("Custom weather description");
  } finally {
    info.mockRestore();
    vi.unstubAllGlobals();
  }
});
