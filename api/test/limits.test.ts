// EventIdCache is what the spec calls the "LRU of 500": eviction is FIFO on
// insertion order and a hit does NOT refresh an id, because a redelivery must
// not extend an old id's lifetime. Named for what it does.
// Two bounded in-memory controls: the per-IP intent cap and the per-hour
// outbound mail cap, plus the event-id LRU that collapses Stripe redeliveries.
import { describe, expect, test } from "bun:test";
import { EventIdCache, RollingHourCounter } from "../src/limits.ts";

const T0 = 1_756_000_000_000;

describe("RollingHourCounter", () => {
  test("allows exactly the configured number of events in one hour", () => {
    const counter = new RollingHourCounter(20);
    for (let i = 0; i < 20; i += 1) {
      expect(counter.allow("1.2.3.4", T0 + i)).toBe(true);
    }
    expect(counter.allow("1.2.3.4", T0 + 20)).toBe(false);
  });

  test("counts each key separately", () => {
    const counter = new RollingHourCounter(1);
    expect(counter.allow("a", T0)).toBe(true);
    expect(counter.allow("a", T0)).toBe(false);
    expect(counter.allow("b", T0)).toBe(true);
  });

  test("forgets an event once it is an hour old", () => {
    const counter = new RollingHourCounter(2);
    expect(counter.allow("a", T0)).toBe(true);
    expect(counter.allow("a", T0 + 1000)).toBe(true);
    expect(counter.allow("a", T0 + 2000)).toBe(false);
    expect(counter.allow("a", T0 + 3_600_001)).toBe(true);
  });

  test("rolls rather than resetting on a fixed boundary", () => {
    const counter = new RollingHourCounter(2);
    counter.allow("a", T0);
    counter.allow("a", T0 + 3_000_000);
    expect(counter.allow("a", T0 + 3_600_001)).toBe(true);
    expect(counter.allow("a", T0 + 3_600_002)).toBe(false);
  });

  test("drops keys that have gone quiet, so memory stays bounded", () => {
    const counter = new RollingHourCounter(5);
    for (let i = 0; i < 1000; i += 1) {
      counter.allow(`ip-${i}`, T0);
    }
    expect(counter.size(T0 + 3_600_001)).toBe(0);
  });
});

describe("EventIdCache", () => {
  test("reports an id as unseen the first time and seen afterwards", () => {
    const lru = new EventIdCache(500);
    expect(lru.seen("evt_1")).toBe(false);
    expect(lru.seen("evt_1")).toBe(true);
    expect(lru.seen("evt_1")).toBe(true);
  });

  test("keeps distinct ids apart", () => {
    const lru = new EventIdCache(500);
    expect(lru.seen("evt_1")).toBe(false);
    expect(lru.seen("evt_2")).toBe(false);
  });

  test("never grows past its capacity", () => {
    const lru = new EventIdCache(500);
    for (let i = 0; i < 5000; i += 1) {
      lru.seen(`evt_${i}`);
    }
    expect(lru.size).toBe(500);
  });

  test("evicts the oldest id first", () => {
    const lru = new EventIdCache(3);
    lru.seen("a");
    lru.seen("b");
    lru.seen("c");
    lru.seen("d");
    expect(lru.seen("a")).toBe(false);
    expect(lru.seen("c")).toBe(true);
  });

  test("is not confused by an id named like an Object property", () => {
    const lru = new EventIdCache(10);
    expect(lru.seen("__proto__")).toBe(false);
    expect(lru.seen("constructor")).toBe(false);
    expect(lru.seen("__proto__")).toBe(true);
  });
});
