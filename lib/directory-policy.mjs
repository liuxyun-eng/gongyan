export const MAX_FILE = 20 * 1024 * 1024;
export const MAX_TOTAL = 200 * 1024 * 1024;
export const MAX_FILES = 500;
const segment = /^(?:\.(?:env(?:\..*)?|git|ssh|aws|codex|gnupg|config|sites-runtime|wrangler|next)|node_modules|__pycache__|\.DS_Store)$/i;
const basename = /^(?:id_(?:rsa|ed25519|ecdsa)|credentials(?:\..*)?|gongyan-codex.*\.json|.*\.(?:pem|key|p12|pfx))$/i;
export const excludedFile = path => path.split(/[\\/]/).some(p => segment.test(p)) || basename.test(path.split(/[\\/]/).at(-1));
export function inspectBrowserDirectory(files) {
  const included = [], excluded = [], names = new Set();
  let total = 0;
  for (const file of files) {
    const name = file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
    if (!name || name.startsWith("/") || name.split(/[\\/]/).some(p => !p || p === "." || p === "..") || /[\x00-\x1f]/.test(name)) throw new Error("目录包含无效路径，请重新选择。");
    if (excludedFile(name)) { excluded.push(name); continue; }
    if (names.has(name)) throw new Error("目录包含重复文件：" + name);
    names.add(name);
    if (file.size > MAX_FILE) throw new Error(name + " 超过单文件 20 MB 限制，请分批整理后重试。");
    total += file.size;
    if (total > MAX_TOTAL) throw new Error("目录总量超过 200 MB，请选择较小的目录。");
    included.push({ name, file });
    if (included.length > MAX_FILES) throw new Error("目录超过 500 个文件，请分目录分享。");
  }
  return { included: included.sort((a, b) => a.name.localeCompare(b.name)), excluded, total };
}
