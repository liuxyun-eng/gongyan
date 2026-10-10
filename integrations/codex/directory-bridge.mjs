import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { inspectMarkdownFiles, readApprovedFiles } from "./markdown-files.mjs";

export const CLOUD_SITE = "https://gongyan-d6gqg5jl234d901e6-1503317224.ap-shanghai.app.tcloudbase.com";

export function createDirectoryBridge({ directory, nonce, allowedOrigins, bytes, send }) {
  const snapshots = new Map();
  return async (request, response, url) => {
    if (request.method === "GET" && url.pathname === "/directory") {
      const origin = url.searchParams.get("origin");
      if (!allowedOrigins.has(origin)) { send(response, 403, { error: "这个网站没有本机目录读取权限。" }); return true; }
      const html = (await readFile(new URL("directory-panel.html", directory), "utf8"))
        .replaceAll("__PANEL_NONCE__", nonce)
        .replace("__OPENER_ORIGIN__", JSON.stringify(origin).replace(/</g, "\\u003c"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
        "Cross-Origin-Opener-Policy": "unsafe-none",
      });
      response.end(html); return true;
    }
    if (!url.pathname.startsWith("/directory/")) return false;
    // The existing panel Host, Origin and nonce checks run before these APIs.
    for (const [id, value] of snapshots) if (Date.now() - value.createdAt > 5 * 60_000) snapshots.delete(id);
    if (request.method === "POST" && url.pathname === "/directory/read") {
      if (snapshots.size >= 2) throw new Error("已有目录正在读取，请关闭旧的读取窗口后重试。");
      const input = JSON.parse((await bytes(request, 600_000)).toString("utf8"));
      const snapshot = await inspectMarkdownFiles(input.markdown, input.root);
      const files = await readApprovedFiles(snapshot, snapshot.candidates.map(file => file.id));
      const id = randomUUID();
      snapshots.set(id, { createdAt: Date.now(), files });
      send(response, 200, {
        snapshotId: id, total: snapshot.total,
        files: files.map(file => ({ id: file.id, name: file.name, reference: file.reference, size: file.size, sha256: file.hash })),
        skipped: snapshot.skipped.map(file => file.name), missingReferences: snapshot.missingReferences,
      }); return true;
    }
    const snapshot = snapshots.get(url.searchParams.get("snapshotId"));
    if (!snapshot) throw new Error("读取已过期，请重新预览目录。");
    if (request.method === "POST" && url.pathname === "/directory/release") {
      snapshots.delete(url.searchParams.get("snapshotId")); send(response, 200, { released: true }); return true;
    }
    if (request.method === "GET" && url.pathname === "/directory/file") {
      const file = snapshot.files.find(file => file.id === url.searchParams.get("id"));
      if (!file) throw new Error("未找到文件，请重新读取目录。");
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": file.size, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(file.bytes); return true;
    }
    send(response, 404, { error: "未找到这个目录操作。" }); return true;
  };
}
