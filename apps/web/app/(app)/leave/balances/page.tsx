"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { leaveAdjustmentSchema, type LeaveAdjustmentInput } from "@hrms/shared";
import { CalendarDays, ChevronDown, ChevronRight, Scale } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatDateTime, todayInTZ } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { FormField } from "@/components/ui/FormField";
import { Dialog } from "@/components/ui/Dialog";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface LeaveType {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface LedgerEntry {
  id: string;
  deltaDays: number;
  entryType: string;
  note?: string | null;
  createdAt: string;
}

interface BalanceRow {
  leaveType: { id: string; code: string; name: string };
  allocated: number;
  used: number;
  adjustments: number;
  carryForward: number;
  balance: number;
  ledger: LedgerEntry[];
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

const ENTRY_TYPES = ["allocation", "adjustment", "carry_forward"] as const;

export default function LeaveBalancesPage() {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();

  const currentYear = Number(todayInTZ().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Employee picker (hr / md)
  const canPickEmployee = hasRole("hr", "md");
  const canAdjust = hasRole("hr", "md");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [adjustOpen, setAdjustOpen] = useState(false);

  const yearOptions = useMemo(() => [currentYear - 1, currentYear, currentYear + 1], [currentYear]);

  const fetchBalances = useCallback(
    async (y: number, empId: string) => {
      setLoading(true);
      try {
        const path = empId ? `/leave/balances/${empId}` : "/leave/balances/me";
        const res = await apiGet<BalanceRow[]>(path, { year: y });
        setBalances(res);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load balances", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    fetchBalances(year, employeeId);
  }, [fetchBalances, year, employeeId]);

  useEffect(() => {
    if (!canPickEmployee) return;
    (async () => {
      try {
        const res = await apiGet<{ data: EmployeeOption[] }>("/employees", { pageSize: 100 });
        setEmployees(res.data);
      } catch {
        /* picker stays unavailable */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  return (
    <div>
      <PageHeader
        title="Leave balances"
        description={
          employeeId && selectedEmployee
            ? `Balances for ${selectedEmployee.fullName} (${selectedEmployee.employeeCode})`
            : user?.employeeName
              ? `Balances for ${user.employeeName}`
              : undefined
        }
        action={
          canAdjust && (
            <Button onClick={() => setAdjustOpen(true)}>
              <Scale className="h-4 w-4" /> Adjust balance
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="w-36">
          <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
        {canPickEmployee && (
          <div className="w-64">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">My own balances</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} ({e.employeeCode})
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {loading ? (
        <PageSkeleton />
      ) : balances.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={CalendarDays}
            title="No leave balances"
            description={`No leave types are allocated for ${year}.`}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {balances.map((b) => {
            const open = expanded === b.leaveType.id;
            return (
              <Card key={b.leaveType.id} className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold tracking-tight text-ink">{b.leaveType.name}</h3>
                  <Badge variant="blue">{b.leaveType.code}</Badge>
                </div>
                <p className="mt-2 text-3xl font-bold text-ink">
                  {b.balance}
                  <span className="ml-1 text-sm font-normal text-muted">days left</span>
                </p>
                <dl className="mt-4 space-y-1.5 text-sm">
                  <Breakdown label="Allocated" value={b.allocated} />
                  <Breakdown label="Used" value={b.used} negative />
                  <Breakdown label="Adjustments" value={b.adjustments} />
                  <Breakdown label="Carry forward" value={b.carryForward} />
                </dl>
                <button
                  onClick={() => setExpanded(open ? null : b.leaveType.id)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:text-accent-ink"
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {open ? "Hide ledger" : `View ledger (${b.ledger.length})`}
                </button>
                {open && (
                  <div className="mt-3">
                    <Table
                      columns={[
                        { key: "date", header: "Date", render: (l: LedgerEntry) => formatDateTime(l.createdAt) },
                        {
                          key: "delta",
                          header: "Change",
                          className: "text-right tabular-nums",
                          render: (l: LedgerEntry) => (
                            <span className={cn("font-medium", l.deltaDays >= 0 ? "text-accent-ink" : "text-danger")}>
                              {l.deltaDays >= 0 ? "+" : ""}
                              {l.deltaDays} d
                            </span>
                          ),
                        },
                        { key: "type", header: "Type", render: (l: LedgerEntry) => <Badge>{l.entryType.replace(/_/g, " ")}</Badge> },
                        { key: "note", header: "Note", render: (l: LedgerEntry) => l.note || "—" },
                      ]}
                      rows={b.ledger}
                      rowKey={(l) => l.id}
                      empty={<p className="text-sm text-muted">No ledger entries yet.</p>}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {canAdjust && (
        <AdjustDialog
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
          year={year}
          employeeId={employeeId}
          onDone={() => fetchBalances(year, employeeId)}
        />
      )}
    </div>
  );
}

function Breakdown({ label, value, negative = false }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("font-medium", negative ? "text-ink" : "text-ink")}>
        {negative && value > 0 ? `−${value}` : value}
      </dd>
    </div>
  );
}

function AdjustDialog({
  open,
  onClose,
  year,
  employeeId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  employeeId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LeaveAdjustmentInput>({
    resolver: zodResolver(leaveAdjustmentSchema),
    defaultValues: { leaveTypeId: "", year, deltaDays: 0, entryType: "adjustment", note: "" },
  });

  useEffect(() => {
    if (!open) return;
    reset({ leaveTypeId: "", year, deltaDays: 0, entryType: "adjustment", note: "" });
    (async () => {
      try {
        const types = await apiGet<LeaveType[]>("/leave/types");
        setLeaveTypes(types.filter((t) => t.isActive));
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load leave types", "error");
      }
    })();
  }, [open, year, reset, toast]);

  const onSubmit = async (values: LeaveAdjustmentInput) => {
    if (!employeeId) {
      toast("Select an employee first", "error");
      return;
    }
    try {
      await apiPost(`/leave/balances/${employeeId}/adjust`, values);
      toast("Balance adjusted", "success");
      onClose();
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to adjust balance", "error");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Adjust balance"
      description="Add or remove days on an employee's leave ledger. Negative deltaDays reduces the balance."
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isSubmitting} onClick={handleSubmit(onSubmit)}>
            Apply adjustment
          </Button>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <FormField label="Leave type" required error={errors.leaveTypeId?.message}>
          <Select {...register("leaveTypeId")}>
            <option value="">Select leave type</option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Delta days (+/-)" required error={errors.deltaDays?.message}>
            <Input type="number" step="any" {...register("deltaDays", { valueAsNumber: true })} />
          </FormField>
          <FormField label="Entry type" required error={errors.entryType?.message}>
            <Select {...register("entryType")}>
              {ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <FormField label="Note" required error={errors.note?.message}>
          <Textarea rows={2} placeholder="Reason for the adjustment" {...register("note")} />
        </FormField>
        <input type="hidden" {...register("year", { valueAsNumber: true })} value={year} readOnly />
      </form>
    </Dialog>
  );
}
