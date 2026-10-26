"use client";

import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/api";
import type { CreateQuotationInput } from "@hrms/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { QuotationForm, blankQuotationValues } from "@/components/billing/QuotationForm";
import { useToast } from "@/components/ui/Toast";

export default function NewQuotationPage() {
  const router = useRouter();
  const { toast } = useToast();

  const onSubmit = async (values: CreateQuotationInput) => {
    try {
      const res = await apiPost<{ id: string }>("/billing/quotations", values);
      toast("Quotation created", "success");
      router.push(`/billing/quotations/${res.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to create quotation", "error");
    }
  };

  return (
    <>
      <PageHeader
        backHref="/billing/quotations"
        title="New quotation"
        description="The quotation number is generated automatically; totals are computed on the server too"
      />
      <QuotationForm
        initialValues={blankQuotationValues()}
        submitLabel="Create quotation"
        cancelHref="/billing/quotations"
        onSubmit={onSubmit}
      />
    </>
  );
}
