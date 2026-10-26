"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Settings as SettingsIcon } from "lucide-react";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface StatutorySettings {
  pfApplicable?: boolean;
  esiApplicable?: boolean;
  ptApplicable?: boolean;
  tdsApplicable?: boolean;
  ptState?: string;
}

interface CompanySettings {
  name: string;
  timezone: string;
  logoUrl?: string | null;
  settings: { currency?: string; invoicePrefix?: string; statutory?: StatutorySettings } | null;
  statutory?: StatutorySettings;
}

interface StatutoryFormValues {
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  tdsApplicable: boolean;
  ptState: string;
}

interface SettingsFormValues {
  name: string;
  timezone: string;
  logoUrl: string;
  currency: string;
  invoicePrefix: string;
}

interface CompanyLegal {
  legalName?: string | null;
  pan?: string | null;
  gstin?: string | null;
  cin?: string | null;
  registeredOffice?: string | null;
  headOffice?: string | null;
}

interface LegalFormValues {
  legalName: string;
  pan: string;
  gstin: string;
  cin: string;
  registeredOffice: string;
  headOffice: string;
}

export default function CompanySettingsPage() {
  const { toast } = useToast();
  const { hasRole, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [legalLoading, setLegalLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingLegal, setSavingLegal] = useState(false);
  const [savingStatutory, setSavingStatutory] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SettingsFormValues>({
    defaultValues: { name: "", timezone: "", logoUrl: "", currency: "", invoicePrefix: "" },
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<CompanySettings>("/admin/company/settings");
        reset({
          name: res.name ?? "",
          timezone: res.timezone ?? "",
          logoUrl: res.logoUrl ?? "",
          currency: res.settings?.currency ?? "",
          invoicePrefix: res.settings?.invoicePrefix ?? "",
        });
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load company settings", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [reset, toast]);

  const onSubmit = async (values: SettingsFormValues) => {
    setSaving(true);
    try {
      await apiPatch("/admin/company/settings", {
        name: values.name.trim(),
        timezone: values.timezone.trim(),
        logoUrl: values.logoUrl.trim() || undefined,
        settings: {
          currency: values.currency.trim() || undefined,
          invoicePrefix: values.invoicePrefix.trim() || undefined,
        },
      });
      toast("Company settings saved", "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const statutoryForm = useForm<StatutoryFormValues>({
    defaultValues: { pfApplicable: true, esiApplicable: true, ptApplicable: true, tdsApplicable: true, ptState: "TN" },
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<CompanySettings>("/admin/company/settings");
        const s = res.statutory ?? res.settings?.statutory ?? {};
        statutoryForm.reset({
          pfApplicable: s.pfApplicable ?? true,
          esiApplicable: s.esiApplicable ?? true,
          ptApplicable: s.ptApplicable ?? true,
          tdsApplicable: s.tdsApplicable ?? true,
          ptState: s.ptState ?? "TN",
        });
      } catch {
        // Statutory defaults already in the form; main settings load reports errors.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmitStatutory = async (values: StatutoryFormValues) => {
    setSavingStatutory(true);
    try {
      await apiPatch("/admin/company/settings", { settings: { statutory: values } });
      toast("Statutory settings saved", "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to save statutory settings", "error");
    } finally {
      setSavingStatutory(false);
    }
  };

  const legalForm = useForm<LegalFormValues>({
    defaultValues: { legalName: "", pan: "", gstin: "", cin: "", registeredOffice: "", headOffice: "" },
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{ legal?: CompanyLegal | null }>("/admin/company/settings");
        const legal = res.legal ?? {};
        legalForm.reset({
          legalName: legal.legalName ?? "",
          pan: legal.pan ?? "",
          gstin: legal.gstin ?? "",
          cin: legal.cin ?? "",
          registeredOffice: legal.registeredOffice ?? "",
          headOffice: legal.headOffice ?? "",
        });
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load legal details", "error");
      } finally {
        setLegalLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const onSubmitLegal = async (values: LegalFormValues) => {
    setSavingLegal(true);
    try {
      await apiPatch("/admin/company/settings", {
        legal: {
          legalName: values.legalName.trim(),
          pan: values.pan.trim(),
          gstin: values.gstin.trim(),
          cin: values.cin.trim(),
          registeredOffice: values.registeredOffice.trim(),
          headOffice: values.headOffice.trim(),
        },
      });
      toast("Letterhead details saved", "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to save legal details", "error");
    } finally {
      setSavingLegal(false);
    }
  };

  if (authLoading || loading || legalLoading) return <PageSkeleton />;

  if (!hasRole("md")) {
    return (
      <EmptyState
        icon={SettingsIcon}
        title="MD only"
        description="Only the Managing Director (MD) can manage company settings."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Company Settings"
        description="Identity, timezone and billing defaults for your company"
      />

      <Card className="max-w-2xl p-5">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Company name" error={errors.name?.message}>
            <Input {...register("name", { required: "Company name is required" })} placeholder="Atriowings Technologies" />
          </FormField>
          <FormField
            label="Timezone"
            error={errors.timezone?.message}
            hint="IANA timezone used for dates and times, e.g. Asia/Kolkata"
          >
            <Input {...register("timezone")} placeholder="Asia/Kolkata" />
          </FormField>
          <FormField label="Logo URL" hint="Optional — public URL of the company logo">
            <Input {...register("logoUrl")} placeholder="https://…" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Currency" hint="e.g. INR">
              <Input {...register("currency")} placeholder="INR" />
            </FormField>
            <FormField
              label="Invoice prefix"
              hint="Suggested when creating a new invoice number"
            >
              <Input {...register("invoicePrefix")} placeholder="INV-" />
            </FormField>
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" loading={saving}>
              Save settings
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5 max-w-2xl p-5">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Statutory settings</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted">
          Company defaults used by payroll computation. An employee&apos;s own PF / ESI flag, when
          set on their employment record, overrides the company default for that employee.
          Only Tamil Nadu professional-tax slabs are implemented today — other PT states are
          stored but fall back to TN slabs.
        </p>
        <form onSubmit={statutoryForm.handleSubmit(onSubmitStatutory)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-inksoft">
              <input type="checkbox" {...statutoryForm.register("pfApplicable")} className="h-4 w-4 rounded border-line accent-accent" />
              Provident Fund (PF) applicable
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-inksoft">
              <input type="checkbox" {...statutoryForm.register("esiApplicable")} className="h-4 w-4 rounded border-line accent-accent" />
              Employee State Insurance (ESI) applicable
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-inksoft">
              <input type="checkbox" {...statutoryForm.register("ptApplicable")} className="h-4 w-4 rounded border-line accent-accent" />
              Professional Tax (PT) applicable
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-inksoft">
              <input type="checkbox" {...statutoryForm.register("tdsApplicable")} className="h-4 w-4 rounded border-line accent-accent" />
              Tax Deducted at Source (TDS) applicable
            </label>
          </div>
          <FormField label="Professional Tax state" hint="Only TN slabs are implemented; other values fall back to TN">
            <Input {...statutoryForm.register("ptState")} placeholder="TN" />
          </FormField>
          <div className="flex justify-end pt-2">
            <Button type="submit" loading={savingStatutory}>
              Save statutory settings
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5 max-w-2xl p-5">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Letterhead &amp; legal details</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted">Printed on quotations and invoices.</p>
        <form onSubmit={legalForm.handleSubmit(onSubmitLegal)} className="space-y-4">
          <FormField label="Legal company name">
            <Input
              {...legalForm.register("legalName")}
              placeholder="Atriowings Technologies India Private Limited"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="PAN">
              <Input {...legalForm.register("pan")} placeholder="ABCDE1234F" className="font-mono" />
            </FormField>
            <FormField label="GSTIN">
              <Input {...legalForm.register("gstin")} placeholder="33ABCDE1234F1Z5" className="font-mono" />
            </FormField>
            <FormField label="CIN">
              <Input {...legalForm.register("cin")} placeholder="U72900TN2019PTC000000" className="font-mono" />
            </FormField>
          </div>
          <FormField label="Registered office">
            <Textarea
              {...legalForm.register("registeredOffice")}
              placeholder={"Registered office address as on the letterhead"}
            />
          </FormField>
          <FormField label="Head office">
            <Textarea
              {...legalForm.register("headOffice")}
              placeholder={"Head office address as on the letterhead"}
            />
          </FormField>
          <div className="flex justify-end pt-2">
            <Button type="submit" loading={savingLegal}>
              Save letterhead details
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
