"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import {
  departmentSchema,
  designationSchema,
  type DepartmentInput,
  type DesignationInput,
} from "@hrms/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { FormField } from "@/components/ui/FormField";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface Department {
  id: string;
  name: string;
  _count: { employees: number };
}

interface Designation {
  id: string;
  title: string;
  level: number;
}

export default function DepartmentsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("departments");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptDialog, setDeptDialog] = useState<{ mode: "add" } | { mode: "edit"; item: Department } | null>(null);
  const [desgDialog, setDesgDialog] = useState<{ mode: "add" } | { mode: "edit"; item: Designation } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "department" | "designation";
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [depts, desgs] = await Promise.all([
        apiGet<Department[]>("/admin/departments"),
        apiGet<Designation[]>("/admin/designations"),
      ]);
      setDepartments(depts);
      setDesignations(desgs);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const deptForm = useForm<DepartmentInput>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "" },
  });
  const desgForm = useForm<DesignationInput>({
    resolver: zodResolver(designationSchema),
    defaultValues: { title: "", level: 0 },
  });

  useEffect(() => {
    if (!deptDialog) return;
    deptForm.reset(
      deptDialog.mode === "edit" ? { name: deptDialog.item.name } : { name: "" },
    );
  }, [deptDialog, deptForm]);

  useEffect(() => {
    if (!desgDialog) return;
    desgForm.reset(
      desgDialog.mode === "edit"
        ? { title: desgDialog.item.title, level: desgDialog.item.level }
        : { title: "", level: 0 },
    );
  }, [desgDialog, desgForm]);

  const saveDepartment = async (values: DepartmentInput) => {
    try {
      if (deptDialog?.mode === "edit") {
        await apiPatch(`/admin/departments/${deptDialog.item.id}`, values);
        toast("Department updated", "success");
      } else {
        await apiPost("/admin/departments", values);
        toast("Department added", "success");
      }
      setDeptDialog(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to save department", "error");
    }
  };

  const saveDesignation = async (values: DesignationInput) => {
    try {
      if (desgDialog?.mode === "edit") {
        await apiPatch(`/admin/designations/${desgDialog.item.id}`, values);
        toast("Designation updated", "success");
      } else {
        await apiPost("/admin/designations", values);
        toast("Designation added", "success");
      }
      setDesgDialog(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to save designation", "error");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const path =
        confirmDelete.kind === "department"
          ? `/admin/departments/${confirmDelete.id}`
          : `/admin/designations/${confirmDelete.id}`;
      await apiDelete(path);
      toast(
        `${confirmDelete.kind === "department" ? "Department" : "Designation"} deleted`,
        "success",
      );
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to delete", "error");
    } finally {
      setDeleting(false);
    }
  };

  const actionButtons = (
    onEdit: () => void,
    onDelete: () => void,
  ) => (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger hover:text-danger"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
    </div>
  );

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Departments & Designations"
        description="Organise employees into departments and define job levels"
      />

      <Tabs
        tabs={[
          { id: "departments", label: "Departments", count: departments.length },
          { id: "designations", label: "Designations", count: designations.length },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === "departments" && (
        <>
          <div className="mb-4 flex justify-end">
            <Button onClick={() => setDeptDialog({ mode: "add" })}>
              <Plus className="h-4 w-4" /> Add department
            </Button>
          </div>
          <Table<Department>
            columns={[
              {
                key: "name",
                header: "Name",
                render: (d) => <span className="font-medium text-ink">{d.name}</span>,
              },
              {
                key: "employees",
                header: "Employees",
                render: (d) => <span className="tabular-nums">{d._count.employees}</span>,
              },
              {
                key: "actions",
                header: "",
                className: "text-right tabular-nums",
                render: (d) =>
                  actionButtons(
                    () => setDeptDialog({ mode: "edit", item: d }),
                    () => setConfirmDelete({ kind: "department", id: d.id, name: d.name }),
                  ),
              },
            ]}
            rows={departments}
            rowKey={(d) => d.id}
            empty={
              <EmptyState
                icon={Building2}
                title="No departments yet"
                description="Create departments to organise your employees."
                action={
                  <Button onClick={() => setDeptDialog({ mode: "add" })}>
                    <Plus className="h-4 w-4" /> Add department
                  </Button>
                }
              />
            }
          />
        </>
      )}

      {tab === "designations" && (
        <>
          <div className="mb-4 flex justify-end">
            <Button onClick={() => setDesgDialog({ mode: "add" })}>
              <Plus className="h-4 w-4" /> Add designation
            </Button>
          </div>
          <Table<Designation>
            columns={[
              {
                key: "title",
                header: "Title",
                render: (d) => <span className="font-medium text-ink">{d.title}</span>,
              },
              {
                key: "level",
                header: "Level",
                render: (d) => <span className="tabular-nums">{d.level}</span>,
              },
              {
                key: "actions",
                header: "",
                className: "text-right tabular-nums",
                render: (d) =>
                  actionButtons(
                    () => setDesgDialog({ mode: "edit", item: d }),
                    () => setConfirmDelete({ kind: "designation", id: d.id, name: d.title }),
                  ),
              },
            ]}
            rows={designations}
            rowKey={(d) => d.id}
            empty={
              <EmptyState
                title="No designations yet"
                description="Define job titles and their seniority levels."
                action={
                  <Button onClick={() => setDesgDialog({ mode: "add" })}>
                    <Plus className="h-4 w-4" /> Add designation
                  </Button>
                }
              />
            }
          />
        </>
      )}

      {/* Department dialog */}
      <Dialog
        open={deptDialog !== null}
        onClose={() => setDeptDialog(null)}
        title={deptDialog?.mode === "edit" ? "Edit department" : "Add department"}
      >
        <form onSubmit={deptForm.handleSubmit(saveDepartment)} className="space-y-4">
          <FormField label="Name" required error={deptForm.formState.errors.name?.message}>
            <Input {...deptForm.register("name")} placeholder="Engineering" />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDeptDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={deptForm.formState.isSubmitting}>
              {deptDialog?.mode === "edit" ? "Save changes" : "Add department"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Designation dialog */}
      <Dialog
        open={desgDialog !== null}
        onClose={() => setDesgDialog(null)}
        title={desgDialog?.mode === "edit" ? "Edit designation" : "Add designation"}
      >
        <form onSubmit={desgForm.handleSubmit(saveDesignation)} className="space-y-4">
          <FormField label="Title" required error={desgForm.formState.errors.title?.message}>
            <Input {...desgForm.register("title")} placeholder="Senior Engineer" />
          </FormField>
          <FormField
            label="Level"
            error={desgForm.formState.errors.level?.message}
            hint="Higher number = more senior"
          >
            <Input
              type="number"
              {...desgForm.register("level", { valueAsNumber: true })}
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDesgDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={desgForm.formState.isSubmitting}>
              {desgDialog?.mode === "edit" ? "Save changes" : "Add designation"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.kind ?? ""}`}
      >
        <p className="text-sm text-muted">
          Delete <span className="font-medium text-ink">{confirmDelete?.name}</span>? This
          cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} loading={deleting}>
            Delete
          </Button>
        </div>
      </Dialog>
    </>
  );
}
