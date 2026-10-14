import { describe, it, expect } from "vitest";
import { toggleReaction } from "../reactions.js";

describe("toggleReaction", () => {
  it("adds the first reaction to a message that has none", () => {
    expect(toggleReaction(undefined, "👍", "alice")).toEqual({ "👍": ["alice"] });
    expect(toggleReaction({}, "👍", "alice")).toEqual({ "👍": ["alice"] });
  });

  it("adds a second user to an existing reaction, keeping order", () => {
    expect(toggleReaction({ "👍": ["alice"] }, "👍", "bob")).toEqual({ "👍": ["alice", "bob"] });
  });

  it("removes the user's own reaction when toggled again", () => {
    expect(toggleReaction({ "👍": ["alice", "bob"] }, "👍", "alice")).toEqual({ "👍": ["bob"] });
  });

  it("removes the emoji key entirely when the last user leaves", () => {
    expect(toggleReaction({ "👍": ["alice"] }, "👍", "alice")).toEqual({});
  });

  it("keeps other emojis untouched", () => {
    const result = toggleReaction({ "🎉": ["bob"] }, "👍", "alice");
    expect(result).toEqual({ "🎉": ["bob"], "👍": ["alice"] });
  });

  it("does not mutate the object it was given", () => {
    const original = { "👍": ["alice"] };
    toggleReaction(original, "👍", "bob");
    expect(original).toEqual({ "👍": ["alice"] });
  });

  // Regression: these keys used to resolve to inherited Object.prototype
  // members, so `users.includes` threw and crashed the whole server.
  it.each(["toString", "valueOf", "constructor", "hasOwnProperty", "__proto__"])(
    "treats %s as an ordinary key instead of an inherited member",
    (key) => {
      const added = toggleReaction({}, key, "alice");
      expect(Object.keys(added)).toEqual([key]);
      expect(added[key]).toEqual(["alice"]);
      expect(Object.getPrototypeOf(added)).toBe(Object.prototype);

      const removed = toggleReaction(added, key, "alice");
      expect(Object.keys(removed)).toEqual([]);
    }
  );

  it("recovers from malformed stored data instead of throwing", () => {
    expect(toggleReaction(null, "👍", "alice")).toEqual({ "👍": ["alice"] });
    expect(toggleReaction(["x"], "👍", "alice")).toEqual({ "👍": ["alice"] });
    expect(toggleReaction({ "👍": "not-an-array" }, "👍", "alice")).toEqual({ "👍": ["alice"] });
  });
});
