// Two bounded in-memory controls plus the webhook dedupe cache. Single
// container per site, so in-process state is sufficient; nothing here is a
// database and nothing here survives a restart, which is stated rather than
// implied because a restart re-opens the dedupe window for 15 days of Stripe
// redeliveries.

const HOUR_MS = 3_600_000;
const SWEEP_INTERVAL_MS = 60_000;

/** A rolling (not calendar-bucketed) counter: a burst cannot reset on the hour. */
export class RollingHourCounter {
  readonly #limit: number;
  readonly #hits = new Map<string, number[]>();
  #lastSweep = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  allow(key: string, now: number = Date.now()): boolean {
    this.#maybeSweep(now);
    const fresh = (this.#hits.get(key) ?? []).filter((at) => now - at < HOUR_MS);
    if (fresh.length >= this.#limit) {
      this.#hits.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.#hits.set(key, fresh);
    return true;
  }

  /** Number of keys still holding a hit inside the window. */
  size(now: number = Date.now()): number {
    this.#sweep(now);
    return this.#hits.size;
  }

  #maybeSweep(now: number): void {
    if (now - this.#lastSweep < SWEEP_INTERVAL_MS) return;
    this.#sweep(now);
  }

  #sweep(now: number): void {
    this.#lastSweep = now;
    for (const [key, times] of this.#hits) {
      const fresh = times.filter((at) => now - at < HOUR_MS);
      if (fresh.length === 0) this.#hits.delete(key);
      else this.#hits.set(key, fresh);
    }
  }
}

/**
 * `dedupe-on-event-id`. The spec calls this an LRU of 500; eviction is FIFO on
 * insertion order and a repeat hit does NOT refresh an id, because a
 * redelivery must not extend an old id's lifetime. Named for what it does.
 */
export class EventIdCache {
  readonly #capacity: number;
  readonly #ids = new Set<string>();

  constructor(capacity: number) {
    this.#capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.#ids.size;
  }

  /** True if this id was already handled. Records it either way. */
  seen(id: string): boolean {
    if (this.#ids.has(id)) return true;
    this.#ids.add(id);
    while (this.#ids.size > this.#capacity) {
      const oldest = this.#ids.values().next();
      if (oldest.done === true) break;
      this.#ids.delete(oldest.value);
    }
    return false;
  }
}

/** Max PaymentIntents one client IP may cause per rolling hour. */
export const INTENT_LIMIT_PER_IP_PER_HOUR = 20;
/** Max lead submissions one client IP may cause per rolling hour. */
export const LEAD_LIMIT_PER_IP_PER_HOUR = 5;
/** `outbound-email-cap-per-site-per-hour`: hard ceiling on Resend calls. */
export const OUTBOUND_EMAIL_LIMIT_PER_HOUR = 30;
/** `dedupe-on-event-id`: bounded id cache. */
export const EVENT_CACHE_CAPACITY = 500;
