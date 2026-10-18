import { describe, it, expect, vi } from "vitest";
import {
  ChipRowController,
  ChipRowFadeController,
  chipRowSignature,
  smartChipWidths,
  chipRowFades,
  chipRowJustify,
  chipRowLayoutClass,
  embeddedChipRowConfig,
} from "./chip-buttons";

describe("chipRowLayoutClass", () => {
  it("scrolls by default — a row is only laid out otherwise on request", () => {
    expect(chipRowLayoutClass({ buttons: [] })).toBe("scroll");
  });

  it("wraps when asked to", () => {
    expect(chipRowLayoutClass({ buttons: [], wrap: true })).toBe("wrap");
  });

  it("stretch wins over wrap — the chips share the width on one line", () => {
    expect(chipRowLayoutClass({ buttons: [], wrap: true, stretch: true })).toBe("stretch");
  });

  it("marks a smart stretch as both, so it shares the width and gets measured", () => {
    expect(chipRowLayoutClass({ buttons: [], stretch: "smart" })).toBe("stretch smart");
  });
});

describe("embeddedChipRowConfig", () => {
  it("wraps when the card says nothing, keeping the behaviour cards had before the option", () => {
    expect(embeddedChipRowConfig({ chip_buttons: [{ entity: "light.a" }] })).toEqual({
      buttons: [{ entity: "light.a" }],
      wrap: true,
    });
  });

  it("maps chip_buttons_layout: scroll onto the scrolling row", () => {
    const config = embeddedChipRowConfig({ chip_buttons: [], chip_buttons_layout: "scroll" });
    expect(config.wrap).toBe(false);
    expect(chipRowLayoutClass(config)).toBe("scroll");
  });

  it("maps chip_buttons_layout: wrap onto the wrapping row", () => {
    const config = embeddedChipRowConfig({ chip_buttons: [], chip_buttons_layout: "wrap" });
    expect(chipRowLayoutClass(config)).toBe("wrap");
  });

  it("survives a card with no chips configured at all", () => {
    expect(embeddedChipRowConfig({})).toEqual({ buttons: [], wrap: true });
  });
});

describe("chipRowJustify", () => {
  it("defaults to the right edge, where an embedded row sits next to the content", () => {
    expect(chipRowJustify(undefined)).toBe("flex-end");
    expect(chipRowJustify("end")).toBe("flex-end");
  });

  it("maps start and center onto their flexbox values", () => {
    expect(chipRowJustify("start")).toBe("flex-start");
    expect(chipRowJustify("center")).toBe("center");
  });
});

