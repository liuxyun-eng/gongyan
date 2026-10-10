import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { publishMarkdown } from "../scripts/publish-markdown.mjs";
const base = process.argv[2] || "http://127.0.0.1:8793";
const options = process.argv[3] === "--remote" ? JSON.parse(await new Promise(resolve => { let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => resolve(input)); })) : { code: "synthetic-test-invite", fileCount: 500 };
const code = options.code, fileCount = options.fileCount || 3;
const prefix = "qa_" + randomUUID().slice(0, 8), password = randomUUID() + "synthetic";
async function api(path, method = "GET", payload, cookie, expected = 200, extra = {}) {
  const response = await fetch(base + path, { method, headers: { ...(payload ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await response.json().catch(async () => ({ nonJson: response.status }));
  assert.equal(response.status, expected, path + ": " + JSON.stringify(result));
  return { result, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie, headers: response.headers };
}
await api("/api/projects", "GET", undefined, undefined, 401, { "oai-authenticated-user-id": "forged", "oai-authenticated-user-email": "forged@local.test" });
await api("/api/auth/register", "POST", { username: prefix, password, name: "测试成员", code: "invalid" }, undefined, 403);
const owner = await api("/api/auth/register", "POST", { username: prefix + "_owner", password, name: "测试创建者", code }, undefined, 201);
assert.match(owner.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
if (base.startsWith("https:")) assert.match(owner.headers.get("set-cookie"), /Secure/);
const member = await api("/api/auth/register", "POST", { username: prefix + "_member", password, name: "测试成员", code }, undefined, 201);
const outsider = await api("/api/auth/register", "POST", { username: prefix + "_outsider", password, name: "测试访客", code }, undefined, 201);
await api("/api/auth/login", "POST", { username: prefix + "_owner", password: "wrongpassword" }, undefined, 401);
await api("/api/auth/login", "POST", { username: prefix + "_owner", password }, undefined);
const project = (await api("/api/projects", "POST", { name: "云端部署验证 · " + prefix, description: "合成测试内容，验证共享对话和文件上传。" }, owner.cookie, 201)).result.id;
const room = (await api("/api/room?projectId=" + project, "GET", undefined, owner.cookie)).result;
await api("/api/room?projectId=" + project, "GET", undefined, outsider.cookie, 403);
await api("/api/join", "POST", { code: room.project.invite_code }, member.cookie);
await api("/api/projects", "POST", { name: "foreign" }, owner.cookie, 403, { Origin: "https://untrusted.invalid" });
const markdown = "# 云端验证\n\n> 共享目录的所有文件。\n\n全部文件需要校验。\n\n\\[A \\downarrow B = \\neg(A\\lor B)\\]\n";
// A missing object must prevent the whole post from appearing.
const missing = { id: randomUUID(), name: "missing.txt", reference: "./missing.txt", size: 1, sha256: createHash("sha256").update("x").digest("hex") };
await api("/api/markdown-share?projectId=" + project, "POST", { requestId: randomUUID(), markdown, files: [missing] }, owner.cookie, 409);
assert.equal((await api("/api/room?projectId=" + project, "GET", undefined, owner.cookie)).result.posts.length, 0);
const records = Array.from({ length: fileCount }, (_, i) => ({ name: "outputs/nested/" + i + ".txt", content: i === 0 ? "" : "Synthetic file " + i + "\n" }));
const publication = await publishMarkdown({ base, headers: { Cookie: owner.cookie }, projectId: project, markdown, records });
assert.equal(publication.files.length, fileCount);
for (const index of [0, fileCount - 1]) {
  const file = publication.manifest[index];
  const download = await fetch(base + "/api/files/" + file.id, { headers: { Cookie: member.cookie } });
  assert.equal(download.status, 200);
  assert.equal(createHash("sha256").update(Buffer.from(await download.arrayBuffer())).digest("hex"), file.sha256);
  await api("/api/files/" + file.id, "GET", undefined, outsider.cookie, 403);
}
await api("/api/markdown-share?projectId=" + project, "POST", { requestId: publication.requestId, markdown, files: publication.manifest }, owner.cookie);
const after = (await api("/api/room?projectId=" + project, "GET", undefined, member.cookie)).result;
assert.equal(after.posts.length, 1); assert.equal(after.files.length, fileCount);
await api("/api/auth/logout", "POST", undefined, owner.cookie);
await api("/api/projects", "GET", undefined, owner.cookie, 401);
console.log(JSON.stringify({ verified: true, projectId: project, postId: publication.postId, fileCount, checks: ["identity-header forgery denied", "registration invite checked", "independent accounts", "secure cookie", "login", "member join", "outsider denied", "foreign origin denied", "partial upload blocked", "full directory committed", "download hashes match", "idempotent commit", "logout revoked"] }));
