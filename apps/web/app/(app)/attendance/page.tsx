"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { correctAttendanceSchema, type CorrectAttendanceInput } from "@hrms/shared";
import { CheckCircle2, Clock, Download, Fingerprint, History, House, MapPin, Pencil } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ApiError, apiGet, apiPost, downloadFile } from "@/lib/api";
import {
  DEFAULT_TZ,
  formatDate,
  formatMinutes,
  formatPolicyTime,
  formatTime,
  prettify,
  todayInTZ,
} from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPills } from "@/components/ui/FilterPills";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Table } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";

/* ── Types ─────────────────────────────────────────────────────────── */

interface TodayRecord {
  id: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
  lateMinutes: number | null;
  workingMinutes: number | null;
  checkInLat?: number | null;
  checkInLng?: number | null;
  locationVerified?: boolean;
  source?: string;
  wfh?: boolean;
  needsReview?: boolean;
}

interface AttendancePolicy {
  workStart: string;
  workEnd: string;
  graceMinutes: number;
  weeklyOffs: number[];
  fullDayMinutes: number;
  halfDayMinutes: number;
  officeLatitude?: number | null;
  officeLongitude?: number | null;
  geofenceRadiusMeters?: number | null;
  requireLocation?: boolean;
}

interface TodayResponse {
  record: TodayRecord | null;
  policy: AttendancePolicy | null;
  serverTime: string;
  today: string;
  timezone: string;
  isWfhToday?: boolean;
}

interface MyRow {
  id: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
  lateMinutes: number | null;
  workingMinutes: number | null;
  needsReview?: boolean;
}

