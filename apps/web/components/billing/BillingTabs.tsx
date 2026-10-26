"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";

export type BillingSection = "invoices" | "quotations" | "customers";

const SECTION_HREF: Record<BillingSection, string> = {
  invoices: "/billing/invoices",
  quotations: "/billing/quotations",
  customers: "/billing/customers",
};

/** Section tabs shared by the billing list pages (Invoices / Quotations / Customers). */
export function BillingTabs({ active, className }: { active: BillingSection; className?: string }) {
  const router = useRouter();
  return (
    <Tabs
      tabs={[
        { id: "invoices", label: "Invoices" },
        { id: "quotations", label: "Quotations" },
        { id: "customers", label: "Customers" },
      ]}
      value={active}
      onChange={(id) => {
        const href = SECTION_HREF[id as BillingSection];
        if (href && id !== active) router.push(href);
      }}
      className={className}
    />
  );
}
