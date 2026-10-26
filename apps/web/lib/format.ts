import { format } from "date-fns";
import type { Role } from "@hrms/shared";

export const DEFAULT_TZ = "Asia/Kolkata";

/** INR formatting: ₹45,000 */
export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

/** YYYY-MM-DD -> "15 Oct 2026" */
export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const datePart = d.slice(0, 10);
  const dt = new Date(datePart + "T00:00:00");
  if (Number.isNaN(dt.getTime())) return d;
  return format(dt, "dd MMM yyyy");
}

/** ISO datetime -> "15 Oct, 09:32 am" in the given timezone */
export function formatDateTime(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** ISO datetime -> "09:32 am" in the given timezone */
export function formatTime(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Today's date (YYYY-MM-DD) in the given timezone */
export function todayInTZ(tz: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA yields YYYY-MM-DD
}

/** "October 2026" */
export function monthLabel(year: number, month: number): string {
  return format(new Date(year, month - 1, 1), "MMMM yyyy");
}

/** "09:30" + minutes -> "10:15 am" style display of policy times */
export function formatPolicyTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const dt = new Date(2000, 0, 1, h || 0, m || 0);
  return format(dt, "hh:mm a");
}

/** 507 -> "8h 27m" */
export function formatMinutes(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Inclusive day count between two YYYY-MM-DD dates */
export function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(to + "T00:00:00").getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** "employee_code" -> "Employee code" */
export function prettify(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Short login-role labels for badges/menus: MD / HR / Employee */
export const ROLE_LABELS: Record<Role, string> = {
  md: "MD",
  hr: "HR",
  employee: "Employee",
};

/** Long login-role labels for select options */
export const ROLE_LABELS_LONG: Record<Role, string> = {
  md: "Managing Director (MD)",
  hr: "HR",
  employee: "Employee",
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? prettify(role);
}
