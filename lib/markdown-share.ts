import { AppError, db, bucket, text, limitedBytes, now, id, json } from "@/lib/server";
import { excerptSummary } from "@/lib/conversations";
import { parseMarkdownConversation } from "@/lib/markdown-conversation.mjs";

const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const MAX_FILES = 500;
type Project = { project_id: string; user_id: string };
export async function digest(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map(x => x.toString(16).padStart(2, "0")).join("");
}
function uuid(value: unknown) {
  const result = text(value, "提交标识", 100);
  if (!/^[a-f0-9-]{36}$/i.test(result)) throw new AppError("提交标识无效。");
  return result;
}
function fileInfo(input: any) {
  if (!input || typeof input !== "object") throw new AppError("文件清单格式不正确。");
  text(input.name, "文件路径", 1500);
  text(input.reference || "", "文件引用", 2000, false);
  const file = {
    id: uuid(input.id),
    name: input.name as string,
    reference: (input.reference || "") as string,
    size: input.size as number,
    sha256: text(input.sha256, "文件校验值", 64),
  };
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new AppError("文件大小或校验值无效，单文件最多 20 MB。");
  if (file.name.startsWith("/") || file.name.split(/[\\/]/).some(x => !x || x === "." || x === "..") || /[\x00-\x1f]/.test(file.name)) throw new AppError("文件路径无效。");
  return file;
}
async function objectKey(project: Project, requestId: string, fileId: string) {
  return "markdown/" + await digest(project.project_id + "\n" + project.user_id) + "/" + requestId + "/" + fileId;
}
async function receipt(postId: string) {
  const post = await db().prepare("SELECT kind FROM posts WHERE id=?").bind(postId).first<{ kind: string }>();
  if (!post || post.kind === "deleted") throw new AppError("这条共享对话已删除，请重新预览后再分享。", 410);
  const files = await db().prepare("SELECT id,name,size FROM files WHERE post_id=? ORDER BY name").bind(postId).all();
  return { postId, files: files.results, verified: true };
}

