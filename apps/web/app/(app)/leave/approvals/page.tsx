"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Table } from "@/components/ui/Table";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface PendingRequest {
  id: string;
  employeeId: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: string;
  createdAt: string;
  leaveType: { code: string; name: string };
  employee: { id: string; fullName: string; employeeCode: string; department?: { name: string } | null };
}

interface PendingWfh {
  id: string;
  date: string;
  reason: string | null;
  status: string;
  createdAt: string;
  employee: { id: string; fullName: string; employeeCode: string; department?: { name: string } | null };
}

const PAGE_SIZE = 15;

/* ── Work-from-home approvals ─────────────────────────────────────── */

function WfhApprovals() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PendingWfh[]>([]);
  const [deciding, setDeciding] = useState<{ req: PendingWfh; decision: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [decidingBusy, setDecidingBusy] = useState(false);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<PendingWfh[]>("/attendance/wfh-requests/team");
      setRows(Array.isArray(res) ? res : []);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load WFH requests", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const openDecide = (req: PendingWfh, decision: "approve" | "reject") => {
    setNote("");
    setDeciding({ req, decision });
  };

  const confirmDecide = async () => {
    if (!deciding) return;
    setDecidingBusy(true);
    try {
      await apiPost(`/attendance/wfh-requests/${deciding.req.id}/${deciding.decision}`, {
        note: note.trim() || undefined,
      });
      toast(
        `WFH request ${deciding.decision === "approve" ? "approved" : "rejected"}`,
        "success",
      );
      setDeciding(null);
      fetchPending();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to record decision", "error");
    } finally {
      setDecidingBusy(false);
    }
  };

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-ink">Work-from-home approvals</h2>
        <p className="text-sm text-muted">
          Pending WFH requests from your team — no location check on approved days.
        </p>
      </div>

      {loading ? (
        <PageSkeleton />
      ) : (
        <Table
          columns={[
            {
              key: "employee",
              header: "Employee",
              render: (r: PendingWfh) => (
                <div className="flex items-center gap-2.5">
                  <Avatar name={r.employee.fullName} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{r.employee.fullName}</p>
                    <p className="truncate text-xs text-muted">
                      {r.employee.employeeCode}
                      {r.employee.department?.name ? ` · ${r.employee.department.name}` : ""}
                    </p>
                  </div>
                </div>
              ),
            },
            {
              key: "date",
              header: "WFH date",
              render: (r: PendingWfh) => <span className="whitespace-nowrap">{formatDate(r.date)}</span>,
            },
            {
              key: "reason",
              header: "Reason",
              render: (r: PendingWfh) => (
                <span className="block max-w-[200px] truncate" title={r.reason ?? ""}>
                  {r.reason || "—"}
                </span>
              ),
            },
            {
              key: "requested",
              header: "Requested",
              render: (r: PendingWfh) => formatDateTime(r.createdAt),
            },
            {
              key: "actions",
              header: "Actions",
              className: "text-right tabular-nums",
              render: (r: PendingWfh) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => openDecide(r, "approve")}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openDecide(r, "reject")}>
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              ),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={ClipboardCheck}
              title="No WFH requests"
              description="There are no pending work-from-home requests."
            />
          }
        />
      )}

      <Dialog
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding?.decision === "approve" ? "Approve WFH request" : "Reject WFH request"}
        description={
          deciding
            ? `${deciding.req.employee.fullName} · WFH on ${formatDate(deciding.req.date)}`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Back
            </Button>
            <Button
              variant={deciding?.decision === "approve" ? "primary" : "destructive"}
              loading={decidingBusy}
              onClick={confirmDecide}
            >
              {deciding?.decision === "approve" ? "Approve request" : "Reject request"}
            </Button>
          </div>
        }
      >
        <FormField label="Note (optional)">
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note for the employee (visible to them)"
          />
        </FormField>
      </Dialog>
    </div>
  );
}

export default function LeaveApprovalsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PendingRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [deciding, setDeciding] = useState<{ req: PendingRequest; decision: "approved" | "rejected" } | null>(null);
  const [comment, setComment] = useState("");
  const [decidingBusy, setDecidingBusy] = useState(false);

  const fetchPending = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await apiGet<{ data: PendingRequest[]; total: number; page: number; pageSize: number }>(
          "/leave/requests/pending",
          { page: p, pageSize: PAGE_SIZE },
        );
        setRows(res.data);
        setTotal(res.total);
        setPage(res.page);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load pending requests", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    fetchPending(page);
  }, [fetchPending, page]);

  const openDecide = (req: PendingRequest, decision: "approved" | "rejected") => {
    setComment("");
    setDeciding({ req, decision });
  };

  const confirmDecide = async () => {
    if (!deciding) return;
    setDecidingBusy(true);
    try {
      await apiPost(`/leave/requests/${deciding.req.id}/decide`, {
        decision: deciding.decision,
        comment: comment.trim() || undefined,
      });
      toast(
        `Leave request ${deciding.decision === "approved" ? "approved" : "rejected"}`,
        "success",
      );
      setDeciding(null);
      fetchPending(page);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to record decision", "error");
    } finally {
      setDecidingBusy(false);
    }
  };

  const columns = [
    {
      key: "employee",
      header: "Employee",
      render: (r: PendingRequest) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.employee.fullName} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{r.employee.fullName}</p>
            <p className="truncate text-xs text-muted">
              {r.employee.employeeCode}
              {r.employee.department?.name ? ` · ${r.employee.department.name}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (r: PendingRequest) => (
        <div className="flex items-center gap-2">
          <Badge variant="blue">{r.leaveType.code}</Badge>
          <span className="hidden lg:inline">{r.leaveType.name}</span>
        </div>
      ),
    },
    {
      key: "dates",
      header: "Dates",
      render: (r: PendingRequest) => (
        <span className="whitespace-nowrap">
          {formatDate(r.fromDate)} → {formatDate(r.toDate)}
        </span>
      ),
    },
    {
      key: "days",
      header: "Days",
      render: (r: PendingRequest) => r.days,
    },
    {
      key: "reason",
      header: "Reason",
      render: (r: PendingRequest) => (
        <span className="block max-w-[200px] truncate" title={r.reason}>
          {r.reason}
        </span>
      ),
    },
    {
      key: "requested",
      header: "Requested",
      render: (r: PendingRequest) => formatDateTime(r.createdAt),
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right tabular-nums",
      render: (r: PendingRequest) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => openDecide(r, "approved")}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDecide(r, "rejected")}>
            <XCircle className="h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Approvals inbox"
        description="Review and decide on pending leave and work-from-home requests from your team."
      />

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
                icon={ClipboardCheck}
                title="All caught up"
                description="There are no pending leave requests waiting for your decision."
              />
            }
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}

      <Dialog
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding?.decision === "approved" ? "Approve leave request" : "Reject leave request"}
        description={
          deciding
            ? `${deciding.req.employee.fullName} · ${deciding.req.leaveType.name} · ${formatDate(deciding.req.fromDate)} → ${formatDate(deciding.req.toDate)} (${deciding.req.days} day${deciding.req.days === 1 ? "" : "s"})`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Back
            </Button>
            <Button
              variant={deciding?.decision === "approved" ? "primary" : "destructive"}
              loading={decidingBusy}
              onClick={confirmDecide}
            >
              {deciding?.decision === "approved" ? "Approve request" : "Reject request"}
            </Button>
          </div>
        }
      >
        <FormField label="Comment (optional)">
          <Textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note for the employee (visible to them)"
          />
        </FormField>
      </Dialog>

      <WfhApprovals />
    </div>
  );
}
