import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import { normalizeMathDelimiters } from "../lib/markdown-math.mjs";

function render(source) {
  return renderToStaticMarkup(
    React.createElement(
      Streamdown,
      {
        mode: "static",
        parseIncompleteMarkdown: false,
        skipHtml: true,
        plugins: { math: createMathPlugin({ singleDollarTextMath: true }) },
      },
      normalizeMathDelimiters(source),
    ),
  );
}

test("Codex inline and display delimiters render as real KaTeX", () => {
  const source = String.raw`或非 \(A\downarrow B\)。

\[
\boxed{F_C=\neg A\land\neg B\land C}
\]

\[\frac{1}{N}\sum_{i=1}^{N}x_i\]`;
  const html = render(source);
  assert.equal((html.match(/class="katex"/g) || []).length, 3);
  assert.equal((html.match(/class="katex-display"/g) || []).length, 2);
  assert.ok(!html.includes("katex-error"));
  assert.ok(html.includes("<math"));
  assert.equal(
    normalizeMathDelimiters(normalizeMathDelimiters(source)),
    normalizeMathDelimiters(source),
  );
});

test("existing dollar math, code, links, escaped literals and unmatched delimiters stay intact", () => {
  const untouched = String.raw`$x+1$ and $$y+2$$ and $\text{\(example\)}$

\`\(literal\)\` [file](<./\(draft\).txt>)

\`\`\`latex
\[literal\]
\`\`\`

    \(indented code\)

\\(escaped literal\\) and \(unfinished`.replace(/\\`/g, "`");
  assert.equal(normalizeMathDelimiters(untouched), untouched);
  assert.equal(
    normalizeMathDelimiters("normal text (x), [x], prices $5"),
    "normal text (x), [x], prices $5",
  );
});

test("math in a Markdown table and quotation keeps its container", () => {
  const html = render(String.raw`| 运算 | 表达式 |
| --- | --- |
| 或非 | \(A\downarrow B\) |

> \[x^2\]`);
  assert.ok(html.includes("<table"));
  assert.match(html, /<td[^>]*>[\s\S]*class="katex"/);
  assert.match(html, /<blockquote[^>]*>\s*<span class="katex-display"/);
  assert.equal((html.match(/class="katex"/g) || []).length, 2);
});
