"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  salaryStructureSchema,
  type Role,
  type SalaryStructureInput,
  type EmployeeAddress,
  type BankDetails,
  type PostalAddress,
} from "@hrms/shared";
import { Check, Clock, LogIn, Pencil, Plus, Trash2, UserX, Wallet } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { Dialog } from "@/components/ui/Dialog";
import { Avatar } from "@/components/ui/Avatar";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  formatDate,
  formatTime,
  formatINR,
  formatMinutes,
  prettify,
  roleLabel,
  todayInTZ,
  DEFAULT_TZ,
} from "@/lib/format";
import type { EmployeeListItem } from "../page";

interface SalaryComponents {
  basic: number;
  hra: number;
  allowances: Array<{ label: string; amount: number }>;
  deductions: Array<{ label: string; amount: number }>;
  variablePay?: number | null;
}

interface SalaryStructure {
  id: string;
  effectiveFrom: string;
  status: string;
  components: SalaryComponents;
}

interface AttendanceRow {
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
  workingMinutes: number | null;
}

interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  balance: number;
}

interface EmployeeFull extends EmployeeListItem {
  emergencyContact?: Record<string, string> | null;
  address?: EmployeeAddress | null;
  bankDetails?: BankDetails | null;
  user?: { id: string; email: string; role: Role } | null;
}

interface ProfileResponse {
  employee: EmployeeFull;
  salaryStructures: SalaryStructure[];
  recentAttendance: AttendanceRow[];
  leaveBalances: LeaveBalance[];
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 text-sm text-ink">{value ?? "—"}</p>
    </div>
  );
}

function formatAddressLines(a?: PostalAddress | null): string[] {
  if (!a) return [];
  const cityState = [a.city, a.state].filter((s) => s && s.trim() !== "").join(", ");
  const second = a.pin ? (cityState ? `${cityState} — ${a.pin}` : a.pin) : cityState;
  return [a.line, second].filter((s): s is string => !!s && s.trim() !== "");
}

function AddressBlock({ address }: { address?: PostalAddress | null }) {
  const lines = formatAddressLines(address);
  if (lines.length === 0) return <p className="mt-1 text-sm text-ink">—</p>;
  return (
    <div className="mt-1 space-y-0.5">
      {lines.map((l, i) => (
        <p key={i} className="text-sm text-ink">
          {l}
        </p>
      ))}
    </div>
  );
}

function maskAccountNumber(n?: string | null): string {
  if (!n) return "—";
  const digits = n.replace(/\s/g, "");
  return digits.length <= 4 ? `••••${digits}` : `••••${digits.slice(-4)}`;
}

function grossOf(c: SalaryComponents): number {
  return (
    c.basic +
    c.hra +
    c.allowances.reduce((s, a) => s + (a.amount || 0), 0) +
    (c.variablePay || 0)
  );
}

