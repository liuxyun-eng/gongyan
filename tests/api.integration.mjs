import assert from "node:assert/strict";

// Local production worker only: Sites itself supplies these headers in production.
// Never run this script against a deployed site or expose the local worker publicly.
const base = process.env.GONGYAN_TEST_URL || "http://127.0.0.1:8787";
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
  "Tests require a loopback server",
);
const prefix = "integration-" + Date.now();
const owner = prefix + "-owner",
  member = prefix + "-member",
  outsider = prefix + "-outsider";
async function request(
  path,
  { as = owner, data, method, expected = 200, raw } = {},
) {
  const headers = {
    "oai-authenticated-user-id": as,
    "oai-authenticated-user-email": as + "@sites.test",
    Origin: base,
  };
  if (data !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(base + "/api/" + path, {
    method: method || (data !== undefined || raw ? "POST" : "GET"),
    headers,
    body: raw || (data !== undefined ? JSON.stringify(data) : undefined),
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
async function room(as = owner) {
  return request("room?projectId=" + project.id, { as });
}
const anonymous = await fetch(base + "/api/projects");
assert.equal(anonymous.status, 401);
await request("projects", { data: null, expected: 400 });
const project = await request("projects", {
  data: {
    name: "集成验证 " + prefix,
    description: "仅本地测试：发布游标、个人权限、任务领取及附件",
  },
  expected: 201,
});
let state = await room();
assert.equal(state.members.length, 1);
await request("room?projectId=" + project.id, { as: outsider, expected: 403 });
await request("join", {
  as: member,
  data: { code: state.project.invite_code },
});
const session = await request("sessions", {
  data: { projectId: project.id, title: "私有测试对话", tool: "Codex" },
  expected: 201,
});
await request("messages", {
  data: {
    sessionId: session.id,
    messages: [
      { role: "user", content: "公开问题，含测试用敏感片段 SECRET" },
      { role: "assistant", content: "本条应取消分享" },
      { role: "user", content: "第三条记录" },
    ],
  },
});
const saved = await request("messages?sessionId=" + session.id);
assert.equal(saved.messages.length, 3);
const end = saved.messages.at(-1).id;
await request("messages?sessionId=" + session.id, {
  as: member,
  expected: 404,
});
assert.equal((await room(member)).sessions.length, 0);
const publication = {
  sessionId: session.id,
  start: 0,
  end,
  title: "第一批进度",
  summary: "已编辑的摘要",
  nextSteps: "实测验证",
  evidenceType: "AI 推断",
  messages: [{ id: saved.messages[0].id, content: "公开问题，已删去敏感片段" }],
  fileIds: [],
};
await request("publish", {
  data: { ...publication, messages: [] },
  expected: 400,
});
assert.equal(
  (await request("messages?sessionId=" + session.id)).session.published_through,
  0,
);
// A message arriving after preview must remain pending for the next publication.
await request("messages", {
  data: {
    sessionId: session.id,
    messages: [{ role: "assistant", content: "预览之后的新消息" }],
  },
});
const publicationResponses = await Promise.all(
  [1, 2].map(() =>
    fetch(base + "/api/publish", {
      method: "POST",
      headers: {
        "oai-authenticated-user-id": owner,
        "oai-authenticated-user-email": owner + "@sites.test",
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(publication),
    }),
  ),
);
assert.deepEqual(publicationResponses.map((r) => r.status).sort(), [201, 409]);
state = await room(member);
assert.equal(state.posts.length, 1);
assert.equal(JSON.parse(state.posts[0].transcript).length, 1);
assert.ok(!JSON.stringify(state.posts).includes("SECRET"));
assert.ok(!JSON.stringify(state.posts).includes("本条应取消分享"));
const after = await request("messages?sessionId=" + session.id);
assert.equal(after.session.published_through, end);
assert.ok(
  after.messages[0].content.includes("SECRET"),
  "Redaction must not mutate private originals",
);
assert.equal(after.messages.filter((m) => m.id > end).length, 1);
await request("publish", { data: publication, expected: 409 });
await request("publish", { as: member, data: publication, expected: 404 });
const next = after.messages.at(-1);
await request("publish", {
  data: {
    ...publication,
    start: end,
    end: next.id,
    title: "第二批进度",
    messages: [{ id: next.id, content: next.content }],
  },
  expected: 201,
});
assert.equal((await room()).sessions[0].pending_count, 0);
await request("tasks", {
  data: { projectId: project.id, title: "并发领取任务" },
});
const task = (await room()).tasks[0];
const claimResponses = await Promise.all(
  [owner, member].map((as) =>
    fetch(base + "/api/tasks/" + task.id, {
      method: "PATCH",
      headers: {
        "oai-authenticated-user-id": as,
        "oai-authenticated-user-email": as + "@sites.test",
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "claim" }),
    }),
  ),
);
assert.deepEqual(claimResponses.map((r) => r.status).sort(), [200, 409]);
const claimed = (await room()).tasks[0];
assert.ok([owner, member].includes(claimed.assignee));
await request("tasks/" + task.id, {
  as: outsider,
  method: "PATCH",
  data: { action: "complete" },
  expected: 403,
});
await request("tasks/" + task.id, {
  as: claimed.assignee,
  method: "PATCH",
  data: { action: "complete" },
});
assert.equal((await room()).tasks[0].status, "done");
const content = "实验记录：测试附件内容";
const upload = await request(
  "files?projectId=" +
    project.id +
    "&name=" +
    encodeURIComponent("实验记录.txt"),
  { raw: content, expected: 201 },
);
const download = await fetch(base + "/api/files/" + upload.id, {
  headers: {
    "oai-authenticated-user-id": member,
    "oai-authenticated-user-email": member + "@sites.test",
  },
});
assert.equal(download.status, 200);
assert.equal(await download.text(), content);
assert.ok(download.headers.get("content-disposition").includes("filename*="));
await request("files/" + upload.id, { as: outsider, expected: 403 });
await request("posts", {
  as: member,
  data: { projectId: project.id, content: "团队讨论测试" },
});
assert.equal((await room()).posts.length, 3);
await request("join", {
  as: outsider,
  data: { code: "wrong-invite" },
  expected: 404,
});
console.log(
  "PASS: publication boundaries, redaction, concurrency, private transcripts, membership, task claims, file upload/download, team messages.",
);
console.log("Local test project:", project.id);
