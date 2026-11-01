// A repeating callback that only runs while its card is actually on screen.
//
// A clock on a wall tablet runs for weeks. Left alone, a requestAnimationFrame
// loop keeps firing while the card is scrolled out of view, while another
// dashboard tab is in front, and while the screen is off — for a display nobody
// is looking at. This gates the loop on both signals a browser gives us:
// IntersectionObserver for "scrolled into view" and document.hidden for "this
// tab is in front".
//
// Three cadences, because the cheapest one that still looks right is the one to
// use:
//   "frame"  — every animation frame. Only for something that moves smoothly.
//   "second" — on each second boundary.
//   "ten-seconds" — on each ten-second boundary. For a running duration that
//              counts from an arbitrary moment: it changes off the clock's
//              minute, and ten seconds keeps it close without ticking a second.
//   "minute" — on each minute boundary. A clock with no seconds and no moving
//              shape needs nothing more, and this is by far the cheapest.
//
// The callback receives `Date.now()`. It must not write reactive state on every
// frame: at 60Hz that is 60 renders a second for a reading that changes once a
// second at most. Compare what will actually be *shown* and only then assign —
// the same mistake cost the power-summary card 352 renders in 20 seconds.

export type TickCadence = "frame" | "second" | "ten-seconds" | "minute";

export class VisibleTicker {
  private _host: HTMLElement;
  private _onTick: (now: number) => void;
  private _cadence: TickCadence = "minute";

  private _observer?: IntersectionObserver;
  private _rafId?: number;
  private _timeoutId?: number;

  private _onScreen = true;
  private _tabVisible = true;
  private _running = false;

  private _onDocVisibility = () => {
    this._tabVisible = !document.hidden;
    this._sync();
  };

  constructor(host: HTMLElement, onTick: (now: number) => void) {
    this._host = host;
    this._onTick = onTick;
  }

  /** Call from connectedCallback. */
  public connect(): void {
    this._tabVisible = !document.hidden;
    document.addEventListener("visibilitychange", this._onDocVisibility);

    // Without IntersectionObserver (very old browsers) the card simply keeps
    // ticking — degraded, not broken.
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver(
        (entries) => {
          this._onScreen = entries.some((e) => e.isIntersecting);
          this._sync();
        },
        { threshold: 0 },
      );
      this._observer.observe(this._host);
    }
    this._sync();
  }

  /** Call from disconnectedCallback. Safe to call twice. */
  public disconnect(): void {
    document.removeEventListener("visibilitychange", this._onDocVisibility);
    this._observer?.disconnect();
    this._observer = undefined;
    this._stop();
  }

  /**
   * Switch cadence. Cheap to call on every render — it only restarts the timer
   * when the cadence actually changed.
   */
  public setCadence(cadence: TickCadence): void {
    if (cadence === this._cadence) return;
    this._cadence = cadence;
    if (this._running) {
      this._stop();
      this._start();
    }
  }

  /** True while the ticker is scheduling work. Exposed for tests and debugging. */
  public get running(): boolean {
    return this._running;
  }

  private get _active(): boolean {
    return this._onScreen && this._tabVisible;
  }

  private _sync(): void {
    if (this._active && !this._running) {
      this._start();
      // Fire at once: coming back from a hidden tab, the display is stale by
      // however long it was away.
      this._onTick(Date.now());
    } else if (!this._active && this._running) {
      this._stop();
    }
  }

  private _start(): void {
    this._running = true;
    if (this._cadence === "frame") {
      const step = () => {
        this._onTick(Date.now());
        // A callback may stop the ticker itself — an animation that has settled
        // has nothing left to draw. Without this check the next frame would be
        // scheduled after the stop had already run, and the loop would carry on
        // with nothing to cancel it.
        if (!this._running) return;
        this._rafId = requestAnimationFrame(step);
      };
      this._rafId = requestAnimationFrame(step);
      return;
    }
    this._scheduleBoundary();
  }

  /**
   * Sleeps until the next second or minute boundary rather than every 1000ms,
   * so the reading changes when the clock does instead of drifting a little
   * further from it with every tick.
   */
  private _scheduleBoundary(): void {
    const period = this._cadence === "second" ? 1000 : this._cadence === "ten-seconds" ? 10_000 : 60_000;
    const now = Date.now();
    // +20ms so the callback lands just after the boundary, never a hair before
    // it, which would show the previous second.
    const wait = period - (now % period) + 20;
    this._timeoutId = window.setTimeout(() => {
      this._onTick(Date.now());
      if (this._running) this._scheduleBoundary();
    }, wait);
  }

  private _stop(): void {
    this._running = false;
    if (this._rafId !== undefined) {
      cancelAnimationFrame(this._rafId);
      this._rafId = undefined;
    }
    if (this._timeoutId !== undefined) {
      clearTimeout(this._timeoutId);
      this._timeoutId = undefined;
    }
  }
}
