"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { CreateQuotationInput } from "@hrms/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { QuotationForm, DEFAULT_QUOTATION_TERMS } from "@/components/billing/QuotationForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface QuotationDetail {
  id: string;
  quotationNo: string;
  customerId: string;
  issueDate: string;
  validUntil: string;
  status: string;
  terms?: string | null;
  notes?: string | null;
  items: {
    id?: string;
    description: string;
    quantity: number;
    rate: number;
    taxRate: number;
  }[];
}

export default function EditQuotationPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);

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

  const onSubmit = async (values: CreateQuotationInput) => {
    try {
      await apiPatch(`/billing/quotations/${id}`, values);
      toast("Quotation updated", "success");
      router.push(`/billing/quotations/${id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to update quotation", "error");
    }
  };

  if (loading) return <PageSkeleton />;
  if (!quotation) {
    return (
      <EmptyState icon={FileText} title="Quotation not found" description="It may have been deleted." />
    );
  }
  if (quotation.status !== "draft") {
    return (
      <EmptyState
        icon={FileText}
        title="Only draft quotations can be edited"
        description={`Quotation ${quotation.quotationNo} is ${quotation.status} and can no longer be changed.`}
      />
    );
  }

  return (
    <>
      <PageHeader
        backHref={`/billing/quotations/${id}`}
        title={`Edit ${quotation.quotationNo}`}
        description={`Issued ${formatDate(quotation.issueDate)} · Valid until ${formatDate(quotation.validUntil)}`}
      />
      <QuotationForm
        initialValues={{
          customerId: quotation.customerId,
          issueDate: quotation.issueDate.slice(0, 10),
          validUntil: quotation.validUntil.slice(0, 10),
          items: quotation.items.map((i) => ({
            description: i.description,
            quantity: i.quantity,
            rate: i.rate,
            taxRate: i.taxRate,
          })),
          terms: quotation.terms ?? DEFAULT_QUOTATION_TERMS,
          notes: quotation.notes ?? "",
        }}
        submitLabel="Save changes"
        cancelHref={`/billing/quotations/${id}`}
        onSubmit={onSubmit}
      />
    </>
  );
}
