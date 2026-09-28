import { assertQueryAllowed } from "./query-policy";

describe("database query policy", () => {
  it("accepts a single select", () => {
    expect(
      assertQueryAllowed("SELECT id FROM users WHERE id = {{userId}}", "SELECT", "sql"),
    ).toContain("SELECT id");
  });

  it("rejects comments, multiple statements, and forbidden keywords", () => {
    expect(() => assertQueryAllowed("SELECT 1 -- hidden", "SELECT", "sql")).toThrow(
      "Comments are not allowed in queries",
    );
    expect(() => assertQueryAllowed("SELECT 1; SELECT 2", "QUERY", "sql")).toThrow(
      "Only one statement is allowed",
    );
    expect(() => assertQueryAllowed("DROP TABLE users", "QUERY", "sql")).toThrow(
      "Statement is not allowed",
    );
  });

  it("rejects an operation that does not match the statement", () => {
    expect(() => assertQueryAllowed("DELETE FROM users", "SELECT", "sql")).toThrow(
      "This operation does not allow that statement",
    );
  });

  it("rejects empty and oversized queries", () => {
    expect(() => assertQueryAllowed("   ", "SELECT", "sql")).toThrow("Query is empty");
    expect(() => assertQueryAllowed("SELECT 1" + "x".repeat(4000), "SELECT", "sql")).toThrow(
      "Query is too long",
    );
  });

  it("allows a redis read and rejects a flush", () => {
    expect(assertQueryAllowed("GET user:1", "QUERY", "redis")).toBe("GET user:1");
    expect(() => assertQueryAllowed("FLUSHALL", "QUERY", "redis")).toThrow(
      "Statement is not allowed",
    );
  });

  it("rejects mongo operators that execute code", () => {
    expect(() =>
      assertQueryAllowed(
        JSON.stringify({ collection: "users", filter: { $where: "this.a == 1" } }),
        "SELECT",
        "document",
      ),
    ).toThrow("Statement is not allowed");
  });
});
