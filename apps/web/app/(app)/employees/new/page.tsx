"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Landmark,
  MapPin,
  Pencil,
  User,
  type LucideIcon,
} from "lucide-react";
import {
  createEmployeeSchema,
  type CreateEmployeeInput,
  type PostalAddress,
} from "@hrms/shared";
import { apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { formatDate, prettify, todayInTZ, DEFAULT_TZ } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  AddressFields,
  BankDetailsFields,
  EMPLOYMENT_TYPES,
  useEmployeeLookups,
  cleanEmployeePayload,
} from "../employee-form";

interface CreatedLogin {
  name: string;
  email: string;
  temporaryPassword: string;
  employeeId?: string;
}

interface StepDef {
  title: string;
  description: string;
  icon: LucideIcon;
}

const STEPS: StepDef[] = [
  { title: "Personal Information", description: "Basic contact and identity details", icon: User },
  { title: "Employment Details", description: "Role, department and reporting structure", icon: Briefcase },
  { title: "Address", description: "Current and permanent address", icon: MapPin },
  { title: "Banking", description: "Bank account for salary payment", icon: Landmark },
  { title: "Review & Finish", description: "Final check before adding to the system", icon: ClipboardCheck },
];

const LAST_STEP = STEPS.length - 1;

/** Which step each top-level field belongs to (used to jump back on submit errors). */
const FIELD_STEP: Record<string, number> = {
  fullName: 0,
  employeeCode: 0,
  workEmail: 0,
  phone: 0,
  joiningDate: 0,
  departmentId: 1,
  designationId: 1,
  managerId: 1,
  employmentType: 1,
  address: 2,
  bankDetails: 3,
  emergencyContact: 0,
};

const PIN_RE = /^\d{6}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/i;

const emptyAddress: PostalAddress = { line: "", city: "", state: "", pin: "" };

function addressLines(a?: PostalAddress | null): string[] {
  if (!a) return [];
  const cityState = [a.city, a.state].filter((s) => s && s.trim() !== "").join(", ");
  const second = a.pin ? (cityState ? `${cityState} — ${a.pin}` : a.pin) : cityState;
  return [a.line, second].filter((s): s is string => !!s && s.trim() !== "");
}

function ReviewItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 text-sm text-ink">{value ?? "—"}</p>
    </div>
  );
}

