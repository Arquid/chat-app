import { describe, it, expect } from "vitest";
import { UserError } from "../errors.js";

describe("UserError", () => {
  it("is an Error that carries a message and an HTTP status", () => {
    const error = new UserError("Username already taken", 409);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(UserError);
    expect(error.name).toBe("UserError");
    expect(error.message).toBe("Username already taken");
    expect(error.status).toBe(409);
  });

  it("has a stack trace, so it is still useful when it ends up in a log", () => {
    expect(new UserError("x", 400).stack).toContain("UserError");
  });

  it("is not confused with a plain Error", () => {
    expect(new Error("x")).not.toBeInstanceOf(UserError);
  });
});
