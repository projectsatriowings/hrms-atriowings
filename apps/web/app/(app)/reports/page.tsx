"use client";

import { useState } from "react";
import { Download, Play } from "lucide-react";
import { apiGet, downloadFile, ApiError } from "@/lib/api";
import {
  formatDate,
  formatDateTime,
  formatMinutes,
  formatTime,
  monthLabel,
  prettify,
  todayInTZ,
} from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { StatusBadge } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear + 1 - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i, 1).toLocaleString("en", { month: "long" }),
}));

/* ── Generic cell rendering for report shapes ─────────────────────────── */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function renderCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-faint">—</span>;
  if (typeof v === "number")
    return (
      <span className="tabular-nums">
        {Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toFixed(2)}
      </span>
    );
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatDateTime(v);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (isPlainObject(v)) {
    if (typeof v.fullName === "string") return v.fullName;
    if (typeof v.name === "string") return v.name;
    if (typeof v.label === "string") return v.label;
    return (
      <code className="whitespace-pre-wrap break-all text-xs text-muted">
        {JSON.stringify(v)}
      </code>
    );
  }
  return String(v);
}

function dynamicColumns(rows: Record<string, unknown>[]): Column<Record<string, unknown>>[] {
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return keys.map((k) => ({
    key: k,
    header: prettify(k),
    render: (row) => renderCell(row[k]),
  }));
}

/* ── (a) Daily attendance ─────────────────────────────────────────────── */

interface DailyRecord {
  employee: { fullName: string; employeeCode: string; department: { name: string } | null };
  displayStatus: string;
  record: { checkInAt: string | null; checkOutAt: string | null; workingMinutes: number | null } | null;
}

interface DailyReport {
  date: string;
  totals: Record<string, number>;
  records: DailyRecord[];
}

function DailyAttendanceCard() {
  const { toast } = useToast();
  const [date, setDate] = useState(todayInTZ());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await apiGet<DailyReport>("/reports/attendance-daily", { date });
      setReport(res);
      setRan(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to run report", "error");
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = async () => {
    setCsvLoading(true);
    try {
      await downloadFile("/attendance/export", `attendance-${date}.csv`, { from: date, to: date });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to download CSV", "error");
    } finally {
      setCsvLoading(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-ink">Daily attendance</h2>
        <p className="text-sm text-muted">
          Who checked in, when, and how long they worked — for one day
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        </FormField>
        <Button onClick={run} loading={loading}>
          <Play className="h-4 w-4" /> Run
        </Button>
        <Button variant="outline" onClick={downloadCsv} loading={csvLoading}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      {!ran ? (
        <EmptyState title="Pick a date and run the report" />
      ) : report && report.records.length > 0 ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(report.totals ?? {}).map(([k, v]) => (
              <Badge key={k} variant="slate">
                {prettify(k)}: {v}
              </Badge>
            ))}
          </div>
          <Table<DailyRecord>
            columns={[
              {
                key: "employee",
                header: "Employee",
                render: (r) => (
                  <div>
                    <p className="font-medium text-ink">{r.employee.fullName}</p>
                    <p className="font-mono text-xs text-muted">{r.employee.employeeCode}</p>
                  </div>
                ),
              },
              {
                key: "department",
                header: "Department",
                render: (r) => r.employee.department?.name ?? "—",
              },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.displayStatus} /> },
              {
                key: "checkIn",
                header: "Check in",
                render: (r) => (r.record ? formatTime(r.record.checkInAt) : "—"),
              },
              {
                key: "checkOut",
                header: "Check out",
                render: (r) => (r.record ? formatTime(r.record.checkOutAt) : "—"),
              },
              {
                key: "working",
                header: "Working time",
                render: (r) => formatMinutes(r.record?.workingMinutes ?? null),
              },
            ]}
            rows={report.records}
            rowKey={(_, i) => `${report.date}-${i}`}
          />
        </>
      ) : (
        <EmptyState title="No attendance records" description={`Nothing recorded for ${formatDate(date)}.`} />
      )}
    </Card>
  );
}

/* ── (b) Monthly attendance ───────────────────────────────────────────── */

