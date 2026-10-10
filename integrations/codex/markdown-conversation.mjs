import { fromMarkdown } from "mdast-util-from-markdown";
import { codexFileCitations } from "./file-citations.mjs";
// Shared by the local companion, Worker API and browser. Never execute Markdown.
const USER = /^(user|human|you|用户|我|提问)$/i;
const ROLE =
  "(?:User|Human|You|Assistant|AI|Codex|ChatGPT|用户|我|助手|提问|回答)";
const headingRole = new RegExp(
  `^#{1,6}\\s+(${ROLE})(?:\\s*(?:[：:]|Message))?\\s*$`,
  "i",
);
const inlineRole = new RegExp(
  `^(?:\\*\\*|__)?(${ROLE})(?:[：:](?:\\*\\*|__)?\\s*|(\\*\\*|__)\\s*[：:]?\\s*)(.*)$`,
  "i",
);

function sourceFor(markdown, node) {
  return markdown.slice(node.position.start.offset, node.position.end.offset);
}
function plainText(node) {
  return node.value || node.children?.map(plainText).join("") || "";
}
function unquote(content) {
  return content
    .split("\n")
    .map((line) => line.replace(/^ {0,3}> ?/, ""))
    .join("\n");
}

function codexExport(markdown) {
  const nodes = fromMarkdown(markdown).children;
  const title = nodes[0];
  if (
    title?.type !== "heading" ||
    title.depth !== 1 ||
    nodes[1]?.type !== "blockquote"
  )
    return;
  // Codex's Copy as Markdown export uses top-level quotes for user turns.
  // The heading + opening turn + answer sequence distinguishes it from an
  // ordinary answer containing a quotation later in its body.
  if (
    !nodes
      .slice(2)
      .some((node) => node.type !== "blockquote" && node.type !== "heading")
  )
    return;
  const messages = [];
  let answer = [],
    depth = 0;
  function flush() {
    if (answer.length)
      messages.push({ role: "assistant", content: answer.join("\n\n").trim() });
    answer = [];
  }
  for (const node of nodes.slice(1)) {
    const content = sourceFor(markdown, node);
    if (node.type === "html") {
      if (/^<details(?:\s+open)?>\s*<summary>/i.test(content.trim())) depth++;
      else if (/^<\/details>\s*$/i.test(content.trim()))
        depth = Math.max(0, depth - 1);
      answer.push(content);
    } else if (!depth && node.type === "blockquote") {
      flush();
      messages.push({ role: "user", content: unquote(content).trim() });
    } else answer.push(content);
  }
  flush();
  return { title: plainText(title), messages };
}

