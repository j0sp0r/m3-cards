import { describe, it, expect, vi } from "vitest";
import {
  ChipRowFadeController,
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
