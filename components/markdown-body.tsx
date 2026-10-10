"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { cjk } from "@streamdown/cjk";
import { FileText, Download, Image as ImageIcon, ChevronRight } from "lucide-react";
import { normalizeMathDelimiters } from "@/lib/markdown-math.mjs";
import { normalizeCodexFileCitations } from "@/lib/file-citations.mjs";
import { attachmentFor } from "@/lib/file-reference.mjs";
import {
  markdownSections,
  markdownMessageContext,
  type MarkdownSection,
} from "@/lib/markdown-conversation.mjs";

export type FileReference = { id: string; name: string; path: string };
const math = createMathPlugin({ singleDollarTextMath: true });
const plugins = { code, math, mermaid, cjk };
// Map known local destinations before rehype normalizes relative URLs. All
// unknown paths still become text; this does not grant filesystem access.
function remarkAttachments({ references }: { references: FileReference[] }) {
  return (tree: any) => {
    function visit(node: any) {
      if (["link", "image", "definition"].includes(node.type)) {
        const file = attachmentFor(node.url || "", references);
        if (file) node.url = "/api/files/" + file.id;
      }
      for (const child of node.children || []) visit(child);
    }
    visit(tree);
  };
}
function AttachedImage({ file, alt }: { file: FileReference; alt: string }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let url = "",
      active = true;
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    const mime = (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
      } as Record<string, string>
    )[extension || ""];
    if (!mime) return;
    void fetch("/api/files/" + file.id, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const bytes = await response.arrayBuffer();
        if (!active) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setSource(url);
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id, file.name]);
  return source ? (
    <img
      className="conversation-image"
      src={source}
      alt={alt || file.name}
      loading="lazy"
    />
  ) : (
    <a href={"/api/files/" + file.id}>下载 {file.name}</a>
  );
}

function Sections({
  sections,
  references,
}: {
  sections: MarkdownSection[];
  references: FileReference[];
}) {
  return sections.map((section, index) =>
    section.type === "fold" ? (
      <details className="codex-record-fold" key={index}>
        <summary>
          <ChevronRight size={14} />
          <span>{section.label}</span>
        </summary>
        <div className="codex-record-body">
          <Sections sections={section.sections} references={references} />
        </div>
      </details>
    ) : (
      <MarkdownBody
        key={index}
        content={section.content}
        references={references}
      />
    ),
  );
}

export function ConversationMessageBody({
  content,
  role,
  references = [],
}: {
  content: string;
  role: string;
  references?: FileReference[];
}) {
  const context = useMemo(
    () =>
      role === "user"
        ? markdownMessageContext(content)
        : { text: content, files: [], metadata: "" },
    [content, role],
  );
  const sections = useMemo(
    () => markdownSections(context.text),
    [context.text],
  );
  return (
    <>
      {context.files.length > 0 && (
        <div className="codex-user-files">
          {context.files.map((item, index) => {
            const file = attachmentFor(item.path, references);
            return file && item.kind === "image" ? (
              <a
                className="codex-image-attachment"
                key={index}
                href={"/api/files/" + file.id}
              >
                <AttachedImage file={file} alt={file.name} />
              </a>
            ) : file ? (
              <a
                className="codex-context-file"
                key={index}
                href={"/api/files/" + file.id}
              >
                <FileText size={18} />
                <span>{file.name}</span>
              </a>
            ) : (
              <div
                className={
                  "codex-context-file unavailable" +
                  (item.kind === "image" ? " image-placeholder" : "")
                }
                key={index}
                title={item.name}
              >
                {item.kind === "image" ? (
                  <ImageIcon size={18} />
                ) : (
                  <FileText size={18} />
                )}
                <span>
                  {item.kind === "image" && /^codex-clipboard-/.test(item.name)
                    ? "上传的图片"
                    : item.name}
                  <small>未分享{item.kind === "image" ? "原图" : "文件"}</small>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {context.text && (
        <div
          className={
            role === "user" ? "codex-user-bubble" : "codex-answer-body"
          }
        >
          <Sections sections={sections} references={references} />
        </div>
      )}
      {context.metadata && (
        <details className="codex-user-context">
          <summary>附加上下文</summary>
          <MarkdownBody content={context.metadata} references={references} />
        </details>
      )}
    </>
  );
}

export const MarkdownBody = memo(function MarkdownBody({
  content,
  references = [],
}: {
  content: string;
  references?: FileReference[];
}) {
  const renderedContent = useMemo(
    () => normalizeMathDelimiters(normalizeCodexFileCitations(content)),
    [content],
  );
  const remarkPlugins = useMemo(
    () =>
      [
        ...Object.values(defaultRemarkPlugins),
        [remarkAttachments, { references }],
      ] as any,
    [references],
  );
  const components = useMemo(
    () => ({
      a: ({
        href,
        children,
      }: {
        href?: string;
        children?: React.ReactNode;
      }) => {
        const file = attachmentFor(href || "", references);
        if (file)
          return (
            <a
              href={"/api/files/" + file.id}
              className="codex-output-file"
              download={file.name.split("/").at(-1)}
              aria-label={"下载 " + file.name.split("/").at(-1)}
            >
              <FileText size={18} />
              <span>{file.name.split("/").at(-1)}</span>
              <Download size={16} />
            </a>
          );
        if (!href || !/^(?:https?:\/\/|#)/i.test(href))
          return <span className="codex-output-file unavailable"><FileText size={18} /><span>{children}<small>未找到文件</small></span></span>;
        return (
          <a
            href={href}
            target={href.startsWith("#") ? undefined : "_blank"}
            rel="noopener noreferrer"
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt }: { src?: string | Blob; alt?: string }) => {
        const file = attachmentFor(typeof src === "string" ? src : "", references);
        return file ? (
          <AttachedImage file={file} alt={alt || ""} />
        ) : (
          <span className="unshared-image">
            {alt || "图片"} · 未关联本地文件
          </span>
        );
      },
    }),
    [references],
  );
  return (
    <Streamdown
      mode="static"
      animated={false}
      parseIncompleteMarkdown={false}
      className="codex-markdown"
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={components}
      skipHtml
      shikiTheme={["github-light", "github-light"]}
      controls={{ table: false, code: { copy: true, download: false } }}
      lineNumbers={false}
      urlTransform={(url) => {
        const file = attachmentFor(url, references);
        return file
          ? "/api/files/" + file.id
          : /^(?:https?:\/\/|#)/i.test(url)
            ? url
            : "";
      }}
      mermaid={{ config: { securityLevel: "strict" } }}
    >
      {renderedContent}
    </Streamdown>
  );
});
