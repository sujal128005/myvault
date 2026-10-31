/**
 * Inactivity auto-lock logic (platform-independent; driven by a timer).
 * Uses wall-clock timestamps, so sleeping laptops / throttled background tabs
 * still lock on the first check after wake-up.
 */
export interface InactivityOptions {
  timeoutMs: () => number;
  /** If non-null, lock once the page has been hidden for this long. */
  hiddenTimeoutMs: () => number | null;
  onLock: () => void;
  now?: () => number;
}

export class InactivityMonitor {
  private last: number;
  private hiddenAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: InactivityOptions) {
    this.now = opts.now ?? Date.now;
    this.last = this.now();
  }

  poke(): void {
    this.last = this.now();
  }

  setHidden(hidden: boolean): void {
    this.hiddenAt = hidden ? this.now() : null;
    if (!hidden) this.check();
  }

  /** Returns true if it locked. */
  check(): boolean {
    const t = this.now();
    if (t - this.last >= this.opts.timeoutMs()) {
      this.opts.onLock();
      return true;
    }
    const hiddenLimit = this.opts.hiddenTimeoutMs();
    if (this.hiddenAt !== null && hiddenLimit !== null && t - this.hiddenAt >= hiddenLimit) {
      this.opts.onLock();
      return true;
    }
    return false;
  }
}

export const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'] as const;
