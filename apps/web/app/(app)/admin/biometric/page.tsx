"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Fingerprint, Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError, apiBase, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
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

/* ── Types ─────────────────────────────────────────────────────────── */

interface Device {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  _count: { mappings: number };
}

interface Mapping {
  id: string;
  deviceUserId: string;
  employee: { id: string; name: string; employeeCode: string };
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

export default function BiometricDevicesPage() {
  const { toast } = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  // Register flow
  const [registerOpen, setRegisterOpen] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Manage flow
  const [manageDevice, setManageDevice] = useState<Device | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [mapUserId, setMapUserId] = useState("");
  const [mapEmployeeId, setMapEmployeeId] = useState("");
  const [adding, setAdding] = useState(false);

  // Delete flow
  const [confirmDelete, setConfirmDelete] = useState<Device | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadDevices = useCallback(async () => {
    try {
      const res = await apiGet<Device[]>("/admin/biometric/devices");
      setDevices(Array.isArray(res) ? res : []);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to load devices", "error");
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadDevices();
      setLoading(false);
    })();
  }, [loadDevices]);

  const loadEmployees = useCallback(async () => {
    try {
      const res = await apiGet<{ data: EmployeeOption[] }>("/employees", { pageSize: 200 });
      setEmployees(res.data ?? []);
    } catch {
      /* mapping form degrades gracefully */
    }
  }, []);

  const loadMappings = useCallback(
    async (deviceId: string) => {
      setMappingsLoading(true);
      try {
        const res = await apiGet<Mapping[]>(`/admin/biometric/devices/${deviceId}/mappings`);
        setMappings(Array.isArray(res) ? res : []);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Failed to load mappings", "error");
      } finally {
        setMappingsLoading(false);
      }
    },
    [toast],
  );

  const openManage = (d: Device) => {
    setManageDevice(d);
    setMapUserId("");
    setMapEmployeeId("");
    loadMappings(d.id);
    if (employees.length === 0) loadEmployees();
  };

  /* ── Register ── */

  const register = async () => {
    const name = deviceName.trim();
    if (!name) {
      toast("Give the device a name first", "error");
      return;
    }
    setRegistering(true);
    try {
      const res = await apiPost<{ id: string; name: string; apiKey: string }>(
        "/admin/biometric/devices",
        { name },
      );
      setNewKey({ name: res.name, apiKey: res.apiKey });
      setDeviceName("");
      loadDevices();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to register device", "error");
    } finally {
      setRegistering(false);
    }
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey.apiKey);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = newKey.apiKey;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const closeRegister = () => {
    setRegisterOpen(false);
    setNewKey(null);
    setDeviceName("");
    setCopied(false);
  };

  /* ── Enable / disable / delete ── */

  const toggleStatus = async (d: Device) => {
    const next = d.status === "active" ? "disabled" : "active";
    try {
      await apiPatch(`/admin/biometric/devices/${d.id}`, { status: next });
      toast(`Device ${next === "active" ? "enabled" : "disabled"}`, "success");
      loadDevices();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to update device", "error");
    }
  };

