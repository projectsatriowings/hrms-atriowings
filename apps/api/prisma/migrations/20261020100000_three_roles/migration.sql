-- Role model simplified for single-company use: owner -> md, hr_admin -> hr, manager -> employee
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('employee', 'hr', 'md');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING (
  CASE "role"::text
    WHEN 'owner' THEN 'md'
    WHEN 'hr_admin' THEN 'hr'
    WHEN 'manager' THEN 'employee'
    ELSE 'employee'
  END
)::"Role";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'employee';
DROP TYPE "Role_old";
