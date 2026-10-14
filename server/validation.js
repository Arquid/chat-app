export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,20}$/;
export const ROOM_NAME_REGEX = /^[a-zA-Z0-9_-]{2,30}$/;

export const MAX_TEXT_LENGTH = 2000;

// The only image reference the server ever hands out is
// /uploads/<uuid>.<ext> (see the multer storage in index.js). Anything else a
// client puts in a message's `image` field is not an upload of ours.
export const IMAGE_PATH_REGEX = /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp))$/;

// Returns the stored file name ("<uuid>.png") for a valid image path, else null.
export function parseImagePath(imagePath) {
  const match = typeof imagePath === "string" ? IMAGE_PATH_REGEX.exec(imagePath) : null;
  return match ? match[1] : null;
}

export function isValidUsername(username) {
  return typeof username === "string" && USERNAME_REGEX.test(username);
}

export function isValidPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

export function isValidMessage(message) {
  return Boolean(
    message &&
    typeof message.text === "string" &&
    message.text.length <= MAX_TEXT_LENGTH &&
    (message.text.trim().length > 0 || typeof message.image === "string") &&
    (message.image === null || message.image === undefined || parseImagePath(message.image) !== null)
  );
}

export function isValidRoomName(roomName) {
  return typeof roomName === "string" && ROOM_NAME_REGEX.test(roomName);
}
