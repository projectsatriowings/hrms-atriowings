"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api";
import { formatDateTime, prettify } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
}

const PAGE_SIZE = 25;

export default function AuditLogPage() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState<{ entityType: string; action: string }>({
    entityType: "",
    action: "",
  });

  const load = useCallback(
    async (p: number, filters: { entityType: string; action: string }) => {
      setLoading(true);
      try {
        const res = await apiGet<{ data: AuditLog[]; total: number; page: number }>(
          "/admin/audit-logs",
          {
            page: p,
            pageSize: PAGE_SIZE,
            entityType: filters.entityType || undefined,
            action: filters.action || undefined,
          },
        );
        setLogs(res.data);
        setTotal(res.total);
        setPage(res.page);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load audit logs", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(1, { entityType: "", action: "" });
  }, [load]);

  const applyFilters = () => {
    const filters = { entityType: entityType.trim(), action: action.trim() };
    setApplied(filters);
    load(1, filters);
  };

  const clearFilters = () => {
    setEntityType("");
    setAction("");
    const filters = { entityType: "", action: "" };
    setApplied(filters);
    load(1, filters);
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Every significant change made across the company workspace"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Entity type">
          <Input
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="e.g. invoice"
            className="w-auto min-w-44"
          />
        </FormField>
        <FormField label="Action">
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. created"
            className="w-auto min-w-44"
          />
        </FormField>
        <Button onClick={applyFilters}>Apply</Button>
        {(applied.entityType || applied.action) && (
          <Button variant="outline" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      <Table<AuditLog>
        columns={[
          {
            key: "createdAt",
            header: "Time",
            render: (l) => <span className="whitespace-nowrap">{formatDateTime(l.createdAt)}</span>,
          },
          { key: "action", header: "Action", render: (l) => prettify(l.action) },
          { key: "entityType", header: "Entity type", render: (l) => prettify(l.entityType) },
          {
            key: "entityId",
            header: "Entity ID",
            render: (l) =>
              l.entityId ? (
                <code className="font-mono text-xs text-muted">
                  {l.entityId.length > 12 ? `${l.entityId.slice(0, 12)}…` : l.entityId}
                </code>
              ) : (
                <span className="text-faint">—</span>
              ),
          },
          {
            key: "ip",
            header: "IP",
            render: (l) =>
              l.ip ? (
                <code className="font-mono text-xs text-muted">{l.ip}</code>
              ) : (
                <span className="text-faint">—</span>
              ),
          },
        ]}
        rows={logs}
        rowKey={(l) => l.id}
        empty={
          <EmptyState
            icon={ScrollText}
            title="No audit entries"
            description="No changes match these filters yet."
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => load(p, applied)} />
    </>
  );
}
