"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileUp,
  RotateCcw,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { apiUpload, apiPost, downloadFile, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { Stepper } from "@/components/ui/Stepper";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

const STEPS = ["Template", "Upload", "Preview", "Map columns", "Summary", "Done"];

interface ExpectedField {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

const EXPECTED_FIELDS: ExpectedField[] = [
  { key: "employeeCode", label: "employeeCode", description: "Unique code, e.g. EMP001", required: true },
  { key: "fullName", label: "fullName", description: "Employee's full name", required: true },
  { key: "workEmail", label: "workEmail", description: "Work email address (unique)", required: true },
  { key: "phone", label: "phone", description: "Phone number", required: false },
  { key: "joiningDate", label: "joiningDate", description: "Joining date as YYYY-MM-DD", required: true },
  { key: "department", label: "department", description: "Department name (must already exist)", required: false },
  { key: "designation", label: "designation", description: "Designation title (must already exist)", required: false },
  { key: "managerCode", label: "managerCode", description: "Manager's employee code", required: false },
  { key: "employmentType", label: "employmentType", description: "full_time, part_time, contract or intern", required: false },
];

interface PreviewRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: Array<{ field: string; message: string }>;
}

interface PreviewResult {
  rows: PreviewRow[];
  validCount: number;
  errorCount: number;
}

interface CommitResult {
  imported: number;
  failed: Array<{ rowNumber: number; errors: Array<{ field: string; message: string }> | string[] }>;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function deriveHeaders(rows: PreviewRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.data)) {
      if (!seen.has(k)) seen.add(k);
    }
  }
  return Array.from(seen);
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_]+/g, "");
}

function autoMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of EXPECTED_FIELDS) {
    const hit = headers.find((h) => normalizeHeader(h) === normalizeHeader(f.key));
    if (hit) m[f.key] = hit;
  }
  return m;
}

