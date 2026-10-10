import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { publishMarkdown } from "../scripts/publish-markdown.mjs";
const base = process.env.GONGYAN_TEST_URL || "http://127.0.0.1:8792";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
const owner = "markdown-test-" + Date.now(), member = owner + "-member", outsider = owner + "-outsider";
const headers = as => ({ "oai-authenticated-user-id": as, "oai-authenticated-user-email": as + "@sites.test" });
async function call(path, data, expected = 200, as = owner) {
  const response = await fetch(base + "/api/" + path, { method: data ? "POST" : "GET", headers: { ...headers(as), ...(data ? { "Content-Type": "application/json" } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
const project = await call("projects", { name: "Markdown 与目录 · 合成验证" }, 201);
const initial = await call("room?projectId=" + project.id);
await call("join", { code: initial.project.invite_code }, 200, member);
const markdown = "# 实验分析\n\n## User\n请检查标定数据。\n\n## Assistant\n[数据](./data.csv)\n\n\\(E=mc^2\\)";
const first = await publishMarkdown({ base, headers: headers(owner), projectId: project.id, markdown, records: [{ name: "data.csv", content: "temp\n25" }, { name: "nested/data.csv", content: "different" }, { name: "empty.txt", content: "" }] });
const payload = { requestId: first.requestId, markdown, files: first.manifest };
const duplicate = await call("markdown-share?projectId=" + project.id, payload);
assert.equal(duplicate.postId, first.postId); assert.equal(duplicate.idempotent, true);
await call("markdown-share?projectId=" + project.id, { ...payload, markdown: markdown + "changed" }, 409);
await call("markdown-share?projectId=" + project.id, payload, 403, outsider);
const room = await call("room?projectId=" + project.id, undefined, 200, member);
assert.equal(room.posts.length, 1);
const transcript = JSON.parse(room.posts[0].transcript);
assert.equal(transcript[0].sourceMarkdown, markdown);
assert.equal(transcript[0].references.length, 3);
const contents = new Map([["data.csv", "temp\n25"], ["nested/data.csv", "different"], ["empty.txt", ""]]);
for (const file of first.files) {
  const download = await fetch(base + "/api/files/" + file.id, { headers: headers(member) });
  assert.equal(download.status, 200); assert.equal(await download.text(), contents.get(file.name));
}
const missing = { id: randomUUID(), name: "missing.txt", reference: "./missing.txt", size: 1, sha256: createHash("sha256").update("x").digest("hex") };
await call("markdown-share?projectId=" + project.id, { requestId: randomUUID(), markdown, files: [missing] }, 409);
await call("markdown-share?projectId=" + project.id, { requestId: randomUUID(), markdown: "", files: [] }, 400);
await call("codex/connections", {}, 404);
assert.equal((await call("room?projectId=" + project.id)).posts.length, 1);
const post = room.posts[0];
const revision = createHash("sha256").update(post.transcript).digest("hex");
for (const as of [member, outsider]) {
  const response = await fetch(base + "/api/posts/" + first.postId + "/messages", { method: "DELETE", headers: { ...headers(as), "Content-Type": "application/json" }, body: JSON.stringify({ index: 0, revision }) });
  assert.equal(response.status, 403, await response.text());
}
const response = await fetch(base + "/api/posts/" + first.postId + "/messages", { method: "DELETE", headers: { ...headers(owner), "Content-Type": "application/json" }, body: JSON.stringify({ index: 0, revision }) });
assert.equal(response.status, 200);
const deletion = await response.json();
assert.doesNotMatch(deletion.transcript, /请检查标定数据/);
assert.equal(JSON.parse(deletion.transcript)[0].references.length, 3);
async function removePost(postId, revision, expected = 200, as = owner, extraHeaders = {}) {
  const response = await fetch(base + "/api/posts/" + postId, { method: "DELETE", headers: { ...headers(as), "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify({ revision }) });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
const memberPost = await publishMarkdown({ base, headers: headers(member), projectId: project.id, markdown: "## Assistant\n组员上传的独立对话", records: [] });
for (const as of [member, outsider]) await removePost(first.postId, revision, 403, as);
await removePost(first.postId, revision, 409);
const beforeDelete = await call("room?projectId=" + project.id);
assert.equal(beforeDelete.posts.length, 2);
assert.ok(beforeDelete.files.every(file => file.post_id === first.postId));
const currentRevision = createHash("sha256").update(deletion.transcript).digest("hex");
await removePost(first.postId, currentRevision, 403, owner, { origin: "http://foreign.example" });
assert.equal((await removePost(first.postId, currentRevision)).deleted, true);
await removePost(first.postId, currentRevision); // A lost delete response can be retried.
await removePost(first.postId, currentRevision, 403, member);
const afterDelete = await call("room?projectId=" + project.id, undefined, 200, member);
assert.deepEqual(afterDelete.posts.map(post => post.id), [memberPost.postId]);
assert.equal(afterDelete.files.length, 3);
assert.ok(afterDelete.files.every(file => file.post_id === null));
for (const file of afterDelete.files) {
  assert.equal((await call("files/" + file.id + "/context", undefined, 200, member)).post, null);
  const download = await fetch(base + "/api/files/" + file.id, { headers: headers(member) });
  assert.equal(download.status, 200); assert.equal(await download.text(), contents.get(file.name));
}
await call("markdown-share?projectId=" + project.id, payload, 410);
const deletedMessageResponse = await fetch(base + "/api/posts/" + first.postId + "/messages", { method: "DELETE", headers: { ...headers(owner), "Content-Type": "application/json" }, body: JSON.stringify({ index: 0, revision: currentRevision }) });
assert.equal(deletedMessageResponse.status, 404); await deletedMessageResponse.arrayBuffer();
const memberSnapshot = afterDelete.posts[0];
const memberRevision = createHash("sha256").update(memberSnapshot.transcript).digest("hex");
await removePost(memberPost.postId, memberRevision, 403, owner); // Project ownership does not override uploader ownership.
const clearMember = await fetch(base + "/api/posts/" + memberPost.postId + "/messages", { method: "DELETE", headers: { ...headers(member), "Content-Type": "application/json" }, body: JSON.stringify({ index: 0, revision: memberRevision }) });
assert.equal(clearMember.status, 200); assert.equal((await clearMember.json()).transcript, "[]");
await removePost(memberPost.postId, createHash("sha256").update("[]").digest("hex"), 200, member);
await removePost(randomUUID(), currentRevision, 404);
assert.equal((await call("room?projectId=" + project.id)).posts.length, 0);
console.log("Production Markdown upload: all files verified, original text retained, same-name nested files and empty files downloaded, incomplete manifests rejected, idempotent retry and member isolation passed.");
console.log("Whole conversation deletion: uploader-only permissions, stale versions and foreign origins rejected, exact target removed, retained files downloadable, empty snapshots removable, retries cannot resurrect deleted content.");
