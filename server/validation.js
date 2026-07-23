export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,20}$/;
export const ROOM_NAME_REGEX = /^[a-zA-Z0-9_-]{2,30}$/;

export const MAX_TEXT_LENGTH = 2000;

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
    (message.image === null || message.image === undefined || typeof message.image === "string")
  );
}

export function isValidRoomName(roomName) {
  return typeof roomName === "string" && ROOM_NAME_REGEX.test(roomName);
}
