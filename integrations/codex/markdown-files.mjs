import { open, realpath, stat, readdir, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative, isAbsolute, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { markdownFileReferences, parseMarkdownConversation } from "./markdown-conversation.mjs";

export const MAX_FILE = 20 * 1024 * 1024;
export const MAX_TOTAL = 200 * 1024 * 1024;
export const MAX_FILES = 500;
const excludedSegment = /^(?:\.(?:env(?:\..*)?|git|ssh|aws|codex|gnupg|config|sites-runtime|wrangler|next)|node_modules|__pycache__|\.DS_Store)$/i;
const excludedName = /^(?:id_(?:rsa|ed25519|ecdsa)|credentials(?:\..*)?|gongyan-codex.*\.json|.*\.(?:pem|key|p12|pfx))$/i;
const excluded = path => path.split(/[\\/]/).some(p => excludedSegment.test(p)) || excludedName.test(basename(path));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function inside(root, path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../");
}
async function inventory(root) {
  const paths = [], skipped = [];
  let entries = 0;
  async function walk(folder, depth = 0) {
    if (depth > 40) throw new Error("目录嵌套超过 40 层，请选择较小的工作目录。");
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (++entries > 20_000) throw new Error("目录项目过多，请选择本次成果所在目录。");
      const path = resolve(folder, entry.name), name = relative(root, path).split("\\").join("/");
      if (excluded(name)) { skipped.push({ name, reason: "凭证、系统文件或依赖目录" }); continue; }
      if (entry.isSymbolicLink()) throw new Error("目录包含符号链接：" + name + "。请改用实际文件，避免遗漏或越界。");
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile()) {
        paths.push({ path, name });
        if (paths.length > MAX_FILES) throw new Error("目录超过 500 个文件，请分目录分享。没有文件被上传。");
      } else throw new Error("目录包含无法上传的特殊文件：" + name);
    }
  }
  await walk(root);
  return { paths, skipped };
}
async function readRegular(root, path) {
  if (!inside(root, path) || excluded(relative(root, path))) throw new Error("文件超出工作目录范围。");
  if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== path) throw new Error("文件路径已改变或包含符号链接，请重新读取。");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new Error("不是普通文件。");
    if (before.size > MAX_FILE) throw new Error("超过单文件 20 MB 限制。");
    const bytes = await file.readFile();
    const after = await file.stat();
    if (bytes.length !== before.size || after.mtimeMs !== before.mtimeMs || after.size !== before.size) throw new Error("文件正在变化，请保存后重新读取。");
    return bytes;
  } finally { await file.close(); }
}
export async function inspectMarkdownFiles(markdown, requestedRoot) {
  const conversation = parseMarkdownConversation(markdown);
  if (typeof requestedRoot !== "string" || !isAbsolute(requestedRoot) || requestedRoot.length > 2000) throw new Error("请填写完整的本机工作目录路径。");
  const root = await realpath(requestedRoot);
  if (excluded(root) || root === "/" || !(await stat(root)).isDirectory()) throw new Error("请选择成果所在的工作目录。");
  const { paths, skipped } = await inventory(root);
  const links = markdownFileReferences(conversation.markdown);
  const candidates = [], originals = new Map();
  let total = 0;
  for (const item of paths) {
    let bytes;
    try { bytes = await readRegular(root, item.path); } catch (error) { throw new Error(item.name + "：" + error.message + " 本次分享尚未上传任何文件。"); }
    total += bytes.length;
    if (total > MAX_TOTAL) throw new Error("目录总量超过 200 MB，请选择较小的成果目录。本次分享尚未上传任何文件。");
    const reference = links.find(link => resolve(root, link.path) === item.path)?.path || "./" + item.name;
    const file = { id: randomUUID(), name: item.name, size: bytes.length, hash: digest(bytes), reference, path: item.path };
    originals.set(file.id, file);
    candidates.push({ id: file.id, name: file.name, size: file.size, reference, status: "ready", selected: true, detail: "" });
  }
  const missingReferences = links.filter(link => !paths.some(item => resolve(root, link.path) === item.path)).map(link => link.path);
  return { conversation, root, candidates, originals, skipped, missingReferences, total };
}
export async function readApprovedFiles(snapshot, fileIds) {
  if (!Array.isArray(fileIds) || fileIds.length !== snapshot.originals.size || new Set(fileIds).size !== fileIds.length || fileIds.some(id => !snapshot.originals.has(id))) throw new Error("必须上传本次工作目录的完整清单，请重新读取预览。");
  const current = await inventory(snapshot.root);
  const previous = [...snapshot.originals.values()].map(f => f.name).sort();
  if (JSON.stringify(current.paths.map(f => f.name).sort()) !== JSON.stringify(previous)) throw new Error("目录文件清单已改变，请重新读取。");
  const output = [];
  for (const id of fileIds) {
    const file = snapshot.originals.get(id), bytes = await readRegular(snapshot.root, file.path);
    if (bytes.length !== file.size || digest(bytes) !== file.hash) throw new Error(file.name + " 内容已改变，请重新读取。");
    output.push({ ...file, bytes });
  }
  return output;
}
