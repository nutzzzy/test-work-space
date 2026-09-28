const MAX_QUERY_LENGTH = 4000;

const SQL_FORBIDDEN =
  /\b(DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|ATTACH|DETACH|PRAGMA|COPY|EXEC|EXECUTE|CALL|SHUTDOWN|VACUUM|MERGE)\b|INTO\s+OUTFILE|LOAD_FILE\s*\(/i;

export type QueryDialect = "sql" | "document" | "redis" | "search";

const REDIS_COMMANDS = new Set([
  "GET",
  "SET",
  "DEL",
  "EXISTS",
  "HGET",
  "HSET",
  "HDEL",
  "PING",
  "TTL",
  "EXPIRE",
  "TYPE",
  "STRLEN",
  "MGET",
]);

export function dialectFor(type: string): QueryDialect {
  switch (type) {
    case "MYSQL":
    case "POSTGRESQL":
    case "SQLSERVER":
    case "ORACLE":
      return "sql";
    case "MONGODB":
      return "document";
    case "REDIS":
      return "redis";
    case "ELASTICSEARCH":
      return "search";
    default:
      throw new Error("Invalid connector");
  }
}

function stripSqlStrings(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, "\"\"");
}

export function assertQueryAllowed(
  raw: string,
  operation: string,
  dialect: QueryDialect,
): string {
  const query = raw.trim();
  if (!query) throw new Error("Query is empty");
  if (query.length > MAX_QUERY_LENGTH) throw new Error("Query is too long");

  if (dialect === "sql") return assertSql(query, operation);
  if (dialect === "redis") return assertRedis(query);
  if (dialect === "document") return assertDocument(query, operation);
  return assertSearch(query);
}

function assertSql(query: string, operation: string): string {
  const stripped = stripSqlStrings(query);
  if (/--|\/\*|#/.test(stripped)) {
    throw new Error("Comments are not allowed in queries");
  }
  const body = stripped.trim().replace(/;+\s*$/g, "");
  if (body.includes(";")) throw new Error("Only one statement is allowed");
  if (SQL_FORBIDDEN.test(body)) throw new Error("Statement is not allowed");

  const keyword = (body.match(/^([A-Za-z]+)/)?.[1] ?? "").toUpperCase();
  const allowed = allowedSqlKeywords(operation);
  if (!allowed.includes(keyword)) {
    throw new Error("This operation does not allow that statement");
  }
  return query.trim().replace(/;+\s*$/g, "");
}

function allowedSqlKeywords(operation: string): string[] {
  switch (operation) {
    case "SELECT":
      return ["SELECT", "WITH"];
    case "INSERT":
      return ["INSERT"];
    case "UPDATE":
      return ["UPDATE"];
    case "DELETE":
      return ["DELETE"];
    case "QUERY":
      return ["SELECT", "WITH", "INSERT", "UPDATE", "DELETE"];
    default:
      throw new Error("Database step is invalid");
  }
}

function assertRedis(query: string): string {
  if (/--|\/\*|[\r\n]/.test(query)) {
    throw new Error("Comments are not allowed in queries");
  }
  if (query.includes(";")) throw new Error("Only one statement is allowed");
  const command = (query.trim().match(/^([A-Za-z]+)/)?.[1] ?? "").toUpperCase();
  if (!REDIS_COMMANDS.has(command)) throw new Error("Statement is not allowed");
  return query.trim();
}

function assertDocument(query: string, operation: string): string {
  if (!["QUERY", "SELECT", "INSERT", "UPDATE", "DELETE"].includes(operation)) {
    throw new Error("Database step is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    throw new Error("Database step is invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Database step is invalid");
  }
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.collection !== "string" || !doc.collection.trim()) {
    throw new Error("Database step is invalid");
  }
  const blob = JSON.stringify(doc);
  if (/\$where|\$function|mapReduce|\$accumulator/i.test(blob)) {
    throw new Error("Statement is not allowed");
  }
  return JSON.stringify(doc);
}

function assertSearch(query: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    throw new Error("Database step is invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Database step is invalid");
  }
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.index !== "string" || !doc.index.trim()) {
    throw new Error("Database step is invalid");
  }
  if (/script/i.test(JSON.stringify(doc))) {
    throw new Error("Statement is not allowed");
  }
  return JSON.stringify(doc);
}
