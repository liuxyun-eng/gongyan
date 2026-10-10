import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { context } from "./context.mjs";
import * as api from "../../app/api/[...path]/route";
import * as auth from "../../app/api/auth/[action]/route";
import { database } from "./runtime.mjs";

const frontend = new URL("./index.html", import.meta.url);
const server = createServer(async (incoming, outgoing) => {
  try {
    const origin = process.env.APP_ORIGIN || "http://127.0.0.1:9000";
    const url = new URL(incoming.url || "/", origin);
    if (incoming.method === "GET" && (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname) || url.pathname === "/favicon.svg")) {
      const types: Record<string,string> = { js:"application/javascript",css:"text/css",woff:"font/woff",woff2:"font/woff2",ttf:"font/ttf",svg:"image/svg+xml" };
      try {
        const compressed = /\.(js|css)$/.test(url.pathname) && String(incoming.headers["accept-encoding"] || "").includes("gzip");
        const bytes = await readFile(new URL("." + url.pathname + (compressed ? ".gz" : ""), import.meta.url));
        outgoing.writeHead(200, { "Content-Type": types[url.pathname.split(".").at(-1)!] || "application/octet-stream", "Content-Length":bytes.length,"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options":"nosniff", "Vary":"Accept-Encoding", ...(compressed ? {"Content-Encoding":"gzip"} : {}) }); outgoing.end(bytes);
      } catch { outgoing.writeHead(404); outgoing.end(); }
      return;
    }
    if (url.pathname === "/health") {
      await database.prepare("SELECT 1 AS healthy").first();
      outgoing.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      outgoing.end('{"ready":true}'); return;
    }
    if (!url.pathname.startsWith("/api/")) {
      if (incoming.method !== "GET" || !["/", "/login", "/login/", "/share", "/share/"].includes(url.pathname)) { outgoing.writeHead(404); outgoing.end(); return; }
      outgoing.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
      outgoing.end(await readFile(frontend)); return;
    }
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "cookie", "origin"]) {
      const value = incoming.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    // Never accept caller-supplied Cloudflare/platform identity or credential headers.
    const forwarded = String(incoming.headers["x-forwarded-for"] || "").split(",").at(-1)?.trim();
    headers.set("CF-Connecting-IP", forwarded || incoming.socket.remoteAddress || "gateway");
    const method = incoming.method || "GET";
    const request = new Request(url, { method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: Readable.toWeb(incoming), duplex: "half" }) } as RequestInit);
    await context.run({ request, objectFolders: new Map(), savedObjects: new Map() }, async () => {
      const routes = url.pathname.startsWith("/api/auth/") ? auth : api;
      const handler = (routes as unknown as Record<string, ((request: Request) => Promise<Response>)>)[method];
      const response = handler ? await handler(request) : Response.json({ error: "不支持这个请求方法。" }, { status: 405 });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body as any).pipe(outgoing);
      else outgoing.end();
    });
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    outgoing.end('{"error":"服务暂时不可用，请保留文件并重试。"}');
  }
});
server.listen(Number(process.env.PORT || 9000), process.env.GONGYAN_LOCAL ? "127.0.0.1" : "0.0.0.0");
