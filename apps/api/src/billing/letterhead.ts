import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument as PdfLibDocument } from "pdf-lib";

/**
 * Letterhead rendering for customer-facing PDFs (quotations, tax invoices).
 * Legal identity comes from Company.settings.legal, merged over the defaults
 * below (which match Atriowings' printed letterhead).
 */

export interface LegalInfo {
  legalName: string;
  pan: string;
  gstin: string;
  cin: string;
  registeredOffice: string;
  headOffice: string;
}

export const LEGAL_DEFAULTS: LegalInfo = {
  legalName: "Atriowings Technologies India Private Limited",
  pan: "AASCA7189D",
  gstin: "33AASCA7189D1ZD",
  cin: "U72900TN20190TC131558",
  registeredOffice: "No.1, 57th Street, Venkat Raman Nagar, Korattur, Thiruvallur, Chennai - 600 080, Tamil Nadu, INDIA",
  headOffice: "No.45, 2nd Floor, 3rd Avenue, Anna Nagar East, Chennai - 600102, Tamil Nadu, INDIA",
};

export const LETTERHEAD_BLUE = "#1F5CAB";

/** Merge settings.legal (partial, user-edited) over the letterhead defaults. */
export function getLegal(settings: unknown): LegalInfo {
  const out: LegalInfo = { ...LEGAL_DEFAULTS };
  if (settings && typeof settings === "object") {
    const legal = (settings as Record<string, unknown>).legal;
    if (legal && typeof legal === "object") {
      const rec = legal as Record<string, unknown>;
      (Object.keys(LEGAL_DEFAULTS) as (keyof LegalInfo)[]).forEach((k) => {
        const v = rec[k];
        if (typeof v === "string" && v.trim()) out[k] = v;
      });
    }
  }
  return out;
}

/** Locate a bundled asset (letterhead PDF) across dev/dist layouts. */
export function resolveAssetPath(filename: string): string | null {
  const candidates = [
    join(process.cwd(), "assets", filename),
    join(process.cwd(), "..", "assets", filename),
    join(process.cwd(), "apps", "api", "assets", filename),
    join(__dirname, "..", "..", "assets", filename),
    join(__dirname, "..", "assets", filename),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

/** Y coordinate where body content may start on the real letterhead (its header rule sits at ~130pt). */
export const LETTERHEAD_CONTENT_TOP = 148;
/** Bottom margin so body content never runs into the letterhead footer (rule at ~764pt). */
export const LETTERHEAD_BOTTOM_MARGIN = 96;

/**
 * Overlay generated body content onto the company's REAL letterhead PDF
 * (assets/letterhead.pdf — the exact file provided by the company; never
 * redrawn). Each content page is drawn over a fresh copy of the letterhead
 * page, so the header/footer remain the original vector artwork.
 * Falls back to the bare content if the letterhead asset is missing.
 */
export async function mergeOntoLetterhead(contentPdf: Buffer): Promise<Buffer> {
  const letterheadPath = resolveAssetPath("letterhead.pdf");
  if (!letterheadPath) return contentPdf;
  try {
    const letterhead = await PdfLibDocument.load(readFileSync(letterheadPath));
    const out = await PdfLibDocument.create();
    const embeddedPages = await out.embedPdf(contentPdf);
    for (const embedded of embeddedPages) {
      const [page] = await out.copyPages(letterhead, [0]);
      out.addPage(page);
      page.drawPage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    }
    return Buffer.from(await out.save());
  } catch {
    return contentPdf;
  }
}

// ── Amount in words (Indian numbering: lakh / crore) ──────────

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const r = n % 10;
  return r ? `${TENS[t]} ${ONES[r]}` : TENS[t];
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return twoDigits(r);
  return r ? `${ONES[h]} Hundred ${twoDigits(r)}` : `${ONES[h]} Hundred`;
}

function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const rest = n % 1_000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/** 59000 → "Fifty Nine Thousand Rupees Only"; paise appended when non-zero. */
export function inrAmountInWords(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);
  let out = `${indianWords(rupees)} Rupees`;
  if (paise > 0) out += ` and ${indianWords(paise)} Paise`;
  return `${out} Only`;
}
