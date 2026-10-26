-- Make User.email globally unique so login by email alone is unambiguous
-- across companies (fixes the login/tenant bug: findFirst by email alone
-- could previously pick the wrong tenant's account when the same email
-- existed in two companies, which the old @@unique([companyId, email])
-- permitted). The seed has a single company and no duplicate login
-- emails, so this migration applies cleanly to demo data; on a database
-- that already contains the same email in two companies it will fail
-- until those duplicates are resolved — that failure is intentional.
DROP INDEX "User_companyId_email_key";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
