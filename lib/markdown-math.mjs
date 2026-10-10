import { fromMarkdown } from "mdast-util-from-markdown";

// Codex exports also use \(...\) and \[...\]. remark-math accepts dollar
// delimiters, so adapt only the display input, never the retained source.
export function normalizeMathDelimiters(markdown) {
  if (!/\\[([]/.test(markdown)) return markdown;
  const protectedRanges = [];
  function protect(node) {
    if (
      ["code", "inlineCode", "html", "link", "image", "definition"].includes(
        node.type,
      )
    ) {
      protectedRanges.push([
        node.position.start.offset,
        node.position.end.offset,
      ]);
      return;
    }
    for (const child of node.children || []) protect(child);
  }
  protect(fromMarkdown(markdown));
  protectedRanges.sort((a, b) => a[0] - b[0]);

  const escaped = (index) => {
    let count = 0;
    while (index > 0 && markdown[--index] === "\\") count++;
    return count % 2 === 1;
  };
  const overlaps = (start, end) =>
    protectedRanges.some(([left, right]) => left < end && right > start);
  const findClosing = (start, delimiter) => {
    let end = markdown.indexOf(delimiter, start);
    while (end >= 0 && escaped(end))
      end = markdown.indexOf(delimiter, end + delimiter.length);
    return end;
  };
  let output = "",
    cursor = 0,
    index = 0;
  while (index < markdown.length) {
    const protectedRange = protectedRanges.find(
      ([start, end]) => start <= index && index < end,
    );
    if (protectedRange) {
      index = protectedRange[1];
      continue;
    }
    // Leave existing dollar math intact, including delimiter examples in it.
    if (markdown[index] === "$" && !escaped(index)) {
      const delimiter = markdown[index + 1] === "$" ? "$$" : "$";
      const end = findClosing(index + delimiter.length, delimiter);
      if (end >= 0 && !overlaps(index, end + delimiter.length)) {
        index = end + delimiter.length;
        continue;
      }
    }
    if (
      markdown[index] !== "\\" ||
      escaped(index) ||
      !["(", "["].includes(markdown[index + 1])
    ) {
      index++;
      continue;
    }
    const display = markdown[index + 1] === "[";
    const end = findClosing(index + 2, display ? "\\]" : "\\)");
    if (end < 0 || overlaps(index, end + 2)) {
      index++;
      continue;
    }
    const body = markdown.slice(index + 2, end);
    if (!body.trim() || /\n[ \t]*\n/.test(body)) {
      index++;
      continue;
    }
    let replacement = display ? "$$" + body + "$$" : "$" + body.trim() + "$";
    if (display && !body.includes("\n")) {
      const prefix = markdown.slice(
        markdown.lastIndexOf("\n", index - 1) + 1,
        index,
      );
      const lineEnd = markdown.indexOf("\n", end + 2);
      const suffix = markdown.slice(
        end + 2,
        lineEnd < 0 ? markdown.length : lineEnd,
      );
      // A standalone formula must be a math block, also inside a quotation.
      if (/^(?: {0,3}> ?)*[ \t]*$/.test(prefix) && !suffix.trim()) {
        replacement = "$$\n" + prefix + body.trim() + "\n" + prefix + "$$";
      }
    }
    output += markdown.slice(cursor, index) + replacement;
    cursor = index = end + 2;
  }
  return output + markdown.slice(cursor);
}
