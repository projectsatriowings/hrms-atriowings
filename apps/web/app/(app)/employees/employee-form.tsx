"use client";

import { useEffect, useState } from "react";
import { type UseFormRegister, type FieldErrors, type Path } from "react-hook-form";
import { type CreateEmployeeInput } from "@hrms/shared";
import { apiGet } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { prettify } from "@/lib/format";
import type { EmployeeListItem } from "./page";

export interface DepartmentOpt {
  id: string;
  name: string;
}

export interface DesignationOpt {
  id: string;
  title: string;
  level?: number | null;
}

export interface EmployeeLookups {
  departments: DepartmentOpt[];
  designations: DesignationOpt[];
  managers: EmployeeListItem[];
  loading: boolean;
}

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"];

type AddressPart = "line" | "city" | "state" | "pin";

/** Address line / city / state / PIN fields for one address (current or permanent). */
export function AddressFields({
  register,
  errors,
  which,
}: {
  register: UseFormRegister<CreateEmployeeInput>;
  errors: FieldErrors<CreateEmployeeInput>;
  which: "current" | "permanent";
}) {
  const sub = (errors.address?.[which] ?? {}) as unknown as Record<
    string,
    { message?: string } | undefined
  >;
  const field = (f: AddressPart) => `address.${which}.${f}` as Path<CreateEmployeeInput>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Address line" error={sub.line?.message} className="sm:col-span-2">
        <Input {...register(field("line"))} placeholder="Flat / street / area" />
      </FormField>
      <FormField label="City" error={sub.city?.message}>
        <Input {...register(field("city"))} placeholder="e.g. Chennai" />
      </FormField>
      <FormField label="State" error={sub.state?.message}>
        <Input {...register(field("state"))} placeholder="e.g. Tamil Nadu" />
      </FormField>
      <FormField label="PIN code" error={sub.pin?.message}>
        <Input {...register(field("pin"))} inputMode="numeric" placeholder="e.g. 600102" />
      </FormField>
    </div>
  );
}

/** Bank account fields used for salary payment (all optional). */
export function BankDetailsFields({
  register,
  errors,
}: {
  register: UseFormRegister<CreateEmployeeInput>;
  errors: FieldErrors<CreateEmployeeInput>;
}) {
  const be = errors.bankDetails ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Account holder name" error={be.accountHolder?.message}>
        <Input {...register("bankDetails.accountHolder")} placeholder="Name as on the account" />
      </FormField>
      <FormField label="Bank name" error={be.bankName?.message}>
        <Input {...register("bankDetails.bankName")} placeholder="e.g. HDFC Bank" />
      </FormField>
      <FormField label="Account number" error={be.accountNumber?.message}>
        <Input {...register("bankDetails.accountNumber")} inputMode="numeric" placeholder="Account number" />
      </FormField>
      <FormField label="IFSC" error={be.ifsc?.message}>
        <Input {...register("bankDetails.ifsc")} placeholder="e.g. HDFC0001234" className="uppercase" />
      </FormField>
      <FormField label="Branch" error={be.branch?.message}>
        <Input {...register("bankDetails.branch")} placeholder="e.g. Anna Nagar" />
      </FormField>
    </div>
  );
}

