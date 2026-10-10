import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CLOUD_SITE } from "../integrations/codex/directory-bridge.mjs";

test("loopback reader returns complete verified files without cloud credentials or Finder", async () => {
  const root = await mkdtemp(join(tmpdir(), "gongyan-bridge-"));
  const child = spawn(process.execPath, ["integrations/codex/upload-panel.mjs", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const base = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Reader startup timed out")), 10_000);
      child.stdout.on("data", chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.once("error", reject); child.once("exit", () => { clearTimeout(timer); reject(new Error("Reader exited")); });
    });
    await mkdir(join(root, "nested"));
    const records = new Map([["报告.pdf", Buffer.from("%PDF-1.4\n% synthetic\n")], ["nested/报告.pdf", Buffer.from("nested synthetic")], ["empty.txt", Buffer.alloc(0)]]);
    for (const [name, bytes] of records) await writeFile(join(root, name), bytes);
    await writeFile(join(root, ".env"), "SYNTHETIC_EXCLUDED");
    assert.equal((await fetch(base + "/directory?origin=https%3A%2F%2Foutside.example")).status, 403);
    const html = await (await fetch(base + "/directory?origin=" + encodeURIComponent(CLOUD_SITE))).text();
    const nonce = html.match(/<script nonce="([a-f0-9]+)"/)[1];
    assert.match(html, /event\.source !== openerWindow/);
    assert.match(html, /event\.origin !== expectedOrigin/);
    const headers = { "x-gongyan-panel": nonce, "Content-Type": "application/json", Origin: base };
    const body = JSON.stringify({ root, markdown: ':codex-file-citation{path="' + join(root, "报告.pdf") + '" purpose="output"}' });
    for (const bad of [{ ...headers, "x-gongyan-panel": "wrong" }, { ...headers, Origin: "https://outside.example" }]) {
      assert.equal((await fetch(base + "/directory/read", { method: "POST", headers: bad, body })).status, 400);
    }
    const response = await fetch(base + "/directory/read", { method: "POST", headers, body });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.files.length, 3); assert.deepEqual(result.skipped, [".env"]);
    assert.equal(result.missingReferences.length, 0);
    for (const file of result.files) {
      const downloaded = await fetch(base + "/directory/file?snapshotId=" + result.snapshotId + "&id=" + file.id, { headers });
      assert.equal(downloaded.status, 200);
      const bytes = Buffer.from(await downloaded.arrayBuffer());
      assert.deepEqual(bytes, records.get(file.name));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
      assert.equal(file.reference, join(root, file.name));
    }
    assert.equal((await fetch(base + "/directory/release?snapshotId=" + result.snapshotId, { method: "POST", headers, body: "{}" })).status, 200);
    assert.equal((await fetch(base + "/directory/file?snapshotId=" + result.snapshotId + "&id=" + result.files[0].id, { headers })).status, 400);
    const missing = await fetch(base + "/directory/read", { method: "POST", headers, body: JSON.stringify({ root: root + "/missing", markdown: "成果" }) });
    assert.equal(missing.status, 400); assert.match((await missing.json()).error, /未找到文件/);
  } finally {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  }
});
