import { describe, it, expect } from "vitest";
import { isValidUsername, isValidPassword, isValidMessage, isValidRoomName, MAX_TEXT_LENGTH } from "../validation.js";

describe("isValidUsername", () => {
  it("accepts 3-20 alphanumeric/underscore/hyphen characters", () => {
    expect(isValidUsername("abc")).toBe(true);
    expect(isValidUsername("a".repeat(20))).toBe(true);
    expect(isValidUsername("valid_user-1")).toBe(true);
  });

  it("rejects usernames shorter than 3 or longer than 20 characters", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("a".repeat(21))).toBe(false);
  });

  it("rejects usernames with disallowed characters anywhere in the string", () => {
    // Regression test: an earlier version of this regex had no trailing `$`
    // anchor, so only the first 3-20 characters were checked and anything
    // could be appended after them (e.g. "abc<script>alert(1)</script>").
    expect(isValidUsername("abc<script>alert(1)</script>")).toBe(false);
    expect(isValidUsername("valid name")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidUsername(undefined)).toBe(false);
    expect(isValidUsername(123)).toBe(false);
    expect(isValidUsername(null)).toBe(false);
  });
});

describe("isValidPassword", () => {
  it("accepts strings of 8 or more characters", () => {
    expect(isValidPassword("password123")).toBe(true);
    expect(isValidPassword("12345678")).toBe(true);
  });

  it("rejects strings shorter than 8 characters", () => {
    expect(isValidPassword("short")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidPassword(undefined)).toBe(false);
    expect(isValidPassword(12345678)).toBe(false);
  });
});

describe("isValidMessage", () => {
  it("accepts a message with non-empty text", () => {
    expect(isValidMessage({ text: "hello" })).toBe(true);
  });

  it("accepts an image-only message with empty text", () => {
    expect(isValidMessage({ text: "", image: "/uploads/x.png" })).toBe(true);
  });

  it("rejects a message with neither text nor image", () => {
    expect(isValidMessage({ text: "" })).toBe(false);
    expect(isValidMessage({ text: "   " })).toBe(false);
  });

  it("rejects text longer than the max length", () => {
    expect(isValidMessage({ text: "a".repeat(MAX_TEXT_LENGTH + 1) })).toBe(false);
  });

  it("accepts text at exactly the max length", () => {
    expect(isValidMessage({ text: "a".repeat(MAX_TEXT_LENGTH) })).toBe(true);
  });

  it("rejects a non-string image field", () => {
    expect(isValidMessage({ text: "hi", image: 12345 })).toBe(false);
  });

  it("rejects null/undefined messages", () => {
    expect(isValidMessage(null)).toBe(false);
    expect(isValidMessage(undefined)).toBe(false);
  });
});

describe("isValidRoomName", () => {
  it("accepts 2-30 alphanumeric/underscore/hyphen characters", () => {
    expect(isValidRoomName("general")).toBe(true);
    expect(isValidRoomName("ab")).toBe(true);
    expect(isValidRoomName("a".repeat(30))).toBe(true);
    expect(isValidRoomName("room_name-1")).toBe(true);
  });

  it("rejects names shorter than 2 or longer than 30 characters", () => {
    expect(isValidRoomName("a")).toBe(false);
    expect(isValidRoomName("a".repeat(31))).toBe(false);
  });

  it("rejects names with disallowed characters anywhere in the string", () => {
    expect(isValidRoomName("ab<script>alert(1)</script>")).toBe(false);
    expect(isValidRoomName("room name")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidRoomName(undefined)).toBe(false);
    expect(isValidRoomName(123)).toBe(false);
    expect(isValidRoomName(null)).toBe(false);
  });
});
