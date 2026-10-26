-- Payroll statutory round: per-employee TDS regime override + structured
-- old-regime tax declarations (one per employee per financial year).
ALTER TABLE "Employee" ADD COLUMN "taxRegime" TEXT;

CREATE TABLE "PayrollTaxDeclaration" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'new',
    "section80C" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "section80D" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hraExemption" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollTaxDeclaration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollTaxDeclaration_employeeId_financialYear_key" ON "PayrollTaxDeclaration"("employeeId", "financialYear");
CREATE INDEX "PayrollTaxDeclaration_financialYear_idx" ON "PayrollTaxDeclaration"("financialYear");
ALTER TABLE "PayrollTaxDeclaration" ADD CONSTRAINT "PayrollTaxDeclaration_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
