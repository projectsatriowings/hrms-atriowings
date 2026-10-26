"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Calculator, Download, FileText, Info } from "lucide-react";
import { payrollAdjustmentSchema, type PayrollAdjustmentInput } from "@hrms/shared";
import { apiDelete, apiGet, apiPost, downloadFile, ApiError } from "@/lib/api";
import { formatDate, formatINR, formatDateTime, monthLabel } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressSteps } from "@/components/ui/Stepper";

interface PayComponent {
  componentKey: string;
  label: string;
  amount: number;
  kind: "earning" | "deduction";
}

interface PayRecord {
  id: string;
  employeeId: string;
  gross: number;
  totalDeductions: number;
  netPay: number;
  lopDays: number;
  paidDays: number;
  status: string;
  salaryStructureId?: string | null;
  structureEffectiveFrom?: string | null;
  employee: { id: string; fullName: string; employeeCode: string; department: { name: string } | null };
  components: PayComponent[];
}

interface PeriodTotals {
  gross?: number;
  totalDeductions?: number;
  netPay?: number;
  headcount?: number;
}

interface AttendanceCoverage {
  expectedDays: number;
  daysWithoutRecord: number;
  missingCheckoutDays?: number;
  coveragePercent: number;
}

interface PayrollAdjustmentRow {
  id: string;
  employeeId: string;
  componentKey: string;
  label: string;
  amount: number;
  kind: "earning" | "deduction";
  note?: string | null;
  employee?: { id: string; fullName: string; employeeCode: string } | null;
}

interface PeriodDetail {
  period: { id: string; year: number; month: number; status: string; lockedAt: string | null };
  records: PayRecord[];
  totals?: PeriodTotals;
  previousPeriodTotals?: PeriodTotals | null;
  attendanceCoverage?: AttendanceCoverage | null;
  warnings?: string[];
}

interface DeptCost {
  department: string;
  headcount: number;
  gross: number;
  netPay: number;
}

const STEPS = ["Inputs", "Compute", "Review", "Approve", "Finalized"];
const STEP_BY_STATUS: Record<string, number> = { draft: 1, in_review: 3, approved: 3, finalized: 4 };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ₹4,20,000 -> "₹4.2L" for compact banner text */
function formatINRCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return formatINR(v);
}

