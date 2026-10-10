import test from "node:test";
import assert from "node:assert/strict";
import { sharedTranscript, sharedMarkdown } from "../lib/shared-transcript.mjs";

test("historical flattened Codex Markdown still restores separate turns", () => {
  const source = "# 实验\n\n> 问题\n\n答案\n\n> 下一步？\n\n复测。";
  const messages = sharedTranscript({ transcript: JSON.stringify([{ role: "assistant", content: source, sourceMarkdown: source }]) });
  assert.deepEqual(messages.map(m => m.role), ["user", "assistant", "user", "assistant"]);
});
test("an edited snapshot uses its canonical remaining messages without resurrecting a deleted turn", () => {
  const remaining = [{ id: "retained", role: "assistant", content: "保留的回答。", sourceMarkdown: "# 导出\n\n## Assistant\n保留的回答。", snapshotVersion: 2 }];
  const messages = sharedTranscript({ transcript: JSON.stringify(remaining) });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "retained");
  const exported = sharedMarkdown("导出", messages);
  assert.equal(exported, "# 导出\n\n## Assistant\n\n保留的回答。");
});
test("empty deleted conversations stay empty; ordinary text posts still render", () => {
  assert.deepEqual(sharedTranscript({ transcript: "[]", summary: "" }), []);
  assert.equal(sharedTranscript({ transcript: "[]", summary: "普通记录", kind: "discussion" })[0].content, "普通记录");
});
