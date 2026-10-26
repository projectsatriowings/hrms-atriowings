import PDFDocument from "pdfkit";

export interface PayslipPdfComponent {
  label: string;
  amount: number;
  kind: "earning" | "deduction" | "employer";
}

export interface PayslipPdfData {
  companyName: string;
  employeeName: string;
  employeeCode: string;
  department?: string;
  designation?: string;
  /** e.g. "October 2026". */
  periodLabel: string;
  paidDays: number;
  lopDays: number;
  components: PayslipPdfComponent[];
  gross: number;
  totalDeductions: number;
  netPay: number;
}

/** Render a real payslip PDF (pdfkit, same chunk-buffer pattern as billing). */
export function buildPayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  // compress:false keeps the text streams readable (and the output easily
  // verifiable in tests) — payslips are single-page documents.
  const doc = new PDFDocument({ size: "A4", compress: false, margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const money = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const earnings = data.components.filter((c) => c.kind === "earning");
  const deductions = data.components.filter((c) => c.kind === "deduction");
  const employer = data.components.filter((c) => c.kind === "employer");

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#0F172A").text("PAYSLIP", 50, 50);
  doc.font("Helvetica").fontSize(10).fillColor("#475569")
    .text(data.companyName, 50, 74)
    .text(`Pay period: ${data.periodLabel}`, 50, 88);
  doc.fontSize(10).fillColor("#0F172A");
  doc.text(`Employee: ${data.employeeName} (${data.employeeCode})`, 50, 112);
  if (data.department) doc.text(`Department: ${data.department}`, 50, 126);
  if (data.designation) doc.text(`Designation: ${data.designation}`, 50, 140);
  doc.text(`Paid days: ${data.paidDays}  |  LOP days: ${data.lopDays}`, 320, 112, { width: 225, align: "right" });

  let y = 168;
  const section = (title: string, rows: PayslipPdfComponent[]) => {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0F172A").text(title, 50, y);
    y += 20;
    doc.font("Helvetica").fontSize(10);
    if (rows.length === 0) {
      doc.fillColor("#64748B").text("—", 50, y);
      y += 16;
    }
    for (const row of rows) {
      doc.fillColor("#0F172A").text(row.label, 50, y);
      doc.text(money(row.amount), 320, y, { width: 175, align: "right" });
      y += 16;
    }
    y += 8;
  };

  section("Earnings", earnings);
  section("Deductions", deductions);
  if (employer.length > 0) section("Employer contributions (informational)", employer);

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0F172A");
  doc.text("Gross pay", 50, y);
  doc.text(money(data.gross), 320, y, { width: 175, align: "right" });
  y += 18;
  doc.text("Total deductions", 50, y);
  doc.text(money(data.totalDeductions), 320, y, { width: 175, align: "right" });
  y += 18;
  doc.text("Net pay", 50, y);
  doc.text(money(data.netPay), 320, y, { width: 175, align: "right" });
  y += 30;
  doc.font("Helvetica").fontSize(8).fillColor("#64748B")
    .text("This is a computer-generated payslip. TDS shown as \"TDS (estimate)\" is an estimate based on the annualised pay for this period and the declarations on record; it is not a tax filing.", 50, y, { width: 495 });
  doc.end();
  return done;
}