describe("chipRowFades", () => {
  it("fades neither edge when the row fits", () => {
    expect(chipRowFades({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({
      start: false,
      end: false,
    });
  });

  it("ignores the sub-pixel slack a row that fits exactly can report", () => {
    expect(chipRowFades({ scrollLeft: 0.4, scrollWidth: 300.6, clientWidth: 300 })).toEqual({
      start: false,
      end: false,
    });
  });

  it("fades the end while chips are hidden to the right", () => {
    expect(chipRowFades({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 })).toEqual({
      start: false,
      end: true,
    });
  });

  it("fades both edges mid-scroll", () => {
    expect(chipRowFades({ scrollLeft: 100, scrollWidth: 500, clientWidth: 300 })).toEqual({
      start: true,
      end: true,
    });
  });

  it("fades only the start once scrolled all the way right", () => {
    expect(chipRowFades({ scrollLeft: 200, scrollWidth: 500, clientWidth: 300 })).toEqual({
      start: true,
      end: false,
    });
  });
});

// The controller only ever touches classList, addEventListener and a
// ResizeObserver, so these suites can drive it in Vitest's Node environment
// with stand-ins rather than a real DOM.
class FakeRow {
  public classes = new Set<string>();
  public listeners: Array<(event: { currentTarget: FakeRow }) => void> = [];
  public removed = 0;
  public observer?: () => void;

  constructor(
    public scrollLeft: number,
    public scrollWidth: number,
    public clientWidth: number,
  ) {}

  public classList = {
    toggle: (name: string, on: boolean) => {
      if (on) this.classes.add(name);
      else this.classes.delete(name);
    },
  };

  public addEventListener(_type: string, fn: (event: { currentTarget: FakeRow }) => void): void {
    this.listeners.push(fn);
  }

  public removeEventListener(): void {
    this.removed++;
  }

  public scrollTo(left: number): void {
    this.scrollLeft = left;
    for (const fn of this.listeners) fn({ currentTarget: this });
  }
}

function fakeRoot(rows: FakeRow[]) {
  return { querySelectorAll: () => rows } as unknown as ParentNode;
}

function installResizeObserver(): FakeRow[] {
  const observed: FakeRow[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private _cb: (entries: Array<{ target: FakeRow }>) => void) {}
      observe(row: FakeRow) {
        observed.push(row);
        row.observer = () => this._cb([{ target: row }]);
      }
      disconnect() {}
    },
  );
  return observed;
}

describe("ChipRowFadeController", () => {
  it("fades every scrolling row, not just the first — a card can render two", () => {
    installResizeObserver();
    // The button card renders both its inline row and its bottom bar; which one
    // is visible is decided in CSS, so both need their fades kept honest.
    const inline = new FakeRow(0, 500, 300);
    const bottom = new FakeRow(200, 500, 300);
    new ChipRowFadeController().sync(fakeRoot([inline, bottom]));

    expect([...inline.classes]).toEqual(["fade-end"]);
    expect([...bottom.classes]).toEqual(["fade-start"]);
  });

  it("follows the row as it is scrolled", () => {
    installResizeObserver();
    const row = new FakeRow(0, 500, 300);
    new ChipRowFadeController().sync(fakeRoot([row]));
    expect(row.classes.has("fade-start")).toBe(false);

    row.scrollTo(100);
    expect([...row.classes].sort()).toEqual(["fade-end", "fade-start"]);
  });

  it("re-checks on resize, when a row that used to fit stops fitting", () => {
    const observed = installResizeObserver();
    const row = new FakeRow(0, 300, 300);
    new ChipRowFadeController().sync(fakeRoot([row]));
    expect(row.classes.size).toBe(0);

    row.clientWidth = 200;
    observed[0].observer?.();
    expect([...row.classes]).toEqual(["fade-end"]);
  });

  it("releases the old row's listener when Lit swaps the row out", () => {
    installResizeObserver();
    const controller = new ChipRowFadeController();
    const first = new FakeRow(0, 500, 300);
    controller.sync(fakeRoot([first]));

    const second = new FakeRow(0, 500, 300);
    controller.sync(fakeRoot([second]));
    expect(first.removed).toBe(1);
    expect(second.listeners).toHaveLength(1);

    controller.disconnect();
    expect(second.removed).toBe(1);
  });

  it("does nothing for a card whose row does not scroll", () => {
    installResizeObserver();
    const controller = new ChipRowFadeController();
    expect(() => controller.sync(fakeRoot([]))).not.toThrow();
    expect(() => controller.disconnect()).not.toThrow();
  });
});

// A row as the layout controller sees it: what is written on it and how
// many chips it holds. Scroll metrics only matter to the fades it also runs.
class FakeChipRow extends FakeRow {
  constructor(
    public textContent: string,
    public childElementCount = 1,
    public layoutClasses: string[] = [],
  ) {
    super(0, 100, 100);
  }

  public override classList = {
    toggle: (name: string, on: boolean) => {
      if (on) this.classes.add(name);
      else this.classes.delete(name);
    },
    contains: (name: string) => this.layoutClasses.includes(name),
  };
}

describe("chipRowSignature", () => {
  it("changes with the text on the chips", () => {
    const a = chipRowSignature([new FakeChipRow("Door Locked")] as unknown as HTMLElement[]);
    const b = chipRowSignature([new FakeChipRow("Door Unlocked")] as unknown as HTMLElement[]);
    expect(a).not.toBe(b);
  });

  it("changes when a chip is added, even an icon-only one with no text", () => {
    const a = chipRowSignature([new FakeChipRow("x", 2)] as unknown as HTMLElement[]);
    const b = chipRowSignature([new FakeChipRow("x", 3)] as unknown as HTMLElement[]);
    expect(a).not.toBe(b);
  });

  it("changes when the row switches to smart widths", () => {
    const a = chipRowSignature([new FakeChipRow("x", 1, ["stretch"])] as unknown as HTMLElement[]);
    const b = chipRowSignature([new FakeChipRow("x", 1, ["stretch", "smart"])] as unknown as HTMLElement[]);
    expect(a).not.toBe(b);
  });
});

describe("ChipRowController", () => {
  it("does not measure again on a render that changed nothing on the chips", () => {
    // The render-storm case: every hass tick re-renders every chip card, and
    // measuring each time is a forced layout per chip.
    installResizeObserver();
    const layout = vi.fn();
    const controller = new ChipRowController(layout);
    const row = new FakeChipRow("Living room 21.4 °C");
    const root = fakeRoot([row]);

    controller.sync(root);
    controller.sync(root);
    controller.sync(root);
    expect(layout).toHaveBeenCalledTimes(1);
  });

  it("measures again when a chip's text changes", () => {
    installResizeObserver();
    const layout = vi.fn();
    const controller = new ChipRowController(layout);
    const row = new FakeChipRow("Living room 21.4 °C");
    const root = fakeRoot([row]);

    controller.sync(root);
    row.textContent = "Living room 21.5 °C";
    controller.sync(root);
    expect(layout).toHaveBeenCalledTimes(2);
  });

  it("measures again when the row is resized", () => {
    const observed = installResizeObserver();
    const layout = vi.fn();
    const row = new FakeChipRow("x");
    new ChipRowController(layout).sync(fakeRoot([row]));

    // The fades observe the row too; the last observer is the layout one.
    observed[observed.length - 1].observer?.();
    expect(layout).toHaveBeenCalledTimes(2);
  });

  it("measures a row Lit swapped in, even with the same text", () => {
    installResizeObserver();
    const layout = vi.fn();
    const controller = new ChipRowController(layout);
    controller.sync(fakeRoot([new FakeChipRow("x")]));
    controller.sync(fakeRoot([new FakeChipRow("x")]));
    expect(layout).toHaveBeenCalledTimes(2);
  });

  it("measures again after a disconnect and reconnect", () => {
    installResizeObserver();
    const layout = vi.fn();
    const controller = new ChipRowController(layout);
    const root = fakeRoot([new FakeChipRow("x")]);
    controller.sync(root);
    controller.disconnect();
    controller.sync(root);
    expect(layout).toHaveBeenCalledTimes(2);
  });

  it("runs the fades as well, so a host needs nothing else", () => {
    installResizeObserver();
    const row = new FakeChipRow("x");
    row.scrollWidth = 300;
    new ChipRowController(vi.fn()).sync(fakeRoot([row]));
    expect([...row.classes]).toEqual(["fade-end"]);
  });

  it("does nothing for a card with no chip row", () => {
    installResizeObserver();
    const layout = vi.fn();
    const controller = new ChipRowController(layout);
    controller.sync(fakeRoot([]));
    expect(layout).not.toHaveBeenCalled();
    expect(() => controller.disconnect()).not.toThrow();
  });
});

describe("smartChipWidths", () => {
  it("shares spare room evenly on top of each content width", () => {
    expect(smartChipWidths([200, 80, 60], 400)).toEqual([220, 100, 80]);
  });

  it("cuts only the long chip when the row is too narrow", () => {
    // The screenshot case: a long lock chip next to two short sensor chips.
    expect(smartChipWidths([260, 100, 90], 360)).toEqual([170, 100, 90]);
  });

  it("caps every chip that is over the fair share, not just the widest", () => {
    expect(smartChipWidths([300, 200, 50], 350)).toEqual([150, 150, 50]);
  });

  it("splits evenly when nothing is under the fair share", () => {
    expect(smartChipWidths([200, 200], 300)).toEqual([150, 150]);
  });

  it("never widens a fixed chip", () => {
    expect(smartChipWidths([100, 36, 64], 260, [false, true, false])).toEqual([130, 36, 94]);
  });

  it("never cuts a fixed chip either — it comes off the top first", () => {
    expect(smartChipWidths([200, 36, 200], 90, [false, true, false])).toEqual([27, 36, 27]);
  });

  it("leaves fixed chips whole even when they alone overflow the row", () => {
    expect(smartChipWidths([36, 36, 120], 60, [true, true, false])).toEqual([36, 36, 0]);
  });

  it("fills the row exactly", () => {
    const widths = smartChipWidths([310, 95, 42, 180], 500);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(500);
  });
});
