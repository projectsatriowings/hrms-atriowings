"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatINR, todayInTZ } from "@/lib/format";
import { createInvoiceSchema, type CreateInvoiceInput } from "@hrms/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface CustomerOption {
  id: string;
  name: string;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{ data: CustomerOption[] }>("/customers", {
          page: 1,
          pageSize: 100,
        });
        setCustomers(res.data);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load customers", "error");
      } finally {
        setLoadingCustomers(false);
      }
    })();
  }, [toast]);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvoiceInput>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: {
      customerId: "",
      invoiceNo: "",
      issueDate: todayInTZ(),
      dueDate: todayInTZ(),
      items: [{ description: "", quantity: 1, rate: 0, taxRate: 18 }],
      notes: "",
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const watchedItems = watch("items") ?? [];
  const subtotal = watchedItems.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0),
    0,
  );
  const taxTotal = watchedItems.reduce(
    (s, it) =>
      s + ((Number(it.quantity) || 0) * (Number(it.rate) || 0) * (Number(it.taxRate) || 0)) / 100,
    0,
  );
  const grandTotal = subtotal + taxTotal;

  const onSubmit = async (values: CreateInvoiceInput) => {
    try {
      const res = await apiPost<{ id: string }>("/invoices", values);
      toast("Invoice created", "success");
      router.push(`/billing/invoices/${res.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to create invoice", "error");
    }
  };

  if (loadingCustomers) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        backHref="/billing/invoices"
        title="New invoice"
        description="Line items are taxed individually; totals are computed on the server too"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Customer" required error={errors.customerId?.message}>
              <Select {...register("customerId")}>
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Invoice no"
              required
              error={errors.invoiceNo?.message}
              hint="Use your company invoice prefix (see Company Settings)"
            >
              <Input {...register("invoiceNo")} placeholder="INV-2026-001" />
            </FormField>
            <FormField label="Issue date" required error={errors.issueDate?.message}>
              <Input type="date" {...register("issueDate")} />
            </FormField>
            <FormField label="Due date" required error={errors.dueDate?.message}>
              <Input type="date" {...register("dueDate")} />
            </FormField>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-ink">Line items</h2>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => append({ description: "", quantity: 1, rate: 0, taxRate: 18 })}
            >
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </div>

          <div className="space-y-4">
            {fields.map((field, i) => (
              <div key={field.id} className="rounded-lg border border-line p-3">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-12 sm:col-span-5">
                    <FormField
                      label="Description"
                      required
                      error={errors.items?.[i]?.description?.message}
                    >
                      <Input
                        {...register(`items.${i}.description`)}
                        placeholder="Monthly magazine subscription"
                      />
                    </FormField>
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <FormField label="Qty" required error={errors.items?.[i]?.quantity?.message}>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        {...register(`items.${i}.quantity`, { valueAsNumber: true })}
                      />
                    </FormField>
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <FormField label="Rate (₹)" required error={errors.items?.[i]?.rate?.message}>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        {...register(`items.${i}.rate`, { valueAsNumber: true })}
                      />
                    </FormField>
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <FormField label="Tax %" error={errors.items?.[i]?.taxRate?.message}>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        {...register(`items.${i}.taxRate`, { valueAsNumber: true })}
                      />
                    </FormField>
                  </div>
                  <div className="col-span-1 flex items-end justify-end pb-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-danger hover:text-danger"
                      disabled={fields.length === 1}
                      onClick={() => remove(i)}
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {typeof errors.items?.message === "string" && (
            <p className="mt-2 text-xs text-danger">{errors.items.message}</p>
          )}

          <div className="mt-5 flex justify-end">
            <dl className="w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between text-muted">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{formatINR(subtotal)}</dd>
              </div>
              <div className="flex justify-between text-muted">
                <dt>Tax</dt>
                <dd className="tabular-nums">{formatINR(taxTotal)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold tracking-tight text-ink">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatINR(grandTotal)}</dd>
              </div>
            </dl>
          </div>
        </Card>

        <Card className="p-5">
          <FormField label="Notes" hint="Optional — payment terms, bank details, etc.">
            <Textarea {...register("notes")} placeholder="Payment due within 15 days…" />
          </FormField>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/billing/invoices")}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Create invoice
          </Button>
        </div>
      </form>
    </>
  );
}
