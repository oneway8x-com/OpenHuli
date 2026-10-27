import assert from "node:assert/strict";
import { test } from "node:test";
import { getTestDatabaseUrl } from "./test-database.ts";

test("accepts only the explicit local test database", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const url = `postgresql://test:test@${host}:5434/openhuli_test?schema=public`;
    assert.equal(getTestDatabaseUrl(url), url);
  }
});

test("rejects missing, remote, development, and connection-override targets without exposing secrets", () => {
  for (const value of [
    "",
    "invalid",
    "https://localhost/openhuli_test",
    "postgresql://test:secret@db.example.com/openhuli_test",
    "postgresql://test:secret@localhost/openhuli",
    "postgresql://test:secret@localhost/postgres",
    "postgresql://test:secret@localhost/openhuli_test?host=db.example.com",
    "postgresql://test:secret@localhost/openhuli_test?schema=other",
    "postgresql://test:secret@localhost/openhuli_test#fragment",
  ]) {
    assert.throws(
      () => getTestDatabaseUrl(value),
      (error: Error) =>
        error.message.includes("local openhuli_test") &&
        !error.message.includes("secret"),
    );
  }
});
