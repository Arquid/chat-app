export class UserError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}