function csvCell(v: string | undefined): string {
  const s = v ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ImportEmployeesPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);

  const runPreview = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await apiUpload<PreviewResult>("/employees/import/preview", fd);
      setPreview(r);
      const hs = deriveHeaders(r.rows);
      setHeaders(hs);
      setMapping(autoMapping(hs));
      return r;
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    if (!file) {
      toast("Choose a CSV file first", "error");
      return;
    }
    try {
      const r = await runPreview(file);
      toast(
        `Validation complete: ${r.validCount} valid, ${r.errorCount} with errors`,
        r.errorCount > 0 ? "info" : "success",
      );
      setStep(2);
    } catch (e) {
      toast(errMsg(e, "Validation failed"), "error");
    }
  };

  const handleApplyMapping = async () => {
    if (!preview) return;
    const missing = EXPECTED_FIELDS.filter((f) => f.required && !mapping[f.key]);
    if (missing.length > 0) {
      toast(`Map required columns: ${missing.map((f) => f.key).join(", ")}`, "error");
      return;
    }
    const mappedFields = EXPECTED_FIELDS.filter((f) => mapping[f.key]);
    const headerRow = mappedFields.map((f) => f.key);
    const bodyRows = preview.rows.map((r) => mappedFields.map((f) => r.data[mapping[f.key]] ?? ""));
    const csv = [headerRow, ...bodyRows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const remapped = new File([csv], "remapped.csv", { type: "text/csv" });
    try {
      const r = await runPreview(remapped);
      toast(`Re-validated: ${r.validCount} valid, ${r.errorCount} with errors`, "success");
      setStep(2);
    } catch (e) {
      toast(errMsg(e, "Re-validation failed"), "error");
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const validRows = preview.rows.filter((r) => r.errors.length === 0).map((r) => r.data);
    if (validRows.length === 0) {
      toast("No valid rows to import", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<CommitResult>("/employees/import/commit", { rows: validRows });
      setResult(r);
      setStep(5);
      toast(`Imported ${r.imported} employees`, "success");
    } catch (e) {
      toast(errMsg(e, "Import failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setStep(0);
    setFile(null);
    setPreview(null);
    setHeaders([]);
    setMapping({});
    setResult(null);
  };

  const downloadTemplate = async () => {
    try {
      await downloadFile("/employees/import/template", "employee_import_template.csv");
    } catch (e) {
      toast(errMsg(e, "Template download failed"), "error");
    }
  };

  const invalidRows = preview?.rows.filter((r) => r.errors.length > 0) ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Import employees"
        description="Bulk-add employees from a CSV file in a few guided steps."
        backHref="/employees"
      />

      <Card className="mb-6 p-5">
        <Stepper steps={STEPS} current={step} />
      </Card>

      {/* Step 0 — Template */}
      {step === 0 && (
        <Card className="p-5">
          <h2 className="text-base font-semibold tracking-tight text-ink">Download the template</h2>
          <p className="mt-1 text-sm text-muted">
            Start from the CSV template so every column lines up with what the importer expects.
          </p>
          <Button className="mt-4" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Download template
          </Button>
          <h3 className="mt-6 text-sm font-semibold text-inksoft">Expected columns</h3>
          <ul className="mt-2 divide-y divide-line">
            {EXPECTED_FIELDS.map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-4 py-2 text-sm">
                <div>
                  <code className="rounded bg-soft px-1.5 py-0.5 text-xs font-medium text-inksoft">
                    {f.label}
                  </code>
                  <p className="mt-0.5 text-xs text-muted">{f.description}</p>
                </div>
                {f.required ? (
                  <Badge variant="rose">Required</Badge>
                ) : (
                  <Badge variant="slate">Optional</Badge>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setStep(1)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 1 — Upload */}
      {step === 1 && (
        <Card className="p-5">
          <h2 className="text-base font-semibold tracking-tight text-ink">Upload your CSV</h2>
          <p className="mt-1 text-sm text-muted">
            Nothing is imported yet — the file is only validated at this stage.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <FileUp className="h-4 w-4" /> {file ? "Change file" : "Choose CSV file"}
            </Button>
            {file && <span className="text-sm text-muted">{file.name}</span>}
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button loading={busy} disabled={!file} onClick={handleValidate}>
              <Upload className="h-4 w-4" /> Validate file
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2 — Preview */}
      {step === 2 && preview && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="emerald">{preview.validCount} valid</Badge>
              <Badge variant={preview.errorCount > 0 ? "rose" : "slate"}>
                {preview.errorCount} with errors
              </Badge>
              <span className="text-sm text-muted">{preview.rows.length} rows total</span>
            </div>
          </Card>

          {preview.rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={Users}
                title="No rows found"
                description="The uploaded file didn't contain any data rows."
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {preview.rows.map((r) => (
                <Card key={r.rowNumber} className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-inksoft">Row {r.rowNumber}</span>
                    {r.errors.length === 0 ? (
                      <Badge variant="emerald">
                        <CheckCircle2 className="h-3 w-3" /> Valid
                      </Badge>
                    ) : (
                      <Badge variant="rose">
                        <XCircle className="h-3 w-3" /> {r.errors.length}{" "}
                        {r.errors.length === 1 ? "error" : "errors"}
                      </Badge>
                    )}
                  </div>
                  <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(r.data).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="shrink-0 font-medium text-faint">{k}:</dt>
                        <dd className="truncate text-inksoft">{v || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  {r.errors.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.errors.map((e, i) => (
                        <Badge key={i} variant="rose">
                          {e.field}: {e.message}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(3)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 — Map columns */}
      {step === 3 && preview && (
        <Card className="p-5">
          <h2 className="text-base font-semibold tracking-tight text-ink">Map columns</h2>
          <p className="mt-1 text-sm text-muted">
            Match each expected field to a column in your file. Headers were auto-matched where
            possible — adjust any that look wrong.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {EXPECTED_FIELDS.map((f) => (
              <FormField
                key={f.key}
                label={f.label}
                required={f.required}
                hint={f.required ? undefined : "Leave unmapped to skip this column"}
              >
                <Select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.key]: e.target.value }))
                  }
                >
                  <option value="">— {f.required ? "Select column…" : "Skip"} —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </FormField>
            ))}
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(4)}>
                Skip mapping
              </Button>
              <Button loading={busy} onClick={handleApplyMapping}>
                Apply mapping & re-validate
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step 4 — Summary */}
      {step === 4 && preview && (
        <Card className="p-5">
          <h2 className="text-base font-semibold tracking-tight text-ink">Ready to import</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <Badge variant="emerald">{preview.validCount} valid rows</Badge>
            <Badge variant={preview.errorCount > 0 ? "rose" : "slate"}>
              {preview.errorCount} invalid rows
            </Badge>
          </div>
          {invalidRows.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-inksoft">
                Rows that will be skipped
              </h3>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {invalidRows.map((r) => (
                  <div
                    key={r.rowNumber}
                    className="rounded-lg border border-danger/30 bg-danger-soft/50 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-inksoft">Row {r.rowNumber}:</span>{" "}
                    <span className="text-muted">
                      {r.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button
              loading={busy}
              disabled={preview.validCount === 0}
              onClick={handleCommit}
            >
              Import {preview.validCount} valid {preview.validCount === 1 ? "row" : "rows"}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 5 — Done */}
      {step === 5 && result && (
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-accent" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-ink">Import complete</h2>
              <p className="text-sm text-muted">
                {result.imported} {result.imported === 1 ? "employee" : "employees"} imported
                {result.failed.length > 0 &&
                  `, ${result.failed.length} failed`}
              </p>
            </div>
          </div>
          {result.failed.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-inksoft">Failed rows</h3>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {result.failed.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-danger/30 bg-danger-soft/50 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-inksoft">Row {f.rowNumber}:</span>{" "}
                    <span className="text-muted">
                      {f.errors
                        .map((e) =>
                          typeof e === "string" ? e : `${e.field}: ${e.message}`,
                        )
                        .join("; ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/employees">
              <Button>
                <Users className="h-4 w-4" /> Back to employees
              </Button>
            </Link>
            <Button variant="outline" onClick={resetAll}>
              <RotateCcw className="h-4 w-4" /> Start new import
            </Button>
          </div>
        </Card>
      )}

    </div>
  );
}
