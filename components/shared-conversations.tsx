"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  MessageSquare,
  Download,
  LockKeyhole,
  Copy,
  Check,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConversationMessageBody,
  type FileReference,
} from "@/components/markdown-body";
import { sharedTranscript, sharedMarkdown } from "@/lib/shared-transcript.mjs";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "@/components/ui/context-menu";

type SharedPost = {
  id: string;
  kind: string;
  author: string;
  user_id: string;
  title: string;
  summary: string;
  tool: string;
  transcript: string;
  file_ids: string;
  created_at: string;
};
type SharedFile = {
  id: string;
  name: string;
  size: number;
  post_id: string | null;
};
type Message = {
  id: string | number;
  role: string;
  content: string;
  sourceMarkdown?: string;
  references?: FileReference[];
};
function date(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function ReplayMessage({
  message,
  references,
  onDelete,
  deleting,
}: {
  onDelete?: () => void;
  deleting: boolean;
  message: Message;
  references: FileReference[];
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <article
      className={"codex-message " + message.role}
      aria-label={message.role === "user" ? "用户消息" : "Codex 回答"}
    >
      <ConversationMessageBody
        content={message.content}
        role={message.role}
        references={references}
      />
      <div className="codex-message-actions">
        <button className="codex-message-copy" onClick={copy} aria-label={copied ? "已复制消息" : "复制消息"} title={copied ? "已复制" : "复制消息"}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        {onDelete && <button className="codex-message-copy codex-message-delete" onClick={onDelete} disabled={deleting} aria-label="删除这段消息" title="删除这段消息"><Trash2 size={14} /></button>}
      </div>
    </article>
  );
}
export function SharedConversations({
  posts,
  files,
  projectId,
  userId,
  ownerId,
  onChanged,
  browserUpload = false,
}: {
  posts: SharedPost[];
  files: SharedFile[];
  projectId: string;
  userId: string;
  ownerId: string;
  onChanged: () => Promise<unknown>;
  browserUpload?: boolean;
}) {
  const [deletion, setDeletion] = useState<{ postId: string; index: number; transcript: string; content: string } | null>(null);
  const [postDeletion, setPostDeletion] = useState<{ postId: string; title: string; transcript: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [mobileReading, setMobileReading] = useState(false);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requested = parameters.get("post") || "";
    setSelectedId(requested);
    setDeletion(null);
    setPostDeletion(null);
    setDeleteError("");
    setMobileReading(
      Boolean(requested && parameters.get("project") === projectId),
    );
  }, [projectId]);
  const selected =
    posts.find((post) => post.id === selectedId) || posts[0] || null;
  const messages = useMemo(
    () => sharedTranscript(selected),
    [selected?.id, selected?.transcript, selected?.summary],
  );
  const attached = files.filter((file) => file.post_id === selected?.id);
  const references = messages[0]?.references || [];
  const shareUrl =
    "/share?project=" + encodeURIComponent(projectId);
  async function deleteMessage() {
    if (!deletion || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      const bytes = new TextEncoder().encode(deletion.transcript);
      const revision = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
      const response = await fetch("/api/posts/" + encodeURIComponent(deletion.postId) + "/messages", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: deletion.index, revision }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "删除失败，请重试。");
      await onChanged(); setDeletion(null); toast.success("这段消息已从共享对话和 Markdown 中删除。");
    } catch (error) { setDeleteError((error as Error).message); }
    finally { setDeleting(false); }
  }
  async function deletePost() {
    if (!postDeletion || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      const bytes = new TextEncoder().encode(postDeletion.transcript);
      const revision = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
      const response = await fetch("/api/posts/" + encodeURIComponent(postDeletion.postId), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "删除失败，请重试。");
      await onChanged();
      if (selected?.id === postDeletion.postId) {
        const next = posts.find(post => post.id !== postDeletion.postId);
        setSelectedId(next?.id || "");
        if (!next) setMobileReading(false);
      }
      const url = new URL(window.location.href);
      if (url.searchParams.get("post") === postDeletion.postId) {
        url.searchParams.delete("post");
        window.history.replaceState(window.history.state, "", url);
      }
      setPostDeletion(null);
      toast.success("共享对话已删除，文件保留在工作区。");
    } catch (error) { setDeleteError((error as Error).message); }
    finally { setDeleting(false); }
  }
  function downloadMarkdown() {
    if (!selected) return;
    const text =
      messages[0]?.sourceMarkdown ||
      sharedMarkdown(selected.title, messages);
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      selected.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) + ".md";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div
      className={"shared-conversation-room" + (mobileReading ? " reading" : "")}
    >
      <aside className="shared-conversation-list" aria-label="团队共享对话">
        <div className="conversation-list-header">
          <strong>
            共享对话 <small>{posts.length}</small>
          </strong>
          <Button asChild size="sm" variant="outline">
            <a href={shareUrl} target="_blank" rel="noopener noreferrer">
              分享 Markdown
            </a>
          </Button>
        </div>
        <div className="conversation-list-items">
          {!posts.length ? (
            <div className="conversation-empty">
              <MessageSquare size={24} />
              <p>还没有共享对话</p>
              <span>粘贴 Codex Markdown，分享后就会出现在这里。</span>
            </div>
          ) : (
            posts.map((post) => (
              <ContextMenu key={post.id}>
              <ContextMenuTrigger asChild disabled={post.user_id !== userId || deleting}>
              <button
                className={
                  "conversation-list-item" +
                  (post.id === selected?.id ? " selected" : "")
                }
                onClick={() => {
                  setSelectedId(post.id);
                  setMobileReading(true);
                }}
                aria-pressed={post.id === selected?.id}
              >
                <strong>{post.title || "共享记录"}</strong>
                <span>
                  {post.author || "团队成员"}
                  <time>{date(post.created_at)}</time>
                </span>
                <small>
                  {files.filter((file) => file.post_id === post.id).length}{" "}
                  个文件 · {post.tool || "团队记录"}
                </small>
              </button>
              </ContextMenuTrigger>
              {post.user_id === userId && (
                <ContextMenuContent>
                  <ContextMenuItem variant="destructive" disabled={deleting} onSelect={() => {
                    setDeleteError("");
                    setPostDeletion({ postId: post.id, title: post.title || "共享记录", transcript: post.transcript });
                  }}>
                    <Trash2 size={15} />删除共享对话
                  </ContextMenuItem>
                </ContextMenuContent>
              )}
              </ContextMenu>
            ))
          )}
        </div>
        <div className="conversation-list-footer">
          <LockKeyhole size={13} />
          团队成员可阅读
        </div>
      </aside>
      <section className="shared-conversation-view" aria-label="只读对话">
        {selected ? (
          <>
            <header className="conversation-reader-header">
              <div>
                <button
                  className="conversation-back"
                  onClick={() => setMobileReading(false)}
                >
                  返回对话列表
                </button>
                <h2>{selected.title}</h2>
                <p>
                  {selected.author || "团队成员"} 分享 ·{" "}
                  {date(selected.created_at)} <span>共享快照</span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadMarkdown}
                aria-label="下载 Markdown"
              >
                <Download size={16} />
              </Button>
            </header>
            <div className="conversation-reader-scroll" key={selected.id}>
              <div className="conversation-transcript">
                {messages.map((message, index) => (
                  <ReplayMessage
                    key={String(message.id) + index}
                    message={message}
                    references={references}
                    deleting={deleting}
                    onDelete={selected.user_id === userId || ownerId === userId ? () => {
                      setDeleteError("");
                      setDeletion({ postId: selected.id, index, transcript: selected.transcript, content: message.content });
                    } : undefined}
                  />
                ))}
                {!messages.length && <p className="conversation-snapshot-note">对话已清空，已上传的文件仍可下载。</p>}
                {!!attached.length && (
                  <section
                    className="conversation-attachments"
                    aria-label="关联文件"
                  >
                    <h3>关联文件 · {attached.length}</h3>
                    {attached.map((file) => (
                      <a key={file.id} href={"/api/files/" + file.id}>
                        <FileText size={17} />
                        <span>
                          {file.name}
                          <small>
                            {file.size === 0 ? "0 B" : file.size >= 1024 * 1024
                              ? (file.size / (1024 * 1024)).toFixed(1) + " MB"
                              : Math.max(1, Math.ceil(file.size / 1024)) +
                                " KB"}
                          </small>
                        </span>
                        <Download size={15} />
                      </a>
                    ))}
                  </section>
                )}
                <p className="conversation-snapshot-note">
                  共享的是这次发布的对话。后续工作继续在 Codex 中完成。
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="reader-empty">
            <MessageSquare size={32} />
            <h2>一起读懂研究过程</h2>
            <p>选择一段共享对话，查看问题、回答和关联成果。</p>
          </div>
        )}
      </section>
      <Dialog open={!!deletion} onOpenChange={open => { if (!open && !deleting) setDeletion(null); }}>
        <DialogContent className="simple-modal">
          <DialogHeader><DialogTitle>删除这段消息？</DialogTitle><DialogDescription>这段内容将从共享对话和导出的 Markdown 中移除，已上传的文件保留。</DialogDescription></DialogHeader>
          <p className="delete-message-preview">{deletion?.content.slice(0, 160)}{(deletion?.content.length || 0) > 160 ? "…" : ""}</p>
          {deleteError && <p className="error-banner" role="alert">{deleteError}</p>}
          <DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setDeletion(null)}>取消</Button><Button variant="destructive" disabled={deleting} onClick={() => void deleteMessage()}>{deleting ? "正在删除…" : "删除这段消息"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!postDeletion} onOpenChange={open => { if (!open && !deleting) setPostDeletion(null); }}>
        <DialogContent className="simple-modal">
          <DialogHeader><DialogTitle>删除这条共享对话？</DialogTitle><DialogDescription>整条对话会从工作区移除，无法撤销。已上传的文件仍保留在“文件”中，可以继续下载。</DialogDescription></DialogHeader>
          <p className="delete-message-preview">{postDeletion?.title}</p>
          {deleteError && <p className="error-banner" role="alert">{deleteError}</p>}
          <DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setPostDeletion(null)}>取消</Button><Button variant="destructive" disabled={deleting} onClick={() => void deletePost()}>{deleting ? "正在删除…" : "删除共享对话"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
