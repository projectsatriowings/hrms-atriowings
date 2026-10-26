"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Users } from "lucide-react";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { customerSchema } from "@hrms/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { BillingTabs } from "@/components/billing/BillingTabs";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { FormField } from "@/components/ui/FormField";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface Customer {
  id: string;
  name: string;
  gstin?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: Record<string, string> | null;
}

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const customerFormSchema = customerSchema.omit({ address: true }).extend({
  gstin: z.preprocess(blankToUndef, z.string().max(15).optional()),
  email: z.preprocess(blankToUndef, z.string().email("Enter a valid email address").optional()),
  phone: z.preprocess(blankToUndef, z.string().max(20).optional()),
  addressText: z.string().optional(),
});

type CustomerFormValues = z.infer<typeof customerFormSchema>;

const PAGE_SIZE = 20;

export default function CustomersPage() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; customer: Customer } | null>(
    null,
  );

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await apiGet<{ data: Customer[]; total: number; page: number }>(
          "/customers",
          { page: p, pageSize: PAGE_SIZE },
        );
        setCustomers(res.data);
        setTotal(res.total);
        setPage(res.page);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load customers", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: { name: "", gstin: "", email: "", phone: "", addressText: "" },
  });

  useEffect(() => {
    if (!dialog) return;
    if (dialog.mode === "edit") {
      const c = dialog.customer;
      reset({
        name: c.name,
        gstin: c.gstin ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
        addressText: c.address ? Object.values(c.address).join("\n") : "",
      });
    } else {
      reset({ name: "", gstin: "", email: "", phone: "", addressText: "" });
    }
  }, [dialog, reset]);

  const onSubmit = async (values: CustomerFormValues) => {
    const payload = {
      name: values.name.trim(),
      gstin: values.gstin,
      email: values.email,
      phone: values.phone,
      address: values.addressText?.trim() ? { address: values.addressText.trim() } : undefined,
    };
    try {
      if (dialog?.mode === "edit") {
        await apiPatch(`/customers/${dialog.customer.id}`, payload);
        toast("Customer updated", "success");
      } else {
        await apiPost("/customers", payload);
        toast("Customer added", "success");
      }
      setDialog(null);
      load(page);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to save customer", "error");
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Bill-to customers for GST invoicing"
        action={
          <Button onClick={() => setDialog({ mode: "add" })}>
            <Plus className="h-4 w-4" /> Add customer
          </Button>
        }
      />

      <BillingTabs active="customers" className="mb-5" />

      <Table<Customer>
        columns={[
          { key: "name", header: "Name", render: (c) => <span className="font-medium text-ink">{c.name}</span> },
          { key: "gstin", header: "GSTIN", render: (c) => <span className="font-mono text-xs">{c.gstin || "—"}</span> },
          { key: "email", header: "Email", render: (c) => c.email || "—" },
          { key: "phone", header: "Phone", render: (c) => c.phone || "—" },
          {
            key: "actions",
            header: "",
            className: "text-right tabular-nums",
            render: (c) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setDialog({ mode: "edit", customer: c });
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            ),
          },
        ]}
        rows={customers}
        rowKey={(c) => c.id}
        empty={
          <EmptyState
            icon={Users}
            title="No customers yet"
            description="Add your first bill-to customer to start raising invoices."
            action={
              <Button onClick={() => setDialog({ mode: "add" })}>
                <Plus className="h-4 w-4" /> Add customer
              </Button>
            }
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={load} />

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === "edit" ? "Edit customer" : "Add customer"}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Name" required error={errors.name?.message}>
            <Input {...register("name")} placeholder="Acme Traders Pvt Ltd" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="GSTIN" error={errors.gstin?.message}>
              <Input {...register("gstin")} placeholder="33ABCDE1234F1Z5" />
            </FormField>
            <FormField label="Phone" error={errors.phone?.message}>
              <Input {...register("phone")} placeholder="+91 98400 12345" />
            </FormField>
          </div>
          <FormField label="Email" error={errors.email?.message}>
            <Input {...register("email")} type="email" placeholder="billing@acme.in" />
          </FormField>
          <FormField label="Address" hint="Free text; stored as the customer's billing address">
            <Textarea {...register("addressText")} placeholder={"No. 12, Main Road\nChennai 600001"} />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {dialog?.mode === "edit" ? "Save changes" : "Add customer"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
