"use client";
import { useEffect, useRef, useState } from "react";
import { Layers, FolderOpen, ArrowLeft, Check } from "lucide-react";
import { parseMarkdownConversation, markdownFileReferences } from "@/lib/markdown-conversation.mjs";
import { inspectBrowserDirectory } from "@/lib/directory-policy.mjs";
type PreparedFile = { id: string; name: string; reference: string; size: number; sha256: string; bytes: Uint8Array };
type Snapshot = { markdown: string; title: string; requestId: string; files: PreparedFile[]; skipped: string[]; messages: number; total: number; projectId: string };
type UploadReceipt = { error?: string; verified?: boolean; sha256?: string; size?: number; files?: unknown[]; postId?: string; transport?: string; ticket?: string; chunkSize?: number; index?: number };
const size = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(1) + " KB";
export default function Share() {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]), [projectId, setProjectId] = useState("");
  const [markdown, setMarkdown] = useState(""), [files, setFiles] = useState<File[]>([]), [folder, setFolder] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [phase, setPhase] = useState("");
  const [done, setDone] = useState(0), [success, setSuccess] = useState("");
  const uploaded = useRef(new Set<string>()), folderInput = useRef<HTMLInputElement>(null), markdownInput = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch("/api/projects").then(async r => { const result = await r.json() as { error?: string; projects: { id: string; name: string }[] }; if (!r.ok) throw new Error(result.error); setProjects(result.projects); const requested = new URLSearchParams(window.location.search).get("project"); setProjectId(result.projects.find(p => p.id === requested)?.id || result.projects[0]?.id || ""); }).catch(e => setError(e.message)); }, []);
  function reset() { setSnapshot(null); setError(""); setSuccess(""); setDone(0); uploaded.current.clear(); }
  async function preview() {
    setBusy(true); setError(""); setPhase("正在读取目录…"); uploaded.current.clear();
    try {
      if (!projectId) throw new Error("请先创建或加入一个工作区。");
      const parsed = parseMarkdownConversation(markdown);
      const inventory = inspectBrowserDirectory(files);
      const references = markdownFileReferences(parsed.markdown);
      const prepared: PreparedFile[] = [];
      for (const [index, item] of inventory.included.entries()) {
        setPhase(`正在校验文件 ${index + 1}/${inventory.included.length}`);
        let bytes: Uint8Array;
        try { bytes = new Uint8Array(await item.file.arrayBuffer()); } catch { throw new Error("无法读取文件：" + item.name + "。请重新选择目录。"); }
        if (bytes.byteLength !== item.file.size) throw new Error("文件已变化：" + item.name + "。请重新选择目录。");
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, "0")).join("");
        const reference = references.find((ref: { path: string }) => ref.path === item.name || ref.path.endsWith("/" + item.name))?.path || "./" + item.name;
        prepared.push({ id: crypto.randomUUID(), name: item.name, reference, size: bytes.byteLength, sha256, bytes });
      }
      setSnapshot({ projectId, markdown: parsed.markdown, title: parsed.title, requestId: crypto.randomUUID(), files: prepared, skipped: inventory.excluded, messages: parsed.messages.length, total: inventory.total }); setDone(0);
    } catch (error) { setError((error as Error).message); setSnapshot(null); }
    finally { setBusy(false); setPhase(""); }
  }
  async function share() {
    if (!snapshot || busy) return;
    setBusy(true); setError("");
    const headers = { "Content-Type": "application/json" };
    const manifest = snapshot.files.map(({ bytes, ...file }) => file);
    async function send(url: string, options: RequestInit, requireVerified = true) {
      const response = await fetch(url, options);
      const result = await response.json().catch(() => ({})) as UploadReceipt;
      if (!response.ok || (requireVerified && !result.verified)) throw new Error(result.error || "上传未确认，请重试。");
      return result;
    }
    try {
      for (const [index, file] of snapshot.files.entries()) {
        if (uploaded.current.has(file.id)) continue;
        setPhase(`正在上传 ${index + 1}/${snapshot.files.length}：${file.name}`);
        const { bytes, ...metadata } = file;
        let failure: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const prefix = "/api/markdown-share/";
            const query = "?projectId=" + encodeURIComponent(snapshot.projectId);
            const prepared = await send(prefix + "prepare" + query, { method: "POST", headers, body: JSON.stringify({ requestId: snapshot.requestId, file: metadata }) }, false);
            let result = prepared;
            if (!prepared.verified && prepared.transport === "chunks" && prepared.ticket && prepared.chunkSize === 2 * 1024 * 1024) {
              const chunks = [];
              for (let part = 0; part < Math.max(1, Math.ceil(bytes.length / prepared.chunkSize)); part++) {
                setPhase(`正在上传 ${index + 1}/${snapshot.files.length}：${file.name}（${Math.min(100, Math.round(part * prepared.chunkSize / Math.max(1, bytes.length) * 100))}%）`);
                const chunk = bytes.slice(part * prepared.chunkSize, (part + 1) * prepared.chunkSize);
                const result = await send(prefix + "chunk" + query + "&requestId=" + snapshot.requestId + "&file=" + encodeURIComponent(JSON.stringify(metadata)) + "&ticket=" + encodeURIComponent(prepared.ticket) + "&index=" + part, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: chunk as Uint8Array<ArrayBuffer> }, false);
                const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", chunk as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, "0")).join("");
                if (result.index !== part || result.sha256 !== hash || result.size !== chunk.length) throw new Error("文件分段回执不一致。");
                chunks.push({ index: part, sha256: hash, size: chunk.length });
              }
              setPhase(`正在保存并校验 ${index + 1}/${snapshot.files.length}：${file.name}`);
              // Retry sealing separately: a timed-out response must not resend all parts.
              let sealed = false;
              for (let retry = 0; retry < 3 && !sealed; retry++) {
                try { await send(prefix + "seal" + query, { method: "POST", headers, body: JSON.stringify({ requestId: snapshot.requestId, file: metadata, ticket: prepared.ticket, chunks }) }, false); sealed = true; }
                catch (error) { if (retry === 2) throw error; }
              }
              result = await send(prefix + "verify" + query, { method: "POST", headers, body: JSON.stringify({ requestId: snapshot.requestId, file: metadata, ticket: prepared.ticket }) });
            } else if (!prepared.verified) {
              if (prepared.transport !== "proxy") throw new Error("上传方式未确认，请重试。");
              result = await send(prefix + "files" + query + "&requestId=" + snapshot.requestId + "&file=" + encodeURIComponent(JSON.stringify(metadata)), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes as Uint8Array<ArrayBuffer> });
            }
            if (result.sha256 !== file.sha256 || result.size !== file.size) throw new Error("文件回执不一致。");
            failure = null; break;
          } catch (error) { failure = error as Error; }
        }
        if (failure) throw new Error(file.name + "：" + failure.message);
        uploaded.current.add(file.id); setDone(uploaded.current.size);
      }
      setPhase("所有文件已保存，正在发布对话…");
      const result = await send("/api/markdown-share?projectId=" + encodeURIComponent(snapshot.projectId), { method: "POST", headers, body: JSON.stringify({ requestId: snapshot.requestId, title: snapshot.title, markdown: snapshot.markdown, files: manifest }) });
      if (result.files?.length !== manifest.length || !result.postId) throw new Error("文件数量未完整确认，请重试。");
      setSuccess("已分享：" + snapshot.messages + " 条消息、" + manifest.length + " 个文件，全部校验通过。");
      window.location.assign("/?project=" + encodeURIComponent(snapshot.projectId) + "&post=" + encodeURIComponent(result.postId));
    } catch (error) { setError((error as Error).message + " 已保存的文件和本次提交会保留，可直接重试。"); }
    finally { setBusy(false); setPhase(""); }
  }
  return <main className="simple-page"><section className="simple-card">
    <div className="simple-toolbar"><a className="simple-brand" href="/"><Layers size={23} />共研</a><a href="/" className="simple-link"><ArrowLeft size={14} style={{ display: "inline", marginRight: 6 }} />返回工作区</a></div>
    <h1>分享 Codex 对话</h1><p>粘贴 Markdown，选择工作目录，一起分享给伙伴。</p>
    <label>分享到工作区<select value={projectId} disabled={busy} onChange={e => { reset(); setProjectId(e.target.value); }}>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
    {!projects.length && <p>还没有工作区，<a href="/">先创建或加入</a>。</p>}
    <label>Codex 对话 · Markdown<textarea rows={10} value={markdown} disabled={busy} onChange={e => { reset(); setMarkdown(e.target.value); }} placeholder="在 Codex 中复制对话为 Markdown，然后粘贴到这里。" /></label>
    <input hidden ref={markdownInput} type="file" accept=".md,.markdown,text/markdown" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 400000) { setError("Markdown 超过 400 KB。"); return; } reset(); setMarkdown(await file.text()); }} />
    <button className="simple-link" disabled={busy} onClick={() => markdownInput.current?.click()}>选择 .md 文件</button>
    <section className="simple-section"><div className="simple-toolbar"><strong>本机工作目录</strong><button className="simple-folder" disabled={busy} onClick={() => folderInput.current?.click()}><FolderOpen size={16} style={{ marginRight: 8 }} />{folder ? "重新选择目录" : "选择目录"}</button></div>
      <input ref={folderInput} hidden type="file" {...{ webkitdirectory: "", directory: "" }} multiple onChange={e => { reset(); const selected = Array.from(e.target.files || []); setFiles(selected); setFolder(selected[0]?.webkitRelativePath.split("/")[0] || ""); }} />
      <p>{folder ? "已选择：" + folder : "可只分享对话。需要文件时选择目录，包含其子目录。"}<br />最多 500 个文件 · 单文件 20 MB · 总量 200 MB。凭证、系统文件和依赖目录会排除，并列出清单。</p>
    </section>
    {snapshot && <section className="simple-section"><strong>{snapshot.title}</strong><p>{snapshot.messages} 条消息 · {snapshot.files.length} 个文件 · {size(snapshot.total)}</p><ul className="simple-file-list">{snapshot.files.map(f => <li key={f.id}><span><Check size={13} style={{ display: "inline", color: "#238361", marginRight: 8 }} />{f.name}</span><small>{size(f.size)}</small></li>)}</ul>{snapshot.skipped.length > 0 && <details><summary>已排除 {snapshot.skipped.length} 项</summary><ul className="simple-file-list">{snapshot.skipped.map(name => <li key={name}>{name}</li>)}</ul></details>}</section>}
    {busy && <p aria-live="polite">{phase}</p>}
    {snapshot && busy && <progress className="simple-progress" max={Math.max(1, snapshot.files.length)} value={done} />}
    {error && <p className="simple-error" role="alert">{error}</p>}{success && <p className="simple-success">{success}</p>}
    <button className="simple-primary" disabled={busy || !projectId || !markdown.trim()} onClick={snapshot ? share : preview}>{busy ? "请稍候…" : snapshot ? error ? "重试分享" : "分享到工作区" : "预览对话和文件"}</button>
    <p style={{ textAlign: "center" }}>全部文件保存并校验成功后才发布。工作区成员可阅读对话、下载文件。</p>
  </section></main>;
}
