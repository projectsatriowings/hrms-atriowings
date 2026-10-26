-- Biometric late sync: offline devices may deliver punches up to 7 days
-- late. Flag punches that arrived >24h after they happened so HR can tell
-- a late sync apart from a live punch.
ALTER TABLE "BiometricPunch" ADD COLUMN "lateSync" BOOLEAN NOT NULL DEFAULT false;
