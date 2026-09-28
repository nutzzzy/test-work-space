export function interpolatePath(obj: unknown, path: string): unknown {
  const cleaned = path
    .replace(/^\$\.?/, "")
    .replace(/^response\./, "")
    .trim();
  if (!cleaned) return obj;

  const parts = cleaned.split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    const match = part.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      const [, key, index] = match;
      if (!current || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
      if (!Array.isArray(current)) return undefined;
      current = current[Number(index)];
      continue;
    }
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function resolveResponsePath(
  path: string,
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  } | null,
): unknown {
  if (!response) return undefined;
  const normalized = path.replace(/^response\./, "");

  if (normalized === "status" || normalized === "status_code") {
    return response.status;
  }
  if (normalized.startsWith("headers.")) {
    const header = normalized.slice("headers.".length);
    return (
      response.headers[header.toLowerCase()] ?? response.headers[header]
    );
  }
  if (normalized === "body") {
    return response.body;
  }
  if (normalized.startsWith("body.")) {
    return interpolatePath(response.body, normalized.slice("body.".length));
  }
  // Convenience: body.data.orderId without body. prefix
  return interpolatePath(
    { status: response.status, headers: response.headers, body: response.body },
    normalized,
  );
}

function coerceEquals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (
    (typeof actual === "number" || typeof actual === "string") &&
    (typeof expected === "number" || typeof expected === "string")
  ) {
    return String(actual) === String(expected);
  }
  return false;
}

export function assertValue(
  kind: string,
  actual: unknown,
  expected?: unknown,
): void {
  switch (kind) {
    case "status_code":
    case "equals":
      if (!coerceEquals(actual, expected)) {
        throw new Error(
          `Assertion equals failed: expected ${String(expected)}, got ${String(actual)}`,
        );
      }
      break;
    case "not_equals":
      if (coerceEquals(actual, expected)) {
        throw new Error(
          `Assertion not_equals failed: both are ${String(actual)}`,
        );
      }
      break;
    case "contains":
      if (typeof actual === "string" && typeof expected === "string") {
        if (!actual.includes(expected)) {
          throw new Error(`Assertion contains failed`);
        }
        break;
      }
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Assertion contains failed`);
        }
        break;
      }
      throw new Error(`Assertion contains unsupported types`);
    case "exists":
      if (actual === undefined || actual === null) {
        throw new Error(`Assertion exists failed`);
      }
      break;
    case "not_exists":
      if (actual !== undefined && actual !== null) {
        throw new Error(`Assertion not_exists failed`);
      }
      break;
    default:
      throw new Error(`Unknown assertion kind: ${kind}`);
  }
}
