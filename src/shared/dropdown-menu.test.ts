import { describe, it, expect, vi, afterEach } from "vitest";
import { M3DropdownMenu, positionDropdown } from "./dropdown-menu";

const VIEWPORT = { width: 400, height: 800 };
const MENU = { width: 200, height: 160 };

describe("positionDropdown", () => {
  it("opens below the anchor and centers on it when there is room", () => {
    const { left, top, placement } = positionDropdown(
      { top: 100, left: 150, width: 40, height: 38 },
      MENU,
      VIEWPORT,
    );
    expect(placement).toBe("below");
    expect(top).toBe(100 + 38 + 6);
    expect(left).toBe(150 + 20 - 100);
  });

  it("flips above the anchor when the menu would run off the bottom", () => {
    const { top, placement } = positionDropdown(
      { top: 700, left: 150, width: 40, height: 38 },
      MENU,
      VIEWPORT,
    );
    expect(placement).toBe("above");
    expect(top).toBe(700 - 6 - 160);
  });

  it("stays below when neither side fits, clamped into the viewport", () => {
    const tall = { width: 200, height: 780 };
    const { top, placement } = positionDropdown(
      { top: 300, left: 150, width: 40, height: 38 },
      tall,
      VIEWPORT,
    );
    expect(placement).toBe("below");
    // Pulled up so the bottom edge keeps its margin too.
    expect(top).toBe(VIEWPORT.height - 8 - tall.height);
  });

  it("clamps horizontally instead of hanging off the screen edge", () => {
    const nearLeft = positionDropdown(
      { top: 100, left: 0, width: 40, height: 38 },
      MENU,
      VIEWPORT,
    );
    expect(nearLeft.left).toBe(8);

    const nearRight = positionDropdown(
      { top: 100, left: 360, width: 40, height: 38 },
      MENU,
      VIEWPORT,
    );
    expect(nearRight.left).toBe(400 - 8 - 200);
  });
});

// No DOM in this run: the menu is built from its prototype, with a stand-in
// dialog behind renderRoot, which is all the handover touches.
interface MenuInternals {
  _onClose?: () => void;
  _handleClose(): void;
  replaceHost(): void;
}

function fakeMenu() {
  const dialog = {
    open: true,
    close() {
      this.open = false;
    },
  };
  const menu = Object.create(M3DropdownMenu.prototype) as MenuInternals;
  Object.defineProperty(menu, "renderRoot", { value: { querySelector: () => dialog } });
  Object.defineProperty(menu, "_ignoreNextClose", { value: false, writable: true });
  return { menu, dialog };
}

describe("M3DropdownMenu host handover", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells the outgoing host at once, and not the incoming one later", () => {
    vi.stubGlobal("window", { removeEventListener: vi.fn() });
    const { menu, dialog } = fakeMenu();
    const outgoing = vi.fn();
    const incoming = vi.fn();
    menu._onClose = outgoing;

    menu.replaceHost();
    expect(dialog.open).toBe(false);
    expect(outgoing).toHaveBeenCalledTimes(1);

    // openFor() installs the next host, then the replaced menu's queued
    // close event finally arrives.
    menu._onClose = incoming;
    menu._handleClose();
    expect(incoming).not.toHaveBeenCalled();
    expect(window.removeEventListener).not.toHaveBeenCalled();

    // The incoming host's own close still reaches it.
    menu._handleClose();
    expect(incoming).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no menu is open", () => {
    const { menu, dialog } = fakeMenu();
    dialog.open = false;
    const onClose = vi.fn();
    menu._onClose = onClose;
    menu.replaceHost();
    expect(onClose).not.toHaveBeenCalled();
  });
});
