"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, CalendarX } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { Dialog } from "@/components/ui/Dialog";
import { FilterPills } from "@/components/ui/FilterPills";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface LeaveRequest {
  id: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: string;
  reviewerComment?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  leaveType: { code: string; name: string };
}

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 15;

export default function MyLeaveRequestsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [cancellingBusy, setCancellingBusy] = useState(false);

  const fetchRequests = useCallback(
    async (s: string, p: number) => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = { page: p, pageSize: PAGE_SIZE };
        if (s !== "all") params.status = s;
        const res = await apiGet<{ data: LeaveRequest[]; total: number; page: number; pageSize: number }>(
          "/leave/requests/me",
          params,
        );
        setRows(res.data);
        setTotal(res.total);
        setPage(res.page);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load leave requests", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    fetchRequests(status, page);
  }, [fetchRequests, status, page]);

  const onFilterChange = (v: string) => {
    setStatus(v);
    setPage(1);
  };

  const confirmCancel = async () => {
    if (!cancelling) return;
    setCancellingBusy(true);
    try {
      await apiPost(`/leave/requests/${cancelling.id}/cancel`);
      toast("Leave request cancelled", "success");
      setCancelling(null);
      fetchRequests(status, page);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to cancel request", "error");
    } finally {
      setCancellingBusy(false);
    }
  };

  const columns = [
    {
      key: "type",
      header: "Type",
      render: (r: LeaveRequest) => (
        <div className="flex items-center gap-2">
          <Badge variant="blue">{r.leaveType.code}</Badge>
          <span className="hidden lg:inline">{r.leaveType.name}</span>
        </div>
      ),
    },
    {
      key: "dates",
      header: "Dates",
      render: (r: LeaveRequest) => (
        <span className="whitespace-nowrap">
          {formatDate(r.fromDate)} → {formatDate(r.toDate)}
        </span>
      ),
    },
    {
      key: "days",
      header: "Days",
      render: (r: LeaveRequest) => r.days,
    },
    {
      key: "reason",
      header: "Reason",
      render: (r: LeaveRequest) => (
        <span className="block max-w-[220px] truncate" title={r.reason}>
          {r.reason}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r: LeaveRequest) => <StatusBadge status={r.status} />,
    },
    {
      key: "comment",
      header: "Reviewer comment",
      render: (r: LeaveRequest) => (
        <span className="block max-w-[200px] truncate text-muted" title={r.reviewerComment ?? ""}>
          {r.reviewerComment || "—"}
        </span>
      ),
    },
    {
      key: "decided",
      header: "Decided",
      render: (r: LeaveRequest) => (r.decidedAt ? formatDateTime(r.decidedAt) : "—"),
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right tabular-nums",
      render: (r: LeaveRequest) =>
        r.status === "pending" ? (
          <Button size="sm" variant="outline" onClick={() => setCancelling(r)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="My leave requests"
        description="Track the status of your leave applications."
        action={
          <Link href="/leave/apply">
            <Button>
              <Plus className="h-4 w-4" /> Apply for leave
            </Button>
          </Link>
        }
      />

      <FilterPills options={STATUS_OPTIONS} value={status} onChange={onFilterChange} className="mb-4" />

      {loading ? (
        <PageSkeleton />
      ) : (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                icon={CalendarX}
                title={status === "all" ? "No leave requests yet" : `No ${status} requests`}
                description="Your leave applications will show up here."
                action={
                  <Link href="/leave/apply">
                    <Button>
                      <Plus className="h-4 w-4" /> Apply for leave
                    </Button>
                  </Link>
                }
              />
            }
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}

      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancel this request?"
        description={
          cancelling
            ? `This will withdraw your ${cancelling.leaveType.name.toLowerCase()} request for ${formatDate(cancelling.fromDate)} → ${formatDate(cancelling.toDate)}.`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Keep request
            </Button>
            <Button variant="destructive" loading={cancellingBusy} onClick={confirmCancel}>
              Yes, cancel it
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          The days will be added back to your leave balance once the request is cancelled.
        </p>
      </Dialog>
    </div>
  );
}
