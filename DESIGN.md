# Design System — Attenza

Goal: premium, modern SaaS. Direction A "Modern SaaS": clean light UI, white
navigation, indigo→violet brand gradient. Full dark mode with a persistent
toggle. Tasteful gradients, glows and motion (2026-10-20 premium pass); no
decorative clutter, no dead buttons. Every visible control works.
Mobile-first for employee flows.

## Themes

Light and dark, toggled from the top bar (Sun/Moon button), persisted in
localStorage (`hrms-theme`), defaults to OS `prefers-color-scheme`. Pre-paint
script prevents flash-of-wrong-theme. Print always forces light.

## Tokens (CSS variables, `darkMode: "class"`)

- Font: **Plus Jakarta Sans** (loaded via next/font, weights 400–800,
  `--font-sans`). Page titles extrabold tracking-tight; sections bold;
  body 13–14px; muted 12–13px. Tabular numerals on stats, tables, money.
  (Note: pre-2026-10-20 the stack named Inter but never loaded it — the app
  silently fell back to system fonts. Jakarta is genuinely loaded.)
- Base: `canvas` (page bg #F6F7FB), `surface` (cards/sidebar #FFFFFF),
  `soft` (hover fills), `line` (borders #E9ECF3), `ink` (#111827),
  `inksoft`, `muted` (#6B7280), `faint` (#9CA3AF).
- Accent `accent` (#4F46E5 indigo-600), hover `accent-hover` (#4338CA),
  soft bg `accent-soft` (#EEF0FE), text on soft `accent-ink`.
  Second accent `accent-2` (#7C3AED violet; dark #A78BFA) + `glow`
  (rgba indigo shadow tint) drive the brand gradient: `.bg-brand-gradient`
  (135deg accent→accent-2; primary buttons, logo tile, stat icon chips) and
  `.shadow-glow`.
- Status: `success`/`warning`/`danger`/`info` + `-soft` variants.
- Dark theme: same tokens remapped (canvas #0A0F1E, surface #111A2E,
  accent #818CF8 for contrast, etc.).
- Radius: cards `rounded-2xl`, inputs/buttons `rounded-lg`/`rounded-xl`.
  Shadows: `shadow-sm` cards, `shadow-xl` popovers.
- Motion: theme cross-fade 350ms; page rise-in; staggered fade-up
  (`.animate-stagger`); card hover lift; button press scale; skeleton
  shimmer; dashboard stat count-up (~700ms, `lib/useCountUp.ts`); login
  aurora blobs drifting (20–26s); check-in button pulse-ring until checked
  in; dialog/dropdown pop (scale .97 + fade); table row fade-in. All gated
  behind `prefers-reduced-motion`. Focus-visible ring indigo.
- Signature surfaces: dashboard welcome band (gradient wash + glow blob,
  live one-line summary); login page (aurora backdrop + glass card);
  sidebar active item (accent-soft + 3px gradient indicator bar).
- Glass: frosted top bar (`bg-surface/70 backdrop-blur-xl`), dialog
  overlay/panel, dropdowns, toasts. Content cards stay solid.

## Component inventory (build once in `apps/web/components/ui/`)

Button (primary/ghost/destructive), Card, Input, Select, Textarea, Badge
(status variants), Table (sticky header, row hover, responsive → cards),
Dialog (confirm pattern), Tabs, Skeleton, Toast, Avatar (initials), StatCard
(value + label + link + delta), EmptyState (icon + text + action), Pagination,
FilterPills, DatePicker, SearchInput, PageHeader (title + description + action),
FormField (label + error), Stepper (wizard), ProgressSteps.

## App shell

- Collapsible navy sidebar. Sections: **Workspace** (Dashboard, Employees,
  Attendance, Leave) · **Finance** (Payroll, Billing, Reports) ·
  **Administration** (Departments & Designations, Holidays & Policies,
  Leave Types, Users & Permissions, Company Settings, Audit Log).
  Role-filtered. Active item: emerald left indicator.
- Top bar: page title + breadcrumb, global employee search (jumps to profile),
  notifications bell (pending approvals count), user menu (profile, logout).
- Content: `max-w-[1400px]`, `p-6`, consistent `PageHeader` on every screen.

## Screen inventory (all functional, no mocks)

1. **Login** — centered card, company name, email/password, error states.
2. **Dashboard** — action-first: StatCards row (headcount, present/absent/on-leave
   today, missing check-outs, pending leaves) each linking to filtered views;
   "Needs attention" list with inline approve/reject for leaves; payroll period
   card with status + month-on-month total; outstanding invoices card (if any);
   recent activity feed; quick actions.
3. **Employees list** — SearchInput, FilterPills (All/Active/On notice/Exited),
   department filter, status badges, row → profile. Mobile: cards.
4. **Employee profile** — header (avatar, code, status badge, actions),
   tabs: Overview | Attendance | Leave | Salary history | Activity.
5. **Add/Edit employee** — sectioned form (Personal, Employment, Emergency),
   inline validation errors.
6. **Import wizard** — Stepper: Template → Upload → Preview (row-level errors
   inline) → Map columns → Summary → Done. Never silently drops rows.
7. **Attendance — employee home** — live status card, big Check In/Out button
   (thumb-friendly, sticky on mobile), today's times, this-week strip.
8. **Attendance — HR daily** — date picker, FilterPills
   (All/Present/Late/Absent/On leave/Missing checkout), department filter,
   totals row, table with inline correct action (dialog, reason required).
9. **Attendance — monthly report** — month picker, grid view, CSV export.
10. **Leave — apply** — type select with live balance, date range with auto
    day-count, "who else is off these dates" warning, reason.
11. **Leave — my requests** — status pills, reviewer comments, cancel action.
12. **Leave — balances** — per-type cards with ledger breakdown
    (allocated/used/adjustments/carry-forward).
13. **Leave — approvals inbox** — queue with inline approve/reject + comment.
14. **Leave — team calendar** — month grid, overlap highlighting.
15. **Payroll — periods** — list with status badges, "new period" action.
16. **Payroll — period workspace** — guided steps
    (Inputs → Compute → Review → Approve → Finalized); exception list;
    month-on-month comparison banner; adjustments with reason; register table;
    CSV export.
17. **Payslips (employee)** — list + detail with earnings/deductions breakdown,
    print/PDF.
18. **Billing — customers** — CRUD.
19. **Billing — invoices** — list with status pills + outstanding banner; create
    (customer, dates, line items with tax %, auto totals); detail
    (issue action, record payment, PDF).
20. **Reports** — cards per report with filters + export.
21. **Admin** — departments/designations, holidays + attendance policy form,
    leave types, users & roles, company settings, audit log viewer.

## Premium patterns adopted (from market research)

Action-first dashboard with inline approve/reject · filter pills on lists ·
live clock-in widget · guided payroll wizard with preview-before-finalize ·
month-on-month payroll deltas in plain language · ledger-style leave breakdown ·
"who else is off" warning at apply time · global search in top bar · compliance
deadline hints (PF/ESI by 15th, TDS by 7th) on payroll screens · lean GST
invoicing (no incumbent does this — our differentiator) · regularization-style
corrections with mandatory reason + history.
