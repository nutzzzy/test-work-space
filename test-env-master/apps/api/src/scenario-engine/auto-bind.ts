import type { ExecutionContext } from "./types";

const ALIAS_GROUPS = [
  ["token", "access_token", "accessToken", "jwt", "id_token", "idToken"],
  ["refresh_token", "refreshToken"],
  ["userId", "user_id", "user.id"],
  ["orderId", "order_id", "order.id"],
];

function normalizeKey(key: string) {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function aliasesFor(path: string[]): string[] {
  const leaf = path[path.length - 1] ?? "";
  const dotted = path.join(".");
  const keys = new Set<string>([leaf, dotted]);
  const norm = normalizeKey(leaf);
  for (const group of ALIAS_GROUPS) {
    if (group.some((item) => normalizeKey(item) === norm)) {
      for (const item of group) keys.add(item);
    }
  }
  if (norm.endsWith("id") && path.length > 1) {
    const parent = path[path.length - 2] ?? "";
    keys.add(`${parent}Id`);
    keys.add(`${parent}_id`);
    keys.add(`${parent}.id`);
  }
  return [...keys];
}

function isUsefulScalar(value: unknown): value is string | number | boolean {
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length > 0 && text.length <= 500;
}

/** Remember scalar fields from an API response so later requests can reuse them. */
export function captureResponse(
  body: unknown,
  context: ExecutionContext,
): Record<string, string> {
  const learned: Record<string, string> = {};

  const visit = (value: unknown, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, [...path, key]);
      }
      return;
    }
    if (!isUsefulScalar(value) || path.length === 0) return;
    const leaf = path[path.length - 1] ?? "";
    if (/^\d+$/.test(leaf)) return;
    const text = String(value);
    for (const key of aliasesFor(path)) {
      if (context.isInitial(key) || context.get(key) !== undefined) continue;
      context.set(key, text);
      learned[key] = text;
    }
  };

  visit(body, []);
  return learned;
}

function lookup(key: string, context: ExecutionContext): string | undefined {
  const direct = context.get(key);
  if (direct !== undefined) return direct;
  const norm = normalizeKey(key);
  for (const [name, value] of Object.entries(context.entries())) {
    if (normalizeKey(name) === norm) return value;
  }
  for (const group of ALIAS_GROUPS) {
    if (!group.some((item) => normalizeKey(item) === norm)) continue;
    for (const item of group) {
      const value = context.get(item);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function bindString(input: string, context: ExecutionContext, fieldKey?: string) {
  let next = input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) => {
    return lookup(key, context) ?? match;
  });
  next = next.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    return lookup(key, context) ?? match;
  });
  if (
    fieldKey &&
    (next.trim() === "" || next === fieldKey || next === `:${fieldKey}`)
  ) {
    const found = lookup(fieldKey, context);
    if (found !== undefined) return found;
  }
  return next;
}

function bindValue(value: unknown, context: ExecutionContext, fieldKey?: string): unknown {
  if (typeof value === "string") return bindString(value, context, fieldKey);
  if (Array.isArray(value)) return value.map((item) => bindValue(item, context));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = bindValue(child, context, key);
    }
    return out;
  }
  return value;
}

/** Fill request fields from values captured in earlier API responses. */
export function bindRequest(
  config: Record<string, unknown>,
  context: ExecutionContext,
): Record<string, unknown> {
  const bound = bindValue(config, context) as Record<string, unknown>;
  const token = lookup("token", context);
  if (!token) return bound;

  const headers = {
    ...((bound.headers as Record<string, unknown> | undefined) ?? {}),
  };
  const authorization = headers.Authorization ?? headers.authorization;
  const missing =
    authorization === undefined ||
    (typeof authorization === "string" &&
      (authorization.trim() === "" ||
        authorization.trim() === "Bearer" ||
        authorization.includes("{{")));
  if (missing) {
    headers.Authorization = `Bearer ${token}`;
    delete headers.authorization;
    bound.headers = headers;
  }
  return bound;
}
