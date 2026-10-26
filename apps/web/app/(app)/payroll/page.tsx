"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { payrollPeriodSchema, type PayrollPeriodInput } from "@hrms/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDateTime, monthLabel } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

interface PayrollPeriod {
  id: string;
  year: number;
  month: number;
  status: string;
  lockedAt: string | null;
  _count: { records: number };
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function PayrollPeriodsPage() {
  const { user, loading: authLoading, hasRole } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const canManage = hasRole("hr", "md");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PayrollPeriodInput>({
    resolver: zodResolver(payrollPeriodSchema),
    defaultValues: { year: new Date().getFullYear(), month: new Date().getMonth() + 1 },
  });

  const load = async () => {
    try {
      setLoading(true);
      setPeriods(await apiGet<PayrollPeriod[]>("/payroll/periods"));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load payroll periods", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user && canManage) load();
    else if (!authLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  const openDialog = () => {
    reset({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
    setDialogOpen(true);
  };

  const onCreate = async (data: PayrollPeriodInput) => {
    try {
      const created = await apiPost<{ id: string }>("/payroll/periods", data);
      setDialogOpen(false);
      toast("Payroll period created", "success");
      router.push(`/payroll/periods/${created.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to create payroll period", "error");
    }
  };

  if (authLoading || loading) return <PageSkeleton />;
  if (!canManage) {
    return (
      <EmptyState
        title="Payroll is restricted"
        description="Only HR and the MD can manage payroll periods. You can view your own payslips instead."
        action={<Button onClick={() => router.push("/payroll/payslips")}>My payslips</Button>}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Monthly payroll periods — compute, review, approve and finalize. Bonuses and arrears are handled as adjustment components on a period's register, and survive recomputation."
        action={
          <Button onClick={openDialog}>
            <Plus className="h-4 w-4" /> New period
          </Button>
        }
      />

      <div className="mb-6 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
        Statutory reminder: PF/ESI contributions are due by the 15th · TDS is due by the 7th of the
        next month.
      </div>

      <Table<PayrollPeriod>
        columns={[
          { key: "period", header: "Period", render: (p) => <span className="font-medium">{monthLabel(p.year, p.month)}</span> },
          { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
          { key: "employees", header: "Employees", render: (p) => p._count?.records ?? 0 },
          {
            key: "locked",
            header: "Locked",
            render: (p) => (
              <span className="text-muted">{p.lockedAt ? formatDateTime(p.lockedAt, user?.companyTimezone) : "—"}</span>
            ),
          },
        ]}
        rows={periods}
        rowKey={(p) => p.id}
        onRowClick={(p) => router.push(`/payroll/periods/${p.id}`)}
        empty={
          <EmptyState
            title="No payroll periods yet"
            description="Create your first payroll period to start the monthly run."
            action={
              <Button onClick={openDialog}>
                <Plus className="h-4 w-4" /> New period
              </Button>
            }
          />
        }
      />

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="New payroll period"
        description="Pick the month this payroll run covers."
      >
        <form onSubmit={handleSubmit(onCreate)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Year" required error={errors.year?.message}>
              <Input
                type="number"
                className="h-10"
                {...register("year", { valueAsNumber: true })}
              />
            </FormField>
            <FormField label="Month" required error={errors.month?.message}>
              <Select {...register("month", { valueAsNumber: true })}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(2000, m).replace(" 2000", "")}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Create period
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