export default function PayrollPeriodPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user, loading: authLoading, hasRole } = useAuth();
  const { toast } = useToast();

  const [detail, setDetail] = useState<PeriodDetail | null>(null);
  const [adjustments, setAdjustments] = useState<PayrollAdjustmentRow[]>([]);
  const [deptCost, setDeptCost] = useState<DeptCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [detailsRecord, setDetailsRecord] = useState<PayRecord | null>(null);
  const [adjustRecord, setAdjustRecord] = useState<PayRecord | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const canManage = hasRole("hr", "md");
  const isMd = hasRole("md");

  const load = useCallback(async () => {
    try {
      const d = await apiGet<PeriodDetail>(`/payroll/periods/${id}`);
      setDetail(d);
      try {
        setAdjustments(await apiGet<PayrollAdjustmentRow[]>(`/payroll/periods/${id}/adjustments`));
      } catch {
        setAdjustments([]);
      }
      if (d.period.status === "finalized") {
        try {
          setDeptCost(await apiGet<DeptCost[]>(`/payroll/periods/${id}/cost-by-department`));
        } catch {
          setDeptCost([]);
        }
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load payroll period", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    if (!authLoading && user) load();
    else if (!authLoading) setLoading(false);
  }, [authLoading, user, load]);

  const mutate = async (label: string, path: string, successMsg: string) => {
    try {
      setBusy(label);
      await apiPost(path);
      toast(successMsg, "success");
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : `${successMsg} failed`, "error");
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    if (!detail) return;
    try {
      setBusy("export");
      await downloadFile(
        `/payroll/periods/${id}/export`,
        `payroll-${detail.period.year}-${String(detail.period.month).padStart(2, "0")}.csv`,
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Export failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const sums = useMemo(() => {
    const records = detail?.records ?? [];
    return {
      headcount: detail?.totals?.headcount ?? records.length,
      gross: detail?.totals?.gross ?? records.reduce((s, r) => s + num(r.gross), 0),
      deductions: detail?.totals?.totalDeductions ?? records.reduce((s, r) => s + num(r.totalDeductions), 0),
      net: detail?.totals?.netPay ?? records.reduce((s, r) => s + num(r.netPay), 0),
    };
  }, [detail]);

  const exceptions = useMemo(() => {
    const out: { record: PayRecord; reasons: string[] }[] = [];
    for (const r of detail?.records ?? []) {
      const reasons: string[] = [];
      if (num(r.lopDays) > 0) reasons.push(`${num(r.lopDays)} unpaid leave day(s) — paid days ${num(r.paidDays)}`);
      if (num(r.netPay) <= 0) reasons.push(`Net pay ${formatINR(num(r.netPay))} — verify components`);
      if (reasons.length) out.push({ record: r, reasons });
    }
    return out;
  }, [detail]);

  const momLine = useMemo(() => {
    const prev = detail?.previousPeriodTotals;
    if (!prev) return null;
    const parts: string[] = [];
    const curNet = sums.net;
    const prevNet = num(prev.netPay);
    if (prevNet) {
      const pct = ((curNet - prevNet) / Math.abs(prevNet)) * 100;
      parts.push(
        `Net pay ${formatINRCompact(curNet)}, ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% vs last month`,
      );
    }
    const curGross = sums.gross;
    const prevGross = num(prev.gross);
    if (prevGross) {
      const pct = ((curGross - prevGross) / Math.abs(prevGross)) * 100;
      parts.push(
        `Gross ${formatINRCompact(curGross)}, ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% vs last month`,
      );
    }
    return parts.length ? parts.join(" · ") : null;
  }, [detail, sums]);

  if (authLoading || loading) return <PageSkeleton />;
  if (!detail) {
    return <EmptyState title="Period not found" description="This payroll period may have been removed." />;
  }
  if (!canManage) {
    return (
      <EmptyState
        title="Payroll is restricted"
        description="Only HR and the MD can view the payroll workspace. You can view your own payslips instead."
        action={<Button onClick={() => router.push("/payroll/payslips")}>My payslips</Button>}
      />
    );
  }

  const { period, records } = detail;
  const status = period.status;
  const finalized = status === "finalized";
  const step = STEP_BY_STATUS[status] ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={monthLabel(period.year, period.month)}
        description={
          period.lockedAt
            ? `Locked ${formatDateTime(period.lockedAt, user?.companyTimezone)}`
            : "Payroll workspace — compute, review, approve, finalize."
        }
        backHref="/payroll"
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            {finalized && (
              <Button variant="outline" onClick={exportCsv} loading={busy === "export"}>
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            )}
          </div>
        }
      />

      <Card className="p-5">
        <ProgressSteps steps={STEPS} current={step} />
      </Card>

      {status === "draft" && (
        <Card className="flex items-start gap-3 border-info/30 bg-info-soft/60 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" />
          <p className="text-sm text-inksoft">
            Inputs are pulled automatically from attendance, approved leave, and effective salary
            structures. Run the computation below to generate this month&apos;s payroll register.
            Bonuses, arrears and other one-offs are handled as adjustment components (Adjust on a
            row below) — adjustments survive recomputation.
          </p>
        </Card>
      )}

      {/* Compute summary */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-ink">Computation</h2>
          {!finalized && canManage && (
            <Button
              onClick={() => mutate("compute", `/payroll/periods/${id}/compute`, "Payroll computed")}
              loading={busy === "compute"}
            >
              <Calculator className="h-4 w-4" /> Run computation
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Headcount" value={sums.headcount} />
          <StatCard label="Gross" value={formatINR(sums.gross)} />
          <StatCard label="Deductions" value={formatINR(sums.deductions)} />
          <StatCard label="Net pay" value={formatINR(sums.net)} />
        </div>
        {detail.attendanceCoverage && detail.attendanceCoverage.daysWithoutRecord > 0 && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm text-inksoft">
              <span className="font-semibold text-ink">Attendance coverage {detail.attendanceCoverage.coveragePercent}%.</span>{" "}
              No attendance records for {detail.attendanceCoverage.daysWithoutRecord} of{" "}
              {detail.attendanceCoverage.expectedDays} working days — those days were treated as
              LOP (unpaid). Verify attendance before finalising.
            </p>
          </div>
        )}
        {detail.attendanceCoverage && (detail.attendanceCoverage.missingCheckoutDays ?? 0) > 0 && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm text-inksoft">
              <span className="font-semibold text-ink">
                {detail.attendanceCoverage.missingCheckoutDays} day(s) with a check-in but no check-out.
              </span>{" "}
              Those days were paid 0 and counted in LOP. Resolve the missing check-outs before
              finalising.
            </p>
          </div>
        )}
      </section>

      {/* Exceptions */}
      {exceptions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold tracking-tight text-ink">Exceptions to review</h2>
          {exceptions.map(({ record, reasons }) => (
            <div
              key={record.id}
              className="rounded-2xl border border-line border-l-4 border-l-warning bg-surface p-4 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <span className="text-sm font-semibold tracking-tight text-ink">
                  {record.employee.fullName}
                  <span className="ml-2 font-normal text-muted">{record.employee.employeeCode}</span>
                </span>
              </div>
              <ul className="mt-1.5 space-y-0.5 pl-6 text-sm text-warning">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* Month-on-month */}
      {momLine && (
        <Card className="border-accent/30 bg-accent-soft/60 p-4">
          <p className="text-sm text-accent-ink">{momLine}</p>
        </Card>
      )}

      {/* Register */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight text-ink">Payroll register</h2>
        <Table<PayRecord>
          columns={[
            {
              key: "employee",
              header: "Employee",
              render: (r) => (
                <div>
                  <div className="font-medium">{r.employee.fullName}</div>
                  <div className="text-xs text-muted">
                    {r.employee.employeeCode}
                    {r.employee.department ? ` · ${r.employee.department.name}` : ""}
                  </div>
                </div>
              ),
            },
            { key: "paidDays", header: "Paid days", render: (r) => num(r.paidDays), className: "text-center" },
            {
              key: "lopDays",
              header: "LOP days",
              render: (r) =>
                num(r.lopDays) > 0 ? (
                  <Badge variant="amber">{num(r.lopDays)}</Badge>
                ) : (
                  <span className="text-faint">0</span>
                ),
              className: "text-center",
            },
            { key: "gross", header: "Gross", render: (r) => formatINR(num(r.gross)), className: "text-right tabular-nums" },
            {
              key: "deductions",
              header: "Deductions",
              render: (r) => formatINR(num(r.totalDeductions)),
              className: "text-right tabular-nums",
            },
            {
              key: "netPay",
              header: "Net pay",
              render: (r) => <span className="font-semibold">{formatINR(num(r.netPay))}</span>,
              className: "text-right tabular-nums",
            },
            {
              key: "components",
              header: "Components",
              render: (r) => (
                <Button variant="ghost" size="sm" onClick={() => setDetailsRecord(r)}>
                  <FileText className="h-4 w-4" /> Details
                </Button>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              render: (r) =>
                !finalized && canManage ? (
                  <Button variant="outline" size="sm" onClick={() => setAdjustRecord(r)}>
                    Adjust
                  </Button>
                ) : (
                  <span className="text-faint">—</span>
                ),
            },
          ]}
          rows={records}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title="No records yet"
              description="Run the computation to generate payroll records for this period."
            />
          }
        />
      </section>

      {/* Adjustments (survive recompute) */}
      {adjustments.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight text-ink">Adjustments</h2>
          <p className="text-sm text-muted">
            Manual adjustments are stored separately and re-applied on every recomputation.
            Bonuses and arrears are handled here.
          </p>
          <Table<PayrollAdjustmentRow>
            columns={[
              {
                key: "employee",
                header: "Employee",
                render: (a) => (
                  <div>
                    <div className="font-medium">{a.employee?.fullName ?? a.employeeId}</div>
                    <div className="text-xs text-muted">{a.employee?.employeeCode ?? ""}</div>
                  </div>
                ),
              },
              { key: "label", header: "Label", render: (a) => a.label },
              { key: "kind", header: "Kind", render: (a) => a.kind },
              { key: "amount", header: "Amount", render: (a) => formatINR(num(a.amount)), className: "text-right tabular-nums" },
              {
                key: "actions",
                header: "Actions",
                render: (a) =>
                  !finalized && canManage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await apiDelete(`/payroll/periods/${id}/adjustments/${a.id}`);
                          toast("Adjustment removed", "success");
                          await load();
                        } catch (e) {
                          toast(e instanceof ApiError ? e.message : "Failed to remove adjustment", "error");
                        }
                      }}
                    >
                      Remove
                    </Button>
                  ) : (
                    <span className="text-faint">—</span>
                  ),
              },
            ]}
            rows={adjustments}
            rowKey={(a) => a.id}
          />
        </section>
      )}

      {/* Approval workflow */}
      <Card className="p-5">
        <h2 className="text-base font-semibold tracking-tight text-ink">Approval</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {finalized ? (
            <div className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-canvas">
              Finalized — records are immutable.
            </div>
          ) : (
            <>
              {status === "draft" && hasRole("hr") && (
                <Button
                  onClick={() => mutate("submit", `/payroll/periods/${id}/submit`, "Submitted for approval")}
                  loading={busy === "submit"}
                >
                  Submit for approval
                </Button>
              )}
              {status === "in_review" && isMd && (
                <Button
                  onClick={() => mutate("approve", `/payroll/periods/${id}/approve`, "Payroll approved")}
                  loading={busy === "approve"}
                >
                  Approve payroll
                </Button>
              )}
              {status === "approved" && isMd && (
                <Button variant="destructive" onClick={() => setFinalizeOpen(true)} loading={busy === "finalize"}>
                  Finalize &amp; lock
                </Button>
              )}
              {status === "in_review" && hasRole("hr") && !isMd && (
                <p className="text-sm text-muted">
                  Waiting for the MD to approve this payroll run.
                </p>
              )}
              {status === "approved" && !isMd && (
                <p className="text-sm text-muted">
                  Approved. Waiting for the MD to finalize and lock.
                </p>
              )}
              {status === "draft" && isMd && !hasRole("hr") && (
                <p className="text-sm text-muted">Waiting for HR to submit this run for approval.</p>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Cost by department */}
      {finalized && deptCost.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight text-ink">Cost by department</h2>
          <Table<DeptCost>
            columns={[
              { key: "department", header: "Department", render: (d) => <span className="font-medium">{d.department}</span> },
              { key: "headcount", header: "Headcount", render: (d) => num(d.headcount), className: "text-center" },
              { key: "gross", header: "Gross", render: (d) => formatINR(num(d.gross)), className: "text-right tabular-nums" },
              {
                key: "netPay",
                header: "Net",
                render: (d) => <span className="font-semibold">{formatINR(num(d.netPay))}</span>,
                className: "text-right tabular-nums",
              },
            ]}
            rows={deptCost}
            rowKey={(d, i) => `${d.department}-${i}`}
          />
        </section>
      )}

      {/* Component details dialog */}
      <Dialog
        open={!!detailsRecord}
        onClose={() => setDetailsRecord(null)}
        title={detailsRecord ? `${detailsRecord.employee.fullName} — pay components` : ""}
        description={detailsRecord ? `${detailsRecord.employee.employeeCode} · paid days ${num(detailsRecord.paidDays)} · LOP ${num(detailsRecord.lopDays)}` : ""}
        wide
      >
        {detailsRecord && (
          <>
            {detailsRecord.structureEffectiveFrom && (
              <p className="mb-4 text-sm text-muted">
                Salary structure effective from{" "}
                <span className="font-semibold text-ink">{formatDate(detailsRecord.structureEffectiveFrom)}</span>
              </p>
            )}
            <ComponentBreakdown components={detailsRecord.components} />
            {detailsRecord.components.some((c) => c.componentKey === "tds") && (
              <p className="mt-4 text-xs text-muted">TDS (estimate) — verify before filing.</p>
            )}
          </>
        )}
      </Dialog>

      {/* Adjust dialog */}
      <AdjustDialog
        record={adjustRecord}
        onClose={() => setAdjustRecord(null)}
        onSaved={load}
      />

      {/* Finalize confirm dialog */}
      <Dialog
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        title="Finalize & lock payroll"
        description="This action is irreversible."
      >
        <p className="text-sm text-muted">
          Finalizing will lock the {monthLabel(period.year, period.month)} payroll run. Records,
          components and adjustments become immutable, and payslips will be issued to employees.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setFinalizeOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={busy === "finalize"}
            onClick={async () => {
              setFinalizeOpen(false);
              await mutate("finalize", `/payroll/periods/${id}/finalize`, "Payroll finalized and locked");
            }}
          >
            Finalize &amp; lock
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function ComponentBreakdown({ components }: { components: PayComponent[] }) {
  const earnings = components.filter((c) => c.kind === "earning");
  const deductions = components.filter((c) => c.kind === "deduction");
  const total = (list: PayComponent[]) => list.reduce((s, c) => s + num(c.amount), 0);

  const block = (title: string, list: PayComponent[]) => (
    <div>
      <h4 className="mb-2 text-sm font-semibold tracking-tight text-ink">{title}</h4>
      {list.length === 0 ? (
        <p className="text-sm text-faint">None</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {list.map((c) => (
              <tr key={c.componentKey} className="border-b border-line last:border-0">
                <td className="py-1.5 text-inksoft">{c.label}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{formatINR(num(c.amount))}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 text-ink">Total</td>
              <td className="py-1.5 text-right tabular-nums text-ink">{formatINR(total(list))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {block("Earnings", earnings)}
      {block("Deductions", deductions)}
    </div>
  );
}

function AdjustDialog({
  record,
  onClose,
  onSaved,
}: {
  record: PayRecord | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const params = useParams<{ id: string }>();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PayrollAdjustmentInput>({
    resolver: zodResolver(payrollAdjustmentSchema),
    defaultValues: { payrollRecordId: "", componentKey: "", label: "", amount: 0, kind: "earning", reason: "" },
  });

  useEffect(() => {
    if (record) {
      reset({ payrollRecordId: record.id, componentKey: "", label: "", amount: 0, kind: "earning", reason: "" });
    }
  }, [record, reset]);

  const onSubmit = async (data: PayrollAdjustmentInput) => {
    try {
      await apiPost(`/payroll/periods/${params.id}/adjust`, data);
      toast("Adjustment applied", "success");
      onClose();
      await onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to apply adjustment", "error");
    }
  };

  return (
    <Dialog
      open={!!record}
      onClose={onClose}
      title={record ? `Adjust — ${record.employee.fullName}` : "Adjust"}
      description="Adds an earning or deduction component to this employee's record."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <input type="hidden" {...register("payrollRecordId")} />
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Component key" required error={errors.componentKey?.message} hint="e.g. bonus_q3">
            <Input className="h-10" {...register("componentKey")} />
          </FormField>
          <FormField label="Label" required error={errors.label?.message} hint="Shown on the payslip">
            <Input className="h-10" {...register("label")} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Amount"
            required
            error={errors.amount?.message}
            hint="Signed — negative reduces"
          >
            <Input type="number" step="0.01" className="h-10" {...register("amount", { valueAsNumber: true })} />
          </FormField>
          <FormField label="Kind" required error={errors.kind?.message}>
            <Select {...register("kind")}>
              <option value="earning">Earning</option>
              <option value="deduction">Deduction</option>
            </Select>
          </FormField>
        </div>
        <FormField label="Reason" required error={errors.reason?.message}>
          <Textarea rows={3} {...register("reason")} />
        </FormField>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Apply adjustment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