function MonthlyAttendanceCard() {
  const { toast } = useToast();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await apiGet<Record<string, unknown>>("/reports/attendance-monthly", {
        year,
        month,
      });
      setResult(res);
      setRan(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to run report", "error");
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = async () => {
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
    setCsvLoading(true);
    try {
      await downloadFile("/attendance/export", `attendance-${year}-${String(month).padStart(2, "0")}.csv`, {
        from,
        to,
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to download CSV", "error");
    } finally {
      setCsvLoading(false);
    }
  };

  const records = Array.isArray(result?.records)
    ? (result.records as Record<string, unknown>[])
    : null;
  const totals = isPlainObject(result?.totals) ? (result.totals as Record<string, unknown>) : null;

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-ink">Monthly attendance</h2>
        <p className="text-sm text-muted">Attendance summary for a full month</p>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Year">
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-auto">
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Month">
          <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-auto">
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </FormField>
        <Button onClick={run} loading={loading}>
          <Play className="h-4 w-4" /> Run
        </Button>
        <Button variant="outline" onClick={downloadCsv} loading={csvLoading}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      {!ran ? (
        <EmptyState title="Pick a month and run the report" />
      ) : (
        <>
          {totals && (
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(totals).map(([k, v]) => (
                <Badge key={k} variant="slate">
                  {prettify(k)}: {String(v)}
                </Badge>
              ))}
            </div>
          )}
          {records && records.length > 0 ? (
            <Table<Record<string, unknown>>
              columns={dynamicColumns(records)}
              rows={records}
              rowKey={(_, i) => `${year}-${month}-${i}`}
            />
          ) : (
            <EmptyState
              title="No records"
              description={`Nothing found for ${monthLabel(year, month)}.`}
            />
          )}
        </>
      )}
    </Card>
  );
}

/* ── (c) Leave balances ───────────────────────────────────────────────── */

interface LeaveBalanceRow {
  employeeCode: string;
  fullName: string;
  department: string;
  leaveType: string;
  allocated: number;
  used: number;
  adjustments: number;
  carryForward: number;
  balance: number;
}

function LeaveBalancesCard() {
  const { toast } = useToast();
  const [year, setYear] = useState(currentYear);
  const [rows, setRows] = useState<LeaveBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await apiGet<LeaveBalanceRow[]>("/reports/leave-balances", { year });
      setRows(Array.isArray(res) ? res : []);
      setRan(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to run report", "error");
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = async () => {
    setCsvLoading(true);
    try {
      await downloadFile("/reports/leave-balances/export", `leave-balances-${year}.csv`, { year });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to download CSV", "error");
    } finally {
      setCsvLoading(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-ink">Leave balances</h2>
        <p className="text-sm text-muted">
          Allocated, used and remaining leave per employee and leave type
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Year">
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-auto">
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
        <Button onClick={run} loading={loading}>
          <Play className="h-4 w-4" /> Run
        </Button>
        <Button variant="outline" onClick={downloadCsv} loading={csvLoading}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      {!ran ? (
        <EmptyState title="Pick a year and run the report" />
      ) : rows.length > 0 ? (
        <Table<LeaveBalanceRow>
          columns={[
            { key: "employeeCode", header: "Code", render: (r) => <span className="font-mono text-xs">{r.employeeCode}</span> },
            { key: "fullName", header: "Employee", render: (r) => <span className="font-medium text-ink">{r.fullName}</span> },
            { key: "department", header: "Department", render: (r) => r.department || "—" },
            { key: "leaveType", header: "Leave type", render: (r) => r.leaveType },
            { key: "allocated", header: "Allocated", className: "text-right tabular-nums", render: (r) => <span className="tabular-nums">{r.allocated}</span> },
            { key: "used", header: "Used", className: "text-right tabular-nums", render: (r) => <span className="tabular-nums">{r.used}</span> },
            { key: "adjustments", header: "Adjustments", className: "text-right tabular-nums", render: (r) => <span className="tabular-nums">{r.adjustments}</span> },
            { key: "carryForward", header: "Carry fwd", className: "text-right tabular-nums", render: (r) => <span className="tabular-nums">{r.carryForward}</span> },
            {
              key: "balance",
              header: "Balance",
              className: "text-right tabular-nums",
              render: (r) => <span className={cn("font-semibold tabular-nums", r.balance < 0 && "text-danger")}>{r.balance}</span>,
            },
          ]}
          rows={rows}
          rowKey={(r, i) => `${r.employeeCode}-${r.leaveType}-${i}`}
        />
      ) : (
        <EmptyState title="No leave balances" description={`No leave data for ${year}.`} />
      )}
    </Card>
  );
}

/* ── (d) Payroll register ─────────────────────────────────────────────── */

function PayrollRegisterCard() {
  const { toast } = useToast();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [downloading, setDownloading] = useState(false);

  const downloadCsv = async () => {
    setDownloading(true);
    try {
      await downloadFile(
        "/reports/payroll-register/export",
        `payroll-register-${year}-${String(month).padStart(2, "0")}.csv`,
        { year, month },
      );
      toast("Payroll register downloaded", "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to download CSV", "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-ink">Payroll register</h2>
        <p className="text-sm text-muted">
          Full payroll register for a pay month, as a CSV download
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Year">
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-auto">
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Month">
          <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-auto">
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </FormField>
        <Button onClick={downloadCsv} loading={downloading}>
          <Download className="h-4 w-4" /> Download CSV — {monthLabel(year, month)}
        </Button>
      </div>
    </Card>
  );
}

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Operational reports with CSV export for audits and sharing"
      />
      <div className="space-y-6">
        <DailyAttendanceCard />
        <MonthlyAttendanceCard />
        <LeaveBalancesCard />
        <PayrollRegisterCard />
      </div>
    </>
  );
}
