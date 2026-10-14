import "@testing-library/jest-dom/vitest";

// users.js throws at import time if this is missing, so it must be set
// before any test file imports server code.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-do-not-use-in-production";

// jsdom doesn't implement scrollIntoView; Chat.jsx calls it on every
// message update. (Server integration tests run in the node environment,
// where there is no Element at all.)
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = () => {};
}
