"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Check, Download, FileText, Pencil, Send, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, downloadFile, ApiError } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface QuotationItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
  amount: number;
}

interface QuotationDetail {
  id: string;
  quotationNo: string;
  customerId: string;
  customer: { id: string; name: string; gstin?: string | null; email?: string | null; phone?: string | null };
  issueDate: string;
  validUntil: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  status: string;
  terms?: string | null;
  notes?: string | null;
  convertedInvoiceId?: string | null;
  convertedInvoiceNo?: string | null;
  items: QuotationItem[];
}

type StatusAction = "sent" | "accepted" | "rejected" | "expired";
type PendingAction = { kind: "status"; status: StatusAction } | { kind: "delete" } | { kind: "convert" };

const STATUS_ACTION_COPY: Record<StatusAction, { title: string; confirm: string; toast: string }> = {
  sent: {
    title: "Mark as sent",
    confirm: "Mark this quotation as sent to the customer?",
    toast: "Quotation marked as sent",
  },
  accepted: {
    title: "Accept quotation",
    confirm: "Mark this quotation as accepted by the customer? You can then convert it to an invoice.",
    toast: "Quotation accepted",
  },
  rejected: {
    title: "Reject quotation",
    confirm: "Mark this quotation as rejected by the customer? This cannot be undone.",
    toast: "Quotation marked as rejected",
  },
  expired: {
    title: "Mark as expired",
    confirm: "Mark this quotation as expired? This cannot be undone.",
    toast: "Quotation marked as expired",
  },
};

