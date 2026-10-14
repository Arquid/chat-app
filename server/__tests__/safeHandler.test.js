import { describe, it, expect, vi, afterEach } from "vitest";
import { safeHandler } from "../safeHandler.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeHandler", () => {
  it("passes object payloads through to the handler", () => {
    const handler = vi.fn();
    safeHandler(handler)({ id: "1" });
    expect(handler).toHaveBeenCalledWith({ id: "1" });
  });

  it("ignores null, undefined and primitive payloads for object handlers", () => {
    const handler = vi.fn();
    const wrapped = safeHandler(handler);
    wrapped(null);
    wrapped(undefined);
    wrapped("text");
    wrapped(42);
    wrapped();
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls handlers that opt out of the object check with any payload", () => {
    const handler = vi.fn();
    const wrapped = safeHandler(handler, { expectObject: false });
    wrapped("a string");
    wrapped(null);
    wrapped();
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("forwards extra arguments such as the disconnect reason", () => {
    const handler = vi.fn();
    safeHandler(handler, { expectObject: false })("transport close", "extra");
    expect(handler).toHaveBeenCalledWith("transport close", "extra");
  });

  it("swallows and logs errors thrown by the handler instead of propagating them", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = safeHandler(() => {
      throw new TypeError("boom");
    });

    expect(() => wrapped({})).not.toThrow();
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
