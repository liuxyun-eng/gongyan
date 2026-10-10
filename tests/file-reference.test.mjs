import test from "node:test";
import assert from "node:assert/strict";
import { attachmentFor } from "../lib/file-reference.mjs";

test("historical relative uploads resolve absolute Codex citations and encoded filenames", () => {
  const file = { id: "old", name: "实验 报告.pdf", path: "./实验 报告.pdf" };
  assert.equal(attachmentFor("/synthetic/outputs/实验 报告.pdf", [file]), file);
  assert.equal(attachmentFor("file:///synthetic/outputs/%E5%AE%9E%E9%AA%8C%20%E6%8A%A5%E5%91%8A.pdf", [file]), file);
  assert.equal(attachmentFor("/api/files/old", [file]), file);
  assert.equal(attachmentFor("./实验 报告.pdf", [file]), file);
  assert.equal(attachmentFor("https://example.com/实验 报告.pdf", [file]), undefined);
  assert.equal(attachmentFor("/synthetic/missing.pdf", [file]), undefined);
});

test("ambiguous filenames stay unavailable and the longest matching folder wins", () => {
  const left = { id: "a", name: "a/report.pdf", path: "./report.pdf" };
  const right = { id: "b", name: "b/report.pdf", path: "./report.pdf" };
  assert.equal(attachmentFor("/synthetic/report.pdf", [left, right]), undefined);
  assert.equal(attachmentFor("/synthetic/a/report.pdf", [left, right]), left);
  assert.equal(attachmentFor("/synthetic/b/report.pdf", [left, right]), right);
  assert.equal(attachmentFor("report.pdf", [left, right]), undefined);
});

test("new absolute records require an exact path and do not borrow another filename", () => {
  const file = { id: "new", name: "outputs/report.pdf", path: "/synthetic/outputs/report.pdf" };
  assert.equal(attachmentFor(file.path + "#L3", [file]), file);
  assert.equal(attachmentFor("/different/report.pdf", [file]), undefined);
  assert.equal(attachmentFor("//outside/report.pdf", [file]), undefined);
});
