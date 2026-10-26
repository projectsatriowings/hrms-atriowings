import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { dateOnly, pageParams, pageResult, round2, todayInTz, ymdOf } from "../common/utils";
import { RequestUser } from "../common/decorators";
import type { CreateInvoiceInput, CreateQuotationInput, CustomerInput, InvoicePaymentInput, QuotationStatusInput } from "@hrms/shared";
import { getLegal, inrAmountInWords, mergeOntoLetterhead, LETTERHEAD_BLUE, LETTERHEAD_BOTTOM_MARGIN, LETTERHEAD_CONTENT_TOP } from "./letterhead";

@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ── Customers ────────────────────────────────────────────────

  async listCustomers(user: RequestUser, q: { page?: number; pageSize?: number; search?: string }) {
    const { skip, take, page, pageSize } = pageParams(q.page, q.pageSize);
    const where = {
      companyId: user.companyId,
      ...(q.search ? { name: { contains: q.search, mode: "insensitive" as const } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({ where, orderBy: { name: "asc" }, skip, take }),
      this.prisma.customer.count({ where }),
    ]);
    return pageResult(data, total, page, pageSize);
  }

  async createCustomer(user: RequestUser, input: CustomerInput) {
    const created = await this.prisma.customer.create({
      data: { companyId: user.companyId, name: input.name.trim(), gstin: input.gstin, email: input.email, phone: input.phone, address: input.address ?? undefined },
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "billing.customer_created", entityType: "customer", entityId: created.id, after: { name: input.name } });
    return created;
  }

  async updateCustomer(user: RequestUser, id: string, input: Partial<CustomerInput>) {
    const existing = await this.prisma.customer.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Customer not found" });
    return this.prisma.customer.update({ where: { id }, data: { ...input, address: input.address ?? undefined } });
  }

  // ── Invoices ─────────────────────────────────────────────────

  private withBalance(inv: { total: unknown; amountPaid: unknown; dueDate: Date; status: string }, today: string) {
    const total = Number(inv.total);
    const paid = Number(inv.amountPaid);
    const balance = round2(total - paid);
    const isOverdue = balance > 0 && ymdOf(inv.dueDate) < today && (inv.status === "issued" || inv.status === "partially_paid");
    return { ...inv, balance, isOverdue, displayStatus: isOverdue ? "overdue" : inv.status };
  }

  async listInvoices(user: RequestUser, q: { page?: number; pageSize?: number; status?: string; customerId?: string; from?: string; to?: string }) {
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const today = todayInTz(company?.timezone ?? "Asia/Kolkata");
    const { skip, take, page, pageSize } = pageParams(q.page, q.pageSize);
    // A18: from+to are merged into ONE issueDate object. The old code spread
    // two separate issueDate keys, so the second (to) overwrote the first
    // (from) whenever both were given.
    const issueDate: Record<string, unknown> = {};
    if (q.from) issueDate.gte = dateOnly(q.from);
    if (q.to) issueDate.lte = dateOnly(q.to);
    const baseWhere: Record<string, unknown> = {
      companyId: user.companyId,
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(Object.keys(issueDate).length ? { issueDate } : {}),
    };
    if (q.status === "overdue") {
      // A19: overdue is filtered IN THE DATABASE QUERY (well, in a two-step
      // query whose total is computed after filtering), not in memory after
      // pagination. Overdue = dueDate before today AND balance > 0 AND status
      // in (issued, partially_paid). Balance comes from the payment sums, not
      // just the amountPaid column, so a drifted column cannot hide an
      // overdue invoice. The candidate set is fetched without pagination,
      // filtered, and only then paginated — so total and page items agree.
      const candidates = await this.prisma.invoice.findMany({
        where: {
          ...baseWhere,
          status: { in: ["issued", "partially_paid"] },
          dueDate: { lt: dateOnly(today) },
        },
        include: { customer: { select: { id: true, name: true } } },
        orderBy: { issueDate: "desc" },
      });
      const paidByInvoice = new Map<string, number>();
      if (candidates.length) {
        const sums = await this.prisma.invoicePayment.groupBy({
          by: ["invoiceId"],
          where: { invoiceId: { in: candidates.map((c) => c.id) } },
          _sum: { amount: true },
        });
        for (const row of sums) paidByInvoice.set(row.invoiceId, Number(row._sum.amount ?? 0));
      }
      const overdue = candidates
        .map((inv) => this.withBalance({ ...inv, amountPaid: paidByInvoice.get(inv.id) ?? 0 }, today))
        .filter((r) => r.balance > 0);
      return pageResult(overdue.slice(skip, skip + take), overdue.length, page, pageSize);
    }
    const where: Record<string, unknown> = {
      ...baseWhere,
      ...(q.status ? { status: q.status } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where, include: { customer: { select: { id: true, name: true } } },
        orderBy: { issueDate: "desc" }, skip, take,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    const result = data.map((inv) => this.withBalance(inv, today));
    return pageResult(result, total, page, pageSize);
  }

  async getInvoice(user: RequestUser, id: string) {
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const today = todayInTz(company?.timezone ?? "Asia/Kolkata");
    const inv = await this.prisma.invoice.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: true, items: { orderBy: { id: "asc" } }, payments: { orderBy: { paidOn: "desc" } } },
    });
    if (!inv) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    return this.withBalance(inv, today);
  }

  async createInvoice(user: RequestUser, input: CreateInvoiceInput) {
    const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: user.companyId } });
    if (!customer) throw new NotFoundException({ code: "not_found", message: "Customer not found" });
    // B8: invoiceNo is now optional. An explicit number is kept verbatim
    // (backward compatible with seed/manual numbers); otherwise a number is
    // auto-generated as <invoicePrefix>/<FY>/<seq>, exactly like quotations,
    // with the prefix read from Company.settings.billing (default "ATL").
    // The number is resolved inside the retry loop below, because a
    // concurrent create may take the count-based number first.
    const explicitNo = input.invoiceNo?.trim() || null;
    if (explicitNo) {
      const dup = await this.prisma.invoice.findFirst({ where: { companyId: user.companyId, invoiceNo: explicitNo } });
      if (dup) throw new ConflictException({ code: "duplicate_invoice_no", message: "Invoice number already exists" });
    }
    if (input.dueDate < input.issueDate) throw new BadRequestException({ code: "invalid_dates", message: "Due date cannot be before issue date" });

    const items = input.items.map((it) => {
      const lineTotal = round2(it.quantity * it.rate);
      const tax = round2((lineTotal * it.taxRate) / 100);
      return { ...it, lineTotal, tax };
    });
    const subtotal = round2(items.reduce((s, i) => s + i.lineTotal, 0));
    const taxTotal = round2(items.reduce((s, i) => s + i.tax, 0));
    const total = round2(subtotal + taxTotal);
    this.assertMoneyWithinLimits([...items.map((i) => round2(i.lineTotal + i.tax)), subtotal, taxTotal, total]);

    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const invoicePrefix = this.billingPrefixes(company?.settings).invoicePrefix;
    let created;
    let invoiceNo = explicitNo ?? "";
    for (let attempt = 0; attempt < 3 && !explicitNo; attempt++) {
      invoiceNo = await this.nextDocNumber(user.companyId, "invoice", invoicePrefix, input.issueDate);
      try {
        created = await this.tryCreateInvoice(user, customer.id, invoiceNo, input, subtotal, taxTotal, total, items);
        break;
      } catch (e) {
        if (this.isUniqueViolation(e)) continue;
        throw e;
      }
    }
    if (!created && explicitNo) {
      invoiceNo = explicitNo;
      try {
        created = await this.tryCreateInvoice(user, customer.id, invoiceNo, input, subtotal, taxTotal, total, items);
      } catch (e) {
        if (this.isUniqueViolation(e)) {
          throw new ConflictException({ code: "duplicate_invoice_no", message: "Invoice number already exists" });
        }
        throw e;
      }
    }
    if (!created) throw new ConflictException({ code: "duplicate_invoice_no", message: "Invoice number already exists" });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "billing.invoice_created", entityType: "invoice", entityId: created.id, after: { invoiceNo, total } });
    return created;
  }

  /** Single invoice insert shared by the explicit- and auto-number paths. */
  private async tryCreateInvoice(
    user: RequestUser, customerId: string, invoiceNo: string, input: CreateInvoiceInput,
    subtotal: number, taxTotal: number, total: number,
    items: Array<{ description: string; quantity: number; rate: number; taxRate: number; lineTotal: number; tax: number }>,
  ) {
    return this.prisma.invoice.create({
      data: {
        companyId: user.companyId, customerId, invoiceNo,
        issueDate: dateOnly(input.issueDate), dueDate: dateOnly(input.dueDate),
        subtotal, taxTotal, total, amountPaid: 0, status: "draft", notes: input.notes,
        items: { create: items.map((i) => ({ description: i.description, quantity: i.quantity, rate: i.rate, taxRate: i.taxRate, amount: round2(i.lineTotal + i.tax) })) },
      },
      include: { items: true, customer: true },
    });
  }

  async issueInvoice(user: RequestUser, id: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, companyId: user.companyId } });
    if (!inv) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    if (inv.status !== "draft") throw new ConflictException({ code: "invalid_transition", message: "Only draft invoices can be issued" });
    const updated = await this.prisma.invoice.update({ where: { id }, data: { status: "issued" } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "billing.invoice_issued", entityType: "invoice", entityId: id });
    return updated;
  }

  async recordPayment(user: RequestUser, id: string, input: InvoicePaymentInput) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, companyId: user.companyId } });
    if (!inv) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    if (inv.status === "draft") throw new BadRequestException({ code: "draft_invoice", message: "Issue the invoice before recording payments" });
    const total = Number(inv.total);
    const paid = Number(inv.amountPaid);
    if (round2(paid + input.amount) - total > 0.01) {
      throw new BadRequestException({ code: "overpayment", message: `Payment exceeds balance of ₹${round2(total - paid)}` });
    }
    const newPaid = round2(paid + input.amount);
    const status = newPaid >= total - 0.01 ? "paid" : "partially_paid";
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.invoicePayment.create({
        data: { invoiceId: id, amount: input.amount, paidOn: dateOnly(input.paidOn), method: input.method, reference: input.reference },
      });
      return tx.invoice.update({ where: { id }, data: { amountPaid: newPaid, status } });
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "billing.payment_recorded", entityType: "invoice", entityId: id, after: { amount: input.amount } });
    return updated;
  }

  async outstanding(user: RequestUser) {
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const today = todayInTz(company?.timezone ?? "Asia/Kolkata");
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId: user.companyId, status: { in: ["issued", "partially_paid"] } },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
    });
    const withBal = invoices.map((inv) => this.withBalance(inv, today)).filter((r) => r.balance > 0);
    return {
      invoices: withBal,
      totalOutstanding: round2(withBal.reduce((s, r) => s + r.balance, 0)),
      overdueCount: withBal.filter((r) => r.isOverdue).length,
    };
  }

  // ── Quotations ───────────────────────────────────────────────

  /** Indian financial year label for a YMD date: Apr 2026–Mar 2027 → "2026-27". */
  private fyOf(ymd: string): string {
    const year = Number(ymd.slice(0, 4));
    const month = Number(ymd.slice(5, 7));
    const start = month >= 4 ? year : year - 1;
    return `${start}-${String(start + 1).slice(2)}`;
  }

  /** Billing prefixes from Company.settings.billing, with the historical
   *  defaults preserved when the company has not configured its own. */
  private billingPrefixes(settings: unknown): { quotationPrefix: string; invoicePrefix: string } {
    const billing = (settings as { billing?: unknown } | null)?.billing;
    const qp = (billing as { quotationPrefix?: unknown } | null)?.quotationPrefix;
    const ip = (billing as { invoicePrefix?: unknown } | null)?.invoicePrefix;
    return {
      quotationPrefix: typeof qp === "string" && qp.trim() ? qp.trim() : "ATQ",
      invoicePrefix: typeof ip === "string" && ip.trim() ? ip.trim() : "ATL",
    };
  }

  /** Next document number for the company + FY of the given date. */
  private async nextDocNumber(companyId: string, kind: "quotation" | "invoice", prefix: string, issueYmd: string): Promise<string> {
    const head = `${prefix}/${this.fyOf(issueYmd)}/`;
    const count = kind === "quotation"
      ? await this.prisma.quotation.count({ where: { companyId, quotationNo: { startsWith: head } } })
      : await this.prisma.invoice.count({ where: { companyId, invoiceNo: { startsWith: head } } });
    return `${head}${String(count + 1).padStart(3, "0")}`;
  }

  /** Money columns are Decimal(12,2); reject anything that cannot be stored
   *  instead of letting the insert fail with a 500. */
  private assertMoneyWithinLimits(amounts: number[]) {
    for (const a of amounts) {
      if (!Number.isFinite(a) || Math.abs(a) > 9_999_999_999.99) {
        throw new BadRequestException({ code: "amount_too_large", message: "Amount exceeds the supported maximum of ₹9,99,99,99,999.99" });
      }
    }
  }

  /** Prisma unique-constraint error (P2002), duck-typed. */
  private isUniqueViolation(e: unknown): boolean {
    return !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";
  }

  private priceItems(items: CreateQuotationInput["items"]) {
    const priced = items.map((it) => {
      const lineTotal = round2(it.quantity * it.rate);
      const tax = round2((lineTotal * it.taxRate) / 100);
      return { description: it.description, quantity: it.quantity, rate: it.rate, taxRate: it.taxRate, lineTotal, tax, amount: round2(lineTotal + tax) };
    });
    const totals = {
      items: priced,
      subtotal: round2(priced.reduce((s, i) => s + i.lineTotal, 0)),
      taxTotal: round2(priced.reduce((s, i) => s + i.tax, 0)),
      total: round2(priced.reduce((s, i) => s + i.amount, 0)),
    };
    this.assertMoneyWithinLimits([...priced.map((i) => i.amount), totals.subtotal, totals.taxTotal, totals.total]);
    return totals;
  }

  async listQuotations(user: RequestUser, q: { page?: number; pageSize?: number; status?: string; customerId?: string; search?: string }) {
    const { skip, take, page, pageSize } = pageParams(q.page, q.pageSize);
    const where: Record<string, unknown> = {
      companyId: user.companyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.search ? {
        OR: [
          { quotationNo: { contains: q.search, mode: "insensitive" as const } },
          { customer: { name: { contains: q.search, mode: "insensitive" as const } } },
        ],
      } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.quotation.findMany({
        where,
        include: { customer: { select: { id: true, name: true } }, _count: { select: { items: true } } },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }], skip, take,
      }),
      this.prisma.quotation.count({ where }),
    ]);
    const result = data.map(({ _count, ...rest }) => ({ ...rest, itemsCount: _count.items }));
    return pageResult(result, total, page, pageSize);
  }

  async createQuotation(user: RequestUser, input: CreateQuotationInput) {
    const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: user.companyId } });
    if (!customer) throw new NotFoundException({ code: "not_found", message: "Customer not found" });
    if (input.validUntil < input.issueDate) throw new BadRequestException({ code: "invalid_dates", message: "Valid-until date cannot be before issue date" });

    const { items, subtotal, taxTotal, total } = this.priceItems(input.items);
    // Numbers are count-based: if a concurrent create takes the number first,
    // the unique key fires — recompute and retry instead of returning a 500.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const quotationNo = await this.nextDocNumber(user.companyId, "quotation", this.billingPrefixes((await this.prisma.company.findUnique({ where: { id: user.companyId } }))?.settings).quotationPrefix, input.issueDate);
      try {
        const created = await this.prisma.quotation.create({
          data: {
            companyId: user.companyId, customerId: customer.id, quotationNo,
            issueDate: dateOnly(input.issueDate), validUntil: dateOnly(input.validUntil),
            subtotal, taxTotal, total, status: "draft", terms: input.terms, notes: input.notes,
            items: { create: items.map((i) => ({ description: i.description, quantity: i.quantity, rate: i.rate, taxRate: i.taxRate, amount: i.amount })) },
          },
          include: { items: { orderBy: { id: "asc" } }, customer: true },
        });
        await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "billing.quotation_created", entityType: "quotation", entityId: created.id, after: { quotationNo, total } });
        return created;
      } catch (e) {
        if (this.isUniqueViolation(e)) { lastErr = e; continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  async getQuotation(user: RequestUser, id: string) {
    const q = await this.prisma.quotation.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: true, items: { orderBy: { id: "asc" } } },
    });
    if (!q) throw new NotFoundException({ code: "not_found", message: "Quotation not found" });
    return q;
  }

  async updateQuotation(user: RequestUser, id: string, input: Partial<CreateQuotationInput>) {
    const existing = await this.prisma.quotation.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Quotation not found" });
    if (existing.status !== "draft") throw new ConflictException({ code: "not_editable", message: "Only draft quotations can be edited" });

    if (input.customerId && input.customerId !== existing.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: user.companyId } });
      if (!customer) throw new NotFoundException({ code: "not_found", message: "Customer not found" });
    }
    const issueYmd = input.issueDate ?? ymdOf(existing.issueDate);
    const validYmd = input.validUntil ?? ymdOf(existing.validUntil);
    if (validYmd < issueYmd) throw new BadRequestException({ code: "invalid_dates", message: "Valid-until date cannot be before issue date" });

    const priced = input.items ? this.priceItems(input.items) : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (priced) await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      return tx.quotation.update({
        where: { id },
        data: {
          ...(input.customerId ? { customerId: input.customerId } : {}),
          ...(input.issueDate ? { issueDate: dateOnly(input.issueDate) } : {}),
          ...(input.validUntil ? { validUntil: dateOnly(input.validUntil) } : {}),
          ...(input.terms !== undefined ? { terms: input.terms } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(priced ? {
            subtotal: priced.subtotal, taxTotal: priced.taxTotal, total: priced.total,
            items: { create: priced.items.map((i) => ({ description: i.description, quantity: i.quantity, rate: i.rate, taxRate: i.taxRate, amount: i.amount })) },
          } : {}),
        },
        include: { items: { orderBy: { id: "asc" } }, customer: true },
      });
    });
    return updated;
  }

  async deleteQuotation(user: RequestUser, id: string) {
    const existing = await this.prisma.quotation.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Quotation not found" });
    if (existing.status !== "draft") throw new ConflictException({ code: "not_editable", message: "Only draft quotations can be deleted" });
    await this.prisma.quotation.delete({ where: { id } });
    return { ok: true };
  }

  async setQuotationStatus(user: RequestUser, id: string, input: QuotationStatusInput) {
    const q = await this.prisma.quotation.findFirst({ where: { id, companyId: user.companyId } });
    if (!q) throw new NotFoundException({ code: "not_found", message: "Quotation not found" });
    const allowed: Record<string, string[]> = {
      draft: ["sent", "expired"],
      sent: ["accepted", "rejected", "expired"],
      accepted: [], rejected: [], expired: [], converted: [],
    };
    if (!allowed[q.status]?.includes(input.status)) {
      throw new ConflictException({ code: "invalid_transition", message: `Cannot move a ${q.status} quotation to ${input.status}` });
    }
    const updated = await this.prisma.quotation.update({ where: { id }, data: { status: input.status } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "billing.quotation_status", entityType: "quotation", entityId: id, before: { status: q.status }, after: { status: input.status } });
    return updated;
  }

  async convertQuotation(user: RequestUser, id: string) {
    const q = await this.prisma.quotation.findFirst({
      where: { id, companyId: user.companyId },
      include: { items: { orderBy: { id: "asc" } } },
    });
    if (!q) throw new NotFoundException({ code: "not_found", message: "Quotation not found" });
    if (q.status !== "accepted") throw new ConflictException({ code: "not_accepted", message: "Only accepted quotations can be converted to an invoice" });

    const issueYmd = ymdOf(q.issueDate);
    const notes = `Converted from quotation ${q.quotationNo}${q.notes ? `\n${q.notes}` : ""}`;
    // The status flip happens FIRST inside the transaction as an atomic claim
    // (updateMany conditioned on status="accepted"): a concurrent convert of
    // the same quotation updates 0 rows and fails with a clean 409 instead of
    // creating a duplicate invoice or dying on a unique-key 500. The whole
    // attempt retries if a DIFFERENT quotation's convert grabs the same
    // count-based invoice number first.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const invoiceNo = await this.nextDocNumber(user.companyId, "invoice", this.billingPrefixes((await this.prisma.company.findUnique({ where: { id: user.companyId } }))?.settings).invoicePrefix, issueYmd);
      try {
        const invoice = await this.prisma.$transaction(async (tx) => {
          const claim = await tx.quotation.updateMany({
            where: { id, companyId: user.companyId, status: "accepted" },
            data: { status: "converted" },
          });
          if (claim.count === 0) {
            throw new ConflictException({ code: "not_accepted", message: "Only accepted quotations can be converted to an invoice" });
          }
          const created = await tx.invoice.create({
            data: {
              companyId: user.companyId, customerId: q.customerId, invoiceNo,
              issueDate: q.issueDate, dueDate: q.validUntil,
              subtotal: q.subtotal, taxTotal: q.taxTotal, total: q.total, amountPaid: 0, status: "draft", notes,
              items: { create: q.items.map((i) => ({ description: i.description, quantity: i.quantity, rate: i.rate, taxRate: i.taxRate, amount: i.amount })) },
            },
            include: { items: { orderBy: { id: "asc" } }, customer: true },
          });
          await tx.quotation.update({ where: { id }, data: { convertedInvoiceId: created.id } });
          return created;
        });
        await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "billing.quotation_converted", entityType: "quotation", entityId: id, after: { invoiceId: invoice.id, invoiceNo } });
        await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "billing.invoice_created", entityType: "invoice", entityId: invoice.id, after: { invoiceNo, total: Number(q.total), fromQuotation: q.quotationNo } });
        return invoice;
      } catch (e) {
        if (this.isUniqueViolation(e)) { lastErr = e; continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  // ── PDF ──────────────────────────────────────────────────────

  async invoicePdf(user: RequestUser, id: string): Promise<Buffer> {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: true, items: true, payments: { orderBy: { paidOn: "asc" } }, company: true },
    });
    if (!inv) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });

    const legal = getLegal(inv.company.settings);
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: LETTERHEAD_CONTENT_TOP, bottom: LETTERHEAD_BOTTOM_MARGIN, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

    const money = (n: number | unknown) => `Rs. ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    let y = LETTERHEAD_CONTENT_TOP;

    doc.font("Helvetica-Bold").fontSize(16).fillColor(LETTERHEAD_BLUE).text("TAX INVOICE", 50, y);
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text(`From: ${inv.company.name} · GSTIN: ${legal.gstin}`, 50, y + 22);
    y += 48;

    doc.fontSize(10).fillColor("#0F172A");
    doc.text(`Invoice No: ${inv.invoiceNo}`, 50, y);
    doc.text(`Issue Date: ${ymdOf(inv.issueDate)}`, 50, y + 14);
    doc.text(`Due Date: ${ymdOf(inv.dueDate)}`, 50, y + 28);
    doc.text(`Status: ${inv.status.toUpperCase()}`, 50, y + 42);
    doc.text("Bill To:", 320, y);
    doc.fontSize(11).text(inv.customer.name, 320, y + 14);
    doc.fontSize(9).fillColor("#475569");
    if (inv.customer.gstin) doc.text(`GSTIN: ${inv.customer.gstin}`, 320, y + 30);
    if (inv.customer.email) doc.text(inv.customer.email, 320, y + 44);
    if (inv.customer.phone) doc.text(inv.customer.phone, 320, y + 58);
    y += 110;

    // Items table
    const cols = [50, 268, 318, 412, 456];
    const colW = [212, 42, 88, 38, 88];
    doc.fontSize(9).fillColor("#FFFFFF").rect(50, y, 500, 20).fill("#0F172A");
    doc.text("Description", cols[0] + 6, y + 6, { width: colW[0] });
    doc.text("Qty", cols[1], y + 6, { width: colW[1], align: "right" });
    doc.text("Rate", cols[2], y + 6, { width: colW[2], align: "right" });
    doc.text("GST%", cols[3], y + 6, { width: colW[3], align: "right" });
    doc.text("Amount", cols[4], y + 6, { width: colW[4], align: "right" });
    y += 20;
    doc.fillColor("#0F172A");
    for (const item of inv.items) {
      doc.fontSize(9);
      doc.text(item.description, cols[0] + 6, y + 6, { width: colW[0] });
      doc.text(String(item.quantity), cols[1], y + 6, { width: colW[1], align: "right" });
      doc.text(money(item.rate), cols[2], y + 6, { width: colW[2], align: "right" });
      doc.text(`${item.taxRate}%`, cols[3], y + 6, { width: colW[3], align: "right" });
      doc.text(money(item.amount), cols[4], y + 6, { width: colW[4], align: "right" });
      y += 22;
      doc.strokeColor("#E2E8F0").lineWidth(0.5).moveTo(50, y).lineTo(550, y).stroke();
    }
    y += 16;
    const totals: [string, unknown][] = [
      ["Subtotal", inv.subtotal],
      ["Tax Total", inv.taxTotal],
      ["Invoice Total", inv.total],
      ["Amount Paid", inv.amountPaid],
      ["Balance Due", round2(Number(inv.total) - Number(inv.amountPaid))],
    ];
    for (const [label, val] of totals) {
      doc.fontSize(label === "Balance Due" ? 11 : 9).fillColor(label === "Balance Due" ? "#059669" : "#0F172A");
      doc.text(label, 350, y, { width: 100, align: "right" });
      doc.text(money(val), 460, y, { width: 90, align: "right" });
      y += 16;
    }
    if (inv.notes) {
      y += 10;
      doc.fontSize(9).fillColor("#64748B").text(`Notes: ${inv.notes}`, 50, y, { width: 500 });
    }

    doc.end();
    return mergeOntoLetterhead(await done);
  }

  async quotationPdf(user: RequestUser, id: string): Promise<Buffer> {
    const q = await this.prisma.quotation.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: true, items: { orderBy: { id: "asc" } }, company: true },
    });
    if (!q) throw new NotFoundException({ code: "not_found", message: "Quotation not found" });

    const legal = getLegal(q.company.settings);
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: LETTERHEAD_CONTENT_TOP, bottom: LETTERHEAD_BOTTOM_MARGIN, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

    const money = (n: number | unknown) => `Rs. ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    let y = LETTERHEAD_CONTENT_TOP;

    // Title + meta block
    doc.font("Helvetica-Bold").fontSize(16).fillColor(LETTERHEAD_BLUE).text("QUOTATION", 50, y);
    doc.font("Helvetica").fontSize(10).fillColor("#0F172A");
    doc.text(`Quotation No: ${q.quotationNo}`, 320, y, { width: 225, align: "right" });
    doc.text(`Date: ${ymdOf(q.issueDate)}`, 320, y + 15, { width: 225, align: "right" });
    doc.text(`Valid Until: ${ymdOf(q.validUntil)}`, 320, y + 30, { width: 225, align: "right" });
    doc.fontSize(9).fillColor("#64748B").text(`Status: ${q.status.toUpperCase()}`, 320, y + 45, { width: 225, align: "right" });
    y += 62;

    // Customer block
    doc.fontSize(10).fillColor("#0F172A").text("To:", 50, y);
    doc.font("Helvetica-Bold").fontSize(11).text(q.customer.name, 50, y + 14);
    doc.font("Helvetica").fontSize(9).fillColor("#475569");
    let cy = y + 32;
    if (q.customer.gstin) { doc.text(`GSTIN: ${q.customer.gstin}`, 50, cy); cy += 12; }
    const addr = (q.customer.address && typeof q.customer.address === "object") ? q.customer.address as Record<string, unknown> : {};
    const addrLine = [addr.line, addr.city, addr.state, addr.pin].filter((v) => typeof v === "string" && v).join(", ");
    if (addrLine) { doc.text(addrLine, 50, cy, { width: 320 }); cy += 12; }
    if (q.customer.email) { doc.text(q.customer.email, 50, cy); cy += 12; }
    if (q.customer.phone) { doc.text(q.customer.phone, 50, cy); cy += 12; }
    y = Math.max(y + 78, cy + 6);

    // Items table
    const cols = [50, 268, 318, 412, 456];
    const colW = [212, 42, 88, 38, 88];
    doc.fontSize(9).fillColor("#FFFFFF").rect(50, y, 500, 20).fill(LETTERHEAD_BLUE);
    doc.text("Description", cols[0] + 6, y + 6, { width: colW[0] });
    doc.text("Qty", cols[1], y + 6, { width: colW[1], align: "right" });
    doc.text("Rate", cols[2], y + 6, { width: colW[2], align: "right" });
    doc.text("GST%", cols[3], y + 6, { width: colW[3], align: "right" });
    doc.text("Amount", cols[4], y + 6, { width: colW[4], align: "right" });
    y += 20;
    doc.fillColor("#0F172A");
    for (const item of q.items) {
      doc.fontSize(9);
      doc.text(item.description, cols[0] + 6, y + 6, { width: colW[0] });
      doc.text(String(item.quantity), cols[1], y + 6, { width: colW[1], align: "right" });
      doc.text(money(item.rate), cols[2], y + 6, { width: colW[2], align: "right" });
      doc.text(`${item.taxRate}%`, cols[3], y + 6, { width: colW[3], align: "right" });
      doc.text(money(item.amount), cols[4], y + 6, { width: colW[4], align: "right" });
      y += 22;
      doc.strokeColor("#E2E8F0").lineWidth(0.5).moveTo(50, y).lineTo(550, y).stroke();
    }
    y += 16;

    // Totals
    const totals: [string, unknown, boolean][] = [
      ["Subtotal", q.subtotal, false],
      ["GST", q.taxTotal, false],
      ["Grand Total", q.total, true],
    ];
    for (const [label, val, bold] of totals) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor("#0F172A");
      doc.text(label, 350, y, { width: 100, align: "right" });
      doc.text(money(val), 460, y, { width: 90, align: "right" });
      y += 16;
    }
    y += 6;
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#475569")
      .text(`Amount in words: ${inrAmountInWords(Number(q.total))}`, 50, y, { width: 500 });
    y += 24;

    // Terms & conditions
    if (q.terms) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A").text("Terms & Conditions", 50, y);
      y += 14;
      doc.font("Helvetica").fontSize(9).fillColor("#475569");
      for (const line of q.terms.split(/\r?\n/)) {
        doc.text(line, 50, y, { width: 500 });
        y += doc.heightOfString(line || " ", { width: 500 }) + 2;
      }
      y += 8;
    }
    if (q.notes) {
      doc.font("Helvetica").fontSize(9).fillColor("#64748B").text(`Notes: ${q.notes}`, 50, y, { width: 500 });
      y += doc.heightOfString(`Notes: ${q.notes}`, { width: 500 }) + 8;
    }

    // Sign-off
    y = Math.max(y + 12, 560);
    doc.font("Helvetica").fontSize(10).fillColor("#0F172A");
    doc.text(`For ${legal.legalName}`, 320, y, { width: 225, align: "right" });
    doc.font("Helvetica-Bold").text("Authorised Signatory", 320, y + 52, { width: 225, align: "right" });

    doc.end();
    return mergeOntoLetterhead(await done);
  }
}
