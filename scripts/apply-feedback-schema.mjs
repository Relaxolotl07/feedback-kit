// One-shot: apply the feedback table's schema to whatever DB the env points at.
//   node --env-file=.env.local scripts/apply-feedback-schema.mjs
// or, for production, override:
//   $env:DATABASE_URL="..."; node scripts/apply-feedback-schema.mjs
//
// Looks for the DDL in (in order):
//   1. ./src/feedback/schema.sql   (when run from a target repo)
//   2. ./templates/feedback/schema.sql  (when run from the kit repo itself)
//   3. $env:FEEDBACK_SCHEMA_PATH  (explicit override)
import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = neon(url);

const candidates = [
  process.env.FEEDBACK_SCHEMA_PATH,
  "src/feedback/schema.sql",
  "templates/feedback/schema.sql",
].filter(Boolean).map((p) => resolve(process.cwd(), p));
const schemaPath = candidates.find((p) => existsSync(p));
if (!schemaPath) {
  console.error(`Could not locate schema.sql. Looked in:\n  ${candidates.join("\n  ")}`);
  process.exit(1);
}
const schema = readFileSync(schemaPath, "utf8");
// Neon's tagged template wants statements one at a time. Split on bare ";" at end of line.
const statements = schema
  .replace(/--[^\n]*\n/g, "\n")
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const stmt of statements) {
  process.stdout.write(`> ${stmt.split("\n")[0].slice(0, 80)}\n`);
  await sql.query(stmt);
}
console.log(`Applied ${statements.length} statements.`);
