import { describe, it, expect, vi, afterEach } from "vitest";
import { anchorFocus, anchorTarget, installFocusAnchor, isInside, rememberPointer } from "./focus-anchor";

// No DOM in this test run, so nodes are plain objects with the few properties
// the module walks: parentNode, and host on a shadow root.

afterEach(() => vi.unstubAllGlobals());

function tree() {
  const body = { parentNode: null } as unknown as Node;
  const card = { parentNode: body, tagName: "M3-VACUUM-CARD" } as unknown as Node;
  const shadow = { parentNode: null, host: card } as unknown as Node;
  const header = { parentNode: shadow } as unknown as Node;
  const elsewhere = { parentNode: body } as unknown as Node;
  return { body, card, shadow, header, elsewhere };
}

describe("isInside", () => {
  it("climbs out of a shadow root to its host", () => {
    const { card, header } = tree();
    expect(isInside(card, header)).toBe(true);
  });

  it("is false for something elsewhere on the page", () => {
    const { card, elsewhere } = tree();
    expect(isInside(card, elsewhere)).toBe(false);
  });

  it("is false for nothing", () => {
    const { card } = tree();
    expect(isInside(card, null)).toBe(false);
  });
});

function fakeCard(parent: Node, tabIndex = -1) {
  const attrs = new Map<string, string>();
  return {
    parentNode: parent,
    tabIndex,
    tagName: "M3-VACUUM-CARD",
    ownerDocument: { body: null },
    hasAttribute: (k: string) => attrs.has(k),
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    getAttribute: (k: string) => attrs.get(k),
    focus: vi.fn(),
  };
}

describe("anchorFocus", () => {
  it("moves stray focus onto the card, without scrolling", () => {
    // The reported bug: focus left on a light card's slider elsewhere on the
    // page, so closing the vacuum's dialog scrolled back up to the slider.
    const body = { parentNode: null } as unknown as Node;
    const slider = { parentNode: body } as unknown as Element;
    vi.stubGlobal("document", { activeElement: slider });
    const card = fakeCard(body);
    anchorFocus(card as unknown as HTMLElement);
    expect(card.focus).toHaveBeenCalledWith({ preventScroll: true });
    // Focusable by script only — the card must not join the tab order.
    expect(card.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps a natively focusable anchor in the tab order", () => {
    // A dropdown parks focus on its own trigger button; tabindex=-1 there
    // would make the button unreachable by Tab from then on.
    const body = { parentNode: null } as unknown as Node;
    const slider = { parentNode: body } as unknown as Element;
    vi.stubGlobal("document", { activeElement: slider });
    const button = fakeCard(body, 0);
    anchorFocus(button as unknown as HTMLElement);
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(button.getAttribute("tabindex")).toBeUndefined();
  });

  it("leaves focus alone when it is already inside the card", () => {
    // A keyboard user who tabbed to the header and pressed Enter: the dialog
    // should give focus back to the header, not to the card around it.
    const body = { parentNode: null } as unknown as Node;
    const card = fakeCard(body);
    const shadow = { parentNode: null, host: card } as unknown as Node;
    const header = { parentNode: shadow, shadowRoot: null } as unknown as Element;
    vi.stubGlobal("document", { activeElement: header });
    anchorFocus(card as unknown as HTMLElement);
    expect(card.focus).not.toHaveBeenCalled();
  });
});

describe("installFocusAnchor", () => {
  it("registers its listeners once, however often the bundle runs it", () => {
    const addEventListener = vi.fn();
    const win = { addEventListener } as unknown as Window;
    installFocusAnchor(win);
    installFocusAnchor(win);
    // Two: the pointer it remembers the origin from, and the dialog itself.
    expect(addEventListener).toHaveBeenCalledTimes(2);
    expect(addEventListener.mock.calls[0][0]).toBe("pointerdown");
    expect(addEventListener.mock.calls[0][2]).toEqual({ capture: true, passive: true });
    expect(addEventListener.mock.calls[1][0]).toBe("hass-more-info");
    expect(addEventListener.mock.calls[1][2]).toEqual({ capture: true });
  });
});

describe("anchorTarget", () => {
  function chipInside(card: Node, connected = true) {
    const shadow = { parentNode: null, host: card } as unknown as Node;
    return { parentNode: shadow, isConnected: connected } as unknown as HTMLElement;
  }

  it("prefers the element the pointer went down on", () => {
    const { card } = tree();
    const chip = chipInside(card);
    rememberPointer(chip);
    expect(anchorTarget(card as unknown as HTMLElement)).toBe(chip);
  });

  it("falls back to the card when nothing was pressed", () => {
    const { card } = tree();
    rememberPointer(undefined);
    expect(anchorTarget(card as unknown as HTMLElement)).toBe(card);
  });

  it("falls back to the card for a pointer from long ago", () => {
    // An unrelated tap minutes back is not the origin of this dialog.
    const { card } = tree();
    rememberPointer(chipInside(card), Date.now() - 60_000);
    expect(anchorTarget(card as unknown as HTMLElement)).toBe(card);
  });

  it("falls back to the card for a node the render threw away", () => {
    // Focusing a detached element does nothing at all, which would leave focus
    // wherever it was — the very bug this module exists for.
    const { card } = tree();
    rememberPointer(chipInside(card, false));
    expect(anchorTarget(card as unknown as HTMLElement)).toBe(card);
  });

  it("falls back to the card for a pointer in a different card", () => {
    const { card, body } = tree();
    const other = { parentNode: body, isConnected: true } as unknown as HTMLElement;
    rememberPointer(other);
    expect(anchorTarget(card as unknown as HTMLElement)).toBe(card);
  });
});
