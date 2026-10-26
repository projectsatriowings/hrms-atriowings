"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Umbrella } from "lucide-react";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { leaveTypeSchema, type LeaveTypeInput } from "@hrms/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { FormField } from "@/components/ui/FormField";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface LeaveType {
  id: string;
  code: string;
  name: string;
  defaultDays: number;
  carryForward: boolean;
  maxCarryDays: number | null;
  isActive: boolean;
}

export default function LeaveTypesPage() {
  const { toast } = useToast();
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; item: LeaveType } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<LeaveType[]>("/leave/types");
      setLeaveTypes(Array.isArray(res) ? res : []);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load leave types", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LeaveTypeInput>({
    resolver: zodResolver(leaveTypeSchema),
    defaultValues: {
      code: "",
      name: "",
      defaultDays: 0,
      carryForward: false,
      maxCarryDays: null,
      isActive: true,
    },
  });

  useEffect(() => {
    if (!dialog) return;
    if (dialog.mode === "edit") {
      const t = dialog.item;
      reset({
        code: t.code,
        name: t.name,
        defaultDays: t.defaultDays,
        carryForward: t.carryForward,
        maxCarryDays: t.maxCarryDays,
        isActive: t.isActive,
      });
    } else {
      reset({
        code: "",
        name: "",
        defaultDays: 0,
        carryForward: false,
        maxCarryDays: null,
        isActive: true,
      });
    }
  }, [dialog, reset]);

  const onSubmit = async (values: LeaveTypeInput) => {
    try {
      if (dialog?.mode === "edit") {
        await apiPatch(`/leave/types/${dialog.item.id}`, values);
        toast("Leave type updated", "success");
      } else {
        await apiPost("/leave/types", values);
        toast("Leave type added", "success");
      }
      setDialog(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to save leave type", "error");
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Leave Types"
        description="Define the leave categories employees can apply for"
        action={
          <Button onClick={() => setDialog({ mode: "add" })}>
            <Plus className="h-4 w-4" /> Add leave type
          </Button>
        }
      />

      <Table<LeaveType>
        columns={[
          {
            key: "code",
            header: "Code",
            render: (t) => <span className="font-mono text-xs font-semibold tracking-tight text-ink">{t.code}</span>,
          },
          {
            key: "name",
            header: "Name",
            render: (t) => <span className="font-medium text-ink">{t.name}</span>,
          },
          {
            key: "defaultDays",
            header: "Default days",
            render: (t) => <span className="tabular-nums">{t.defaultDays}</span>,
          },
          {
            key: "carryForward",
            header: "Carry forward",
            render: (t) => (t.carryForward ? "Yes" : "No"),
          },
          {
            key: "maxCarryDays",
            header: "Max carry",
            render: (t) => <span className="tabular-nums">{t.maxCarryDays ?? "—"}</span>,
          },
          {
            key: "isActive",
            header: "Status",
            render: (t) =>
              t.isActive ? (
                <Badge variant="emerald">Active</Badge>
              ) : (
                <Badge variant="slate">Inactive</Badge>
              ),
          },
          {
            key: "actions",
            header: "",
            className: "text-right tabular-nums",
            render: (t) => (
              <Button size="sm" variant="ghost" onClick={() => setDialog({ mode: "edit", item: t })}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            ),
          },
        ]}
        rows={leaveTypes}
        rowKey={(t) => t.id}
        empty={
          <EmptyState
            icon={Umbrella}
            title="No leave types yet"
            description="Add leave types like Casual, Sick or Earned leave."
            action={
              <Button onClick={() => setDialog({ mode: "add" })}>
                <Plus className="h-4 w-4" /> Add leave type
              </Button>
            }
          />
        }
      />

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === "edit" ? "Edit leave type" : "Add leave type"}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Code" required error={errors.code?.message} hint="e.g. CL, SL, EL">
              <Input {...register("code")} placeholder="CL" />
            </FormField>
            <FormField label="Name" required error={errors.name?.message}>
              <Input {...register("name")} placeholder="Casual Leave" />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default days per year" error={errors.defaultDays?.message}>
              <Input
                type="number"
                min={0}
                step="any"
                {...register("defaultDays", { valueAsNumber: true })}
              />
            </FormField>
            <FormField label="Max carry days" error={errors.maxCarryDays?.message}>
              <Input
                type="number"
                min={0}
                step="any"
                placeholder="No limit"
                {...register("maxCarryDays", {
                  setValueAs: (v) => (v === "" || v === undefined ? null : Number(v)),
                })}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-inksoft">
            <input
              type="checkbox"
              {...register("carryForward")}
              className="h-4 w-4 rounded border-line accent-accent"
            />
            Allow unused days to carry forward to next year
          </label>
          <label className="flex items-center gap-2 text-sm text-inksoft">
            <input
              type="checkbox"
              {...register("isActive")}
              className="h-4 w-4 rounded border-line accent-accent"
            />
            Active (employees can apply for this leave)
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {dialog?.mode === "edit" ? "Save changes" : "Add leave type"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
