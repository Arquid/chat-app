// Sliding-window rate limiter keyed by any string. The server keys it by
// username, so the budget belongs to the account instead of one connection.
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map(); // key -> ascending timestamps still inside the window

  function recent(key, t) {
    const list = hits.get(key) ?? [];
    while (list.length > 0 && t - list[0] >= windowMs) list.shift();
    return list;
  }

  return {
    // Counts the attempt and returns true, or returns false when over the limit.
    take(key) {
      const t = now();
      const list = recent(key, t);
      if (list.length >= limit) {
        hits.set(key, list);
        return false;
      }
      list.push(t);
      hits.set(key, list);
      return true;
    },

    // Drops keys whose window has fully expired so the map cannot grow forever.
    sweep() {
      const t = now();
      for (const key of [...hits.keys()]) {
        if (recent(key, t).length === 0) hits.delete(key);
      }
    },

    get size() {
      return hits.size;
    },
  };
}