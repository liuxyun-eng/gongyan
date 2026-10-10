import { fromMarkdown } from "mdast-util-from-markdown";

// These are inert export markers, never executable directives. Do not rewrite
// examples inside code, existing links, or raw HTML.
export function codexFileCitations(markdown) {
  const protectedRanges = [];
  function visit(node) {
    if (["code", "inlineCode", "html", "link", "image", "definition"].includes(node.type)) {
      protectedRanges.push([node.position.start.offset, node.position.end.offset]);
      return;
    }
    for (const child of node.children || []) visit(child);
  }
  visit(fromMarkdown(markdown));
  const markers = [];
  const pattern = /:{1,2}codex-file-citation\{((?:[^{}"']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*)\}/g;
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index, end = start + match[0].length;
    if (protectedRanges.some(([a, b]) => start < b && end > a)) continue;
    const attribute = match[1].match(/(?:^|\s)path\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
    if (!attribute) continue;
    let path;
    try { path = attribute[1][0] === '"' ? JSON.parse(attribute[1]) : attribute[1].slice(1, -1).replace(/\\'/g, "'"); } catch { continue; }
    if (!/^(?:\/|\.\.?\/|file:\/\/)/i.test(path) || path.startsWith("//") || /[\x00-\x1f]/.test(path)) continue;
    const name = path.split(/[\\/]/).at(-1);
    if (name) markers.push({ path, name, start, end });
  }
  return markers;
}

export function normalizeCodexFileCitations(markdown) {
  let rendered = markdown;
  for (const marker of codexFileCitations(markdown).reverse()) {
    const label = marker.name.replace(/([\\[\]])/g, "\\$1");
    const url = encodeURI(marker.path).replace(/[()<>]/g, character => "%" + character.charCodeAt(0).toString(16));
    rendered = rendered.slice(0, marker.start) + `[${label}](<${url}>)` + rendered.slice(marker.end);
  }
  return rendered;
}
