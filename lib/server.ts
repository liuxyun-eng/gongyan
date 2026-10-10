import { env } from "cloudflare:workers";
import { getUser } from "@/lib/auth";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function db() {
  if (!env.DB) throw new AppError("数据服务暂时不可用，请稍后重试。", 503);
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET) throw new AppError("附件服务暂时不可用，请稍后重试。", 503);
  return env.BUCKET;
}
export async function identity() {
  const user = await getUser();
  if (!user) throw new AppError("请先登录。", 401);
  return { ...user, name: user.fullName || user.email.split("@")[0] };
}
export async function membership(projectId: string, userId: string) {
  const row = await db()
    .prepare("SELECT * FROM members WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first<any>();
  if (!row) throw new AppError("你没有这个项目的访问权限。", 403);
  return row;
}
export async function ownSession(id: string, userId: string) {
  const row = await db()
    .prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<any>();
  if (!row) throw new AppError("对话不存在或不属于你。", 404);
  await membership(row.project_id, userId);
  return row;
}
export function text(
  value: unknown,
  label: string,
  max = 2000,
  required = true,
) {
  if (typeof value !== "string") throw new AppError(label + "格式不正确。");
  const result = value.trim();
  if ((required && !result) || result.length > max)
    throw new AppError(label + "不能为空或超过长度限制。");
  return result;
}
export async function body(request: Request) {
  const raw = await limitedBytes(request, 500_000);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new AppError("提交内容格式不正确。");
  }
}
export async function limitedBytes(request: Request, max: number) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new AppError("提交内容过大。", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new AppError("提交内容过大。", 413);
    }
    parts.push(chunk.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new AppError("请求来源不匹配，请刷新页面重试。", 403);
}
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
