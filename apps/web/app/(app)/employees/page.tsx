"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Upload, Users } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterPills } from "@/components/ui/FilterPills";
import { Select } from "@/components/ui/Select";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  phone?: string | null;
  joiningDate: string;
  department: { id: string; name: string } | null;
  designation: { id: string; title: string } | null;
  manager: { id: string; fullName: string; employeeCode: string } | null;
  employmentStatus: string;
  employmentType: string;
  dateOfExit?: string | null;
  pfApplicable?: boolean | null;
  esiApplicable?: boolean | null;
  tdsDeductedYtd?: number | null;
}

interface EmployeesResponse {
  data: EmployeeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface Department {
  id: string;
  name: string;
  _count?: { employees: number };
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "on_notice", label: "On notice" },
  { value: "exited", label: "Exited" },
];

export default function EmployeesPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [rows, setRows] = useState<EmployeeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[] | null>(null);

  // Debounce search typing
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Departments (fetch may be forbidden for some roles — hide the filter then)
  useEffect(() => {
    (async () => {
      try {
        const d = await apiGet<Department[]>("/admin/departments");
        setDepartments(d);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 403)) {
          toast(e instanceof ApiError ? e.message : "Failed to load departments", "error");
        }
        setDepartments(null);
      }
    })();
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<EmployeesResponse>("/employees", {
        search: search || undefined,
        departmentId: departmentId || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(r.data ?? []);
      setTotal(r.total ?? 0);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load employees", "error");
    } finally {
      setLoading(false);
    }
  }, [search, status, departmentId, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Employees"
        description={`${total} ${total === 1 ? "employee" : "employees"} in the directory`}
        action={
          <>
            <Link href="/employees/import">
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4" /> Import
              </Button>
            </Link>
            <Link href="/employees/new">
              <Button size="sm">
                <Plus className="h-4 w-4" /> Add employee
              </Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          className="w-full sm:w-72"
          placeholder="Search name, code or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {departments && (
          <Select
            className="w-full sm:w-56"
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by department"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="mb-4">
        <FilterPills
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : (
        <>
          <Table<EmployeeListItem>
            columns={[
              {
                key: "employee",
                header: "Employee",
                render: (r) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={r.fullName} size="sm" />
                    <div>
                      <p className="font-medium text-ink">{r.fullName}</p>
                      <p className="text-xs text-muted">{r.employeeCode}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: "department",
                header: "Department",
                render: (r) => r.department?.name ?? "—",
              },
              {
                key: "designation",
                header: "Designation",
                render: (r) => r.designation?.title ?? "—",
              },
              {
                key: "manager",
                header: "Manager",
                render: (r) => r.manager?.fullName ?? "—",
              },
              {
                key: "status",
                header: "Status",
                render: (r) => <StatusBadge status={r.employmentStatus} />,
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/employees/${r.id}`)}
            empty={
              <EmptyState
                icon={Users}
                title="No employees found"
                description={
                  search || status || departmentId
                    ? "Try adjusting your search or filters."
                    : "Add your first employee to get started."
                }
                action={
                  !search && !status && !departmentId ? (
                    <Link href="/employees/new">
                      <Button size="sm">
                        <Plus className="h-4 w-4" /> Add employee
                      </Button>
                    </Link>
                  ) : undefined
                }
              />
            }
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
