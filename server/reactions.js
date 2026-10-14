// Returns a new reactions object with `username`'s reaction `emoji` toggled.
//
// Reactions are keyed by client-supplied strings, so the lookups must never
// reach Object.prototype: with a plain `obj[emoji]` an emoji such as
// "toString" resolves to an inherited function instead of "no reactions yet".
// A Map built from the object's own entries has no such inherited keys.
export function toggleReaction(reactions, emoji, username) {
  const isPlainObject = reactions !== null && typeof reactions === "object" && !Array.isArray(reactions);
  const entries = new Map(isPlainObject ? Object.entries(reactions) : []);

  const current = entries.get(emoji);
  const users = Array.isArray(current) ? current : [];
  const next = users.includes(username) ? users.filter((u) => u !== username) : [...users, username];

  if (next.length > 0) {
    entries.set(emoji, next);
  } else {
    entries.delete(emoji);
  }

  // fromEntries defines own properties, so even a key like "__proto__" stays
  // plain data and cannot change the object's prototype.
  return Object.fromEntries(entries);
}
