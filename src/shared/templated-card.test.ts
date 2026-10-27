import { describe, it, expect } from "vitest";
import type { LitElement, PropertyValues } from "lit";
import { TemplatedCard } from "./templated-card";

// A stand-in for a card. These suites run in Vitest's Node environment, where
// there is no DOM to define a custom element in, and the mixin needs none of
// one: it hooks `willUpdate`, `connectedCallback` and `disconnectedCallback`,
// which are called here by hand in the order Lit calls them. The listener pair
// is for the tap haptics the mixin attaches on connect.
class FakeCard {
  /** Counts the renders the mixin asks for. */
  public updates = 0;
  public addEventListener(): void {}
  public removeEventListener(): void {}
  public connectedCallback(): void {}
  public disconnectedCallback(): void {}
  protected willUpdate(_changed: PropertyValues): void {}
  public requestUpdate(): void {
    this.updates++;
  }
}

interface CardUnderTest {
  _config?: unknown;
  hass?: unknown;
  updates: number;
  rawConfig: unknown;
  willUpdate(changed: PropertyValues): void;
  connectedCallback(): void;
  disconnectedCallback(): void;
}

function build(): {
  card: CardUnderTest;
  hass: unknown;
  open: Map<string, (msg: { result?: unknown }) => void>;
} {
  const open = new Map<string, (msg: { result?: unknown }) => void>();
  const hass = {
    connection: {
      subscribeMessage: (
        cb: (msg: { result?: unknown }) => void,
        payload: { template: string },
      ) => {
        open.set(payload.template, cb);
        return Promise.resolve(() => open.delete(payload.template));
      },
    },
  };
  const Card = TemplatedCard(FakeCard as unknown as new () => LitElement);
  return { card: new Card() as unknown as CardUnderTest, hass, open };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("TemplatedCard", () => {
  it("leaves the config of a card that uses no templates exactly as it was", () => {
    const { card, hass } = build();
    const config = { type: "custom:m3-button-card", name: "Kitchen" };

    card._config = config;
    card.hass = hass;
    card.willUpdate(new Map());
    card.willUpdate(new Map());

    // Same object, not a copy of it: nothing was walked, cloned or subscribed.
    expect(card._config).toBe(config);
  });

  it("renders the card's templates and keeps the config steady in between", async () => {
    const { card, hass, open } = build();
    const authored = { type: "custom:m3-button-card", name: "{{ a }}", entity: "light.kitchen" };

    card._config = { ...authored };
    card.hass = hass;
    card.willUpdate(new Map());
    expect(open.size).toBe(1);

    open.get("{{ a }}")!({ result: "Kitchen" });
    expect(card.updates).toBeGreaterThan(0);

    card.willUpdate(new Map());
    expect(card._config).toEqual({
      type: "custom:m3-button-card",
      name: "Kitchen",
      entity: "light.kitchen",
    });
    // The author's config is kept as written, templates and all.
    expect(card.rawConfig).toEqual(authored);

    // Nothing new pushed: the same object comes back, so a card that rebuilds
    // on a config change does not rebuild on every render.
    const resolved = card._config;
    card.willUpdate(new Map());
    expect(card._config).toBe(resolved);

    // Home Assistant caches view elements: closed on the way out, reopened on
    // the way back, and the last known values stay on screen throughout.
    card.disconnectedCallback();
    await flush();
    expect(open.size).toBe(0);
    expect(card._config).toBe(resolved);

    card.connectedCallback();
    card.willUpdate(new Map());
    expect(open.size).toBe(1);
    expect(card._config).toBe(resolved);
  });

  it("waits for the websocket rather than subscribing without one", () => {
    const { card, hass, open } = build();

    card._config = { name: "{{ a }}" };
    card.hass = undefined;
    card.willUpdate(new Map());
    expect(open.size).toBe(0);

    card.hass = hass;
    card.willUpdate(new Map());
    expect(open.size).toBe(1);
  });
});