// Called only after the ordinary signed-in identity, origin and membership checks.
export async function handleMarkdownShare(request: Request, project: Project, action?: string) {
  try {
    if (["prepare", "seal", "verify"].includes(action || "") && request.method === "POST") {
      const input = JSON.parse(new TextDecoder().decode(await limitedBytes(request, 12_000)));
      const requestId = uuid(input.requestId), file = fileInfo(input.file);
      const key = await objectKey(project, requestId, file.id), signature = await digest(JSON.stringify(file));
      const store = bucket() as unknown as {
        prepareUpload?: (key: string, file: ReturnType<typeof fileInfo>, signature: string) => Promise<unknown>;
        verifyUpload?: (key: string, file: ReturnType<typeof fileInfo>, signature: string, ticket: string) => Promise<void>;
        sealUpload?: (key: string, signature: string, ticket: string, file: ReturnType<typeof fileInfo>, chunks: unknown) => Promise<void>;
      };
      const existing = await bucket().head(key);
      if (existing && existing.customMetadata?.signature !== signature) throw new AppError("文件提交标识已用于其他内容。", 409);
      if (existing) return json({ id: file.id, size: file.size, sha256: file.sha256, verified: true });
      if (action === "prepare") return json(store.prepareUpload ? await store.prepareUpload(key, file, signature) : { transport: "proxy" });
      if (!store.verifyUpload || typeof input.ticket !== "string") throw new AppError("上传校验凭证无效。");
      if (action === "seal") {
        if (!store.sealUpload) throw new AppError("未找到这个上传操作。", 404);
        await store.sealUpload(key, signature, input.ticket, file, input.chunks);
        return json({ sealed: true });
      }
      await store.verifyUpload(key, file, signature, input.ticket);
      return json({ id: file.id, size: file.size, sha256: file.sha256, verified: true });
    }
    if (action === "chunk" && request.method === "POST") {
      const url = new URL(request.url), requestId = uuid(url.searchParams.get("requestId"));
      let input;
      try { input = JSON.parse(url.searchParams.get("file") || ""); } catch { throw new AppError("文件清单格式不正确。"); }
      const file = fileInfo(input), ticket = url.searchParams.get("ticket"), index = Number(url.searchParams.get("index"));
      if (!ticket || !Number.isSafeInteger(index) || index < 0 || index >= Math.max(1, Math.ceil(file.size / (2 * 1024 * 1024)))) throw new AppError("文件分段标识无效。");
      const store = bucket() as unknown as { uploadChunk?: (key: string, file: ReturnType<typeof fileInfo>, signature: string, ticket: string, index: number, bytes: Uint8Array) => Promise<unknown> };
      if (!store.uploadChunk) throw new AppError("未找到这个上传操作。", 404);
      const bytes = await limitedBytes(request, 2 * 1024 * 1024);
      const result = await store.uploadChunk(await objectKey(project, requestId, file.id), file, await digest(JSON.stringify(file)), ticket, index, bytes);
      return json(result);
    }
    if (action === "files" && request.method === "POST") {
      const url = new URL(request.url);
      const requestId = uuid(url.searchParams.get("requestId"));
      let input;
      try { input = JSON.parse(url.searchParams.get("file") || ""); } catch { throw new AppError("文件清单格式不正确。"); }
      const file = fileInfo(input);
      const bytes = await limitedBytes(request, MAX_FILE);
      if (bytes.length !== file.size || await digest(bytes) !== file.sha256) throw new AppError("文件传输校验失败，请重试。", 409);
      const key = await objectKey(project, requestId, file.id);
      const signature = await digest(JSON.stringify(file));
      const existing = await bucket().head(key);
      if (existing && existing.customMetadata?.signature !== signature) throw new AppError("文件提交标识已用于其他内容。", 409);
      if (!existing) {
        await bucket().put(key, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { signature, sha256: file.sha256 } });
        const saved = await bucket().get(key);
        if (!saved || saved.size !== file.size || await digest(new Uint8Array(await saved.arrayBuffer())) !== file.sha256) {
          await bucket().delete(key);
          throw new AppError("文件保存校验失败，请重试。", 503);
        }
      }
      return json({ id: file.id, size: file.size, sha256: file.sha256, verified: true });
    }
    if (action || request.method !== "POST") throw new AppError("未找到这个上传操作。", 404);
    let input;
    try { input = JSON.parse(new TextDecoder().decode(await limitedBytes(request, 2 * 1024 * 1024))); } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("分享内容格式不正确。");
    }
    let parsed;
    try { parsed = parseMarkdownConversation(input?.markdown); } catch (error) { throw new AppError((error as Error).message); }
    const requestId = uuid(input.requestId);
    const title = text(input.title || parsed.title, "标题", 150);
    if (!Array.isArray(input.files) || input.files.length > MAX_FILES) throw new AppError("每次最多上传 500 个文件。");
    const files = input.files.map(fileInfo);
    if (new Set(files.map((f: any) => f.id)).size !== files.length || new Set(files.map((f: any) => f.name)).size !== files.length) throw new AppError("文件清单包含重复路径或标识。");
    if (files.reduce((sum: number, f: any) => sum + f.size, 0) > MAX_TOTAL) throw new AppError("目录总量最多 200 MB。");
    const requestHash = await digest(JSON.stringify({ markdown: parsed.markdown, title, files }));
    const existing = await db().prepare("SELECT post_id,request_hash FROM deliveries WHERE project_id=? AND user_id=? AND request_id=?").bind(project.project_id, project.user_id, requestId).first<any>();
    if (existing) {
      if (existing.request_hash !== requestHash) throw new AppError("本次提交标识已用于其他内容，请重新预览。", 409);
      return json({ ...await receipt(existing.post_id), idempotent: true });
    }
    const objects = [];
    const objectPrefix = "markdown/" + await digest(project.project_id + "\n" + project.user_id) + "/" + requestId + "/";
    for (const file of files) {
      const key = objectPrefix + file.id;
      const object = await bucket().head(key);
      if (!object || object.size !== file.size || object.customMetadata?.signature !== await digest(JSON.stringify(file))) throw new AppError("文件尚未完整保存：" + file.name + "。请重试。", 409);
      objects.push({ ...file, key });
    }
    const postId = id(), date = now();
    const transcript = parsed.messages.map((m: any, index: number) => ({
      ...m, id: "markdown:" + (index + 1), position: index + 1,
      ...(index === 0 ? { sourceMarkdown: parsed.markdown, references: files.map((f: any) => ({ id: f.id, name: f.name, path: f.reference })) } : {}),
    }));
    // D1 Free allows 50 queries per invocation and 100 parameters per query.
    // Twelve rows per insert keeps the complete 500-file commit inside both limits.
    const fileStatements = [];
    for (let index = 0; index < objects.length; index += 12) {
      const group = objects.slice(index, index + 12);
      fileStatements.push(db().prepare("INSERT INTO files(id,project_id,user_id,name,size,object_key,post_id,created_at) VALUES " + group.map(() => "(?,?,?,?,?,?,?,?)").join(",")).bind(...group.flatMap(f => [f.id, project.project_id, project.user_id, f.name, f.size, f.key, postId, date])));
    }
    try {
      await db().batch([
        db().prepare("INSERT INTO posts(id,project_id,user_id,kind,title,summary,evidence_type,tool,transcript,file_ids,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(postId, project.project_id, project.user_id, "progress", title, excerptSummary(transcript), "待复核", "Codex", JSON.stringify(transcript), JSON.stringify(files.map((f: any) => f.id)), date),
        ...fileStatements,
        db().prepare("INSERT INTO deliveries(id,project_id,user_id,request_id,request_hash,post_id,created_at) VALUES (?,?,?,?,?,?,?)").bind(id(), project.project_id, project.user_id, requestId, requestHash, postId, date),
      ]);
    } catch (error) {
      const saved = await db().prepare("SELECT post_id,request_hash FROM deliveries WHERE project_id=? AND user_id=? AND request_id=?").bind(project.project_id, project.user_id, requestId).first<any>();
      if (saved?.request_hash === requestHash) return json({ ...await receipt(saved.post_id), idempotent: true });
      throw error;
    }
    return json({ ...await receipt(postId), syncedMessages: transcript.length }, 201);
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    console.error("Markdown upload failed", error);
    return json({ error: "分享未完成，请保留文件并重试。" }, 503);
  }
}
