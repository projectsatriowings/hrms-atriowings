"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ApiError, apiGet, downloadFile } from "@/lib/api";
import { DEFAULT_TZ, formatDate, monthLabel, prettify, todayInTZ } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

/* ── Types (probed against the live API) ───────────────────────────── */

interface MonthlyEmployee {
  id: string;
  fullName: string;
  employeeCode: string;
}

interface MonthlySummary {
  absent: number;
  half_day: number;
  late: number;
  missingCheckout: number;
  onLeave: number;
  present: number;
}

interface MonthlyResponse {
  year: number;
  month: number;
  days: string[];
  employees: MonthlyEmployee[];
  matrix: Record<string, Record<string, string>>;
  summary: Record<string, MonthlySummary>;
}

interface Department {
  id: string;
  name: string;
}

/* ── Status colors ─────────────────────────────────────────────────── */

const STATUS_DOT: Record<string, string> = {
  present: "bg-accent-soft0",
  late: "bg-warning-soft0",
  half_day: "bg-amber-400",
  on_leave: "bg-sky-500",
  absent: "bg-danger-soft0",
  missing_checkout: "bg-fuchsia-500",
  weekly_off: "bg-slate-300",
  holiday: "bg-violet-500",
  future: "bg-soft border border-line",
};

const LEGEND = [
  "present",
  "late",
  "half_day",
  "on_leave",
  "absent",
  "missing_checkout",
  "weekly_off",
  "holiday",
];

function MonthCell({
  status,
  title,
}: {
  status: string | undefined;
  title: string;
}) {
  return (
    <td title={title} className="border-b border-line px-1 py-1.5 text-center">
      <span
        className={`inline-block h-3 w-3 rounded-full ${status ? STATUS_DOT[status] ?? "bg-slate-400" : "bg-soft"}`}
      />
    </td>
  );
}

export default function MonthlyAttendancePage() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const now = useMemo(() => {
    const [y, m] = todayInTZ(user?.companyTimezone || DEFAULT_TZ)
      .split("-")
      .map(Number);
    return { year: y, month: m };
  }, [user]);

  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [dept, setDept] = useState("");
  const [depts, setDepts] = useState<Department[] | null>(null);
  const [data, setData] = useState<MonthlyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    setYear(now.year);
    setMonth(now.month);
  }, [now]);

  useEffect(() => {
    apiGet<Department[]>("/admin/departments")
      .then(setDepts)
      .catch(() => setDepts(null)); // 403 for employees — hide the filter
  }, []);

  useEffect(() => {
    setLoading(true);
    setForbidden(false);
    const params: Record<string, number | string> = { year, month };
    if (dept) params.departmentId = dept;
    apiGet<MonthlyResponse>("/attendance/monthly", params)
      .then((res) => setData(res))
      .catch((e) => {
        setData(null);
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true);
        } else {
          toast(e instanceof ApiError ? e.message : "Couldn't load monthly report", "error");
        }
      })
      .finally(() => setLoading(false));
  }, [year, month, dept, toast]);

  const yearOptions = useMemo(
    () => [now.year - 1, now.year, now.year + 1],
    [now],
  );

  const exportCsv = () => {
    const lastDay = new Date(year, month, 0).getDate();
    const p = (n: number) => String(n).padStart(2, "0");
    const params: Record<string, string | undefined> = {
      from: `${year}-${p(month)}-01`,
      to: `${year}-${p(month)}-${p(lastDay)}`,
    };
    if (dept) params.departmentId = dept;
    downloadFile("/attendance/export", `attendance-${year}-${p(month)}.csv`, params).catch((e) =>
      toast(e instanceof ApiError ? e.message : "Export failed", "error"),
    );
  };

  if (authLoading) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Monthly attendance"
        description={monthLabel(year, month)}
        backHref="/attendance"
        action={
          <Button variant="outline" onClick={exportCsv} disabled={loading || !data}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField label="Year" className="sm:w-32">
            <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Month" className="sm:w-44">
            <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>
                  {monthLabel(year, m).split(" ")[0]}
                </option>
              ))}
            </Select>
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
      </Card>

      {loading ? (
        <PageSkeleton />
      ) : forbidden ? (
        <EmptyState
          title="Not available"
          description="Monthly attendance reports aren't available for your role."
        />
      ) : !data || data.employees.length === 0 ? (
        <EmptyState
          title="No employees"
          description="No employees found for this month and filter."
        />
      ) : (
        <>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
            {LEGEND.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-xs text-muted">
                <span className={`inline-block h-3 w-3 rounded-full ${STATUS_DOT[s]}`} />
                {prettify(s)}
              </span>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-canvas">
                  <th className="sticky left-0 z-10 min-w-44 border-b border-line bg-canvas px-3 py-2 text-left font-semibold text-inksoft">
                    Employee
                  </th>
                  {data.days.map((d) => {
                    const [y, m, day] = d.split("-").map(Number);
                    const wd = new Date(y, m - 1, day).toLocaleDateString("en", {
                      weekday: "narrow",
                    });
                    return (
                      <th
                        key={d}
                        title={formatDate(d)}
                        className="min-w-7 border-b border-line px-1 py-2 text-center font-medium text-muted"
                      >
                        <span className="block text-[10px] uppercase">{wd}</span>
                        <span className="block text-xs font-semibold text-inksoft">{day}</span>
                      </th>
                    );
                  })}
                  <th className="sticky right-0 border-b border-line bg-canvas px-3 py-2 text-center font-semibold text-inksoft">
                    Totals
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((emp) => {
                  const row = data.matrix[emp.id] ?? {};
                  const sum = data.summary[emp.id];
                  return (
                    <tr key={emp.id} className="hover:bg-canvas/60">
                      <td className="sticky left-0 z-10 border-b border-line bg-white px-3 py-1.5">
                        <p className="whitespace-nowrap font-medium text-ink">{emp.fullName}</p>
                        <p className="text-[11px] text-muted">{emp.employeeCode}</p>
                      </td>
                      {data.days.map((d) => (
                        <MonthCell
                          key={d}
                          status={row[d]}
                          title={`${emp.fullName} · ${formatDate(d)} · ${prettify(row[d] ?? "—")}`}
                        />
                      ))}
                      <td className="sticky right-0 border-b border-line bg-white px-3 py-1.5 text-center">
                        {sum && (
                          <span className="whitespace-nowrap">
                            <span className="font-semibold text-accent-ink">P:{sum.present}</span>
                            {" · "}
                            <span className="font-semibold text-danger">A:{sum.absent}</span>
                            {(sum.late > 0 || sum.missingCheckout > 0) && (
                              <span className="text-faint">
                                {" · "}
                                {sum.late > 0 && `L:${sum.late}`}
                                {sum.late > 0 && sum.missingCheckout > 0 && " "}
                                {sum.missingCheckout > 0 && `M:${sum.missingCheckout}`}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Hover any cell for the date and status. P = present, A = absent, L = late, M = missing
            checkout.
          </p>
        </>
      )}
    </div>
  );
}
