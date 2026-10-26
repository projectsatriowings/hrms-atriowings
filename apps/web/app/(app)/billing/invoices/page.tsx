"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Plus } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { FilterPills } from "@/components/ui/FilterPills";
import { BillingTabs } from "@/components/billing/BillingTabs";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  customerId: string;
  customer: { id: string; name: string };
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  status: string;
  balance: number;
  isOverdue: boolean;
  displayStatus: string;
}

interface Outstanding {
  invoices: InvoiceRow[];
  totalOutstanding: number;
  overdueCount: number;
}

const PILLS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "issued", label: "Issued" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const PAGE_SIZE = 20;

export default function InvoicesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [outstanding, setOutstanding] = useState<Outstanding | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: number, s: string) => {
      setLoading(true);
      try {
        const res = await apiGet<{ data: InvoiceRow[]; total: number; page: number }>(
          "/invoices",
          { page: p, pageSize: PAGE_SIZE, status: s || undefined },
        );
        setInvoices(res.data);
        setTotal(res.total);
        setPage(res.page);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load invoices", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const loadOutstanding = useCallback(async () => {
    try {
      const res = await apiGet<Outstanding>("/billing/outstanding");
      setOutstanding(res);
    } catch {
      /* banner is optional; the list still works */
    }
  }, []);

  useEffect(() => {
    loadOutstanding();
  }, [loadOutstanding]);

  useEffect(() => {
    load(1, status);
  }, [load, status]);

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="GST invoices raised to customers"
        action={
          <Button onClick={() => router.push("/billing/invoices/new")}>
            <Plus className="h-4 w-4" /> New invoice
          </Button>
        }
      />

      <BillingTabs active="invoices" className="mb-5" />

      {outstanding && outstanding.totalOutstanding > 0 && (
        <Card className="mb-5 flex flex-wrap items-center gap-4 border-warning/30 bg-warning-soft p-4">
          <span className="rounded-full bg-warning-soft p-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-warning">
              {formatINR(outstanding.totalOutstanding)} outstanding across{" "}
              {outstanding.invoices.length} invoice{outstanding.invoices.length === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-warning">{outstanding.overdueCount} overdue</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setStatus("overdue")}>
            View overdue
          </Button>
        </Card>
      )}

      <FilterPills options={PILLS} value={status} onChange={setStatus} className="mb-4" />

      <Table<InvoiceRow>
        columns={[
          {
            key: "invoiceNo",
            header: "Invoice no",
            render: (r) => <span className="font-medium text-ink">{r.invoiceNo}</span>,
          },
          { key: "customer", header: "Customer", render: (r) => r.customer?.name ?? "—" },
          { key: "issueDate", header: "Issue date", render: (r) => formatDate(r.issueDate) },
          { key: "dueDate", header: "Due date", render: (r) => formatDate(r.dueDate) },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums",
            render: (r) => <span className="tabular-nums">{formatINR(r.total)}</span>,
          },
          {
            key: "amountPaid",
            header: "Paid",
            className: "text-right tabular-nums",
            render: (r) => <span className="tabular-nums">{formatINR(r.amountPaid)}</span>,
          },
          {
            key: "balance",
            header: "Balance",
            className: "text-right tabular-nums",
            render: (r) => (
              <span className={r.balance > 0 ? "font-semibold text-danger tabular-nums" : "tabular-nums"}>
                {formatINR(r.balance)}
              </span>
            ),
          },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.displayStatus} /> },
        ]}
        rows={invoices}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/billing/invoices/${r.id}`)}
        empty={
          <EmptyState
            icon={FileText}
            title="No invoices found"
            description={
              status
                ? "No invoices match this filter."
                : "Create your first invoice to start billing customers."
            }
            action={
              !status ? (
                <Button onClick={() => router.push("/billing/invoices/new")}>
                  <Plus className="h-4 w-4" /> New invoice
                </Button>
              ) : undefined
            }
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => load(p, status)} />
    </>
  );
}
