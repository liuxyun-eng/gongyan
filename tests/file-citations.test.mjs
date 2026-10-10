import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexFileCitations, normalizeCodexFileCitations } from "../lib/file-citations.mjs";
import { markdownFileReferences } from "../lib/markdown-conversation.mjs";
import { inspectMarkdownFiles } from "../integrations/codex/markdown-files.mjs";

test("Codex output citations become filename links and explicit file references", () => {
  const path = "/synthetic/工作目录/outputs/实验 报告(1).pdf";
  const marker = ':codex-file-citation{path="' + path + '" purpose="output"}';
  const source = "PDF 已完成。\n\n" + marker;
  assert.deepEqual(markdownFileReferences(source), [{ path, label: "实验 报告(1).pdf" }]);
  const rendered = normalizeCodexFileCitations(source);
  assert.doesNotMatch(rendered, /codex-file-citation/);
  assert.match(rendered, /\[实验 报告\(1\)\.pdf\]/);
  assert.equal(markdownFileReferences(rendered)[0].path, path);
  assert.equal(source.endsWith(marker), true, "Original export is untouched");
});

test("citation examples in code and HTML stay inert, invalid destinations are not read", () => {
  const marker = ':codex-file-citation{path="/synthetic/report.pdf" purpose="output"}';
  const source = '`' + marker + '`\n\n```text\n' + marker + '\n```\n\n<div>' + marker + '</div>';
  assert.deepEqual(codexFileCitations(source), []);
  assert.equal(normalizeCodexFileCitations(source), source);
  assert.deepEqual(codexFileCitations(':codex-file-citation{path="https://outside.example/report.pdf"}'), []);
  assert.deepEqual(codexFileCitations(':codex-file-citation{path="/broken.pdf}'), []);
  assert.deepEqual(codexFileCitations(':codex-file-citation{path="//outside/report.pdf"}'), []);
});

test("typed directories bind citations to actual files; absent paths report not found", async () => {
  const root = await mkdtemp(join(tmpdir(), "gongyan-citation-"));
  try {
    await mkdir(join(root, "outputs"));
    const path = join(root, "outputs/实验 报告.pdf");
    await writeFile(path, "%PDF-1.4\n% synthetic test only\n");
    const markdown = ':codex-file-citation{path="' + path + '" purpose="output"}\n\n:codex-file-citation{path="' + root + '/missing.pdf"}';
    const inspected = await inspectMarkdownFiles(markdown, root);
    assert.equal(inspected.candidates[0].reference, path);
    assert.equal(inspected.candidates[0].name, "outputs/实验 报告.pdf");
    assert.deepEqual(inspected.missingReferences, [root + "/missing.pdf"]);
    await assert.rejects(inspectMarkdownFiles(markdown, root + "/absent"), /未找到文件/);
    await mkdir(join(root, "empty"));
    assert.deepEqual((await inspectMarkdownFiles(markdown, root + "/empty")).candidates, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
