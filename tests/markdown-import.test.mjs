import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, symlink, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseMarkdownConversation,
  markdownFileReferences,
  markdownSections,
  markdownMessageContext,
} from "../lib/markdown-conversation.mjs";
import {
  inspectMarkdownFiles,
  readApprovedFiles,
} from "../integrations/codex/markdown-files.mjs";

test("Markdown role markers preserve code fences, tables and math", () => {
  const markdown =
    "# 温度采集讨论\n\n## User\n请分析数据。\n\n## Assistant\n```python\nUser: this is code\nprint(1)\n```\n\n| 参数 | 数值 |\n| --- | --- |\n| 温度 | 25 |\n\n$$E=mc^2$$\n\n**You:** 下一步呢？\n**Codex:** 做一次实测。";
  const parsed = parseMarkdownConversation(markdown);
  assert.equal(parsed.title, "温度采集讨论");
  assert.equal(parsed.messages.length, 4);
  assert.equal(parsed.messages[1].role, "assistant");
  assert.ok(parsed.messages[1].content.includes("User: this is code"));
  assert.ok(parsed.messages[1].content.includes("$$E=mc^2$$"));
  assert.equal(parsed.markdown, markdown);
});
test("unmarked text is one disclosed assistant segment; malformed and huge input fail", () => {
  assert.equal(parseMarkdownConversation("# 项目报告\n\n内容").hasRoles, false);
  assert.equal(
    parseMarkdownConversation("# 项目报告\n\n内容").messages[0].role,
    "assistant",
  );
  assert.throws(() => parseMarkdownConversation(""), /粘贴/);
  assert.throws(() => parseMarkdownConversation("x".repeat(20_001)), /20,000/);
});
test("native Codex exports restore user turns without expanding tool history into turns", () => {
  const markdown =
    "# 图片处理\n\n> 请处理图片。\n>\n> User context\n>\n> Images:\n> - `/synthetic/input.png`\n\n<details><summary>2 previous messages</summary>\n\n> <details><summary>Ran a command</summary>\n>\n> ```sh\n> echo done\n> ```\n>\n> </details>\n\n</details>\n\n已处理。\n\n[下载图片](./output.png)\n\n> 下一步怎么做？\n\n保留原始文件。";
  const parsed = parseMarkdownConversation(markdown);
  assert.equal(parsed.format, "codex");
  assert.equal(parsed.hasRoles, true);
  assert.equal(parsed.title, "图片处理");
  assert.deepEqual(
    parsed.messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  );
  assert.equal(parsed.messages[2].content, "下一步怎么做？");
  assert.ok(parsed.messages[1].content.includes("2 previous messages"));
  assert.equal(parsed.markdown, markdown);
  const context = markdownMessageContext(parsed.messages[0].content);
  assert.equal(context.text, "请处理图片。");
  assert.deepEqual(context.files, [
    { path: "/synthetic/input.png", name: "input.png", kind: "image" },
  ]);
  assert.deepEqual(
    markdownFileReferences(markdown).map((file) => file.path),
    ["./output.png", "/synthetic/input.png"],
  );
  const sections = markdownSections(parsed.messages[1].content);
  assert.equal(sections[0].type, "fold");
  assert.equal(sections[0].sections[0].label, "Ran a command");
  assert.match(
    sections[0].sections[0].sections[0].content,
    /```sh\necho done\n```/,
  );
});
test("ordinary quotes and HTML examples remain Markdown; nested disclosures are inert data", () => {
  const report = "# 实验说明\n\n这是报告。\n\n> 来自论文的引用。\n\n继续说明。";
  assert.equal(parseMarkdownConversation(report).format, "markdown");
  const content =
    "```html\n<details><summary>code only</summary>\n</details>\n```\n\n<details><summary>Tool record</summary>\n\n<script>alert(1)</script>\n\n<details><summary>Nested record</summary>\n\n内容\n\n</details>\n\n</details>";
  const sections = markdownSections(content);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].type, "markdown");
  assert.match(sections[0].content, /code only/);
  assert.equal(sections[1].label, "Tool record");
  assert.equal(sections[1].sections[1].label, "Nested record");
  assert.deepEqual(
    markdownFileReferences(
      "# 实验\n\n> 问题\n\n内联示例 `/synthetic/do-not-read.png`。",
    ),
    [],
  );
});
test("extract only explicit local Markdown links with spaces, line numbers and parentheses", () => {
  const md =
    "[a](</tmp/file name.c:20>) ![图](file:///tmp/%E5%9B%BE.png) [b](./plot(1).csv) [remote](https://example.com/file)\n```md\n[hidden](/tmp/hidden)\n```\n[paper][report]\n\n[report]: ../report.pdf";
  assert.deepEqual(
    markdownFileReferences(md).map((file) => file.path),
    ["/tmp/file name.c", "/tmp/图.png", "./plot(1).csv", "../report.pdf"],
  );
});
test("directory discovery includes unlinked nested and empty files, excludes credentials", async () => {
  const base = await mkdtemp(join(tmpdir(), "gongyan-md-")), root = join(base, "work");
  await mkdir(root);
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "result.csv"), "temp,value\n20,1");
    await writeFile(join(root, "nested", "result.csv"), "different");
    await writeFile(join(root, "empty.txt"), "");
    await writeFile(join(root, ".env"), "SYNTHETIC_SECRET");
    const snapshot = await inspectMarkdownFiles("## Assistant\n[results](result.csv:2) [missing](missing.pdf)", root);
    assert.deepEqual(snapshot.candidates.map(f => f.name).sort(), ["empty.txt", "nested/result.csv", "result.csv"]);
    assert.equal(snapshot.skipped.length, 1);
    assert.deepEqual(snapshot.missingReferences, ["missing.pdf"]);
    const ids = snapshot.candidates.map(f => f.id);
    assert.equal((await readApprovedFiles(snapshot, ids)).length, 3);
    await assert.rejects(() => readApprovedFiles(snapshot, [ids[0]]), /完整清单/);
    await writeFile(join(root, "result.csv"), "temp,value\n20,2");
    await assert.rejects(() => readApprovedFiles(snapshot, ids), /改变/);
    await writeFile(join(base, "outside.txt"), "outside");
    await symlink(join(base, "outside.txt"), join(root, "escape.txt"));
    await assert.rejects(() => inspectMarkdownFiles("## Assistant\n成果", root), /符号链接/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
test("new files invalidate the whole preview instead of silently omitting them", async () => {
  const root = await mkdtemp(join(tmpdir(), "gongyan-md-change-"));
  try {
    await writeFile(join(root, "a.txt"), "a");
    const snapshot = await inspectMarkdownFiles("## Assistant\n成果", root);
    await writeFile(join(root, "b.txt"), "b");
    await assert.rejects(() => readApprovedFiles(snapshot, snapshot.candidates.map(f => f.id)), /清单已改变/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("oversized and too many files fail the entire preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "gongyan-md-limit-"));
  try {
    await writeFile(join(root, "large.bin"), new Uint8Array(20 * 1024 * 1024 + 1));
    await assert.rejects(() => inspectMarkdownFiles("## Assistant\n成果", root), /20 MB/);
    await rm(join(root, "large.bin"));
    for (let n = 0; n < 501; n++) await writeFile(join(root, n + ".txt"), "");
    await assert.rejects(() => inspectMarkdownFiles("## Assistant\n成果", root), /500/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
