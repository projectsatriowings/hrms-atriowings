import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarOff,
  Clock,
  FileText,
  Fingerprint,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Umbrella,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@hrms/shared";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const ALL: Role[] = ["employee", "hr", "md"];
const ADMIN: Role[] = ["hr", "md"];

export const NAV: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
      { href: "/employees", label: "Employees", icon: Users, roles: ["hr", "md"] },
      { href: "/attendance", label: "Attendance", icon: Clock, roles: ALL },
      { href: "/leave", label: "Leave", icon: CalendarDays, roles: ALL },
      { href: "/payroll/payslips", label: "My Payslips", icon: Receipt, roles: ["employee"] },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/payroll", label: "Payroll", icon: Wallet, roles: ADMIN },
      { href: "/billing/invoices", label: "Billing", icon: FileText, roles: ADMIN },
      { href: "/reports", label: "Reports", icon: BarChart3, roles: ADMIN },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin/departments", label: "Departments", icon: Building2, roles: ADMIN },
      { href: "/admin/holidays", label: "Holidays & Policies", icon: CalendarOff, roles: ADMIN },
      { href: "/admin/leave-types", label: "Leave Types", icon: Umbrella, roles: ADMIN },
      { href: "/admin/users", label: "Users & Permissions", icon: ShieldCheck, roles: ADMIN },
      { href: "/admin/biometric", label: "Biometric Devices", icon: Fingerprint, roles: ADMIN },
      { href: "/admin/settings", label: "Company Settings", icon: Settings, roles: ["md"] },
      { href: "/admin/audit", label: "Audit Log", icon: ScrollText, roles: ADMIN },
    ],
  },
];

export function navFor(role: Role): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.roles.includes(role)) })).filter(
    (s) => s.items.length > 0,
  );
}

const TITLES: Array<[RegExp, string]> = [
  [/^\/dashboard$/, "Dashboard"],
  [/^\/employees\/import$/, "Import Employees"],
  [/^\/employees\/new$/, "Add Employee"],
  [/^\/employees\/[^/]+\/edit$/, "Edit Employee"],
  [/^\/employees\/[^/]+$/, "Employee Profile"],
  [/^\/employees$/, "Employees"],
  [/^\/attendance\/monthly$/, "Monthly Attendance"],
  [/^\/attendance$/, "Attendance"],
  [/^\/leave\/apply$/, "Apply for Leave"],
  [/^\/leave\/my$/, "My Leave"],
  [/^\/leave\/balances$/, "Leave Balances"],
  [/^\/leave\/approvals$/, "Leave Approvals"],
  [/^\/leave\/calendar$/, "Team Calendar"],
  [/^\/leave$/, "Leave"],
  [/^\/payroll\/payslips$/, "My Payslips"],
  [/^\/payroll\/periods\/[^/]+$/, "Payroll Period"],
  [/^\/payroll$/, "Payroll"],
  [/^\/billing\/customers$/, "Customers"],
  [/^\/billing\/invoices\/new$/, "New Invoice"],
  [/^\/billing\/invoices\/[^/]+$/, "Invoice"],
  [/^\/billing\/invoices$/, "Invoices"],
  [/^\/reports$/, "Reports"],
  [/^\/admin\/departments$/, "Departments & Designations"],
  [/^\/admin\/holidays$/, "Holidays & Policies"],
  [/^\/admin\/leave-types$/, "Leave Types"],
  [/^\/admin\/users$/, "Users & Permissions"],
  [/^\/admin\/biometric$/, "Biometric Devices"],
  [/^\/admin\/settings$/, "Company Settings"],
  [/^\/admin\/audit$/, "Audit Log"],
];

export function titleFor(pathname: string): string {
  for (const [re, title] of TITLES) {
    if (re.test(pathname)) return title;
  }
  return "Attenza";
}
