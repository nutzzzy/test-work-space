import { maskSecrets } from "@qa-workbench/shared";

const SECRET_KEYS = new Set([
  "password",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "secret",
  "access_token",
  "refresh_token",
]);

export function maskDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return maskSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskDeep(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k.toLowerCase()) && typeof v === "string") {
        out[k] = "***";
      } else {
        out[k] = maskDeep(v);
      }
    }
    return out;
  }
  return value;
}
