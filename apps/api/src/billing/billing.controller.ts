import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, StreamableFile } from "@nestjs/common";
import type { Response } from "express";
import { BillingService } from "./billing.service";
import { CurrentUser, RequestUser, Roles } from "../common/decorators";
import { ZodBody, ZodQuery } from "../common/zod.pipe";
import {
  createInvoiceSchema, createQuotationSchema, customerSchema, invoicePaymentSchema, paginationQuerySchema, quotationStatusSchema, z,
  type CreateInvoiceInput, type CreateQuotationInput, type CustomerInput, type InvoicePaymentInput, type QuotationStatusInput,
} from "@hrms/shared";

const invoiceListQuery = paginationQuerySchema.extend({
  status: z.string().optional(),
  customerId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const quotationListQuery = paginationQuerySchema.extend({
  status: z.string().optional(),
  customerId: z.string().optional(),
});

@Controller()
@Roles("hr", "md")
export class BillingController {
  constructor(private billing: BillingService) {}

  @Get("customers")
  customers(@CurrentUser() user: RequestUser, @Query(ZodQuery(paginationQuerySchema)) q: { page?: number; pageSize?: number; search?: string }) {
    return this.billing.listCustomers(user, q);
  }

  @Post("customers")
  createCustomer(@CurrentUser() user: RequestUser, @Body(ZodBody(customerSchema)) body: CustomerInput) {
    return this.billing.createCustomer(user, body);
  }

  @Patch("customers/:id")
  updateCustomer(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(customerSchema.partial())) body: Partial<CustomerInput>) {
    return this.billing.updateCustomer(user, id, body);
  }

  @Get("invoices")
  invoices(@CurrentUser() user: RequestUser, @Query(ZodQuery(invoiceListQuery)) q: z.infer<typeof invoiceListQuery>) {
    return this.billing.listInvoices(user, q);
  }

  @Post("invoices")
  createInvoice(@CurrentUser() user: RequestUser, @Body(ZodBody(createInvoiceSchema)) body: CreateInvoiceInput) {
    return this.billing.createInvoice(user, body);
  }

  @Get("invoices/:id")
  invoice(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.billing.getInvoice(user, id);
  }

  @Post("invoices/:id/issue")
  issue(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.billing.issueInvoice(user, id);
  }

  @Post("invoices/:id/payments")
  pay(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(invoicePaymentSchema)) body: InvoicePaymentInput) {
    return this.billing.recordPayment(user, id, body);
  }

  @Get("invoices/:id/pdf")
  async pdf(@CurrentUser() user: RequestUser, @Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    const buf = await this.billing.invoicePdf(user, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice.pdf`);
    return new StreamableFile(buf);
  }

  @Get("billing/outstanding")
  outstanding(@CurrentUser() user: RequestUser) {
    return this.billing.outstanding(user);
  }

  // ── Quotations ─────────────────────────────────────────────

  @Get("billing/quotations")
  quotations(@CurrentUser() user: RequestUser, @Query(ZodQuery(quotationListQuery)) q: z.infer<typeof quotationListQuery>) {
    return this.billing.listQuotations(user, q);
  }

  @Post("billing/quotations")
  createQuotation(@CurrentUser() user: RequestUser, @Body(ZodBody(createQuotationSchema)) body: CreateQuotationInput) {
    return this.billing.createQuotation(user, body);
  }

  @Get("billing/quotations/:id")
  quotation(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.billing.getQuotation(user, id);
  }

  @Patch("billing/quotations/:id")
  updateQuotation(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(createQuotationSchema.partial())) body: Partial<CreateQuotationInput>) {
    return this.billing.updateQuotation(user, id, body);
  }

  @Delete("billing/quotations/:id")
  deleteQuotation(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.billing.deleteQuotation(user, id);
  }

  @Post("billing/quotations/:id/status")
  quotationStatus(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(quotationStatusSchema)) body: QuotationStatusInput) {
    return this.billing.setQuotationStatus(user, id, body);
  }

  @Post("billing/quotations/:id/convert")
  convertQuotation(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.billing.convertQuotation(user, id);
  }

  @Get("billing/quotations/:id/pdf")
  async quotationPdf(@CurrentUser() user: RequestUser, @Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    const buf = await this.billing.quotationPdf(user, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=quotation.pdf`);
    return new StreamableFile(buf);
  }
}
