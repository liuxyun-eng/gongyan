import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
// Emit a separate config so the Sites/local bindings and existing data are preserved.
const root = resolve(import.meta.dirname, "..");
const [mode = "test", accountId, databaseId] = process.argv.slice(2);
if (!["test", "deploy"].includes(mode)) throw new Error("Expected test or deploy");
if (mode === "deploy" && (!/^[a-f0-9]{32}$/.test(accountId || "") || !/^[a-f0-9-]{36}$/.test(databaseId || ""))) throw new Error("Specify the actual Cloudflare account and D1 database IDs");
const built = JSON.parse(readFileSync(resolve(root, "dist/server/wrangler.json"), "utf8"));
const folder = resolve(root, ".sites-runtime/cloudflare-" + mode);
mkdirSync(folder, { recursive: true, mode: 0o700 });
const config = {
  name: "gongyan", ...(accountId ? { account_id: accountId } : {}),
  main: resolve(root, "dist/server/index.js"), compatibility_date: built.compatibility_date,
  compatibility_flags: built.compatibility_flags, no_bundle: true, rules: built.rules,
  assets: { directory: resolve(root, "dist/client") }, workers_dev: true,
  preview_urls: false, observability: { enabled: true },
  vars: { AUTH_MODE: "standalone", ...(mode === "test" ? { AUTH_PEPPER: "synthetic-test-pepper-never-use-in-cloud-0000000000000000", REGISTRATION_CODE: "synthetic-test-invite" } : {}) },
  d1_databases: [{ binding: "DB", database_name: mode === "test" ? "gongyan-test" : "gongyan-db", database_id: databaseId || "00000000-0000-4000-8000-000000000001", migrations_dir: resolve(root, "drizzle") }],
  r2_buckets: [{ binding: "BUCKET", bucket_name: mode === "test" ? "gongyan-test-files" : "gongyan-files" }],
};
const output = resolve(folder, "wrangler.json");
writeFileSync(output, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(output);
