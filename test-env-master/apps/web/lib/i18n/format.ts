import type { Locale } from "./types";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Convert Western digits to Persian only for display (fa locale). */
export function formatNumber(
  value: number | string,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return String(value);

  if (locale === "fa") {
    const formatted = new Intl.NumberFormat("en-US", options).format(num);
    return formatted.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]!);
  }
  return new Intl.NumberFormat("en-US", options).format(num);
}

export function formatDateTime(value: string | Date, locale: Locale): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(date);
}

export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(vars[key] ?? ""),
  );
}
