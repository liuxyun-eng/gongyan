import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";

const base = process.env.GONGYAN_DEV_TEST_URL || "http://127.0.0.1:5173";
assert.equal(new URL(base).hostname, "127.0.0.1");
const login = await fetch(base + "/signin-with-chatgpt?return_to=/", { redirect: "manual" });
assert.equal(login.status, 302);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
async function api(path, data, expected = 200) {
  const response = await fetch(base + "/api/" + path, { method: data ? "POST" : "GET", headers: { Cookie: cookie, ...(data ? { "Content-Type": "application/json" } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
const projects = await api("projects");
const project = projects.projects.find(p => p.name === "大文件上传回归 · 合成示例") || await api("projects", { name: "大文件上传回归 · 合成示例" }, 201);
const baseline = (await api("room?projectId=" + project.id)).posts.length;
const folder = await mkdtemp(join(tmpdir(), "gongyan-dev-upload-"));
let child, proxy;
try {
  await mkdir(join(folder, "nested"));
  const records = new Map([
    ["synthetic.bin", Buffer.alloc(1_300_000, 65)],
    ["nested/synthetic.bin", Buffer.from("nested same basename")],
    ["empty.txt", Buffer.alloc(0)],
    ...Array.from({length: 4}, (_,n) => ["unlinked-" + n + ".txt", Buffer.from("no link " + n)]),
  ]);
  for (const [name, bytes] of records) await writeFile(join(folder, name), bytes);
  await writeFile(join(folder, ".env"), "SYNTHETIC_SECRET");
  let failFile = true, lostCommit = true;
  const sends = new Map();
  proxy = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      assert.equal(request.headers.authorization, undefined);
      if (request.url.startsWith("/api/markdown-share/files")) {
        const file = JSON.parse(new URL(request.url, base).searchParams.get("file"));
        sends.set(file.name, (sends.get(file.name) || 0) + 1);
        // Fail three automatic retries, then recover on explicit retry.
        if (failFile && file.name === "synthetic.bin") {
          response.writeHead(413); response.end("Payload Too Large"); return;
        }
      }
      const upstream = await fetch(base + request.url, { method: request.method, headers: { Cookie: request.headers.cookie || "", Origin: base, ...(request.headers["content-type"] ? { "Content-Type": request.headers["content-type"] } : {}) }, ...(request.method !== "GET" ? { body: Buffer.concat(chunks) } : {}) });
      const body = Buffer.from(await upstream.arrayBuffer());
      if (lostCommit && request.url.startsWith("/api/markdown-share?" ) && upstream.ok) {
        lostCommit = false; response.writeHead(502); response.end("Synthetic lost commit response"); return;
      }
      response.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" }); response.end(body);
    } catch (error) { response.writeHead(502); response.end("Synthetic proxy failed"); }
  });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  child = spawn(process.execPath, [resolve("integrations/codex/upload-panel.mjs"), "--site", "http://127.0.0.1:" + proxy.address().port, "--workspace", folder], { stdio: ["ignore", "pipe", "pipe"] });
  const panelUrl = await new Promise((resolve, reject) => {
    let output = ""; const timer = setTimeout(() => reject(Error("Companion startup timed out")), 10_000);
    child.stdout.on("data", chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once("error", reject); child.once("exit", () => { clearTimeout(timer); reject(Error("Companion exited")); });
  });
  const html = await (await fetch(panelUrl)).text();
  assert.doesNotMatch(html, /connection-file|configure|连接配置|补充文件/);
  const nonce = html.match(/<script nonce="([a-f0-9]+)"/)[1];
  const status = await (await fetch(panelUrl + "/status", { headers: { "x-gongyan-panel": nonce, Cookie: cookie } })).json();
  assert.equal(status.signedIn, true);
  async function panel(path, data, expected = 200) {
    const response = await fetch(panelUrl + path, { method: "POST", headers: { "x-gongyan-panel": nonce, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  }
  const preview = await panel("/markdown/preview", { markdown: "## User\n上传整个目录。\n\n## Assistant\n[文件](synthetic.bin)", root: folder, projectId: project.id });
  assert.equal(preview.files.length, 7, "Unlinked files, nested and zero-byte files must all be included");
  assert.equal(preview.skipped.length, 1);
  const payload = { snapshotId: preview.snapshotId };
  const failure = await panel("/markdown/upload", payload, 400);
  assert.match(failure.error, /HTTP 413/);
  assert.equal((await api("room?projectId=" + project.id)).posts.length, baseline, "Partial files must not publish a successful post");
  const confirmedBeforeRetry = new Map(sends);
  await writeFile(join(folder, "synthetic.bin"), "changed after frozen snapshot");
  failFile = false;
  const lost = await panel("/markdown/upload", payload, 400);
  assert.match(lost.error, /有效响应/);
  const receipt = await panel("/markdown/upload", payload);
  assert.equal(receipt.verified, true); assert.equal(receipt.files.length, 7);
  const repeated = await panel("/markdown/upload", payload);
  assert.equal(repeated.postId, receipt.postId);
  for (const file of receipt.files) {
    const downloaded = await fetch(base + "/api/files/" + file.id, { headers: { Cookie: cookie } });
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), records.get(file.name), "Stored bytes for " + file.name);
    if (file.name !== "synthetic.bin" && confirmedBeforeRetry.has(file.name)) assert.equal(sends.get(file.name), confirmedBeforeRetry.get(file.name), "Already-confirmed file should not resend");
  }
  assert.equal((await api("room?projectId=" + project.id)).posts.length, baseline + 1);
  for (const [path, headers, expected] of [
    ["markdown-share?projectId=" + project.id, {}, 401],
    ["markdown-share/files?projectId=outsider", { Cookie: cookie }, 403],
    ["markdown-share?projectId=" + project.id, { Cookie: cookie, Origin: "https://outside.example" }, 403],
    ["codex/connections", { Cookie: cookie }, 404],
  ]) {
    const response = await fetch(base + "/api/" + path, { method: "POST", headers, body: "{}" }); assert.equal(response.status, expected); await response.arrayBuffer();
  }
  const incomplete = { id: randomUUID(), name: "not-uploaded.txt", reference: "./not-uploaded.txt", size: 1, sha256: createHash("sha256").update("x").digest("hex") };
  await api("markdown-share?projectId=" + project.id, { requestId: randomUUID(), markdown: "## Assistant\n不能缺文件。", files: [incomplete] }, 409);
  assert.equal((await api("room?projectId=" + project.id)).posts.length, baseline + 1);
  // Deleting one displayed message also removes it from retained/exported Markdown.
  const beforeDelete = (await api("room?projectId=" + project.id)).posts.find(p => p.id === receipt.postId);
  const revision = createHash("sha256").update(beforeDelete.transcript).digest("hex");
  const deletedResponse = await fetch(base + "/api/posts/" + receipt.postId + "/messages", { method: "DELETE", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ index: 0, revision }) });
  assert.equal(deletedResponse.status, 200);
  const deleted = await deletedResponse.json();
  assert.doesNotMatch(deleted.transcript, /上传整个目录/);
  assert.equal(JSON.parse(deleted.transcript)[0].references.length, 7);
  const staleDelete = await fetch(base + "/api/posts/" + receipt.postId + "/messages", { method: "DELETE", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ index: 0, revision }) });
  assert.equal(staleDelete.status, 409); await staleDelete.arrayBuffer();
  const lastRevision = createHash("sha256").update(deleted.transcript).digest("hex");
  const lastDelete = await fetch(base + "/api/posts/" + receipt.postId + "/messages", { method: "DELETE", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ index: 0, revision: lastRevision }) });
  assert.equal(lastDelete.status, 200); assert.equal((await lastDelete.json()).transcript, "[]");
  const finalPost = (await api("room?projectId=" + project.id)).posts.find(p => p.id === receipt.postId);
  assert.equal(finalPost.summary, "");
  assert.equal(JSON.parse(finalPost.file_ids).length, 7);
  // Per-file 20 MB bounds are explicit; bodies over 22 MB are rejected.
  for (const [size, expected] of [[20 * 1024 * 1024, 400], [23 * 1024 * 1024, 413]]) {
    const form = new FormData();
    form.set("metadata", "{}");
    form.append("files", new File([Buffer.alloc(size, 65)], "invalid-probe.bin"));
    const response = await fetch(base + "/api/markdown-share/files?projectId=" + project.id, { method: "POST", headers: { Cookie: cookie }, body: form });
    assert.equal(response.status, expected); await response.arrayBuffer();
  }
  console.log("Verified: seven complete directory files, nested duplicate basenames, empty and unlinked files, byte-for-byte downloads, failed file retry without resending confirmed files, lost commit response without duplicate post, atomic final manifest and access checks.");
} finally {
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
  if (proxy) await new Promise(resolve => proxy.close(resolve));
  await rm(folder, { recursive: true, force: true });
}
