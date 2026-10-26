"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, ShieldCheck } from "lucide-react";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatDateTime, roleLabel, ROLE_LABELS_LONG } from "@/lib/format";
import { createUserSchema, roleSchema, type Role } from "@hrms/shared";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { FormField } from "@/components/ui/FormField";
import { StatusBadge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface AppUser {
  id: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  lastLoginAt?: string | null;
  employee: { id: string; fullName: string; employeeCode: string } | null;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const userFormSchema = createUserSchema.extend({
  employeeId: z.preprocess(blankToUndef, z.string().optional()),
});

type UserFormValues = z.infer<typeof userFormSchema>;

const ROLES: Role[] = roleSchema.options;
const PAGE_SIZE = 20;

export default function UsersPage() {
  const { toast } = useToast();
  const { hasRole } = useAuth();
  const isMd = hasRole("md");

  const [users, setUsers] = useState<AppUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await apiGet<{ data: AppUser[]; total: number; page: number }>("/users", {
          page: p,
          pageSize: PAGE_SIZE,
        });
        setUsers(res.data);
        setTotal(res.total ?? res.data.length);
        setPage(res.page ?? p);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load users", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  useEffect(() => {
    if (!addOpen) return;
    (async () => {
      try {
        const res = await apiGet<{ data: EmployeeOption[] }>("/employees", {
          page: 1,
          pageSize: 100,
        });
        setEmployees(Array.isArray(res.data) ? res.data : []);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load employees", "error");
      }
    })();
  }, [addOpen, toast]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: { email: "", password: "", role: "employee", employeeId: "" },
  });

  useEffect(() => {
    if (addOpen) reset({ email: "", password: "", role: "employee", employeeId: "" });
  }, [addOpen, reset]);

  const changeRole = async (user: AppUser, role: Role) => {
    if (role === user.role) return;
    try {
      await apiPatch(`/users/${user.id}/role`, { role });
      toast(`Role updated to ${roleLabel(role)}`, "success");
      load(page);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to update role", "error");
    }
  };

  const toggleStatus = async (user: AppUser) => {
    const status = user.status === "active" ? "disabled" : "active";
    try {
      await apiPatch(`/users/${user.id}/status`, { status });
      toast(
        status === "active" ? "User activated" : "User deactivated",
        "success",
      );
      load(page);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to update status", "error");
    }
  };

  const onSubmit = async (values: UserFormValues) => {
    try {
      await apiPost("/users", values);
      toast("User created", "success");
      setAddOpen(false);
      load(1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to create user", "error");
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Users & Permissions"
        description={
          isMd
            ? "Manage logins, roles and account status"
            : "View logins and roles (MD-only actions are disabled)"
        }
        action={
          isMd ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add user
            </Button>
          ) : undefined
        }
      />

      <Table<AppUser>
        columns={[
          {
            key: "email",
            header: "Email",
            render: (u) => <span className="font-medium text-ink">{u.email}</span>,
          },
          {
            key: "employee",
            header: "Linked employee",
            render: (u) =>
              u.employee ? (
                <div>
                  <p className="text-ink">{u.employee.fullName}</p>
                  <p className="font-mono text-xs text-muted">{u.employee.employeeCode}</p>
                </div>
              ) : (
                <span className="text-faint">—</span>
              ),
          },
          {
            key: "role",
            header: "Role",
            render: (u) => (
              <Select
                value={u.role}
                disabled={!isMd}
                title={isMd ? undefined : "MD only"}
                onChange={(e) => changeRole(u, e.target.value as Role)}
                className="w-auto"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS_LONG[r]}
                  </option>
                ))}
              </Select>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (u) => (
              <div className="flex items-center gap-2">
                <StatusBadge status={u.status} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isMd}
                  title={isMd ? undefined : "MD only"}
                  onClick={() => toggleStatus(u)}
                >
                  {u.status === "active" ? "Deactivate" : "Activate"}
                </Button>
              </div>
            ),
          },
          {
            key: "lastLoginAt",
            header: "Last login",
            render: (u) => <span className="whitespace-nowrap">{formatDateTime(u.lastLoginAt)}</span>,
          },
        ]}
        rows={users}
        rowKey={(u) => u.id}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title="No users found"
            description={isMd ? "Add the first login for your team." : undefined}
            action={
              isMd ? (
                <Button onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" /> Add user
                </Button>
              ) : undefined
            }
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={load} />

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add user">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Email" required error={errors.email?.message}>
            <Input {...register("email")} type="email" placeholder="teammate@company.in" />
          </FormField>
          <FormField
            label="Password"
            required
            error={errors.password?.message}
            hint="Minimum 8 characters"
          >
            <Input {...register("password")} type="password" placeholder="••••••••" />
          </FormField>
          <FormField label="Role" error={errors.role?.message}>
            <Select {...register("role")}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS_LONG[r]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Linked employee"
            error={errors.employeeId?.message}
            hint="Optional — link this login to an employee profile"
          >
            <Select {...register("employeeId")}>
              <option value="">None</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} ({e.employeeCode})
                </option>
              ))}
            </Select>
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Create user
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
