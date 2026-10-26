"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api";
import { monthLabel, formatDate, todayInTZ } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface CalendarEvent {
  id: string;
  status: string;
  employeeName: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
}

interface Department {
  id: string;
  name: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function eventColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "approved") return "bg-accent-soft text-accent-ink ring-accent/20";
  if (s === "pending") return "bg-warning-soft text-warning ring-warning/20";
  if (s === "rejected") return "bg-danger-soft text-danger ring-danger/20";
  return "bg-soft text-muted ring-line/20";
}

export default function LeaveCalendarPage() {
  const { toast } = useToast();
  const todayKey = todayInTZ();
  const [year, setYear] = useState(Number(todayKey.slice(0, 4)));
  const [month, setMonth] = useState(Number(todayKey.slice(5, 7)));
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const yearOptions = useMemo(() => {
    const y = Number(todayInTZ().slice(0, 4));
    return [y - 1, y, y + 1];
  }, []);

  // Departments are optional — hide the filter if the endpoint isn't permitted.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{ data?: Department[] } | Department[]>("/admin/departments");
        const list = Array.isArray(res) ? res : (res.data ?? []);
        setDepartments(list.filter((d) => d && d.id && d.name));
      } catch {
        /* 403 or unknown shape → no department filter */
      }
    })();
  }, []);

  const fetchEvents = useCallback(
    async (y: number, m: number, dept: string) => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = { year: y, month: m };
        if (dept) params.departmentId = dept;
        // NOTE: API returns an ARRAY of leave ranges, not a day-keyed map.
        const res = await apiGet<CalendarEvent[]>("/leave/calendar", params);
        setEvents(Array.isArray(res) ? res : []);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load team calendar", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    fetchEvents(year, month, departmentId);
  }, [fetchEvents, year, month, departmentId]);

  // Expand each leave range into per-day cells, clipped to the viewed month.
  const dayMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
    for (const ev of events) {
      let d = new Date(ev.fromDate.slice(0, 10) + "T00:00:00");
      const end = new Date(ev.toDate.slice(0, 10) + "T00:00:00");
      if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) continue;
      let guard = 0;
      while (d <= end && guard++ < 370) {
        const key = toKey(d);
        if (key.startsWith(monthPrefix)) {
          const list = map.get(key) ?? [];
          list.push(ev);
          map.set(key, list);
        }
        d = addDays(d, 1);
      }
    }
    return map;
  }, [events, year, month]);

  // Monday-first grid cells for the viewed month.
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const leading = (first.getDay() + 6) % 7; // Monday-first offset
    const daysInMonth = new Date(year, month, 0).getDate();
    const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
    const arr: (string | null)[] = [];
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - leading + 1;
      if (dayNum < 1 || dayNum > daysInMonth) arr.push(null);
      else arr.push(`${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`);
    }
    return arr;
  }, [year, month]);

  const totalLeaves = events.length;

  return (
    <div>
      <PageHeader
        title="Team calendar"
        description={`${monthLabel(year, month)} · ${totalLeaves} leave ${totalLeaves === 1 ? "entry" : "entries"}`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="w-40">
          <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-28">
          <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
        {departments.length > 0 && (
          <div className="w-52">
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {loading ? (
        <PageSkeleton />
      ) : (
        <Card className="p-3 sm:p-4">
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1 text-center text-xs font-semibold uppercase tracking-wide text-muted">
                {d}
              </div>
            ))}
            {cells.map((key, i) => {
              if (!key) return <div key={i} className="min-h-[64px] rounded-lg bg-canvas/60 sm:min-h-[88px]" />;
              const dayEvents = dayMap.get(key) ?? [];
              const shown = dayEvents.slice(0, 3);
              const extra = dayEvents.length - shown.length;
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={cn(
                    "min-h-[64px] rounded-lg border p-1 sm:min-h-[88px] sm:p-1.5",
                    isToday ? "border-accent bg-accent-soft/40" : "border-line bg-white",
                  )}
                >
                  <p
                    className={cn(
                      "text-xs font-semibold",
                      isToday ? "text-accent-ink" : "text-muted",
                    )}
                  >
                    {Number(key.slice(8, 10))}
                  </p>
                  <div className="mt-1 space-y-1">
                    {shown.map((ev) => (
                      <div
                        key={ev.id}
                        title={`${ev.employeeName} · ${ev.leaveType} · ${formatDate(ev.fromDate)} → ${formatDate(ev.toDate)} · ${ev.status}`}
                        className={cn(
                          "truncate rounded px-1 py-0.5 text-[10px] font-medium ring-1 ring-inset sm:text-[11px]",
                          eventColor(ev.status),
                        )}
                      >
                        {ev.employeeName} · {ev.leaveType}
                      </div>
                    ))}
                    {extra > 0 && (
                      <p className="text-[10px] font-medium text-muted sm:text-[11px]">+{extra} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="font-medium text-ink">Legend:</span>
        <LegendSwatch label="Approved" className="bg-accent-soft text-accent-ink ring-accent/20" />
        <LegendSwatch label="Pending" className="bg-warning-soft text-warning ring-warning/20" />
        <LegendSwatch label="Other" className="bg-soft text-muted ring-line/20" />
      </div>

      {!loading && events.length === 0 && (
        <div className="mt-2">
          <EmptyState
            icon={CalendarDays}
            title="No leaves this month"
            description="Nobody has leave scheduled for the selected month."
          />
        </div>
      )}
    </div>
  );
}

function LegendSwatch({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-full ring-1 ring-inset", className)} />
      {label}
    </span>
  );
}