  const removeDevice = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await apiDelete(`/admin/biometric/devices/${confirmDelete.id}`);
      toast("Device deleted", "success");
      setConfirmDelete(null);
      loadDevices();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to delete device", "error");
    } finally {
      setDeleting(false);
    }
  };

  /* ── Mappings ── */

  const addMapping = async () => {
    if (!manageDevice) return;
    if (!mapUserId.trim() || !mapEmployeeId) {
      toast("Enter the device user ID and pick an employee", "error");
      return;
    }
    setAdding(true);
    try {
      await apiPost(`/admin/biometric/devices/${manageDevice.id}/mappings`, {
        deviceUserId: mapUserId.trim(),
        employeeId: mapEmployeeId,
      });
      toast("Mapping added", "success");
      setMapUserId("");
      setMapEmployeeId("");
      loadMappings(manageDevice.id);
      loadDevices();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to add mapping", "error");
    } finally {
      setAdding(false);
    }
  };

  const removeMapping = async (m: Mapping) => {
    if (!manageDevice) return;
    try {
      await apiDelete(`/admin/biometric/devices/${manageDevice.id}/mappings/${m.id}`);
      toast("Mapping removed", "success");
      loadMappings(manageDevice.id);
      loadDevices();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed to remove mapping", "error");
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Biometric Devices"
        description="Fingerprint / face devices that push attendance punches"
        action={
          <Button onClick={() => setRegisterOpen(true)}>
            <Plus className="h-4 w-4" /> Register device
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <Table<Device>
          columns={[
            {
              key: "name",
              header: "Device",
              render: (d) => (
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                    <Fingerprint className="h-4 w-4" />
                  </span>
                  <span className="font-medium text-ink">{d.name}</span>
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (d) => (
                <Badge variant={d.status === "active" ? "emerald" : "slate"}>
                  {d.status === "active" ? "Active" : "Disabled"}
                </Badge>
              ),
            },
            {
              key: "mappings",
              header: "Mappings",
              render: (d) => <span className="tabular-nums text-inksoft">{d._count.mappings}</span>,
            },
            {
              key: "lastSeenAt",
              header: "Last seen",
              render: (d) => <span className="text-muted">{timeAgo(d.lastSeenAt)}</span>,
            },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (d) => (
                <div className="flex justify-end gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => openManage(d)}>
                    <Pencil className="h-3.5 w-3.5" /> Manage
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleStatus(d)}
                    title={d.status === "active" ? "Disable device" : "Enable device"}
                  >
                    {d.status === "active" ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    onClick={() => setConfirmDelete(d)}
                    title="Delete device"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ),
            },
          ]}
          rows={devices}
          rowKey={(d) => d.id}
          empty={
            <EmptyState
              icon={Fingerprint}
              title="No biometric devices"
              description="Register your fingerprint or face device to start receiving attendance punches."
              action={
                <Button onClick={() => setRegisterOpen(true)}>
                  <Plus className="h-4 w-4" /> Register device
                </Button>
              }
            />
          }
        />
      </Card>

      {/* Register dialog */}
      <Dialog open={registerOpen} onClose={closeRegister} title="Register device">
        {newKey ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
              <p className="font-semibold">Copy now — it won't be shown again.</p>
              <p className="mt-1 text-xs">
                This API key is shown only once. Paste it into the device configuration now.
              </p>
            </div>
            <FormField label={`API key for “${newKey.name}”`}>
              <div className="flex gap-2">
                <Input value={newKey.apiKey} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={copyKey}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </FormField>
            <div className="flex justify-end">
              <Button onClick={closeRegister}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <FormField label="Device name" required>
              <Input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="e.g. Main entrance — eSSL X990"
                onKeyDown={(e) => {
                  if (e.key === "Enter") register();
                }}
              />
            </FormField>
            <p className="text-xs text-muted">
              Registering generates a unique API key for this device. You'll configure the device
              (eSSL, ZKTeco, etc.) to push punches to Attenza with that key.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeRegister}>
                Cancel
              </Button>
              <Button onClick={register} loading={registering}>
                Register & generate key
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Manage dialog */}
      <Dialog
        open={!!manageDevice}
        onClose={() => setManageDevice(null)}
        title={manageDevice ? `Manage — ${manageDevice.name}` : "Manage device"}
        wide
      >
        {manageDevice && (
          <div className="space-y-6">
            {/* Mappings */}
            <div>
              <h4 className="text-sm font-semibold tracking-tight text-ink">User mappings</h4>
              <p className="mt-0.5 text-xs text-muted">
                Link each device user ID (enrollment number on the device) to an employee.
              </p>
              <div className="mt-3 overflow-hidden rounded-xl border border-line">
                <Table<Mapping>
                  columns={[
                    {
                      key: "deviceUserId",
                      header: "Device user ID",
                      render: (m) => (
                        <span className="font-mono text-sm text-ink">{m.deviceUserId}</span>
                      ),
                    },
                    {
                      key: "employee",
                      header: "Employee",
                      render: (m) => (
                        <div>
                          <p className="font-medium text-ink">{m.employee.name}</p>
                          <p className="text-xs text-muted">{m.employee.employeeCode}</p>
                        </div>
                      ),
                    },
                    {
                      key: "actions",
                      header: "",
                      className: "text-right",
                      render: (m) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:text-danger"
                          onClick={() => removeMapping(m)}
                          title="Remove mapping"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ),
                    },
                  ]}
                  rows={mappings}
                  rowKey={(m) => m.id}
                  empty={
                    <EmptyState
                      title="No mappings yet"
                      description="Add the first device user ID mapping below."
                    />
                  }
                />
              </div>
              {mappingsLoading && <p className="mt-2 text-xs text-muted">Loading mappings…</p>}
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <FormField label="Device user ID">
                  <Input
                    value={mapUserId}
                    onChange={(e) => setMapUserId(e.target.value)}
                    placeholder="e.g. 1042"
                  />
                </FormField>
                <FormField label="Employee">
                  <Select value={mapEmployeeId} onChange={(e) => setMapEmployeeId(e.target.value)}>
                    <option value="">Select employee…</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} · {e.employeeCode}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <Button onClick={addMapping} loading={adding}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
            </div>

            {/* Device setup instructions */}
            <div className="rounded-xl border border-line bg-canvas p-4">
              <h4 className="text-sm font-semibold tracking-tight text-ink">Device setup</h4>
              <p className="mt-1 text-xs text-muted">
                Configure the device to push each punch to this endpoint (shown once at
                registration — the key is not stored in readable form).
              </p>
              <dl className="mt-3 space-y-2 text-xs">
                <div>
                  <dt className="font-medium uppercase tracking-wide text-muted">Endpoint</dt>
                  <dd className="mt-0.5 break-all rounded-lg bg-surface p-2 font-mono text-inksoft">
                    {apiBase()}/attendance/biometric-punch
                  </dd>
                </div>
                <div>
                  <dt className="font-medium uppercase tracking-wide text-muted">Header</dt>
                  <dd className="mt-0.5 break-all rounded-lg bg-surface p-2 font-mono text-inksoft">
                    x-device-key: &lt;your device key&gt;
                  </dd>
                </div>
                <div>
                  <dt className="font-medium uppercase tracking-wide text-muted">Body (JSON)</dt>
                  <dd className="mt-0.5 overflow-x-auto rounded-lg bg-surface p-2 font-mono text-inksoft">
                    <pre>{`{ "deviceUserId": "1042", "timestamp": "2026-10-19T09:31:00.000Z", "type": "in" }`}</pre>
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted">
                <code className="font-mono">type</code> is <code className="font-mono">"in"</code>{" "}
                for check-in and <code className="font-mono">"out"</code> for check-out.
              </p>
            </div>
          </div>
        )}
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete device">
        <p className="text-sm text-muted">
          Delete <span className="font-medium text-ink">“{confirmDelete?.name}”</span>? Its API key
          stops working immediately and all user mappings are removed. This can't be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={removeDevice} loading={deleting}>
            Delete device
          </Button>
        </div>
      </Dialog>
    </>
  );
}