export function parseMarkdownConversation(raw) {
  if (typeof raw !== "string" || !raw.trim())
    throw new Error("请粘贴 Codex 对话的 Markdown。");
  if (BufferlessSize(raw) > 400_000)
    throw new Error("Markdown 最多 400 KB，请分段分享。");
  const markdown = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const messages = [];
  let current,
    fence,
    hasRoles = false;
  const prefix = [];
  for (const line of markdown.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        /^ {0,3}(?:`+|~+)\s*$/.test(line)
      )
        fence = undefined;
      (current ? current.lines : prefix).push(line);
      continue;
    }
    const role =
      !fence &&
      (line.trim().match(headingRole) || line.trim().match(inlineRole));
    if (role) {
      hasRoles = true;
      current = {
        role: USER.test(role[1]) ? "user" : "assistant",
        lines: role[3] ? [role[3]] : [],
      };
      messages.push(current);
    } else (current ? current.lines : prefix).push(line);
  }
  const native = !hasRoles ? codexExport(markdown) : undefined;
  const firstHeading =
    native?.title ||
    prefix
      .find((line) => /^#\s+\S/.test(line))
      ?.replace(/^#\s+/, "")
      .trim();
  const parsed =
    native?.messages ||
    (hasRoles
      ? messages
          .map((message) => ({
            role: message.role,
            content: message.lines.join("\n").trim(),
          }))
          .filter((message) => message.content)
      : [{ role: "assistant", content: markdown.trim() }]);
  if (!parsed.length) throw new Error("没有找到可分享的对话内容。");
  if (
    parsed.length > 200 ||
    parsed.some((message) => message.content.length > 20_000)
  )
    throw new Error("最多 200 条问答，每条最多 20,000 字符，请分段分享。");
  const title =
    (
      firstHeading ||
      parsed.find((message) => message.role === "user")?.content ||
      parsed[0].content
    )
      .split("\n")[0]
      .replace(/^[#\s]+/, "")
      .slice(0, 150) || "Codex 共享对话";
  return {
    markdown,
    title,
    messages: parsed,
    hasRoles: hasRoles || !!native,
    format: native ? "codex" : hasRoles ? "roles" : "markdown",
  };
}

// Treat only the export's context section as attached-file metadata. Arbitrary
// inline code elsewhere remains ordinary text and never triggers a file read.
export function markdownMessageContext(content) {
  const nodes = fromMarkdown(content).children;
  const marker = nodes.findIndex(
    (node) =>
      node.type === "paragraph" && /^User context\s*$/i.test(plainText(node)),
  );
  if (marker < 0) return { text: content, files: [], metadata: "" };
  const files = [],
    other = [];
  let kind;
  for (const node of nodes.slice(marker + 1)) {
    const label = plainText(node).trim();
    if (
      node.type === "paragraph" &&
      /^(Images|Files|Attachments):$/i.test(label)
    ) {
      kind = /^Images/i.test(label) ? "image" : "file";
      continue;
    }
    if (kind && node.type === "list") {
      for (const item of node.children) {
        const first = item.children[0];
        const path = first?.children?.find(
          (child) => child.type === "inlineCode" || child.type === "link",
        );
        const value = path?.url || path?.value;
        if (value && /^(?:\/|\.\.?\/|[a-zA-Z]:[\\/])/.test(value)) {
          files.push({ path: value, name: value.split(/[\\/]/).at(-1), kind });
        } else other.push(sourceFor(content, item));
      }
      continue;
    }
    kind = undefined;
    other.push(sourceFor(content, node));
  }
  return {
    text: content.slice(0, nodes[marker].position.start.offset).trim(),
    files,
    metadata: other.join("\n\n"),
  };
}

// Rebuild exported disclosure widgets as React components, without executing
// or trusting the HTML. Tags inside fenced code remain code. Nested exports
// quote their tool records; remove only that container's quote prefix.
export function markdownSections(content) {
  const root = { sections: [], lines: [], quote: 0 };
  const stack = [root];
  let fence;
  function flush(current) {
    const text = current.lines.join("\n").trim();
    if (text) current.sections.push({ type: "markdown", content: text });
    current.lines = [];
  }
  for (const raw of content.split("\n")) {
    const current = stack.at(-1);
    const prefix = raw.match(/^(?: {0,3}> ?)+/)?.[0] || "";
    const quote = (prefix.match(/>/g) || []).length;
    const bare = raw.slice(prefix.length).trim();
    const marker = bare.match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        /^(?:`+|~+)\s*$/.test(bare)
      )
        fence = undefined;
    }
    const open =
      !fence &&
      bare.match(/^<details(?:\s+open)?>\s*<summary>([^\n]*?)<\/summary>\s*$/i);
    if (open && stack.length < 10) {
      flush(current);
      const section = {
        type: "fold",
        label: open[1].replace(/<[^>]*>/g, ""),
        sections: [],
        lines: [],
        quote,
      };
      current.sections.push(section);
      stack.push(section);
    } else if (
      !fence &&
      /^<\/details>\s*$/i.test(bare) &&
      stack.length > 1 &&
      quote === current.quote
    ) {
      flush(current);
      stack.pop();
    } else {
      let line = raw;
      for (let i = 0; i < current.quote; i++)
        line = line.replace(/^ {0,3}> ?/, "");
      current.lines.push(line);
    }
  }
  for (const current of stack) flush(current);
  return root.sections;
}

function BufferlessSize(value) {
  return new TextEncoder().encode(value).length;
}

export function markdownFileReferences(markdown) {
  const references = [];
  const seen = new Set();
  const tree = fromMarkdown(markdown);
  const definitions = new Map();
  function visit(node, callback) {
    callback(node);
    for (const child of node.children || []) visit(child, callback);
  }
  visit(tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  });
  function add(destination, label) {
    if (
      !destination ||
      /^(?:https?:|data:|javascript:|mailto:|codex:|plugin:|app:|#)/i.test(
        destination,
      )
    )
      return;
    let path = destination;
    try {
      path = decodeURIComponent(path);
    } catch {
      return;
    }
    if (/^file:\/\//i.test(path)) {
      try {
        const url = new URL(path);
        if (url.hostname && url.hostname !== "localhost") return;
        path = decodeURIComponent(url.pathname);
      } catch {
        return;
      }
    }
    path = path.replace(/(?:#L?\d+(?:-L?\d+)?|:\d+(?::\d+)?)$/, "");
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(path) ||
      path.startsWith("//") ||
      !path ||
      path.includes("\0") ||
      seen.has(path)
    )
      return;
    seen.add(path);
    references.push({
      path,
      label: label || path.split("/").at(-1),
    });
    if (references.length > 50)
      throw new Error("关联文件过多，每次最多解析 50 个路径。");
  }
  visit(tree, (node) => {
    const destination = ["link", "image"].includes(node.type)
      ? node.url
      : ["linkReference", "imageReference"].includes(node.type)
        ? definitions.get(node.identifier)
        : undefined;
    add(
      destination,
      node.alt || node.children?.map((child) => child.value || "").join(""),
    );
  });
  for (const citation of codexFileCitations(markdown)) add(citation.path, citation.name);
  const native = codexExport(markdown);
  if (native)
    for (const message of native.messages.filter(
      (message) => message.role === "user",
    )) {
      for (const file of markdownMessageContext(message.content).files)
        add(file.path, file.name);
    }
  return references;
}
