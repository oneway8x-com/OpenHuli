/** Test runners must never inherit a developer's or a deployed database connection. */
export function getTestDatabaseUrl(
  value = process.env.TEST_DATABASE_URL,
): string {
  const message =
    "TEST_DATABASE_URL must point to the local openhuli_test PostgreSQL database";
  if (!value) throw new Error(message);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  const safeParams = [...url.searchParams].every(
    ([key, entry]) => key === "schema" && entry === "public",
  );
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/openhuli_test" ||
    url.hash ||
    !safeParams
  ) {
    throw new Error(message);
  }
  return url.toString();
}
