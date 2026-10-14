// Socket.io event handlers run inside the process, so an exception thrown by
// one of them (for example destructuring a null payload) would take the whole
// server down for every connected user. This wrapper makes a bad client
// message harmless: it is logged and ignored.
export function safeHandler(handler, { expectObject = true } = {}) {
  return (...args) => {
    try {
      if (expectObject && (args[0] === null || typeof args[0] !== "object")) return;
      handler(...args);
    } catch (error) {
      console.error("socket handler failed:", error);
    }
  };
}
