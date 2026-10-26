"use client";

import { useCallback, useEffect, useState } from "react";
import { Printer, Receipt } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api";
import { formatDate, formatINR, monthLabel } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Select } from "@/components/ui/Select";

interface PayComponent {
  componentKey: string;
  label: string;
  amount: number;
  kind: "earning" | "deduction";
}

interface PayslipResponse {
  period: { year: number; month: number };
  record: {
    components: PayComponent[];
    gross: number;
    totalDeductions: number;
    netPay: number;
    lopDays: number;
    paidDays: number;
    status: string;
    salaryStructureId?: string | null;
    structureEffectiveFrom?: string | null;
  } | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function PayslipsPage() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<PayslipResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setData(await apiGet<PayslipResponse>("/payroll/payslips/me", { year, month }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load payslip", "error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, month, toast]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  const years = [year - 2, year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i);

  const record = data?.record ?? null;
  const earnings = record?.components.filter((c) => c.kind === "earning") ?? [];
  const deductions = record?.components.filter((c) => c.kind === "deduction") ?? [];

  const compTable = (list: PayComponent[], total: number, totalLabel: string) => (
    <table className="w-full text-sm">
      <tbody>
        {list.map((c) => (
          <tr key={c.componentKey} className="border-b border-line last:border-0">
            <td className="py-2 text-inksoft">{c.label}</td>
            <td className="py-2 text-right tabular-nums text-ink">{formatINR(num(c.amount))}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="py-2 text-ink">{totalLabel}</td>
          <td className="py-2 text-right tabular-nums text-ink">{formatINR(num(total))}</td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="My payslips"
          description="Your monthly payslips from finalized payroll runs."
          action={
            record ? (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            ) : undefined
          }
        />

        <div className="mb-6 flex flex-wrap items-end gap-3">
          <FormField label="Year" className="w-32">
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Month" className="w-44">
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthLabel(2000, m).replace(" 2000", "")}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </div>

      {authLoading || loading ? (
        <PageSkeleton />
      ) : !record ? (
        <EmptyState
          icon={Receipt}
          title="No payslip for this period"
          description={`There is no payslip for ${monthLabel(year, month)}. Payslips appear here once the payroll for that month is finalized.`}
        />
      ) : (
        <Card className="mx-auto max-w-3xl p-6 sm:p-8">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">{user?.companyName ?? "Payslip"}</h2>
              <p className="mt-0.5 text-sm text-muted">
                {user?.employeeName ?? user?.email} · {monthLabel(year, month)}
              </p>
            </div>
            <StatusBadge status={record.status} />
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-x-8 gap-y-1 py-4 text-sm text-muted">
            <span>
              Paid days <span className="font-semibold tracking-tight text-ink">{num(record.paidDays)}</span>
            </span>
            <span>
              LOP days <span className="font-semibold tracking-tight text-ink">{num(record.lopDays)}</span>
            </span>
            {record.structureEffectiveFrom && (
              <span>
                Salary structure effective from{" "}
                <span className="font-semibold tracking-tight text-ink">{formatDate(record.structureEffectiveFrom)}</span>
              </span>
            )}
          </div>
          {deductions.some((c) => c.componentKey === "tds") && (
            <p className="pb-2 text-xs text-muted">TDS (estimate) — verify before filing.</p>
          )}

          {/* Earnings / deductions */}
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Earnings</h3>
              {compTable(earnings, record.gross, "Gross earnings")}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Deductions</h3>
              {compTable(deductions, record.totalDeductions, "Total deductions")}
            </div>
          </div>

          {/* Totals */}
          <div className="mt-6 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between text-muted">
              <span>Gross</span>
              <span className="tabular-nums">{formatINR(num(record.gross))}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Total deductions</span>
              <span className="tabular-nums">{formatINR(num(record.totalDeductions))}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2.5">
              <span className="font-semibold text-accent-ink">Net pay</span>
              <span className="text-xl font-bold tabular-nums text-accent-ink">
                {formatINR(num(record.netPay))}
              </span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
