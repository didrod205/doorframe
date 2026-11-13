#!/usr/bin/env node
// Doorframe CLI: check an open agentic website against the MVP spec from a terminal or CI.
// Usage: node cli/doorframe.mjs <url> [--json]
// Exit code 0 = no failed checks, 1 = at least one failed check, 2 = bad usage.
import { checkSite } from "../check-core.js";
const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith("--"));
if (!url) { console.error("Usage: node cli/doorframe.mjs <url> [--json]"); process.exit(2); }
const report = await checkSite(url, { fetch: (u, o) => fetch(u, { ...o, mode: undefined, headers: { Origin: "https://doorframe-cli.invalid" } }), isNode: true, sameOrigin: () => false });
if (args.includes("--json")) { console.log(JSON.stringify(report, null, 2)); }
else {
  const mark = { pass: "PASS", warn: "WARN", fail: "FAIL", unknown: "????" };
  console.log(`Doorframe check: ${report.target}`);
  for (const c of report.checks) console.log(`${mark[c.status]}  [${c.section}] ${c.title}\n      ${c.detail}`);
  console.log(`\nVerdict: ${report.verdict}  (pass ${report.count.pass}, warn ${report.count.warn}, fail ${report.count.fail}, unknown ${report.count.unknown})`);
}
process.exit(report.count.fail ? 1 : 0);
