-- Biometric punch log for replay idempotency (review fix A20).
CREATE TABLE "BiometricPunch" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceUserId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "recordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiometricPunch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BiometricPunch_deviceId_deviceUserId_timestamp_type_key" ON "BiometricPunch"("deviceId", "deviceUserId", "timestamp", "type");
CREATE INDEX "BiometricPunch_deviceId_deviceUserId_idx" ON "BiometricPunch"("deviceId", "deviceUserId");
ALTER TABLE "BiometricPunch" ADD CONSTRAINT "BiometricPunch_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricPunch" ADD CONSTRAINT "BiometricPunch_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "AttendanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
