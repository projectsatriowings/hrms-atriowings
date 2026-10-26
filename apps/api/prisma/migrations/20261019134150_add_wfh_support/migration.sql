-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "wfh" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WfhRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WfhRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WfhDay" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WfhDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WfhRequest_companyId_date_idx" ON "WfhRequest"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WfhRequest_employeeId_date_key" ON "WfhRequest"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WfhDay_companyId_date_key" ON "WfhDay"("companyId", "date");

-- AddForeignKey
ALTER TABLE "WfhRequest" ADD CONSTRAINT "WfhRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WfhRequest" ADD CONSTRAINT "WfhRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WfhDay" ADD CONSTRAINT "WfhDay_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
