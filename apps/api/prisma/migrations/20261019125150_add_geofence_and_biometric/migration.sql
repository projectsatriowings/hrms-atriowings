-- AlterEnum
ALTER TYPE "AttendanceSource" ADD VALUE 'biometric';

-- AlterTable
ALTER TABLE "AttendancePolicy" ADD COLUMN     "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "officeLatitude" DOUBLE PRECISION,
ADD COLUMN     "officeLongitude" DOUBLE PRECISION,
ADD COLUMN     "requireLocation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "checkInLat" DOUBLE PRECISION,
ADD COLUMN     "checkInLng" DOUBLE PRECISION,
ADD COLUMN     "locationVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BiometricDevice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiometricMapping" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceUserId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BiometricDevice_companyId_idx" ON "BiometricDevice"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricDevice_companyId_name_key" ON "BiometricDevice"("companyId", "name");

-- CreateIndex
CREATE INDEX "BiometricMapping_deviceId_idx" ON "BiometricMapping"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricMapping_deviceId_deviceUserId_key" ON "BiometricMapping"("deviceId", "deviceUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricMapping_deviceId_employeeId_key" ON "BiometricMapping"("deviceId", "employeeId");

-- AddForeignKey
ALTER TABLE "BiometricDevice" ADD CONSTRAINT "BiometricDevice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiometricMapping" ADD CONSTRAINT "BiometricMapping_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiometricMapping" ADD CONSTRAINT "BiometricMapping_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