export default function QuotationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<QuotationDetail>(`/billing/quotations/${id}`);
      setQuotation(res);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load quotation", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = async () => {
    if (!quotation) return;
    setDownloading(true);
    try {
      await downloadFile(`/billing/quotations/${id}/pdf`, `${quotation.quotationNo}.pdf`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to download PDF", "error");
    } finally {
      setDownloading(false);
    }
  };

  const runPending = async () => {
    if (!pending || !quotation) return;
    setBusy(true);
    try {
      if (pending.kind === "status") {
        await apiPost(`/billing/quotations/${id}/status`, { status: pending.status });
        toast(STATUS_ACTION_COPY[pending.status].toast, "success");
        setPending(null);
        load();
      } else if (pending.kind === "delete") {
        await apiDelete(`/billing/quotations/${id}`);
        toast("Quotation deleted", "success");
        router.push("/billing/quotations");
      } else {
        const invoice = await apiPost<{ id: string }>(`/billing/quotations/${id}/convert`);
        toast("Converted to invoice", "success");
        router.push(`/billing/invoices/${invoice.id}`);
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (!quotation) {
    return (
      <EmptyState icon={FileText} title="Quotation not found" description="It may have been deleted." />
    );
  }

  const isDraft = quotation.status === "draft";
  const isSent = quotation.status === "sent";
  const isAccepted = quotation.status === "accepted";
  const isConverted = quotation.status === "converted";

  return (
    <>
      <PageHeader
        backHref="/billing/quotations"
        title={quotation.quotationNo}
        description={`Issued ${formatDate(quotation.issueDate)} · Valid until ${formatDate(quotation.validUntil)}`}
        action={
          <>
            <Button variant="outline" onClick={handleDownload} loading={downloading}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            {isDraft && (
              <>
                <Button variant="outline" onClick={() => router.push(`/billing/quotations/${id}/edit`)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
                <Button
                  variant="outline"
                  className="text-danger hover:text-danger"
                  onClick={() => setPending({ kind: "delete" })}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
                <Button onClick={() => setPending({ kind: "status", status: "sent" })}>
                  <Send className="h-4 w-4" /> Mark as sent
                </Button>
              </>
            )}
            {isSent && (
              <>
                <Button variant="outline" onClick={() => setPending({ kind: "status", status: "expired" })}>
                  Mark expired
                </Button>
                <Button
                  variant="outline"
                  className="text-danger hover:text-danger"
                  onClick={() => setPending({ kind: "status", status: "rejected" })}
                >
                  <X className="h-4 w-4" /> Reject
                </Button>
                <Button onClick={() => setPending({ kind: "status", status: "accepted" })}>
                  <Check className="h-4 w-4" /> Accept
                </Button>
              </>
            )}
            {isAccepted && (
              <Button onClick={() => setPending({ kind: "convert" })}>
                Convert to invoice <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge status={quotation.status} />
        {isConverted &&
          (quotation.convertedInvoiceId ? (
            <button
              onClick={() => router.push(`/billing/invoices/${quotation.convertedInvoiceId}`)}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
            >
              Converted to invoice{quotation.convertedInvoiceNo ? ` ${quotation.convertedInvoiceNo}` : ""}{" "}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="text-xs font-medium text-muted">Converted to an invoice</span>
          ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-ink">Prepared for</h2>
          <p className="font-medium text-ink">{quotation.customer.name}</p>
          {quotation.customer.gstin && (
            <p className="mt-1 font-mono text-xs text-muted">GSTIN: {quotation.customer.gstin}</p>
          )}
          {quotation.customer.email && <p className="mt-1 text-sm text-muted">{quotation.customer.email}</p>}
          {quotation.customer.phone && <p className="mt-1 text-sm text-muted">{quotation.customer.phone}</p>}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-ink">Summary</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between text-muted">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatINR(quotation.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>Tax (GST)</dt>
              <dd className="tabular-nums">{formatINR(quotation.taxTotal)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <dt className="font-semibold tracking-tight text-ink">Total</dt>
              <dd className="text-base font-bold text-ink tabular-nums">{formatINR(quotation.total)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>Valid until</dt>
              <dd>{formatDate(quotation.validUntil)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold tracking-tight text-ink">Items</h2>
      <Table<QuotationItem>
        columns={[
          { key: "description", header: "Description", render: (i) => i.description },
          {
            key: "quantity",
            header: "Qty",
            className: "text-right tabular-nums",
            render: (i) => <span className="tabular-nums">{i.quantity}</span>,
          },
          {
            key: "rate",
            header: "Rate",
            className: "text-right tabular-nums",
            render: (i) => <span className="tabular-nums">{formatINR(i.rate)}</span>,
          },
          {
            key: "taxRate",
            header: "Tax %",
            className: "text-right tabular-nums",
            render: (i) => <span className="tabular-nums">{i.taxRate}%</span>,
          },
          {
            key: "amount",
            header: "Amount",
            className: "text-right tabular-nums",
            render: (i) => <span className="font-medium tabular-nums">{formatINR(i.amount)}</span>,
          },
        ]}
        rows={quotation.items}
        rowKey={(i) => i.id}
      />

      {quotation.terms && (
        <Card className="mt-5 p-5">
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-ink">Terms & conditions</h2>
          <p className="whitespace-pre-wrap text-sm text-muted">{quotation.terms}</p>
        </Card>
      )}

      {quotation.notes && (
        <Card className="mt-5 p-5">
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-ink">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-muted">{quotation.notes}</p>
        </Card>
      )}

      {/* Confirm status change / delete / convert */}
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={
          pending?.kind === "status"
            ? STATUS_ACTION_COPY[pending.status].title
            : pending?.kind === "delete"
              ? "Delete quotation"
              : "Convert to invoice"
        }
      >
        <p className="text-sm text-muted">
          {pending?.kind === "status" && (
            <>
              {STATUS_ACTION_COPY[pending.status].confirm}{" "}
              <span className="font-medium text-ink">{quotation.quotationNo}</span> totals{" "}
              <span className="font-medium text-ink">{formatINR(quotation.total)}</span>.
            </>
          )}
          {pending?.kind === "delete" && (
            <>
              Delete draft quotation <span className="font-medium text-ink">{quotation.quotationNo}</span> for{" "}
              <span className="font-medium text-ink">{quotation.customer.name}</span>? This cannot be undone.
            </>
          )}
          {pending?.kind === "convert" && (
            <>
              Create an invoice from quotation{" "}
              <span className="font-medium text-ink">{quotation.quotationNo}</span> for{" "}
              <span className="font-medium text-ink">{formatINR(quotation.total)}</span>? The quotation will be
              marked as converted.
            </>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            variant={pending?.kind === "delete" || (pending?.kind === "status" && pending.status === "rejected") ? "destructive" : "primary"}
            onClick={runPending}
            loading={busy}
          >
            {pending?.kind === "status"
              ? STATUS_ACTION_COPY[pending.status].title
              : pending?.kind === "delete"
                ? "Delete"
                : "Convert to invoice"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