function AddRevisionDialog({
  employeeId,
  open,
  onClose,
  onSaved,
}: {
  employeeId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SalaryStructureInput>({
    resolver: zodResolver(salaryStructureSchema),
    defaultValues: {
      effectiveFrom: todayInTZ(),
      components: { basic: 0, hra: 0, allowances: [], deductions: [] },
    },
  });
  const {
    fields: allowFields,
    append: allowAppend,
    remove: allowRemove,
  } = useFieldArray({ control, name: "components.allowances" });
  const {
    fields: dedFields,
    append: dedAppend,
    remove: dedRemove,
  } = useFieldArray({ control, name: "components.deductions" });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (values: SalaryStructureInput) => {
    setSaving(true);
    try {
      await apiPost(`/employees/${employeeId}/salary-structures`, values);
      toast("Salary revision added", "success");
      close();
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to add revision", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add salary revision"
      description="The new structure takes effect from the date below."
      wide
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button loading={saving} onClick={handleSubmit(onSubmit)}>
            Save revision
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Effective from" required error={errors.effectiveFrom?.message}>
          <Input {...register("effectiveFrom")} type="date" />
        </FormField>
        <FormField label="Variable pay (annual)" error={errors.components?.variablePay?.message}>
          <Input
            {...register("components.variablePay", { valueAsNumber: true })}
            type="number"
            min={0}
            placeholder="0"
          />
        </FormField>
        <FormField label="Basic (monthly)" required error={errors.components?.basic?.message}>
          <Input
            {...register("components.basic", { valueAsNumber: true })}
            type="number"
            min={0}
            placeholder="0"
          />
        </FormField>
        <FormField label="HRA (monthly)" required error={errors.components?.hra?.message}>
          <Input
            {...register("components.hra", { valueAsNumber: true })}
            type="number"
            min={0}
            placeholder="0"
          />
        </FormField>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-inksoft">Allowances</h3>
          <Button size="sm" variant="outline" onClick={() => allowAppend({ label: "", amount: 0 })}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {allowFields.length === 0 && (
          <p className="text-xs text-faint">No allowances added.</p>
        )}
        <div className="space-y-2">
          {allowFields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input
                {...register(`components.allowances.${i}.label`)}
                placeholder="Label (e.g. Conveyance)"
                className="flex-1"
              />
              <Input
                {...register(`components.allowances.${i}.amount`, { valueAsNumber: true })}
                type="number"
                min={0}
                placeholder="Amount"
                className="w-32"
              />
              <button
                type="button"
                onClick={() => allowRemove(i)}
                className="rounded-lg p-2 text-faint hover:bg-danger-soft hover:text-danger"
                aria-label="Remove allowance"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-inksoft">Deductions</h3>
          <Button size="sm" variant="outline" onClick={() => dedAppend({ label: "", amount: 0 })}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {dedFields.length === 0 && <p className="text-xs text-faint">No deductions added.</p>}
        <div className="space-y-2">
          {dedFields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input
                {...register(`components.deductions.${i}.label`)}
                placeholder="Label (e.g. Professional tax)"
                className="flex-1"
              />
              <Input
                {...register(`components.deductions.${i}.amount`, { valueAsNumber: true })}
                type="number"
                min={0}
                placeholder="Amount"
                className="w-32"
              />
              <button
                type="button"
                onClick={() => dedRemove(i)}
                className="rounded-lg p-2 text-faint hover:bg-danger-soft hover:text-danger"
                aria-label="Remove deduction"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export default function EmployeeProfilePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const tz = user?.companyTimezone || DEFAULT_TZ;

  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [tab, setTab] = useState("overview");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [dateOfExit, setDateOfExit] = useState(todayInTZ());
  const [exitReason, setExitReason] = useState("");
  const [loginRole, setLoginRole] = useState<"employee" | "hr" | "md">("employee");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<ProfileResponse>(`/employees/${id}`);
      setProfile(r);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load employee", "error");
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const employee = profile?.employee;
  const isActive = employee?.employmentStatus === "active";
  const canManageLogin = hasRole("hr", "md");

  const doDeactivate = async () => {
    setWorking(true);
    try {
      await apiPost(`/employees/${id}/deactivate`, {
        dateOfExit,
        reason: exitReason.trim() || undefined,
      });
      toast("Employee deactivated", "success");
      setDeactivateOpen(false);
      setExitReason("");
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to deactivate", "error");
    } finally {
      setWorking(false);
    }
  };

  const doReactivate = async () => {
    setWorking(true);
    try {
      await apiPost(`/employees/${id}/reactivate`);
      toast("Employee reactivated", "success");
      setReactivateOpen(false);
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to reactivate", "error");
    } finally {
      setWorking(false);
    }
  };

  const doCreateLogin = async () => {
    setWorking(true);
    try {
      await apiPost(`/employees/${id}/create-login`, { role: loginRole });
      toast(`Login created with role ${roleLabel(loginRole)}`, "success");
      setLoginOpen(false);
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to create login", "error");
    } finally {
      setWorking(false);
    }
  };

  if (!profile || !employee) return <PageSkeleton />;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "attendance", label: "Attendance", count: profile.recentAttendance.length },
    { id: "leave", label: "Leave" },
    { id: "salary", label: "Salary history", count: profile.salaryStructures.length },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Employee Profile" backHref="/employees" />

      {/* Header card */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={employee.fullName} size="lg" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-ink md:text-[28px]">{employee.fullName}</h1>
                <StatusBadge status={employee.employmentStatus} />
              </div>
              <p className="mt-1 text-sm text-muted">
                {employee.employeeCode} · {employee.designation?.title ?? "No designation"} ·{" "}
                {employee.department?.name ?? "No department"}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {employee.workEmail}
                {employee.phone ? ` · ${employee.phone}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/employees/${id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            </Link>
            {isActive ? (
              <Button variant="outline" size="sm" onClick={() => setDeactivateOpen(true)}>
                <UserX className="h-4 w-4" /> Deactivate
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setReactivateOpen(true)}>
                <Check className="h-4 w-4" /> Reactivate
              </Button>
            )}
            {canManageLogin && !employee.user && (
              <Button size="sm" onClick={() => setLoginOpen(true)}>
                <LogIn className="h-4 w-4" /> Create login
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
              Personal
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailItem label="Full name" value={employee.fullName} />
              <DetailItem label="Employee code" value={employee.employeeCode} />
              <DetailItem label="Work email" value={employee.workEmail} />
              <DetailItem label="Phone" value={employee.phone || "—"} />
              <DetailItem label="Joining date" value={formatDate(employee.joiningDate)} />
              {employee.dateOfExit && (
                <DetailItem label="Date of exit" value={formatDate(employee.dateOfExit)} />
              )}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
              Employment
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailItem label="Department" value={employee.department?.name ?? "—"} />
              <DetailItem label="Designation" value={employee.designation?.title ?? "—"} />
              <DetailItem
                label="Manager"
                value={
                  employee.manager
                    ? `${employee.manager.fullName} (${employee.manager.employeeCode})`
                    : "—"
                }
              />
              <DetailItem label="Employment type" value={prettify(employee.employmentType)} />
              <DetailItem label="Status" value={<StatusBadge status={employee.employmentStatus} />} />
              <DetailItem
                label="PF applicable"
                value={employee.pfApplicable === null || employee.pfApplicable === undefined ? "Company default" : employee.pfApplicable ? "Yes" : "No"}
              />
              <DetailItem
                label="ESI applicable"
                value={employee.esiApplicable === null || employee.esiApplicable === undefined ? "Company default" : employee.esiApplicable ? "Yes" : "No"}
              />
              <DetailItem
                label="TDS deducted this FY"
                value={employee.tdsDeductedYtd != null ? formatINR(Number(employee.tdsDeductedYtd)) : "—"}
              />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
              Address
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-faint">Current</p>
                <AddressBlock address={employee.address?.current} />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-faint">Permanent</p>
                <AddressBlock address={employee.address?.permanent} />
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
              Emergency contact
            </h2>
            {employee.emergencyContact && Object.keys(employee.emergencyContact).length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(employee.emergencyContact).map(([k, v]) => (
                  <DetailItem key={k} label={prettify(k)} value={v} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-faint">No emergency contact on record.</p>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
              System login
            </h2>
            {employee.user ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <DetailItem label="Login email" value={employee.user.email} />
                <DetailItem label="Role" value={roleLabel(employee.user.role)} />
              </div>
            ) : (
              <p className="text-sm text-faint">
                No login created for this employee yet.
                {canManageLogin && " Use “Create login” above to grant access."}
              </p>
            )}
          </Card>
          {employee.bankDetails && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
                Banking
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <DetailItem label="Account holder" value={employee.bankDetails.accountHolder || "—"} />
                <DetailItem label="Bank" value={employee.bankDetails.bankName || "—"} />
                <DetailItem
                  label="Account number"
                  value={maskAccountNumber(employee.bankDetails.accountNumber)}
                />
                <DetailItem label="IFSC" value={employee.bankDetails.ifsc || "—"} />
                <DetailItem label="Branch" value={employee.bankDetails.branch || "—"} />
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "attendance" && (
        <Table<AttendanceRow>
          columns={[
            { key: "workDate", header: "Date", render: (r) => formatDate(r.workDate) },
            { key: "checkIn", header: "Check-in", render: (r) => formatTime(r.checkInAt, tz) },
            { key: "checkOut", header: "Check-out", render: (r) => formatTime(r.checkOutAt, tz) },
            {
              key: "working",
              header: "Working time",
              render: (r) => formatMinutes(r.workingMinutes),
            },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]}
          rows={profile.recentAttendance}
          rowKey={(r, i) => `${r.workDate}-${i}`}
          empty={
            <EmptyState
              icon={Clock}
              title="No attendance records"
              description="Recent check-in history will appear here."
            />
          }
        />
      )}

      {tab === "leave" && (
        <div className="space-y-4">
          <Table<LeaveBalance>
            columns={[
              { key: "leaveTypeName", header: "Leave type", render: (r) => r.leaveTypeName },
              { key: "year", header: "Year", render: (r) => r.year },
              {
                key: "balance",
                header: "Balance (days)",
                render: (r) => <Badge variant={r.balance > 0 ? "emerald" : "slate"}>{r.balance}</Badge>,
              },
            ]}
            rows={profile.leaveBalances}
            rowKey={(r) => r.leaveTypeId}
            empty={
              <EmptyState
                icon={Clock}
                title="No leave balances"
                description="Leave allocations for this employee will appear here."
              />
            }
          />
          <Link href="/leave/balances">
            <Button variant="outline" size="sm">
              View leave balances
            </Button>
          </Link>
        </div>
      )}

      {tab === "salary" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setRevisionOpen(true)}>
              <Plus className="h-4 w-4" /> Add revision
            </Button>
          </div>
          {profile.salaryStructures.length === 0 ? (
            <Card>
              <EmptyState
                icon={Wallet}
                title="No salary structures"
                description="Add the first salary structure to start tracking revisions."
                action={
                  <Button size="sm" onClick={() => setRevisionOpen(true)}>
                    <Plus className="h-4 w-4" /> Add revision
                  </Button>
                }
              />
            </Card>
          ) : (
            profile.salaryStructures.map((s) => {
              const c = s.components;
              const gross = grossOf(c);
              const dedTotal = c.deductions.reduce((t, d) => t + (d.amount || 0), 0);
              return (
                <Card key={s.id} className="p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold tracking-tight text-ink">
                      Effective {formatDate(s.effectiveFrom)}
                    </p>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                    <div className="flex justify-between">
                      <span className="text-muted">Basic</span>
                      <span className="font-medium text-ink">{formatINR(c.basic)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">HRA</span>
                      <span className="font-medium text-ink">{formatINR(c.hra)}</span>
                    </div>
                    {c.allowances.map((a, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="text-muted">{a.label || "Allowance"}</span>
                        <span className="font-medium text-ink">{formatINR(a.amount)}</span>
                      </div>
                    ))}
                    {(c.variablePay || 0) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted">Variable pay</span>
                        <span className="font-medium text-ink">{formatINR(c.variablePay)}</span>
                      </div>
                    )}
                    {c.deductions.map((d, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="text-muted">{d.label || "Deduction"}</span>
                        <span className="font-medium text-danger">−{formatINR(d.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
                    <span className="font-semibold text-inksoft">Net monthly</span>
                    <span className="font-semibold text-accent-ink">{formatINR(gross - dedTotal)}</span>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Recent attendance
            </h2>
            {profile.recentAttendance.length === 0 ? (
              <p className="text-sm text-faint">No attendance records yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {profile.recentAttendance.slice(0, 8).map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-inksoft">
                      {formatDate(a.workDate)}{" "}
                      <span className="text-faint">
                        · in {formatTime(a.checkInAt, tz)} · out {formatTime(a.checkOutAt, tz)}
                      </span>
                    </span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Leave balances
            </h2>
            {profile.leaveBalances.length === 0 ? (
              <p className="text-sm text-faint">No leave balances yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {profile.leaveBalances.map((b) => (
                  <li key={b.leaveTypeId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-inksoft">
                      {b.leaveTypeName} <span className="text-faint">· {b.year}</span>
                    </span>
                    <Badge variant={b.balance > 0 ? "emerald" : "slate"}>
                      {b.balance} {b.balance === 1 ? "day" : "days"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Deactivate dialog */}
      <Dialog
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        title="Deactivate employee"
        description={`${employee.fullName} will be marked as exited and lose access.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeactivateOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={working} onClick={doDeactivate}>
              Deactivate
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Date of exit" required>
            <Input type="date" value={dateOfExit} onChange={(e) => setDateOfExit(e.target.value)} />
          </FormField>
          <FormField label="Reason" hint="Optional — recorded for audit">
            <Textarea
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
              placeholder="e.g. Resigned, notice served"
            />
          </FormField>
        </div>
      </Dialog>

      {/* Reactivate dialog */}
      <Dialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        title="Reactivate employee"
        description={`${employee.fullName} will be marked active again.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setReactivateOpen(false)}>
              Cancel
            </Button>
            <Button loading={working} onClick={doReactivate}>
              Reactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          This clears the exit record and restores the employee to active status.
        </p>
      </Dialog>

      {/* Create login dialog */}
      <Dialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        title="Create login"
        description={`Grant ${employee.fullName} access to the workspace.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setLoginOpen(false)}>
              Cancel
            </Button>
            <Button loading={working} onClick={doCreateLogin}>
              Create login
            </Button>
          </>
        }
      >
        <FormField label="Role" required hint="Determines what the employee can see and do">
          <Select value={loginRole} onChange={(e) => setLoginRole(e.target.value as typeof loginRole)}>
            <option value="employee">Employee</option>
            <option value="hr">HR</option>
            <option value="md">Managing Director (MD)</option>
          </Select>
        </FormField>
      </Dialog>

      <AddRevisionDialog
        employeeId={id}
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