/** Shared sectioned fields used by both Add and Edit employee pages. */
export function EmployeeFormFields({
  register,
  errors,
  lookups,
}: {
  register: UseFormRegister<CreateEmployeeInput>;
  errors: FieldErrors<CreateEmployeeInput>;
  lookups: EmployeeLookups;
}) {
  const ecErrors = (errors.emergencyContact ?? {}) as unknown as Record<
    string,
    { message?: string } | undefined
  >;
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">Personal</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" required error={errors.fullName?.message}>
            <Input {...register("fullName")} placeholder="e.g. Priya Raman" />
          </FormField>
          <FormField label="Work email" required error={errors.workEmail?.message}>
            <Input {...register("workEmail")} type="email" placeholder="priya@company.com" />
          </FormField>
          <FormField label="Phone" error={errors.phone?.message}>
            <Input {...register("phone")} placeholder="+91 98765 43210" />
          </FormField>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">Employment</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Employee code" required error={errors.employeeCode?.message}>
            <Input {...register("employeeCode")} placeholder="e.g. EMP001" />
          </FormField>
          <FormField label="Joining date" required error={errors.joiningDate?.message}>
            <Input {...register("joiningDate")} type="date" />
          </FormField>
          <FormField label="Employment type" error={errors.employmentType?.message}>
            <Select {...register("employmentType")}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {prettify(t)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Department" error={errors.departmentId?.message}>
            <Select {...register("departmentId")} disabled={lookups.loading}>
              <option value="">Select department…</option>
              {lookups.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Designation" error={errors.designationId?.message}>
            <Select {...register("designationId")} disabled={lookups.loading}>
              <option value="">Select designation…</option>
              {lookups.designations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Manager" error={errors.managerId?.message}>
            <Select {...register("managerId")} disabled={lookups.loading}>
              <option value="">No manager</option>
              {lookups.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName} ({m.employeeCode})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="PF applicable"
            error={(errors as unknown as Record<string, { message?: string }>).pfApplicable?.message}
            hint="Company default unless overridden"
          >
            <Select {...register("pfApplicable", { setValueAs: (v) => (v === "" ? null : v === "true") })}>
              <option value="">Company default</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </FormField>
          <FormField
            label="ESI applicable"
            error={(errors as unknown as Record<string, { message?: string }>).esiApplicable?.message}
            hint="Company default unless overridden"
          >
            <Select {...register("esiApplicable", { setValueAs: (v) => (v === "" ? null : v === "true") })}>
              <option value="">Company default</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </FormField>
          <FormField
            label="TDS deducted this FY (₹)"
            error={(errors as unknown as Record<string, { message?: string }>).tdsDeductedYtd?.message}
            hint="Already deducted this financial year; netted off at payroll compute"
          >
            <Input type="number" step="0.01" min="0" {...register("tdsDeductedYtd", { setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)) })} placeholder="0" />
          </FormField>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Emergency contact
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Contact name" error={ecErrors.name?.message}>
            <Input {...register("emergencyContact.name")} placeholder="Contact person" />
          </FormField>
          <FormField label="Contact phone" error={ecErrors.phone?.message}>
            <Input {...register("emergencyContact.phone")} placeholder="+91 98765 43210" />
          </FormField>
          <FormField label="Relationship" error={ecErrors.relationship?.message}>
            <Input {...register("emergencyContact.relationship")} placeholder="e.g. Spouse" />
          </FormField>
        </div>
      </Card>
    </div>
  );
}

/** Fetch departments / designations / managers for the employee forms. */
export function useEmployeeLookups(excludeId?: string): EmployeeLookups {
  const [departments, setDepartments] = useState<DepartmentOpt[]>([]);
  const [designations, setDesignations] = useState<DesignationOpt[]>([]);
  const [managers, setManagers] = useState<EmployeeListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [depts, desigs, emps] = await Promise.all([
          apiGet<DepartmentOpt[]>("/admin/departments").catch(() => [] as DepartmentOpt[]),
          apiGet<DesignationOpt[]>("/admin/designations").catch(() => [] as DesignationOpt[]),
          apiGet<{ data: EmployeeListItem[] }>("/employees", {
            pageSize: 100,
            status: "active",
          }).catch(() => ({ data: [] as EmployeeListItem[] })),
        ]);
        setDepartments(depts);
        setDesignations(desigs);
        setManagers(emps.data.filter((e) => e.id !== excludeId));
      } finally {
        setLoading(false);
      }
    })();
  }, [excludeId]);

  return { departments, designations, managers, loading };
}

/** Keep only non-empty trimmed string entries of an optional nested object. */
function cleanStringRecord(o: unknown): Record<string, string> | undefined {
  if (!o || typeof o !== "object") return undefined;
  const kept = Object.fromEntries(
    Object.entries(o as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" && v.trim() !== "")
      .map(([k, v]) => [k, (v as string).trim()]),
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Strip empty optional fields so the API receives clean payloads. */
export function cleanEmployeePayload<T extends Record<string, unknown>>(v: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v };
  for (const k of ["phone", "departmentId", "designationId", "managerId"]) {
    if (out[k] === "" || out[k] === undefined) delete out[k];
  }
  const ec = cleanStringRecord(out.emergencyContact);
  if (ec) out.emergencyContact = ec;
  else delete out.emergencyContact;

  const addr = out.address as { current?: unknown; permanent?: unknown } | undefined;
  if (addr) {
    const current = cleanStringRecord(addr.current);
    const permanent = cleanStringRecord(addr.permanent);
    const cleaned: Record<string, unknown> = {};
    if (current) cleaned.current = current;
    if (permanent) cleaned.permanent = permanent;
    if (Object.keys(cleaned).length > 0) out.address = cleaned;
    else delete out.address;
  }

  const bank = cleanStringRecord(out.bankDetails);
  if (bank) out.bankDetails = bank;
  else delete out.bankDetails;

  return out;
}
