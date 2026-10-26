import { BadRequestException } from "@nestjs/common";
import { stringify } from "csv-stringify/sync";

/** Pagination helpers */
export function pageParams(page = 1, pageSize = 20) {
  const p = Math.max(1, page);
  const ps = Math.min(100, Math.max(1, pageSize));
  return { skip: (p - 1) * ps, take: ps, page: p, pageSize: ps };
}

export function pageResult<T>(data: T[], total: number, page: number, pageSize: number) {
  return { data, total, page, pageSize };
}

/** CSV export with spreadsheet-formula-injection guard */
export function toCsv(rows: Record<string, unknown>[]): string {
  const safe = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) out[k] = `'${v}`;
      else out[k] = v;
    }
    return out;
  });
  return stringify(safe, { header: true });
}

/** YYYY-MM-DD for "today" in a given IANA timezone */
export function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Convert a YYYY-MM-DD (company tz) to a Date at UTC midnight for @db.Date fields */
export function dateOnly(ymd: string): Date {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  // Reject impossible calendar dates (2026-02-30 rolls over silently in JS;
  // 2026-13-45 is an Invalid Date that crashed Prisma writes with a 500).
  // Query-string dates reach here without Zod validation, so guard centrally.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) {
    throw new BadRequestException({ code: "invalid_date", message: `Invalid date: ${ymd}` });
  }
  return d;
}

export function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Minutes between two dates, rounded */
export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** YYYY-MM-DD for an arbitrary instant in a given IANA timezone */
export function dateInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Great-circle distance in meters between two lat/lng points (haversine). */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
