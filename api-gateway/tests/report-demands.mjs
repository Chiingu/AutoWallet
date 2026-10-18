/**
 * test:report — a colored one-line board over the full suite
 * (both files: the PIN half and the DEMAND half).
 *
 * Why this exists: the DEMAND half runs RED by design (open findings),
 * and a wall of vitest red output is hard to read. This wrapper prints
 * one line per test:
 *
 *   green ✓   — PIN passed
 *   bold  ⚠   — DEMAND passing! (the fix landed — verify and promote
 *               the test into the PIN file)
 *   red   ✗   — DEMAND failing (expected: the finding is still open)
 *   bold  ✗   — PIN failed (a regression — this one is REAL trouble)
 *   yellow ↓  — skipped (tripwire / decision pending)
 *
 * Exit code = vitest's exit code, so scripts can use it unchanged.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPORT = "node_modules/.vitest-report.json"; // inside the gitignored dir

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const run = spawnSync(
  "npx",
  ["vitest", "run", "--reporter=json", `--outputFile=${REPORT}`],
  { stdio: "ignore", shell: true },
);

let data;
try {
  data = JSON.parse(readFileSync(REPORT, "utf8"));
} catch {
  console.error(`${RED}Could not read the vitest JSON report — run failed?${RESET}`);
  process.exit(run.status ?? 1);
}

const results = [];
for (const file of data.testResults) {
  for (const t of file.assertionResults) {
    const name = t.fullName || t.title;
    const isDemand = /DEMAND/.test(name);
    const isSkip = t.status === "skipped" || t.status === "todo";
    results.push({ name, status: t.status, isDemand, isSkip });
  }
}

console.log("");
for (const r of results) {
  const short = r.name.replace(/.* > /, "  › ");
  if (r.isSkip) {
    console.log(`${YELLOW}  ↓ SKIP    ${short}${RESET}`);
  } else if (r.isDemand && r.status === "passed") {
    console.log(`${BOLD}${RED}  ⚠ FLIPPED — the fix landed, verify & promote: ${short}${RESET}`);
  } else if (r.isDemand && r.status === "failed") {
    console.log(`${RED}  ✗ DEMAND  ${short}  ${DIM}(finding open)${RESET}`);
  } else if (r.status === "passed") {
    console.log(`${GREEN}  ✓ PIN     ${short}${RESET}`);
  } else {
    console.log(`${BOLD}${RED}  ✗ PIN FAILED — regression! ${short}${RESET}`);
  }
}

const pinsPassed = results.filter((r) => !r.isDemand && !r.isSkip && r.status === "passed").length;
const pinsFailed = results.filter((r) => !r.isDemand && !r.isSkip && r.status !== "passed").length;
const demandsHeld = results.filter((r) => r.isDemand && r.status === "failed").length;
const flipped = results.filter((r) => r.isDemand && r.status === "passed").length;
const skipped = results.filter((r) => r.isSkip).length;

console.log("");
console.log(
  `  ${GREEN}${pinsPassed} pins passed${RESET}  ` +
  `${pinsFailed ? `${BOLD}${RED}${pinsFailed} PIN(S) FAILED${RESET}  ` : ""}` +
  `${RED}${demandsHeld} demands held red (findings open)${RESET}  ` +
  `${flipped ? `${BOLD}${RED}${flipped} FLIPPED — un-mark & promote${RESET}  ` : ""}` +
  `${YELLOW}${skipped} skipped${RESET}`,
);
console.log("");
process.exit(run.status ?? 1);
