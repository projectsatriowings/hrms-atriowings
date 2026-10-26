// Visual QA: log in and screenshot key HRMS screens. Read-only.
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const OUT = "/home/hatch/workspace/hrms-pro/qa-shots";

(async () => {
  const errors = [];
  const browser = await chromium.launch({
    executablePath: "/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message?.slice(0, 120)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`CONSOLE: ${m.text().slice(0, 120)}`);
  });

  async function shot(name, path) {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`shot ${name} <- ${path}`);
  }

  await shot("01-login", "/login");
  await page.fill('input[type="email"], input[name="email"]', "admin@atriowings.in").catch(() => {});
  await page.fill('input[type="password"]', "Atriowings@123").catch(() => {});
  await page.screenshot({ path: `${OUT}/02-login-filled.png` });
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/03-after-login.png` });
  console.log("after login URL:", page.url());

  for (const [name, path] of [
    ["04-dashboard", "/dashboard"],
    ["05-employees", "/employees"],
    ["06-attendance", "/attendance"],
    ["07-leave-approvals", "/leave/approvals"],
    ["08-payroll", "/payroll"],
    ["09-invoices", "/billing/invoices"],
    ["10-reports", "/reports"],
  ]) {
    await shot(name, path);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await shot("11-mobile-dashboard", "/dashboard");
  await shot("12-mobile-attendance", "/attendance");

  console.log("\n=== JS ERRORS (" + errors.length + ") ===");
  for (const e of [...new Set(errors)].slice(0, 20)) console.log(e);
  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
