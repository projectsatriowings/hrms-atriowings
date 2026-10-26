"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { applyLeaveSchema, type ApplyLeaveInput } from "@hrms/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { daysBetween, formatDate, todayInTZ } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { FormField } from "@/components/ui/FormField";
import { Dialog } from "@/components/ui/Dialog";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

interface LeaveType {
  id: string;
  code: string;
  name: string;
  defaultDays: number;
  carryForward: boolean;
  maxCarryDays?: number | null;
  isActive: boolean;
}

interface BalanceRow {
  leaveType: { id: string; code: string; name: string };
  balance: number;
}

interface Overlap {
  employeeName: string;
  dates: string[];
}

interface ApplyResponse {
  days: number;
  overlappingLeaves: Overlap[];
}

export default function ApplyLeavePage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [overlapInfo, setOverlapInfo] = useState<Overlap[] | null>(null);

  const year = useMemo(() => todayInTZ().slice(0, 4), []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ApplyLeaveInput>({
    resolver: zodResolver(applyLeaveSchema),
    defaultValues: {
      leaveTypeId: "",
      fromDate: todayInTZ(),
      toDate: todayInTZ(),
      reason: "",
    },
  });

  const fromDate = watch("fromDate");
  const toDate = watch("toDate");
  const dayCount = fromDate && toDate ? daysBetween(fromDate, toDate) : 0;

  useEffect(() => {
    (async () => {
      try {
        const [types, bal] = await Promise.all([
          apiGet<LeaveType[]>("/leave/types"),
          apiGet<BalanceRow[]>("/leave/balances/me", { year }),
        ]);
        setLeaveTypes(types.filter((t) => t.isActive));
        setBalances(bal);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load leave data", "error");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const balanceFor = (leaveTypeId: string): number | null => {
    const b = balances.find((r) => r.leaveType.id === leaveTypeId);
    return b ? b.balance : null;
  };

  const selectedType = leaveTypes.find((t) => t.id === watch("leaveTypeId"));

  const onSubmit = async (values: ApplyLeaveInput) => {
    try {
      const res = await apiPost<ApplyResponse>("/leave/requests", values);
      if (res.overlappingLeaves && res.overlappingLeaves.length > 0) {
        // The request was already created; surface the overlap warning with next steps.
        setOverlapInfo(res.overlappingLeaves);
      } else {
        toast("Leave request submitted", "success");
        router.push("/leave/my");
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to submit leave request", "error");
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Apply for leave" description="Request time off — HR will review your request." backHref="/leave/my" />

      <Card className="max-w-2xl p-5 sm:p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <FormField label="Leave type" required error={errors.leaveTypeId?.message}>
            <Select {...register("leaveTypeId")}>
              <option value="">Select leave type</option>
              {leaveTypes.map((t) => {
                const bal = balanceFor(t.id);
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}{bal !== null ? ` — ${bal} day${bal === 1 ? "" : "s"} left` : ""}
                  </option>
                );
              })}
            </Select>
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="From" required error={errors.fromDate?.message}>
              <Input type="date" {...register("fromDate")} />
            </FormField>
            <FormField label="To" required error={errors.toDate?.message}>
              <Input type="date" {...register("toDate")} min={fromDate} />
            </FormField>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="font-medium text-ink">{dayCount}</span>
            day{dayCount === 1 ? "" : "s"}
            {selectedType && balanceFor(selectedType.id) !== null && dayCount > 0 && (
              <span className="text-faint">
                · {balanceFor(selectedType.id)} available on {selectedType.name.toLowerCase()}
              </span>
            )}
          </div>

          <FormField label="Reason" required error={errors.reason?.message}>
            <Textarea rows={3} placeholder="Briefly describe why you need leave" {...register("reason")} />
          </FormField>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={dayCount === 0}>
              Submit request
            </Button>
          </div>
        </form>
      </Card>

      {/* Overlap warning — request already created; give next steps */}
      <Dialog
        open={overlapInfo !== null}
        onClose={() => setOverlapInfo(null)}
        title="Request submitted — heads up"
        description={`Your leave request is in, but ${user?.employeeName || "you"} won't be the only one out:`}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setOverlapInfo(null)}>
              Stay here
            </Button>
            <Button
              onClick={() => {
                setOverlapInfo(null);
                router.push("/leave/my");
              }}
            >
              View my requests
            </Button>
          </div>
        }
      >
        <ul className="space-y-2">
          {(overlapInfo ?? []).map((o, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
              <span className="font-medium text-ink">{o.employeeName}</span>
              <Badge variant="amber">
                {o.dates.map((d) => formatDate(d)).join(", ")}
              </Badge>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
