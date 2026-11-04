import { describe, it, expect, vi, afterEach } from "vitest";
import { createRateLimiter } from "../rateLimiter.js";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance(ms) { t += ms; } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createRateLimiter", () => {
  it("allows up to the limit and then refuses", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: c.now });
    expect([1, 2, 3, 4, 5].map(() => limiter.take("alice"))).toEqual([true, true, true, false, false]);
  });

  it("keeps keys independent of each other", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(limiter.take("alice")).toBe(true);
    expect(limiter.take("alice")).toBe(false);
    expect(limiter.take("bob")).toBe(true);
  });

  it("frees capacity one hit at a time as old hits leave the window", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: c.now });
    expect(limiter.take("a")).toBe(true); // t=0
    c.advance(400);
    expect(limiter.take("a")).toBe(true); // t=400
    expect(limiter.take("a")).toBe(false);
    c.advance(600); // t=1000: the hit from t=0 is exactly windowMs old and has expired
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false); // the t=400 hit still counts
  });

  it("does not let a hit at the very edge of the window count twice", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(limiter.take("a")).toBe(true);
    c.advance(999);
    expect(limiter.take("a")).toBe(false);
    c.advance(1);
    expect(limiter.take("a")).toBe(true);
  });

  it("does not count refused attempts against the window", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(limiter.take("a")).toBe(true);
    for (let i = 0; i < 5; i++) {
      c.advance(100);
      expect(limiter.take("a")).toBe(false);
    }
    c.advance(500); // 1000 ms after the only counted hit
    expect(limiter.take("a")).toBe(true);
  });

  it("treats keys that look like Object.prototype members as ordinary keys", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(limiter.take(key)).toBe(true);
      expect(limiter.take(key)).toBe(false);
    }
  });

  it("sweep removes only keys whose window has fully expired", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    limiter.take("old");
    c.advance(600);
    limiter.take("fresh");
    expect(limiter.size).toBe(2);

    c.advance(400); // "old" is now 1000 ms old, "fresh" only 400 ms
    limiter.sweep();
    expect(limiter.size).toBe(1);
    expect(limiter.take("fresh")).toBe(false); // still limited, so it was kept
    expect(limiter.take("old")).toBe(true);
  });

  it("uses the real clock by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    vi.setSystemTime(1000);
    expect(limiter.take("a")).toBe(true);
  });
});