interface MeResponse {
  data: MyRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface DailyRow {
  employee: {
    id: string;
    fullName: string;
    employeeCode: string;
    department: { name: string } | null;
  };
  employeeId: string;
  record: TodayRecord | null;
  displayStatus: string;
  missingCheckout: boolean;
  calculated: boolean;
}

interface DailyResponse {
  date: string;
  totals: {
    present: number;
    half_day: number;
    absent: number;
    onLeave: number;
    late: number;
    missingCheckout: number;
    weeklyOff: number;
    holiday: number;
  };
  records: DailyRow[];
}

interface Department {
  id: string;
  name: string;
}

/* ── Shared helpers ────────────────────────────────────────────────── */

const STATUS_DOT: Record<string, string> = {
  present: "bg-accent-soft0",
  late: "bg-warning-soft0",
  half_day: "bg-amber-400",
  absent: "bg-danger-soft0",
  on_leave: "bg-sky-500",
  weekly_off: "bg-slate-300",
  holiday: "bg-violet-500",
  missing_checkout: "bg-fuchsia-500",
};

function dotFor(status: string | null | undefined): string {
  if (!status) return "bg-soft";
  return STATUS_DOT[status] ?? "bg-slate-400";
}

function weekRange(todayStr: string): { monday: string; sunday: string } {
  const [y, m, d] = todayStr.split("-").map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = Monday
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
      dt.getDate(),
    ).padStart(2, "0")}`;
  return {
    monday: fmt(new Date(y, m - 1, d - dow)),
    sunday: fmt(new Date(y, m - 1, d - dow + 6)),
  };
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

/* ── My Attendance ─────────────────────────────────────────────────── */

function MyAttendance({ tz }: { tz: string }) {
  const { toast } = useToast();
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [weekRows, setWeekRows] = useState<MyRow[]>([]);
  const [recent, setRecent] = useState<MyRow[]>([]);

  const loadToday = useCallback(async () => {
    const res = await apiGet<TodayResponse>("/attendance/me/today");
    setToday(res);
  }, []);

  const loadLists = useCallback(async () => {
    const { monday, sunday } = weekRange(todayInTZ(tz));
    const [week, hist] = await Promise.all([
      apiGet<MeResponse>("/attendance/me", { from: monday, to: sunday, page: 1, pageSize: 100 }),
      apiGet<MeResponse>("/attendance/me", { page: 1, pageSize: 10 }),
    ]);
    setWeekRows(week.data ?? []);
    setRecent(hist.data ?? []);
  }, [tz]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadToday(), loadLists()]);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Couldn't load attendance", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadToday, loadLists, toast]);

  const record = today?.record ?? null;
  const policy = today?.policy ?? null;
  const openCheckIn = !!record && !!record.checkInAt && !record.checkOutAt;
  const dayComplete = !!record && !!record.checkInAt && !!record.checkOutAt;
  const [locating, setLocating] = useState(false);

  type GeoResult =
    | { ok: true; latitude: number; longitude: number }
    | { ok: false; reason: "denied" | "unavailable" | "unsupported" };

  /** Resolve the device position, or a failure reason. Never throws; always settles by timeoutMs. */
  const getCoords = (timeoutMs: number): Promise<GeoResult> =>
    new Promise((resolve) => {
      if (!("geolocation" in navigator)) return resolve({ ok: false, reason: "unsupported" });
      let done = false;
      const finish = (v: GeoResult) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(v);
        }
      };
      const timer = setTimeout(() => finish({ ok: false, reason: "unavailable" }), timeoutMs);
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          finish({ ok: true, latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) =>
          finish({
            ok: false,
            reason: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
          }),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
      );
    });

  const geoErrorMessage = (reason: "denied" | "unavailable" | "unsupported") =>
    reason === "denied"
      ? "Location permission is needed for check-in. Please allow it and try again."
      : reason === "unsupported"
        ? "Geolocation isn't supported on this device, so location-based check-in isn't available."
        : "Couldn't get your location. Try again.";

  const punch = async (action: "check-in" | "check-out") => {
    setPunching(true);
    try {
      const body: Record<string, number> = {};
      if (action === "check-in") {
        const wfhToday = today?.isWfhToday ?? false;
        const geoRequired =
          !wfhToday &&
          !!policy?.requireLocation &&
          policy?.officeLatitude != null &&
          policy?.officeLongitude != null;
        if (geoRequired) {
          // Blocking: reported location must fall inside the geofence before check-in.
          setLocating(true);
          const geo = await getCoords(10000);
          setLocating(false);
          if (!geo.ok) {
            toast(geoErrorMessage(geo.reason), "error");
            return;
          }
          body.latitude = geo.latitude;
          body.longitude = geo.longitude;
        } else if (!wfhToday) {
          // Opportunistic: attach coords if quickly available, never block.
          const geo = await getCoords(3000);
          if (geo.ok) {
            body.latitude = geo.latitude;
            body.longitude = geo.longitude;
          }
        }
        // On WFH days: check in directly, no location prompt at all.
      }
      const rec = await apiPost<TodayRecord>(`/attendance/${action}`, body);
      await loadToday();
      await loadLists();
      toast(
        action === "check-in"
          ? `Checked in at ${formatTime(rec.checkInAt, tz)}`
          : `Checked out — ${formatMinutes(rec.workingMinutes)} worked`,
        "success",
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === "outside_geofence") {
        const details = e.details as { distanceMeters?: number } | undefined;
        const dist =
          typeof details?.distanceMeters === "number" ? Math.round(details.distanceMeters) : null;
        const radius = policy?.geofenceRadiusMeters ?? 200;
        toast(
          dist != null
            ? `You're ${dist} m from the office — check-in is allowed within ${radius} m.`
            : `You're outside the office geofence — check-in is allowed within ${radius} m.`,
          "error",
        );
      } else if (e instanceof ApiError && e.code === "location_required") {
        toast(
          "Your location is required for check-in. Please allow location access and try again.",
          "error",
        );
      } else {
        toast(
          e instanceof ApiError ? e.message : `Couldn't ${action === "check-in" ? "check in" : "check out"}`,
          "error",
        );
      }
      try {
        await loadToday();
      } catch {
        /* ignore */
      }
    } finally {
      setPunching(false);
      setLocating(false);
    }
  };

  const weekDays = useMemo(() => {
    const { monday } = weekRange(todayInTZ(tz));
    const [y, m, d] = monday.split("-").map(Number);
    const byDate = new Map(weekRows.map((r) => [r.workDate, r]));
    return Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(y, m - 1, d + i);
      const p = (n: number) => String(n).padStart(2, "0");
      const key = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
      return {
        key,
        dayNum: dt.getDate(),
        weekday: dt.toLocaleDateString("en", { weekday: "narrow" }),
        isToday: key === todayInTZ(tz),
        row: byDate.get(key),
      };
    });
  }, [weekRows, tz]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      {/* Today status card */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Today · {formatDate(todayInTZ(tz))}</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">My attendance</h2>
          </div>
          <StatusBadge
            status={record ? record.status : "not_checked_in"}
            label={record ? undefined : "Not checked in"}
          />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-canvas p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Check in</p>
            <p className="mt-1 text-base font-semibold tracking-tight text-ink">
              {record?.checkInAt ? formatTime(record.checkInAt, tz) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-canvas p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Check out</p>
            <p className="mt-1 text-base font-semibold tracking-tight text-ink">
              {record?.checkOutAt ? formatTime(record.checkOutAt, tz) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-canvas p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Worked</p>
            <p className="mt-1 text-base font-semibold tracking-tight text-ink">
              {formatMinutes(record?.workingMinutes)}
            </p>
          </div>
          <div className="rounded-lg bg-canvas p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Late by</p>
            <p className="mt-1 text-base font-semibold tracking-tight text-ink">
              {record?.lateMinutes ? `${record.lateMinutes} min` : "—"}
            </p>
          </div>
        </div>

        {policy && (
          <p className="mt-4 flex items-center gap-1.5 text-sm text-muted">
            <Clock className="h-4 w-4" />
            Work hours {formatPolicyTime(policy.workStart)} – {formatPolicyTime(policy.workEnd)} ·
            grace {policy.graceMinutes} min
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          GPS check-in is a deterrent, not proof of presence — mock-location apps can defeat it.
          Biometric devices are the real control.
        </p>
        {today?.isWfhToday && (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-info-soft px-3 py-2 text-sm font-medium text-info">
            <House className="h-4 w-4" />
            Work from home day — check in from anywhere, no location needed.
          </p>
        )}
      </Card>

      {/* Big punch button — thumb friendly, sticky on mobile */}
      <div className="sticky bottom-4 z-10 md:static">
        {dayComplete ? (
          <Button size="lg" disabled className="h-14 w-full text-base md:w-auto md:min-w-64">
            <CheckCircle2 className="h-5 w-5" />
            Day complete · {formatMinutes(record?.workingMinutes)} worked
          </Button>
        ) : openCheckIn ? (
          <Button
            size="lg"
            onClick={() => punch("check-out")}
            loading={punching}
            className="h-14 w-full text-base md:w-auto md:min-w-64"
          >
            Check out
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={() => punch("check-in")}
            loading={punching}
            className={`h-14 w-full text-base md:w-auto md:min-w-64 ${!record?.checkInAt ? "animate-pulse-ring" : ""}`}
          >
            {locating ? "Checking your location…" : "Check in"}
          </Button>
        )}
      </div>

      {/* Work from home */}
      <WfhSection tz={tz} />

      {/* This week strip */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold tracking-tight text-ink">This week</h3>
        <div className="mt-3 flex items-stretch justify-between gap-1.5 sm:gap-2">
          {weekDays.map((d) => (
            <div
              key={d.key}
              title={d.row ? prettify(d.row.status) : "No record"}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 ${
                d.isToday ? "border-accent bg-accent-soft" : "border-line bg-surface"
              }`}
            >
              <span className="text-[11px] font-medium uppercase text-muted">{d.weekday}</span>
              <span className="text-sm font-semibold tracking-tight text-ink">{d.dayNum}</span>
              <span className={`h-2 w-2 rounded-full ${dotFor(d.row?.status)}`} />
            </div>
          ))}
        </div>
      </Card>

      {/* Recent history */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h3 className="text-sm font-semibold tracking-tight text-ink">Recent history</h3>
        </div>
        <Table<MyRow>
          columns={[
            { key: "workDate", header: "Date", render: (r) => formatDate(r.workDate) },
            {
              key: "checkInAt",
              header: "Check in",
              render: (r) => (r.checkInAt ? formatTime(r.checkInAt, tz) : "—"),
            },
            {
              key: "checkOutAt",
              header: "Check out",
              render: (r) => (r.checkOutAt ? formatTime(r.checkOutAt, tz) : "—"),
            },
            {
              key: "workingMinutes",
              header: "Worked",
              render: (r) => formatMinutes(r.workingMinutes),
            },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={r.status} />
                  {r.needsReview && <Badge variant="amber">Needs review</Badge>}
                </div>
              ),
            },
          ]}
          rows={recent}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No attendance yet" description="Your check-ins will show up here." />}
        />
      </Card>
    </div>
  );
}

/* ── Work from home ────────────────────────────────────────────────── */

interface WfhRequest {
  id: string;
  date: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  decidedAt: string | null;
}

const WFH_STATUS_VARIANT: Record<WfhRequest["status"], "amber" | "emerald" | "rose"> = {
  pending: "amber",
  approved: "emerald",
  rejected: "rose",
};

function WfhSection({ tz }: { tz: string }) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<WfhRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayInTZ(tz));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<WfhRequest[]>("/attendance/wfh-requests/me");
      setRequests(Array.isArray(res) ? res : []);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't load WFH requests", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!date) {
      toast("Pick a date for your work-from-home request", "error");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/attendance/wfh-requests", {
        date,
        reason: reason.trim() || undefined,
      });
      toast("Work-from-home request submitted", "success");
      setReason("");
      setDate(todayInTZ(tz));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "duplicate_wfh") {
        toast("You already have a WFH request for this date", "error");
      } else if (e instanceof ApiError && e.code === "company_wfh_day") {
        toast("This is already a company WFH day — no request needed", "info");
      } else {
        toast(e instanceof ApiError ? e.message : "Couldn't submit WFH request", "error");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <House className="h-4 w-4 text-info" />
        <h3 className="text-sm font-semibold tracking-tight text-ink">Work from home</h3>
      </div>
      <p className="mt-1 text-sm text-muted">
        On WFH days location checks are skipped — check in from anywhere. Company-wide WFH days
        set by HR don't need a request.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
        <FormField label="Date">
          <Input type="date" value={date} min={todayInTZ(tz)} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Reason (optional)">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. plumber visit at home"
          />
        </FormField>
        <Button onClick={submit} loading={submitting} className="sm:mb-0">
          Apply
        </Button>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">My requests</h4>
        {loading ? (
          <p className="py-4 text-center text-sm text-muted">Loading…</p>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={House}
            title="No WFH requests"
            description="Your work-from-home requests will show up here."
          />
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{formatDate(r.date)}</p>
                  {r.reason && (
                    <p className="truncate text-xs text-muted" title={r.reason}>
                      {r.reason}
                    </p>
                  )}
                </div>
                <Badge variant={WFH_STATUS_VARIANT[r.status] ?? "slate"}>
                  {prettify(r.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* ── Team Daily ────────────────────────────────────────────────────── */

const PILLS = [
  { value: "all", label: "All" },
  { value: "present", label: "Present" },
  { value: "half_day", label: "Half day" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "on_leave", label: "On leave" },
  { value: "missing_checkout", label: "Missing checkout" },
  { value: "weekly_off", label: "Weekly off" },
  { value: "holiday", label: "Holiday" },
];

function pillMatches(row: DailyRow, pill: string): boolean {
  if (pill === "all") return true;
  if (pill === "missing_checkout") return row.missingCheckout;
  if (pill === "late") return (row.record?.lateMinutes ?? 0) > 0;
  return row.displayStatus === pill;
}

// datetime-local input → ISO before the shared schema validates
const localDT = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time");
const correctFormSchema = correctAttendanceSchema.extend({
  checkInAt: z.union([localDT, z.literal("")]).optional(),
  checkOutAt: z.union([localDT, z.literal("")]).optional(),
  status: z
    .union([
      z.enum(["present", "absent", "half_day", "on_leave", "weekly_off", "holiday"]),
      z.literal(""),
    ])
    .optional(),
});
type CorrectForm = z.infer<typeof correctFormSchema>;

function summarizeChange(key: string, before: unknown, after: unknown): React.ReactNode {
  const fmt = (v: unknown) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      try {
        return new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      } catch {
        return v;
      }
    }
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  return (
    <div key={key} className="flex items-start justify-between gap-2 rounded-md bg-canvas px-2.5 py-1.5 text-xs">
      <span className="font-medium text-muted">{prettify(key)}</span>
      <span className="text-right">
        <span className="text-faint line-through">{fmt(before)}</span>
        <span className="mx-1.5 text-faint">→</span>
        <span className="font-medium text-ink">{fmt(after)}</span>
      </span>
    </div>
  );
}

function CorrectionEntry({ entry }: { entry: Record<string, unknown> }) {
  const actor =
    ((entry.actor as Record<string, unknown> | undefined)?.fullName as string | undefined) ||
    ((entry.actor as Record<string, unknown> | undefined)?.name as string | undefined) ||
    (entry.actorName as string | undefined) ||
    (entry.correctedByName as string | undefined) ||
    "—";
  const at = (entry.createdAt as string | undefined) || (entry.correctedAt as string | undefined);
  const reason = (entry.reason as string | undefined) || "—";
  const before = (entry.before ?? entry.previous ?? entry.oldValues) as
    | Record<string, unknown>
    | null
    | undefined;
  const after = (entry.after ?? entry.new ?? entry.newValues) as
    | Record<string, unknown>
    | null
    | undefined;

  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const changed = keys.filter(
    (k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null),
  );

  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{actor}</p>
        {at && <p className="text-xs text-muted">{new Date(at).toLocaleString("en-IN")}</p>}
      </div>
      <p className="mt-1 text-sm text-muted">{reason}</p>
      {changed.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {changed.map((k) => summarizeChange(k, before?.[k], after?.[k]))}
        </div>
      )}
    </div>
  );
}

function TeamDaily({ tz, canCorrect }: { tz: string; canCorrect: boolean }) {
  const { toast } = useToast();
  const [date, setDate] = useState(todayInTZ());
  const [dept, setDept] = useState("");
  const [depts, setDepts] = useState<Department[] | null>(null);
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pill, setPill] = useState("all");
  const [correctFor, setCorrectFor] = useState<DailyRow | null>(null);
  const [historyFor, setHistoryFor] = useState<DailyRow | null>(null);
  const [history, setHistory] = useState<Record<string, unknown>[] | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CorrectForm>({
    resolver: zodResolver(correctFormSchema),
    defaultValues: { checkInAt: "", checkOutAt: "", status: "", reason: "" },
  });

  useEffect(() => {
    apiGet<Department[]>("/admin/departments")
      .then(setDepts)
      .catch(() => setDepts(null)); // 403 for employees — hide the filter
  }, []);

  const loadDaily = useCallback(async () => {
    const params: Record<string, string> = { date };
    if (dept) params.departmentId = dept;
    const res = await apiGet<DailyResponse>("/attendance/daily", params);
    setData(res);
  }, [date, dept]);

  useEffect(() => {
    setLoading(true);
    loadDaily()
      .catch((e) => {
        setData(null);
        toast(e instanceof ApiError ? e.message : "Couldn't load team attendance", "error");
      })
      .finally(() => setLoading(false));
  }, [loadDaily, toast]);

  const pillCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of PILLS) counts[p.value] = 0;
    for (const r of data?.records ?? []) {
      for (const p of PILLS) {
        if (pillMatches(r, p.value)) counts[p.value] += 1;
      }
    }
    return counts;
  }, [data]);

  const filtered = useMemo(
    () => (data?.records ?? []).filter((r) => pillMatches(r, pill)),
    [data, pill],
  );

  const openCorrect = (row: DailyRow) => {
    reset({
      checkInAt: isoToLocalInput(row.record?.checkInAt),
      checkOutAt: isoToLocalInput(row.record?.checkOutAt),
      status: "",
      reason: "",
    });
    setCorrectFor(row);
  };

  const openHistory = async (row: DailyRow) => {
    setHistoryFor(row);
    setHistory(null);
    try {
      const res = await apiGet<Record<string, unknown>[]>(
        `/attendance/records/${row.record!.id}/corrections`,
      );
      setHistory(res ?? []);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't load correction history", "error");
      setHistory([]);
    }
  };

  const submitCorrection = async (vals: CorrectForm) => {
    if (!correctFor?.record) return;
    const payload: CorrectAttendanceInput = {
      checkInAt: vals.checkInAt ? new Date(vals.checkInAt).toISOString() : null,
      checkOutAt: vals.checkOutAt ? new Date(vals.checkOutAt).toISOString() : null,
      reason: vals.reason,
    };
    if (vals.status) payload.status = vals.status;
    try {
      await apiPost(`/attendance/records/${correctFor.record.id}/correct`, payload);
      toast("Attendance corrected", "success");
      setCorrectFor(null);
      await loadDaily();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Correction failed", "error");
    }
  };

  const exportCsv = () => {
    const params: Record<string, string | undefined> = { from: date, to: date };
    if (dept) params.departmentId = dept;
    downloadFile("/attendance/export", `attendance-${date}.csv`, params).catch((e) =>
      toast(e instanceof ApiError ? e.message : "Export failed", "error"),
    );
  };

  const totals = data?.totals;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team attendance"
        description={`Daily view · ${formatDate(date)}`}
        action={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField label="Date" className="sm:w-48">
            <Input type="date" value={date} max={todayInTZ()} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          {depts && (
            <FormField label="Department" className="sm:w-64">
              <Select value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">All departments</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
        </div>
        <div className="mt-4">
          <FilterPills
            value={pill}
            onChange={setPill}
            options={PILLS.map((p) => ({ ...p, count: pillCounts[p.value] ?? 0 }))}
          />
        </div>
      </Card>

      {loading ? (
        <PageSkeleton />
      ) : !data ? (
        <EmptyState
          title="Couldn't load team attendance"
          description="Try a different date or check your connection."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <StatCard label="Present" value={totals?.present ?? 0} />
            <StatCard label="Late" value={totals?.late ?? 0} />
            <StatCard label="Half day" value={totals?.half_day ?? 0} />
            <StatCard label="Absent" value={totals?.absent ?? 0} />
            <StatCard label="On leave" value={totals?.onLeave ?? 0} />
            <StatCard label="Missing out" value={totals?.missingCheckout ?? 0} />
            <StatCard label="Weekly off" value={totals?.weeklyOff ?? 0} />
            <StatCard label="Holiday" value={totals?.holiday ?? 0} />
          </div>

          <Card className="overflow-hidden">
            <Table<DailyRow>
              columns={[
                {
                  key: "employee",
                  header: "Employee",
                  render: (r) => (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.employee.fullName} size="sm" />
                      <div>
                        <p className="font-medium text-ink">{r.employee.fullName}</p>
                        <p className="text-xs text-muted">{r.employee.employeeCode}</p>
                      </div>
                    </div>
                  ),
                },
                {
                  key: "department",
                  header: "Department",
                  render: (r) => r.employee.department?.name ?? "—",
                },
                {
                  key: "checkInAt",
                  header: "Check in",
                  render: (r) => (r.record?.checkInAt ? formatTime(r.record.checkInAt, tz) : "—"),
                },
                {
                  key: "checkOutAt",
                  header: "Check out",
                  render: (r) => (r.record?.checkOutAt ? formatTime(r.record.checkOutAt, tz) : "—"),
                },
                {
                  key: "workingMinutes",
                  header: "Working",
                  render: (r) => formatMinutes(r.record?.workingMinutes),
                },
                {
                  key: "displayStatus",
                  header: "Status",
                  render: (r) => (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={r.displayStatus} />
                      {r.missingCheckout && <StatusBadge status="missing_checkout" />}
                      {r.record?.needsReview && <Badge variant="amber">Needs review</Badge>}
                      {r.record?.source === "biometric" && (
                        <Badge variant="blue">
                          <Fingerprint className="h-3 w-3" /> Biometric
                        </Badge>
                      )}
                      {r.record?.checkInAt && r.record.locationVerified && (
                        <Badge variant="emerald">
                          <MapPin className="h-3 w-3" /> In geofence
                        </Badge>
                      )}
                      {r.record?.wfh && (
                        <Badge variant="blue">
                          <House className="h-3 w-3" /> WFH
                        </Badge>
                      )}
                      {r.record?.checkInAt &&
                        !r.record.locationVerified &&
                        (r.record.checkInLat != null || r.record.checkInLng != null) && (
                          <Badge variant="amber">Unverified</Badge>
                        )}
                    </div>
                  ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  className: "text-right tabular-nums",
                  render: (r) =>
                    r.record ? (
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openHistory(r)}
                          title="Correction history"
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        {canCorrect && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openCorrect(r)}
                            title="Correct attendance"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    ),
                },
              ]}
              rows={filtered}
              rowKey={(r) => r.employeeId}
              empty={
                <EmptyState
                  title="No records match"
                  description="Try a different filter or date."
                />
              }
            />
          </Card>
        </>
      )}

      {/* Correct dialog */}
      <Dialog
        open={!!correctFor}
        onClose={() => setCorrectFor(null)}
        title={`Correct attendance — ${correctFor?.employee.fullName}`}
        description={correctFor ? `${formatDate(date)} · ${correctFor.employee.employeeCode}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setCorrectFor(null)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(submitCorrection)} loading={isSubmitting}>
              Save correction
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit(submitCorrection)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Check in" error={errors.checkInAt?.message}>
              <Input type="datetime-local" {...register("checkInAt")} />
            </FormField>
            <FormField label="Check out" error={errors.checkOutAt?.message}>
              <Input type="datetime-local" {...register("checkOutAt")} />
            </FormField>
          </div>
          <FormField label="Status" error={errors.status?.message}>
            <Select {...register("status")}>
              <option value="">Keep current</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="half_day">Half day</option>
              <option value="on_leave">On leave</option>
              <option value="weekly_off">Weekly off</option>
              <option value="holiday">Holiday</option>
            </Select>
          </FormField>
          <FormField label="Reason" required error={errors.reason?.message}>
            <Textarea
              {...register("reason")}
              rows={3}
              placeholder="Why is this correction needed?"
            />
          </FormField>
        </form>
      </Dialog>

      {/* History dialog */}
      <Dialog
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        title={`Correction history — ${historyFor?.employee.fullName}`}
        description={historyFor ? `${formatDate(date)} · ${historyFor.employee.employeeCode}` : undefined}
        wide
      >
        {history === null ? (
          <p className="py-6 text-center text-sm text-muted">Loading history…</p>
        ) : history.length === 0 ? (
          <EmptyState title="No corrections" description="No corrections have been made to this record." />
        ) : (
          <div className="space-y-3">
            {history.map((entry, i) => (
              <CorrectionEntry key={String((entry as { id?: string }).id ?? i)} entry={entry} />
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────── */

export default function AttendancePage() {
  const { user, loading, hasRole } = useAuth();
  const [tab, setTab] = useState<string | null>(null);

  const canViewTeam = hasRole("hr", "md");
  const isAdminish = hasRole("hr", "md");

  useEffect(() => {
    if (user && tab === null) {
      setTab(isAdminish ? "team" : "my");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (loading || !user) return <PageSkeleton />;
  const tz = user.companyTimezone || DEFAULT_TZ;

  if (!canViewTeam) {
    return (
      <div className="space-y-5">
        <PageHeader title="Attendance" description="Check in, check out, and view your history." />
        <MyAttendance tz={tz} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Attendance" description="Your day and your team's daily view." />
      <Tabs
        tabs={[
          { id: "my", label: "My Attendance" },
          { id: "team", label: "Team Daily" },
        ]}
        value={tab ?? "my"}
        onChange={setTab}
      />
      {(tab ?? "my") === "my" ? (
        <MyAttendance tz={tz} />
      ) : (
        <TeamDaily tz={tz} canCorrect={isAdminish} />
      )}
    </div>
  );
}
