export class IdentityError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 429 | 503,
    message: string,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}
