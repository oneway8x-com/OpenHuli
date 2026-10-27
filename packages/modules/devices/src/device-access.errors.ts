export class DeviceAccessError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DeviceAccessError";
  }
}
