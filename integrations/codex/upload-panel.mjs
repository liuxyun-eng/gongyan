import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { inspectMarkdownFiles, readApprovedFiles } from "./markdown-files.mjs";
import { createDirectoryBridge, CLOUD_SITE } from "./directory-bridge.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function option(name) { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; }
for (let i = 0; i < args.length; i += 2) {
  if (!["--workspace", "--port", "--site", "--allow-origin"].includes(args[i]) || !args[i + 1]) throw new Error("只支持 --workspace、--port、--site、--allow-origin 参数。");
}
const workspaceRoot = resolve(option("--workspace") || process.cwd());
const workspaceSite = new URL(option("--site") || "http://127.0.0.1:5173");
if (workspaceSite.protocol !== "http:" || workspaceSite.hostname !== "127.0.0.1" || workspaceSite.username || workspaceSite.password || workspaceSite.pathname !== "/" || workspaceSite.search || workspaceSite.hash) throw new Error("请选择 http://127.0.0.1:<端口> 的本机工作区地址。");
const nonce = randomBytes(32).toString("hex"), snapshots = new Map();
const browserSession = request => createHash("sha256").update(request.headers.cookie || "").digest("hex");
let siteOrigin;
async function workspaceApi(request, path, options = {}) {
  const response = await fetch(workspaceSite.origin + "/api/" + path, {
    ...options, redirect: "manual", signal: AbortSignal.timeout(60_000),
    headers: { ...options.headers, Cookie: request.headers.cookie || "", Origin: workspaceSite.origin },
  });
  if (response.status === 401 || response.status >= 300 && response.status < 400) throw new Error("请先登录共研工作区，回来后即可分享。");
  if (response.status === 413) throw new Error("共研服务拒绝了上传大小（HTTP 413）。本次提交已保留，可以重试。");
  let data;
  try { data = await response.json(); } catch { throw new Error("共研没有返回有效响应，请确认工作区服务已启动。"); }
  if (!response.ok) throw new Error(data.error || "分享暂时失败，请重试。");
  return data;
}
async function bytes(request, limit) {
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length; if (length > limit) throw new Error("上传内容超过大小限制。"); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function send(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(data));
}
const allowedOrigins = new Set([workspaceSite.origin, CLOUD_SITE]);
if (option("--allow-origin")) {
  const allowed = new URL(option("--allow-origin"));
  if (allowed.protocol !== "https:" || allowed.username || allowed.password || allowed.pathname !== "/" || allowed.search || allowed.hash) throw new Error("额外授权网站必须是 HTTPS 网站的根地址。");
  allowedOrigins.add(allowed.origin);
}
const directoryBridge = createDirectoryBridge({ directory: new URL("./", import.meta.url), nonce, allowedOrigins, bytes, send });
const server = createServer(async (request, response) => {
  try {
    if (request.headers.host !== new URL(siteOrigin).host) throw new Error("请使用本机面板地址。");
    const url = new URL(request.url, siteOrigin);
    if (request.method === "GET" && url.pathname === "/directory") { await directoryBridge(request, response, url); return; }
    if (request.method === "GET" && url.pathname === "/") {
      const html = (await readFile(resolve(directory, "markdown-panel.html"), "utf8")).replace("__PANEL_NONCE__", nonce);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
        "X-Content-Type-Options": "nosniff",
      }); response.end(html); return;
    }
    if (request.headers["x-gongyan-panel"] !== nonce || request.headers.origin && request.headers.origin !== siteOrigin) throw new Error("请在上传面板中操作。");
    if (await directoryBridge(request, response, url)) return;
    if (request.method === "GET" && url.pathname === "/status") {
      try {
        const data = await workspaceApi(request, "projects");
        send(response, 200, { signedIn: true, projects: data.projects, siteUrl: workspaceSite.origin, workspaceRoot });
      } catch (error) { send(response, 200, { signedIn: false, projects: [], siteUrl: workspaceSite.origin, workspaceRoot, error: error.message }); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/markdown/preview") {
      const input = JSON.parse((await bytes(request, 600_000)).toString("utf8"));
      const snapshot = await inspectMarkdownFiles(input.markdown, input.root);
      const snapshotId = randomUUID();
      for (const [key, saved] of snapshots) if (!saved.busy && Date.now() - saved.createdAt > 2 * 60 * 60_000) snapshots.delete(key);
      if (snapshots.size >= 5) {
        const oldest = [...snapshots].find(([, value]) => !value.busy && !value.payload);
        if (!oldest) throw new Error("已有 5 次待完成提交，请先完成或重启上传入口。");
        snapshots.delete(oldest[0]);
      }
      snapshots.set(snapshotId, { ...snapshot, projectId: typeof input.projectId === "string" ? input.projectId.slice(0, 100) : "", session: browserSession(request), requestId: randomUUID(), createdAt: Date.now(), uploaded: new Set(), completed: 0 });
      send(response, 200, { snapshotId, title: snapshot.conversation.title, messageCount: snapshot.conversation.messages.length, hasRoles: snapshot.conversation.hasRoles, format: snapshot.conversation.format, root: snapshot.root, files: snapshot.candidates, skipped: snapshot.skipped, missingReferences: snapshot.missingReferences, total: snapshot.total }); return;
    }
    if (request.method === "GET" && url.pathname === "/markdown/progress") {
      const snapshot = snapshots.get(url.searchParams.get("snapshotId"));
      if (!snapshot || snapshot.session !== browserSession(request)) throw new Error("预览已过期，请重新读取。");
      send(response, 200, { completed: snapshot.completed, total: snapshot.candidates.length, current: snapshot.current || "", busy: !!snapshot.busy }); return;
    }
    if (request.method === "POST" && url.pathname === "/markdown/upload") {
      const input = JSON.parse((await bytes(request, 2000)).toString("utf8"));
      const snapshot = snapshots.get(input.snapshotId);
      if (!snapshot || Date.now() - snapshot.createdAt > 2 * 60 * 60_000) throw Object.assign(new Error("预览已过期，请重新读取。"), { repreview: true });
      if (snapshot.session !== browserSession(request) || !snapshot.projectId) throw Object.assign(new Error("请选择工作区，并重新读取文件后分享。"), { repreview: true });
      if (snapshot.busy) throw new Error("这次上传正在进行，请稍后重试。");
      if (snapshot.receipt) {
        send(response, 200, { ...snapshot.receipt, messageCount: snapshot.conversation.messages.length, siteUrl: workspaceSite.origin, projectId: snapshot.projectId }); return;
      }
      snapshot.busy = true;
      try {
        const target = "markdown-share?projectId=" + encodeURIComponent(snapshot.projectId);
        if (!snapshot.payload) {
          // Verify access before reading and freezing the complete directory.
          const accessible = await workspaceApi(request, "projects");
          if (!accessible.projects.some(p => p.id === snapshot.projectId)) throw new Error("你没有这个工作区的访问权限。");
          try { snapshot.payload = await readApprovedFiles(snapshot, [...snapshot.originals.keys()]); } catch (error) { error.repreview = true; throw error; }
        }
        const files = snapshot.payload.map(f => ({ id: f.id, name: f.name, reference: f.reference, size: f.size, sha256: f.hash }));
        for (let index = 0; index < files.length; index++) {
          const file = files[index];
          if (snapshot.uploaded.has(file.id)) continue;
          snapshot.current = file.name;
          let error;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const result = await workspaceApi(request, "markdown-share/files?projectId=" + encodeURIComponent(snapshot.projectId) + "&requestId=" + snapshot.requestId + "&file=" + encodeURIComponent(JSON.stringify(file)), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: snapshot.payload[index].bytes });
              if (!result.verified || result.id !== file.id || result.size !== file.size || result.sha256 !== file.sha256) throw new Error("文件回执校验失败：" + file.name);
              error = undefined; break;
            } catch (failure) { error = failure; }
          }
          if (error) throw new Error(file.name + " 上传未完成：" + error.message);
          snapshot.uploaded.add(file.id); snapshot.completed++;
        }
        snapshot.current = "正在确认全部文件并发布对话";
        const receipt = snapshot.receipt || await workspaceApi(request, target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: snapshot.requestId, markdown: snapshot.conversation.markdown, title: snapshot.conversation.title, files }) });
        if (!receipt.verified || receipt.files.length !== files.length || files.some(f => !receipt.files.some(saved => saved.id === f.id && saved.name === f.name && saved.size === f.size))) throw new Error("文件清单回执不完整，请重试。");
        snapshot.receipt = receipt;
        snapshot.payload = undefined;
        send(response, 200, { ...receipt, messageCount: snapshot.conversation.messages.length, siteUrl: workspaceSite.origin, projectId: snapshot.projectId });
      } finally { snapshot.busy = false; }
      return;
    }
    send(response, 404, { error: "未找到这个操作。" });
  } catch (error) { send(response, 400, { error: error.message || "分享暂时失败，已保留本次提交。", repreview: !!error.repreview }); }
});
server.requestTimeout = 10 * 60_000;
server.listen(Number(option("--port") || 0), "127.0.0.1", () => {
  siteOrigin = "http://127.0.0.1:" + server.address().port;
  console.log("共研 Markdown 上传：" + siteOrigin);
});
