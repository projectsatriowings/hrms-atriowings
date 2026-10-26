"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type UseFormRegister, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateEmployeeSchema,
  type UpdateEmployeeInput,
  type CreateEmployeeInput,
  type EmployeeAddress,
  type BankDetails,
} from "@hrms/shared";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";
import {
  AddressFields,
  BankDetailsFields,
  EmployeeFormFields,
  useEmployeeLookups,
  cleanEmployeePayload,
} from "../../employee-form";
import type { EmployeeListItem } from "../../page";

interface EmployeeDetailResponse {
  employee: EmployeeListItem & {
    emergencyContact?: Record<string, string> | null;
    address?: EmployeeAddress | null;
    bankDetails?: BankDetails | null;
  };
}

const emptyAddress = { line: "", city: "", state: "", pin: "" };

export default function EditEmployeePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { toast } = useToast();
  const lookups = useEmployeeLookups(id);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateEmployeeInput>({
    resolver: zodResolver(updateEmployeeSchema),
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await apiGet<EmployeeDetailResponse>(`/employees/${id}`);
        const e = r.employee;
        setName(e.fullName);
        reset({
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          workEmail: e.workEmail,
          phone: e.phone ?? "",
          joiningDate: e.joiningDate?.slice(0, 10),
          departmentId: e.department?.id ?? "",
          designationId: e.designation?.id ?? "",
          managerId: e.manager?.id ?? "",
          employmentType: e.employmentType ?? "full_time",
          pfApplicable: e.pfApplicable ?? null,
          esiApplicable: e.esiApplicable ?? null,
          tdsDeductedYtd: e.tdsDeductedYtd != null ? Number(e.tdsDeductedYtd) : undefined,
          emergencyContact: {
            name: e.emergencyContact?.name ?? "",
            phone: e.emergencyContact?.phone ?? "",
            relationship: e.emergencyContact?.relationship ?? "",
          },
          address: {
            current: { ...emptyAddress, ...(e.address?.current ?? {}) },
            permanent: { ...emptyAddress, ...(e.address?.permanent ?? {}) },
          },
          bankDetails: {
            accountHolder: e.bankDetails?.accountHolder ?? "",
            bankName: e.bankDetails?.bankName ?? "",
            accountNumber: e.bankDetails?.accountNumber ?? "",
            ifsc: e.bankDetails?.ifsc ?? "",
            branch: e.bankDetails?.branch ?? "",
          },
        });
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load employee", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, reset, toast]);

  const onSubmit = async (values: UpdateEmployeeInput) => {
    setSubmitting(true);
    try {
      await apiPatch(`/employees/${id}`, cleanEmployeePayload(values));
      toast("Employee updated", "success");
      router.push(`/employees/${id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to update employee", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || lookups.loading) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title={name ? `Edit ${name}` : "Edit employee"}
        description="Update the employee's details."
        backHref={`/employees/${id}`}
      />
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-3xl">
        <EmployeeFormFields
          register={register as unknown as UseFormRegister<CreateEmployeeInput>}
          errors={errors as unknown as FieldErrors<CreateEmployeeInput>}
          lookups={lookups}
        />
        <div className="mt-6 space-y-6">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">Address</h2>
            <h3 className="mb-3 text-sm font-semibold text-inksoft">Current address</h3>
            <AddressFields
              register={register as unknown as UseFormRegister<CreateEmployeeInput>}
              errors={errors as unknown as FieldErrors<CreateEmployeeInput>}
              which="current"
            />
            <h3 className="mb-3 mt-6 text-sm font-semibold text-inksoft">Permanent address</h3>
            <AddressFields
              register={register as unknown as UseFormRegister<CreateEmployeeInput>}
              errors={errors as unknown as FieldErrors<CreateEmployeeInput>}
              which="permanent"
            />
          </Card>
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Banking</h2>
            <p className="mb-4 text-sm text-muted">Used for salary payment. All fields are optional.</p>
            <BankDetailsFields
              register={register as unknown as UseFormRegister<CreateEmployeeInput>}
              errors={errors as unknown as FieldErrors<CreateEmployeeInput>}
            />
          </Card>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(`/employees/${id}`)}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
