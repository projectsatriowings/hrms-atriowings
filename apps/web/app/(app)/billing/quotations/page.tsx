"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { FilterPills } from "@/components/ui/FilterPills";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { BillingTabs } from "@/components/billing/BillingTabs";
import { useToast } from "@/components/ui/Toast";

interface QuotationRow {
  id: string;
  quotationNo: string;
  customerId: string;
  customer: { id: string; name: string };
  issueDate: string;
  validUntil: string;
  total: number;
  status: string;
  itemsCount?: number;
}

const PILLS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "converted", label: "Converted" },
];

const PAGE_SIZE = 20;

export default function QuotationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: number, s: string) => {
      setLoading(true);
      try {
        const res = await apiGet<{ data: QuotationRow[]; total: number; page: number }>(
          "/billing/quotations",
          { page: p, pageSize: PAGE_SIZE, status: s || undefined },
        );
        setQuotations(res.data);
        setTotal(res.total);
        setPage(res.page);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load quotations", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(1, status);
  }, [load, status]);

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Quotes sent to customers on your letterhead — convert accepted ones to invoices"
        action={
          <Button onClick={() => router.push("/billing/quotations/new")}>
            <Plus className="h-4 w-4" /> New quotation
          </Button>
        }
      />

      <BillingTabs active="quotations" className="mb-5" />

      <FilterPills options={PILLS} value={status} onChange={setStatus} className="mb-4" />

      <Table<QuotationRow>
        columns={[
          {
            key: "quotationNo",
            header: "Number",
            render: (r) => <span className="font-medium text-ink">{r.quotationNo}</span>,
          },
          { key: "customer", header: "Customer", render: (r) => r.customer?.name ?? "—" },
          { key: "issueDate", header: "Date", render: (r) => formatDate(r.issueDate) },
          { key: "validUntil", header: "Valid until", render: (r) => formatDate(r.validUntil) },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums",
            render: (r) => <span className="font-medium tabular-nums">{formatINR(r.total)}</span>,
          },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
        rows={quotations}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/billing/quotations/${r.id}`)}
        empty={
          <EmptyState
            icon={FileText}
            title="No quotations found"
            description={
              status
                ? "No quotations match this filter."
                : "Create your first quotation to send a priced quote to a customer."
            }
            action={
              !status ? (
                <Button onClick={() => router.push("/billing/quotations/new")}>
                  <Plus className="h-4 w-4" /> New quotation
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
