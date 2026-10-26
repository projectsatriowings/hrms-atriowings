"use client";

import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarOff, MapPin, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import {
  formatDate,
  formatMinutes,
  formatPolicyTime,
  prettify,
  todayInTZ,
} from "@/lib/format";
import {
  attendancePolicySchema,
  holidaySchema,
  type HolidayInput,
} from "@hrms/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { FormField } from "@/components/ui/FormField";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

interface Holiday {
  id: string;
  date: string;
  name: string;
  type: string;
}

interface AttendancePolicy {
  id: string;
  name: string;
  workStart: string;
  workEnd: string;
  graceMinutes: number;
  weeklyOffs: number[];
  fullDayMinutes: number;
  halfDayMinutes: number;
  isDefault: boolean;
  officeLatitude?: number | null;
  officeLongitude?: number | null;
  geofenceRadiusMeters?: number | null;
  requireLocation?: boolean;
}

interface WfhDay {
  id: string;
  date: string;
  note: string | null;
}

// Local extension of the shared schema with office-geofence fields
// (backend accepts these on POST/PATCH /attendance/policies).
const policySchemaWithLocation = attendancePolicySchema.extend({
  officeLatitude: z.number().min(-90).max(90).nullish(),
  officeLongitude: z.number().min(-180).max(180).nullish(),
  geofenceRadiusMeters: z.number().int().min(50).max(5000).default(200),
  requireLocation: z.boolean().default(false),
});
type PolicyInput = z.infer<typeof policySchemaWithLocation>;

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear + 1 - i);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HolidaysPage() {
  const { toast } = useToast();
  const [year, setYear] = useState(currentYear);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [policies, setPolicies] = useState<AttendancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [wfhDays, setWfhDays] = useState<WfhDay[]>([]);
  const [wfhOpen, setWfhOpen] = useState(false);
  const [wfhDate, setWfhDate] = useState(todayInTZ());
  const [wfhNote, setWfhNote] = useState("");
  const [wfhSaving, setWfhSaving] = useState(false);
  const [confirmWfhDelete, setConfirmWfhDelete] = useState<WfhDay | null>(null);
  const [wfhDeleting, setWfhDeleting] = useState(false);

  const loadHolidays = useCallback(
    async (y: number) => {
      try {
        const res = await apiGet<Holiday[]>("/admin/holidays", { year: y });
        setHolidays(Array.isArray(res) ? res : []);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load holidays", "error");
      }
    },
    [toast],
  );

  const loadPolicies = useCallback(async () => {
    try {
      const res = await apiGet<AttendancePolicy[]>("/attendance/policies");
      setPolicies(Array.isArray(res) ? res : []);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load attendance policies", "error");
    }
  }, [toast]);

  const loadWfhDays = useCallback(async () => {
    try {
      const res = await apiGet<WfhDay[]>("/attendance/wfh-days");
      setWfhDays(Array.isArray(res) ? res : []);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load WFH days", "error");
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadHolidays(year), loadPolicies(), loadWfhDays()]);
      setLoading(false);
    })();
  }, [loadHolidays, loadPolicies, loadWfhDays]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loading) loadHolidays(year);
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Add holiday ── */
  const holidayForm = useForm<HolidayInput>({
    resolver: zodResolver(holidaySchema),
    defaultValues: { date: todayInTZ(), name: "", type: "public" },
  });

  useEffect(() => {
    if (addOpen) holidayForm.reset({ date: todayInTZ(), name: "", type: "public" });
  }, [addOpen, holidayForm]);

  const saveHoliday = async (values: HolidayInput) => {
    try {
      await apiPost("/admin/holidays", values);
      toast("Holiday added", "success");
      setAddOpen(false);
      loadHolidays(year);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to add holiday", "error");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await apiDelete(`/admin/holidays/${confirmDelete.id}`);
      toast("Holiday deleted", "success");
      setConfirmDelete(null);
      loadHolidays(year);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to delete holiday", "error");
    } finally {
      setDeleting(false);
    }
  };

  /* ── Company WFH days ── */
  const openWfhAdd = () => {
    setWfhDate(todayInTZ());
    setWfhNote("");
    setWfhOpen(true);
  };

  const saveWfhDay = async () => {
    if (!wfhDate) {
      toast("Pick a date for the WFH day", "error");
      return;
    }
    setWfhSaving(true);
    try {
      await apiPost("/attendance/wfh-days", {
        date: wfhDate,
        note: wfhNote.trim() || undefined,
      });
      toast("WFH day added", "success");
      setWfhOpen(false);
      loadWfhDays();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to add WFH day", "error");
    } finally {
      setWfhSaving(false);
    }
  };

  const handleWfhDelete = async () => {
    if (!confirmWfhDelete) return;
    setWfhDeleting(true);
    try {
      await apiDelete(`/attendance/wfh-days/${confirmWfhDelete.id}`);
      toast("WFH day removed", "success");
      setConfirmWfhDelete(null);
      loadWfhDays();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to remove WFH day", "error");
    } finally {
      setWfhDeleting(false);
    }
  };

  /* ── New attendance policy ── */
  const policyForm = useForm<PolicyInput>({
    resolver: zodResolver(policySchemaWithLocation),
    defaultValues: {
      name: "",
      workStart: "09:30",
      workEnd: "18:30",
      graceMinutes: 10,
      weeklyOffs: [0],
      fullDayMinutes: 480,
      halfDayMinutes: 240,
      isDefault: false,
      officeLatitude: undefined,
      officeLongitude: undefined,
      geofenceRadiusMeters: 200,
      requireLocation: false,
    },
  });

  useEffect(() => {
    if (policyOpen)
      policyForm.reset({
        name: "",
        workStart: "09:30",
        workEnd: "18:30",
        graceMinutes: 10,
        weeklyOffs: [0],
        fullDayMinutes: 480,
        halfDayMinutes: 240,
        isDefault: false,
        officeLatitude: undefined,
        officeLongitude: undefined,
        geofenceRadiusMeters: 200,
        requireLocation: false,
      });
  }, [policyOpen, policyForm]);

  const savePolicy = async (values: PolicyInput) => {
    try {
      await apiPost("/attendance/policies", values);
      toast("Attendance policy created", "success");
      setPolicyOpen(false);
      loadPolicies();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to create policy", "error");
    }
  };

  const [fillingLocation, setFillingLocation] = useState(false);

  const fillCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast("Geolocation isn't supported on this device", "error");
      return;
    }
    setFillingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        policyForm.setValue("officeLatitude", Number(pos.coords.latitude.toFixed(6)), {
          shouldValidate: true,
        });
        policyForm.setValue("officeLongitude", Number(pos.coords.longitude.toFixed(6)), {
          shouldValidate: true,
        });
        setFillingLocation(false);
        toast("Office location filled from your device", "success");
      },
      (err) => {
        setFillingLocation(false);
        toast(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — allow it in your browser settings to use this."
            : "Couldn't get your location. Try again.",
          "error",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Holidays & Policies"
        description="Company holidays for the year and attendance policies"
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add holiday
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <FormField label="Year">
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-auto">
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <Table<Holiday>
        columns={[
          { key: "date", header: "Date", render: (h) => formatDate(h.date) },
          {
            key: "name",
            header: "Name",
            render: (h) => <span className="font-medium text-ink">{h.name}</span>,
          },
          { key: "type", header: "Type", render: (h) => <Badge variant="slate">{prettify(h.type)}</Badge> },
          {
            key: "actions",
            header: "",
            className: "text-right tabular-nums",
            render: (h) => (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                onClick={() => setConfirmDelete(h)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            ),
          },
        ]}
        rows={holidays}
        rowKey={(h) => h.id}
        empty={
          <EmptyState
            icon={CalendarOff}
            title="No holidays"
            description={`No holidays defined for ${year}.`}
            action={
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add holiday
              </Button>
            }
          />
        }
      />

      {/* ── Attendance policies ── */}
      <div className="mb-4 mt-10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink">Attendance policies</h2>
          <p className="text-sm text-muted">
            Work hours, grace period, weekly offs and day-length thresholds
          </p>
        </div>
        <Button variant="outline" onClick={() => setPolicyOpen(true)}>
          <Plus className="h-4 w-4" /> New policy
        </Button>
      </div>

      {policies.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No attendance policies"
            description="Create a policy to define work hours and attendance rules."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {policies.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-semibold tracking-tight text-ink">{p.name}</h3>
                {p.isDefault && <Badge variant="emerald">Default</Badge>}
              </div>
              <dl className="space-y-1.5 text-sm text-muted">
                <div className="flex justify-between gap-3">
                  <dt>Work hours</dt>
                  <dd className="font-medium text-inksoft">
                    {formatPolicyTime(p.workStart)} – {formatPolicyTime(p.workEnd)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Grace period</dt>
                  <dd className="font-medium text-inksoft">{p.graceMinutes} min</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Weekly offs</dt>
                  <dd className="font-medium text-inksoft">
                    {p.weeklyOffs.length > 0
                      ? p.weeklyOffs
                          .slice()
                          .sort((a, b) => a - b)
                          .map((d) => DAY_NAMES[d])
                          .join(", ")
                      : "None"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Full day</dt>
                  <dd className="font-medium text-inksoft">≥ {formatMinutes(p.fullDayMinutes)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Half day</dt>
                  <dd className="font-medium text-inksoft">≥ {formatMinutes(p.halfDayMinutes)}</dd>
                </div>
                {p.officeLatitude != null && p.officeLongitude != null && (
                  <div className="flex justify-between gap-3">
                    <dt>Office location</dt>
                    <dd className="text-right font-medium text-inksoft">
                      {p.requireLocation
                        ? `Geofence · ${p.geofenceRadiusMeters ?? 200} m`
                        : "Set · not enforced"}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          ))}
        </div>
      )}

      {/* ── Company work-from-home days ── */}
      <div className="mb-4 mt-10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink">Work-from-home days</h2>
          <p className="text-sm text-muted">
            Company-wide WFH days — location checks are skipped and no request is needed
          </p>
        </div>
        <Button variant="outline" onClick={openWfhAdd}>
          <Plus className="h-4 w-4" /> Add WFH day
        </Button>
      </div>

      <Table<WfhDay>
        columns={[
          { key: "date", header: "Date", render: (w) => formatDate(w.date) },
          {
            key: "note",
            header: "Note",
            render: (w) => (
              <span className="block max-w-[300px] truncate text-inksoft" title={w.note ?? ""}>
                {w.note || "—"}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "text-right tabular-nums",
            render: (w) => (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                onClick={() => setConfirmWfhDelete(w)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            ),
          },
        ]}
        rows={wfhDays}
        rowKey={(w) => w.id}
        empty={
          <EmptyState
            icon={CalendarOff}
            title="No WFH days"
            description="Declare company-wide work-from-home days here."
            action={
              <Button onClick={openWfhAdd}>
                <Plus className="h-4 w-4" /> Add WFH day
              </Button>
            }
          />
        }
      />

      {/* Add holiday dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add holiday">
        <form onSubmit={holidayForm.handleSubmit(saveHoliday)} className="space-y-4">
          <FormField label="Date" required error={holidayForm.formState.errors.date?.message}>
            <Input type="date" {...holidayForm.register("date")} />
          </FormField>
          <FormField label="Name" required error={holidayForm.formState.errors.name?.message}>
            <Input {...holidayForm.register("name")} placeholder="Diwali" />
          </FormField>
          <FormField label="Type" error={holidayForm.formState.errors.type?.message}>
            <Select {...holidayForm.register("type")}>
              <option value="public">Public</option>
              <option value="optional">Optional</option>
              <option value="restricted">Restricted</option>
            </Select>
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={holidayForm.formState.isSubmitting}>
              Add holiday
            </Button>
          </div>
        </form>
      </Dialog>

      {/* New policy dialog */}
      <Dialog open={policyOpen} onClose={() => setPolicyOpen(false)} title="New attendance policy" wide>
        <form onSubmit={policyForm.handleSubmit(savePolicy)} className="space-y-4">
          <FormField label="Policy name" required error={policyForm.formState.errors.name?.message}>
            <Input {...policyForm.register("name")} placeholder="General shift" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Work start" required error={policyForm.formState.errors.workStart?.message}>
              <Input type="time" {...policyForm.register("workStart")} />
            </FormField>
            <FormField label="Work end" required error={policyForm.formState.errors.workEnd?.message}>
              <Input type="time" {...policyForm.register("workEnd")} />
            </FormField>
            <FormField label="Grace (minutes)" error={policyForm.formState.errors.graceMinutes?.message}>
              <Input
                type="number"
                min={0}
                {...policyForm.register("graceMinutes", { valueAsNumber: true })}
              />
            </FormField>
            <FormField label="Full day (minutes)" error={policyForm.formState.errors.fullDayMinutes?.message}>
              <Input
                type="number"
                min={60}
                {...policyForm.register("fullDayMinutes", { valueAsNumber: true })}
              />
            </FormField>
            <FormField label="Half day (minutes)" error={policyForm.formState.errors.halfDayMinutes?.message}>
              <Input
                type="number"
                min={30}
                {...policyForm.register("halfDayMinutes", { valueAsNumber: true })}
              />
            </FormField>
          </div>
          <FormField label="Weekly offs" error={policyForm.formState.errors.weeklyOffs?.message}>
            <Controller
              name="weeklyOffs"
              control={policyForm.control}
              render={({ field }) => (
                <div className="flex flex-wrap gap-2">
                  {DAY_NAMES.map((d, i) => {
                    const active = field.value?.includes(i) ?? false;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          field.onChange(
                            active
                              ? field.value.filter((x: number) => x !== i)
                              : [...(field.value ?? []), i],
                          )
                        }
                        className={cn(
                          "h-9 rounded-full border px-3.5 text-sm font-medium transition-colors",
                          active
                            ? "border-accent bg-accent text-white"
                            : "border-line bg-white text-muted hover:border-faint",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </FormField>
          <div className="rounded-xl border border-line bg-canvas p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-ink">
                <MapPin className="h-4 w-4 text-accent" /> Office location
              </h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fillCurrentLocation}
                loading={fillingLocation}
              >
                Use my current location
              </Button>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <FormField label="Latitude" error={policyForm.formState.errors.officeLatitude?.message}>
                <Input
                  type="number"
                  step="0.000001"
                  min={-90}
                  max={90}
                  placeholder="13.082700"
                  {...policyForm.register("officeLatitude", {
                    setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                  })}
                />
              </FormField>
              <FormField label="Longitude" error={policyForm.formState.errors.officeLongitude?.message}>
                <Input
                  type="number"
                  step="0.000001"
                  min={-180}
                  max={180}
                  placeholder="80.270700"
                  {...policyForm.register("officeLongitude", {
                    setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                  })}
                />
              </FormField>
              <FormField
                label="Geofence radius (meters)"
                error={policyForm.formState.errors.geofenceRadiusMeters?.message}
              >
                <Input
                  type="number"
                  min={50}
                  max={5000}
                  {...policyForm.register("geofenceRadiusMeters", { valueAsNumber: true })}
                />
              </FormField>
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                {...policyForm.register("requireLocation")}
                className="mt-0.5 h-4 w-4 rounded border-line accent-accent"
              />
              <span className="text-sm">
                <span className="font-medium text-inksoft">Require location for check-in</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Employees must be within the geofence to check in. If off, location is recorded
                  when available but never blocks check-in. GPS check-in is a deterrent only —
                  mock-location apps can defeat it; biometric devices are the real control.
                </span>
              </span>
            </label>
            <p className="mt-2 text-xs text-muted">
              Field staff working outside the office can be handled via HR attendance corrections.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-inksoft">
            <input
              type="checkbox"
              {...policyForm.register("isDefault")}
              className="h-4 w-4 rounded border-line accent-accent"
            />
            Make this the default policy
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setPolicyOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={policyForm.formState.isSubmitting}>
              Create policy
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete holiday confirmation */}
      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete holiday">
        <p className="text-sm text-muted">
          Delete <span className="font-medium text-ink">{confirmDelete?.name}</span> on{" "}
          {confirmDelete ? formatDate(confirmDelete.date) : ""}? This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} loading={deleting}>
            Delete
          </Button>
        </div>
      </Dialog>

      {/* Add WFH day dialog */}
      <Dialog open={wfhOpen} onClose={() => setWfhOpen(false)} title="Add work-from-home day">
        <div className="space-y-4">
          <FormField label="Date" required>
            <Input type="date" value={wfhDate} onChange={(e) => setWfhDate(e.target.value)} />
          </FormField>
          <FormField label="Note (optional)">
            <Input
              value={wfhNote}
              onChange={(e) => setWfhNote(e.target.value)}
              placeholder="e.g. Office deep-cleaning day"
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setWfhOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveWfhDay} loading={wfhSaving}>
              Add WFH day
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete WFH day confirmation */}
      <Dialog
        open={confirmWfhDelete !== null}
        onClose={() => setConfirmWfhDelete(null)}
        title="Remove WFH day"
      >
        <p className="text-sm text-muted">
          Remove the work-from-home day on{" "}
          <span className="font-medium text-ink">
            {confirmWfhDelete ? formatDate(confirmWfhDelete.date) : ""}
          </span>
          ? Employees will need to follow the normal check-in rules again.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmWfhDelete(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleWfhDelete} loading={wfhDeleting}>
            Remove
          </Button>
        </div>
      </Dialog>
    </>
  );
}
