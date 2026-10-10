import { MAX_FILE, MAX_TOTAL, MAX_FILES, excludedFile } from "@/lib/directory-policy.mjs";

export type LocalDirectoryFile = { id: string; name: string; reference: string; size: number; sha256: string; bytes: Uint8Array };
type DirectoryResult = { files: LocalDirectoryFile[]; skipped: string[]; missingReferences: string[]; total: number };
const origin = "http://127.0.0.1:6062";

// A top-level loopback window also works when an HTTPS browser blocks direct
// fetches to HTTP localhost. Only the exact opener and reader can exchange files.
export function readLocalDirectory(root: string, markdown: string): Promise<DirectoryResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let reader: Window | null = null, receiving = false;
    function finish(error?: Error, result?: DirectoryResult) {
      clearInterval(poll); clearTimeout(timeout); clearTimeout(startup); window.removeEventListener("message", onMessage);
      reader?.close();
      if (error) reject(error); else resolve(result!);
    }
    async function onMessage(event: MessageEvent) {
      if (event.origin !== origin || event.source !== reader || !event.data) return;
      if (event.data.type === "gongyan:directory-ready") {
        clearTimeout(startup);
        reader?.postMessage({ type: "gongyan:directory-request", requestId, root, markdown }, origin); return;
      }
      if (event.data.requestId !== requestId || receiving) return;
      if (event.data.type === "gongyan:directory-error") { finish(new Error(event.data.error || "未找到文件。")); return; }
      if (event.data.type !== "gongyan:directory-result") return;
      receiving = true;
      try {
        const input = event.data;
        if (!Array.isArray(input.files) || input.files.length > MAX_FILES || !Array.isArray(input.skipped) || !Array.isArray(input.missingReferences)) throw new Error("目录清单无效，请重试。");
        const files: LocalDirectoryFile[] = [], names = new Set<string>();
        let total = 0;
        for (const file of input.files) {
          if (typeof file.name !== "string" || file.name.startsWith("/") || file.name.split(/[\\/]/).some((part: string) => !part || part === "." || part === "..") || /[\x00-\x1f]/.test(file.name) || excludedFile(file.name) || names.has(file.name)) throw new Error("目录包含无效或重复路径。");
          if (!(file.bytes instanceof ArrayBuffer) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE || file.bytes.byteLength !== file.size || typeof file.reference !== "string" || typeof file.id !== "string") throw new Error("文件大小无效，请重试。");
          const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", file.bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
          if (sha256 !== file.sha256) throw new Error("文件校验失败：" + file.name);
          total += file.size; if (total > MAX_TOTAL) throw new Error("目录总量超过 200 MB。");
          names.add(file.name); files.push({ ...file, bytes: new Uint8Array(file.bytes) });
        }
        if (total !== input.total) throw new Error("目录总量校验失败。");
        finish(undefined, { files, total, skipped: input.skipped, missingReferences: input.missingReferences });
      } catch (error) { finish(error as Error); }
    }
    window.addEventListener("message", onMessage);
    const timeout = setTimeout(() => finish(new Error("本机目录服务未响应。请运行 npm run directory，再重新预览。")), 120_000);
    const startup = setTimeout(() => finish(new Error("本机目录服务尚未启动。请在项目目录运行 npm run directory，再重新预览。")), 8_000);
    const poll = setInterval(() => { if (reader?.closed && !receiving) finish(new Error("目录读取窗口已关闭。若本机服务尚未启动，请运行 npm run directory 后重试。")); }, 500);
    try { reader = window.open(origin + "/directory?origin=" + encodeURIComponent(window.location.origin), "gongyan-directory-" + requestId, "popup,width=580,height=420"); }
    catch { finish(new Error("无法打开本机读取窗口，请检查浏览器设置。")); return; }
    if (!reader) finish(new Error("请允许共研打开本机读取窗口，再重新预览目录。"));
  });
}