function ReviewSection({
  title,
  stepIndex,
  onEdit,
  children,
}: {
  title: string;
  stepIndex: number;
  onEdit: (step: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line pb-5 last:border-b-0 last:pb-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-inksoft">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(stepIndex)}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export default function NewEmployeePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const lookups = useEmployeeLookups();
  const tz = user?.companyTimezone || DEFAULT_TZ;

  const [step, setStep] = useState(0);
  const [sameAddress, setSameAddress] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdLogin, setCreatedLogin] = useState<CreatedLogin | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    trigger,
    getValues,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      employmentType: "full_time",
      phone: "",
      joiningDate: todayInTZ(tz),
      address: {
        current: { ...emptyAddress },
        permanent: { ...emptyAddress },
      },
      bankDetails: { accountHolder: "", bankName: "", accountNumber: "", ifsc: "", branch: "" },
    },
  });

  /** Step-3 gate: any PIN that is filled in must be exactly 6 digits. */
  const validatePins = (): boolean => {
    let ok = true;
    const check = (path: "address.current.pin" | "address.permanent.pin", value?: string) => {
      if (value && value.trim() !== "" && !PIN_RE.test(value.trim())) {
        setError(path, { type: "manual", message: "Enter a valid 6-digit PIN code" });
        ok = false;
      } else {
        clearErrors(path);
      }
    };
    const values = getValues();
    check("address.current.pin", values.address?.current?.pin);
    if (sameAddress) clearErrors("address.permanent.pin");
    else check("address.permanent.pin", values.address?.permanent?.pin);
    return ok;
  };

  /** Step-4 gate: an IFSC that is filled in must be a valid IFSC. */
  const validateIfsc = (): boolean => {
    const ifsc = getValues("bankDetails.ifsc");
    if (ifsc && ifsc.trim() !== "" && !IFSC_RE.test(ifsc.trim())) {
      setError("bankDetails.ifsc", {
        type: "manual",
        message: "Enter a valid IFSC (e.g. HDFC0001234)",
      });
      return false;
    }
    clearErrors("bankDetails.ifsc");
    return true;
  };

  const goNext = async () => {
    if (step === 0) {
      const ok = await trigger(["fullName", "employeeCode", "workEmail", "joiningDate"]);
      if (!ok) return;
    }
    if (step === 2 && !validatePins()) return;
    if (step === 3 && !validateIfsc()) return;
    setStep((s) => Math.min(s + 1, LAST_STEP));
  };

  const onInvalid = (errs: FieldErrors<CreateEmployeeInput>) => {
    const steps = Object.keys(errs).map((k) => FIELD_STEP[k] ?? 0);
    if (steps.length > 0) setStep(Math.min(...steps));
    toast("Please fix the highlighted fields", "error");
  };

  const onSubmit = async (values: CreateEmployeeInput) => {
    // Pressing Enter mid-wizard advances instead of submitting early.
    if (step < LAST_STEP) {
      void goNext();
      return;
    }
    setSubmitting(true);
    try {
      const assembled: CreateEmployeeInput = sameAddress
        ? {
            ...values,
            address: {
              ...(values.address ?? {}),
              permanent: { ...(values.address?.current ?? {}) },
            },
          }
        : values;
      const res = await apiPost<{
        employee?: { id: string };
        id?: string;
        login?: { email: string; temporaryPassword: string } | null;
      }>("/employees", cleanEmployeePayload(assembled));
      const id = res.employee?.id ?? res.id;
      if (res.login) {
        setCopied(false);
        setCreatedLogin({
          name: values.fullName,
          email: res.login.email,
          temporaryPassword: res.login.temporaryPassword,
          employeeId: id,
        });
        return;
      }
      toast(`Employee ${values.fullName} added`, "success");
      router.push(id ? `/employees/${id}` : "/employees");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to add employee", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const closeLoginDialog = () => {
    const id = createdLogin?.employeeId;
    setCreatedLogin(null);
    router.push(id ? `/employees/${id}` : "/employees");
  };

  const copyLogin = async () => {
    if (!createdLogin) return;
    try {
      await navigator.clipboard.writeText(
        `Login email: ${createdLogin.email}\nTemporary password: ${createdLogin.temporaryPassword}`,
      );
      setCopied(true);
      toast("Login details copied", "success");
    } catch {
      toast("Copy failed — please note the details down", "error");
    }
  };

  if (lookups.loading) return <PageSkeleton />;

  const StepIcon = STEPS[step].icon;
  const review = watch();
  const deptName = lookups.departments.find((d) => d.id === review.departmentId)?.name;
  const desigName = lookups.designations.find((d) => d.id === review.designationId)?.title;
  const manager = lookups.managers.find((m) => m.id === review.managerId);
  const currentLines = addressLines(review.address?.current);
  const permanentLines = addressLines(sameAddress ? review.address?.current : review.address?.permanent);

  return (
    <div>
      <PageHeader
        title="Add employee"
        description="Create a new employee record in five quick steps. If a login is created, you'll get the sign-in details to share with them."
        backHref="/employees"
      />

      {/* Mobile step indicator */}
      <Card className="mb-4 px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink">
            Step {step + 1} of {STEPS.length} · {STEPS[step].title}
          </p>
          <div className="flex shrink-0 gap-1">
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={cn("h-1.5 w-4 rounded-full", i <= step ? "bg-accent" : "bg-line")}
              />
            ))}
          </div>
        </div>
      </Card>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
        <div className="grid items-start gap-6 lg:grid-cols-[300px_1fr]">
          {/* Step rail (desktop) */}
          <Card className="hidden p-3 lg:sticky lg:top-6 lg:block">
            <ol className="space-y-1">
              {STEPS.map((s, i) => {
                const done = i < step;
                const current = i === step;
                const Icon = s.icon;
                return (
                  <li key={s.title}>
                    <button
                      type="button"
                      disabled={i > step}
                      onClick={() => setStep(i)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150",
                        current && "bg-accent-soft",
                        !current && i <= step && "hover:bg-soft",
                        i > step && "cursor-default",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                          done && "bg-accent text-white",
                          current && "bg-brand-gradient text-white shadow-glow",
                          !done && !current && "border border-line text-faint",
                        )}
                      >
                        {done ? <Check className="h-4 w-4" /> : i + 1}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "flex items-center gap-1.5 text-sm font-semibold",
                            current ? "text-accent-ink" : done ? "text-ink" : "text-muted",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {s.title}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                          {s.description}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Card>

          {/* Step content */}
          <Card className="p-5 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
                  <StepIcon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold tracking-tight text-ink">{STEPS[step].title}</h2>
                  <p className="text-sm text-muted">{STEPS[step].description}</p>
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                Step {step + 1} of {STEPS.length}
              </span>
            </div>

            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Full name" required error={errors.fullName?.message}>
                  <Input {...register("fullName")} placeholder="e.g. Priya Raman" />
                </FormField>
                <FormField label="Employee code" required error={errors.employeeCode?.message}>
                  <Input {...register("employeeCode")} placeholder="e.g. EMP001" />
                </FormField>
                <FormField label="Work email" required error={errors.workEmail?.message}>
                  <Input {...register("workEmail")} type="email" placeholder="priya@company.com" />
                </FormField>
                <FormField label="Phone" error={errors.phone?.message}>
                  <Input {...register("phone")} placeholder="+91 98765 43210" />
                </FormField>
                <FormField label="Joining date" required error={errors.joiningDate?.message}>
                  <Input {...register("joiningDate")} type="date" />
                </FormField>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Department" error={errors.departmentId?.message}>
                  <Select {...register("departmentId")} disabled={lookups.loading}>
                    <option value="">Select department…</option>
                    {lookups.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Designation" error={errors.designationId?.message}>
                  <Select {...register("designationId")} disabled={lookups.loading}>
                    <option value="">Select designation…</option>
                    {lookups.designations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Reporting manager" error={errors.managerId?.message}>
                  <Select {...register("managerId")} disabled={lookups.loading}>
                    <option value="">No manager</option>
                    {lookups.managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName} ({m.employeeCode})
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Employment type" error={errors.employmentType?.message}>
                  <Select {...register("employmentType")}>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {prettify(t)}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
            )}

            {step === 2 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-inksoft">Current address</h3>
                <AddressFields register={register} errors={errors} which="current" />
                <label className="mt-5 flex cursor-pointer items-center gap-2 text-sm text-inksoft">
                  <input
                    type="checkbox"
                    checked={sameAddress}
                    onChange={(e) => setSameAddress(e.target.checked)}
                    className="h-4 w-4 rounded border-line accent-accent"
                  />
                  Permanent address is the same as current
                </label>
                {!sameAddress && (
                  <div className="mt-6">
                    <h3 className="mb-3 text-sm font-semibold text-inksoft">Permanent address</h3>
                    <AddressFields register={register} errors={errors} which="permanent" />
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div>
                <p className="mb-4 text-sm text-muted">
                  Used for salary payment. You can add this later.
                </p>
                <BankDetailsFields register={register} errors={errors} />
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <ReviewSection title="Personal" stepIndex={0} onEdit={setStep}>
                  <ReviewItem label="Full name" value={review.fullName || "—"} />
                  <ReviewItem label="Employee code" value={review.employeeCode || "—"} />
                  <ReviewItem label="Work email" value={review.workEmail || "—"} />
                  <ReviewItem label="Phone" value={review.phone || "—"} />
                  <ReviewItem
                    label="Joining date"
                    value={review.joiningDate ? formatDate(review.joiningDate) : "—"}
                  />
                </ReviewSection>
                <ReviewSection title="Employment" stepIndex={1} onEdit={setStep}>
                  <ReviewItem label="Department" value={deptName ?? "—"} />
                  <ReviewItem label="Designation" value={desigName ?? "—"} />
                  <ReviewItem
                    label="Reporting manager"
                    value={manager ? `${manager.fullName} (${manager.employeeCode})` : "—"}
                  />
                  <ReviewItem
                    label="Employment type"
                    value={review.employmentType ? prettify(review.employmentType) : "—"}
                  />
                </ReviewSection>
                <ReviewSection title="Address" stepIndex={2} onEdit={setStep}>
                  <ReviewItem
                    label="Current address"
                    value={
                      currentLines.length > 0 ? (
                        <span className="block space-y-0.5">
                          {currentLines.map((l, i) => (
                            <span key={i} className="block">
                              {l}
                            </span>
                          ))}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <ReviewItem
                    label="Permanent address"
                    value={
                      permanentLines.length > 0 ? (
                        <span className="block space-y-0.5">
                          {permanentLines.map((l, i) => (
                            <span key={i} className="block">
                              {l}
                            </span>
                          ))}
                          {sameAddress && <span className="block text-muted">(Same as current)</span>}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                </ReviewSection>
                <ReviewSection title="Banking" stepIndex={3} onEdit={setStep}>
                  <ReviewItem label="Account holder" value={review.bankDetails?.accountHolder || "—"} />
                  <ReviewItem label="Bank" value={review.bankDetails?.bankName || "—"} />
                  <ReviewItem label="Account number" value={review.bankDetails?.accountNumber || "—"} />
                  <ReviewItem label="IFSC" value={review.bankDetails?.ifsc || "—"} />
                  <ReviewItem label="Branch" value={review.bankDetails?.branch || "—"} />
                </ReviewSection>
              </div>
            )}

            {/* Footer */}
            <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
              {step > 0 ? (
                <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
              ) : (
                <span />
              )}
              {step < LAST_STEP ? (
                <Button type="button" onClick={() => void goNext()}>
                  Continue <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" loading={submitting}>
                  Add employee
                </Button>
              )}
            </div>
          </Card>
        </div>
      </form>

      <Dialog
        open={!!createdLogin}
        onClose={closeLoginDialog}
        title="Login created"
        footer={
          <>
            <Button variant="outline" onClick={copyLogin}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy
            </Button>
            <Button onClick={closeLoginDialog}>Done</Button>
          </>
        }
      >
        {createdLogin && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              A login has been created for{" "}
              <span className="font-medium text-ink">{createdLogin.name}</span>.
            </p>
            <div className="space-y-2 rounded-xl border border-line bg-soft px-4 py-3 font-mono text-sm text-ink">
              <p>
                <span className="text-muted">Email: </span>
                {createdLogin.email}
              </p>
              <p>
                <span className="text-muted">Password: </span>
                {createdLogin.temporaryPassword}
              </p>
            </div>
            <p className="text-sm text-muted">
              Shown only once — share it with the employee so they can sign in on their phone.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
