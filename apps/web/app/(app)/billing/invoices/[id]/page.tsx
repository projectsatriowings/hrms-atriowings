"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Download, Plus, ReceiptText } from "lucide-react";
import { apiGet, apiPost, downloadFile, ApiError } from "@/lib/api";
import { formatDate, formatINR, prettify, todayInTZ } from "@/lib/format";
import { invoicePaymentSchema, type InvoicePaymentInput } from "@hrms/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { FormField } from "@/components/ui/FormField";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
  amount: number;
}

interface InvoicePayment {
  id: string;
  amount: number;
  paidOn: string;
  method: string;
  reference?: string | null;
}

interface InvoiceDetail {
  id: string;
  invoiceNo: string;
  customerId: string;
  customer: { id: string; name: string; gstin?: string | null; email?: string | null; phone?: string | null };
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  status: string;
  notes?: string | null;
  balance: number;
  isOverdue: boolean;
  displayStatus: string;
  items: InvoiceItem[];
  payments: InvoicePayment[];
}

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const paymentFormSchema = invoicePaymentSchema.extend({
  reference: z.preprocess(blankToUndef, z.string().optional()),
});

type PaymentFormValues = z.infer<typeof paymentFormSchema>;

const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

export default function InvoiceDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<InvoiceDetail>(`/invoices/${id}`);
      setInvoice(res);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load invoice", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: { amount: 0, paidOn: todayInTZ(), method: "bank_transfer", reference: "" },
  });

  useEffect(() => {
    if (paymentOpen && invoice) {
      reset({
        amount: invoice.balance > 0 ? invoice.balance : 0,
        paidOn: todayInTZ(),
        method: "bank_transfer",
        reference: "",
      });
    }
  }, [paymentOpen, invoice, reset]);

  const handleIssue = async () => {
    setIssuing(true);
    try {
      await apiPost(`/invoices/${id}/issue`);
      toast("Invoice issued", "success");
      setIssueOpen(false);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to issue invoice", "error");
    } finally {
      setIssuing(false);
    }
  };

  const onPaymentSubmit = async (values: PaymentFormValues) => {
    try {
      await apiPost<InvoicePaymentInput>(`/invoices/${id}/payments`, values);
      toast("Payment recorded", "success");
      setPaymentOpen(false);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to record payment", "error");
    }
  };

  const handleDownload = async () => {
    if (!invoice) return;
    setDownloading(true);
    try {
      await downloadFile(`/invoices/${id}/pdf`, `${invoice.invoiceNo}.pdf`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to download PDF", "error");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (!invoice) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="Invoice not found"
        description="It may have been deleted."
      />
    );
  }

  const isDraft = invoice.status === "draft";
  const isPaid = invoice.displayStatus === "paid";
  const canPay = !isDraft && !isPaid && invoice.balance > 0;

  return (
    <>
      <PageHeader
        backHref="/billing/invoices"
        title={invoice.invoiceNo}
        description={`Issued ${formatDate(invoice.issueDate)} · Due ${formatDate(invoice.dueDate)}`}
        action={
          <>
            <Button variant="outline" onClick={handleDownload} loading={downloading}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            {canPay && (
              <Button variant="outline" onClick={() => setPaymentOpen(true)}>
                <Plus className="h-4 w-4" /> Record payment
              </Button>
            )}
            {isDraft && <Button onClick={() => setIssueOpen(true)}>Issue invoice</Button>}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge status={invoice.displayStatus} />
        {invoice.isOverdue && (
          <span className="text-xs font-medium text-danger">Overdue — payment is past due</span>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-ink">Bill to</h2>
          <p className="font-medium text-ink">{invoice.customer.name}</p>
          {invoice.customer.gstin && (
            <p className="mt-1 font-mono text-xs text-muted">GSTIN: {invoice.customer.gstin}</p>
          )}
          {invoice.customer.email && <p className="mt-1 text-sm text-muted">{invoice.customer.email}</p>}
          {invoice.customer.phone && <p className="mt-1 text-sm text-muted">{invoice.customer.phone}</p>}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-ink">Summary</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between text-muted">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatINR(invoice.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>Tax</dt>
              <dd className="tabular-nums">{formatINR(invoice.taxTotal)}</dd>
            </div>
            <div className="flex justify-between font-medium text-ink">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(invoice.total)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>Amount paid</dt>
              <dd className="tabular-nums">{formatINR(invoice.amountPaid)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <dt className="font-semibold tracking-tight text-ink">Balance due</dt>
              <dd
                className={
                  invoice.balance > 0
                    ? "text-base font-bold text-danger tabular-nums"
                    : "font-semibold text-accent-ink tabular-nums"
                }
              >
                {formatINR(invoice.balance)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {invoice.notes && (
        <Card className="mt-5 p-5">
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-ink">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-muted">{invoice.notes}</p>
        </Card>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold tracking-tight text-ink">Items</h2>
      <Table<InvoiceItem>
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
        rows={invoice.items}
        rowKey={(i) => i.id}
      />

      <h2 className="mb-3 mt-8 text-sm font-semibold tracking-tight text-ink">Payments</h2>
      <Table<InvoicePayment>
        columns={[
          {
            key: "amount",
            header: "Amount",
            render: (p) => <span className="font-medium tabular-nums">{formatINR(p.amount)}</span>,
          },
          { key: "paidOn", header: "Paid on", render: (p) => formatDate(p.paidOn) },
          { key: "method", header: "Method", render: (p) => prettify(p.method) },
          { key: "reference", header: "Reference", render: (p) => p.reference || "—" },
        ]}
        rows={invoice.payments}
        rowKey={(p) => p.id}
        empty={
          <EmptyState
            title="No payments recorded yet"
            description="Record a payment once the customer pays."
            action={
              canPay ? (
                <Button size="sm" onClick={() => setPaymentOpen(true)}>
                  <Plus className="h-4 w-4" /> Record payment
                </Button>
              ) : undefined
            }
          />
        }
      />

      {/* Issue confirmation */}
      <Dialog open={issueOpen} onClose={() => setIssueOpen(false)} title="Issue invoice">
        <p className="text-sm text-muted">
          Issue invoice <span className="font-medium text-ink">{invoice.invoiceNo}</span> for{" "}
          <span className="font-medium text-ink">{formatINR(invoice.total)}</span>? The
          invoice will move from draft to issued and can then accept payments.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setIssueOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleIssue} loading={issuing}>
            Issue invoice
          </Button>
        </div>
      </Dialog>

      {/* Record payment */}
      <Dialog open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record payment">
        <form onSubmit={handleSubmit(onPaymentSubmit)} className="space-y-4">
          <FormField label="Amount (₹)" required error={errors.amount?.message}>
            <Input
              type="number"
              min={0}
              step="any"
              {...register("amount", { valueAsNumber: true })}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Paid on" required error={errors.paidOn?.message}>
              <Input type="date" {...register("paidOn")} />
            </FormField>
            <FormField label="Method" error={errors.method?.message}>
              <Select {...register("method")}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField label="Reference" error={errors.reference?.message}>
            <Input {...register("reference")} placeholder="UTR / cheque no (optional)" />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Record payment
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
