"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Layers3,
  Plus,
  MessageSquare,
  ArrowUpRight,
  Check,
  Users,
  FileText,
  Upload,
  Copy,
  Send,
  LockKeyhole,
  Sparkles,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Download,
  MoreHorizontal,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast, Toaster } from "sonner";
import { SharedConversations } from "@/components/shared-conversations";
import { MarkdownBody } from "@/components/markdown-body";
import {
  parseTranscript,
  excerptSummary,
  type TranscriptMessage,
} from "@/lib/conversations";

type Project = {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  invite_code?: string;
};
type Session = {
  id: string;
  title: string;
  tool: string;
  published_through: number;
  pending_count: number;
  project_id: string;
};
type Task = {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  assignee_name: string | null;
};
type FileItem = {
  id: string;
  name: string;
  size: number;
  created_at: string;
  post_id: string | null;
  author: string;
};
type Post = {
  id: string;
  kind: string;
  user_id: string;
  author: string;
  title: string;
  summary: string;
  next_steps: string;
  evidence_type: string;
  tool: string;
  transcript: string;
  task_id: string | null;
  file_ids: string;
  created_at: string;
};
type Room = {
  project: Project;
  members: { user_id: string; name: string; role: string }[];
  sessions: Session[];
  tasks: Task[];
  files: FileItem[];
  posts: Post[];
};
type Draft = {
  session: Session;
  start: number;
  end: number;
  messages: (TranscriptMessage & { selected: boolean })[];
  title: string;
  summary: string;
  summaryEdited: boolean;
  nextSteps: string;
  evidenceType: string;
  taskId: string;
  fileIds: string[];
};
async function api(path: string, data?: unknown, method = "POST") {
  const response = await fetch(
    "/api/" + path,
    data === undefined
      ? { cache: "no-store" }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  if (response.status === 401)
    throw new Error("登录已过期，请刷新页面重新登录。");
  let result: any;
  try { result = await response.json(); } catch { throw new Error("共研服务暂时不可用，请稍后重试。"); }
  if (!response.ok) throw new Error(result.error || "操作失败，请稍后重试。");
  return result;
}
function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function size(value: number) {
  if (value === 0) return "0 B";
  return value > 1024 * 1024
    ? (value / 1024 / 1024).toFixed(1) + " MB"
    : Math.max(1, Math.ceil(value / 1024)) + " KB";
}
function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty-panel">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function Workspace({
  user,
  browserUpload = false,
}: {
  user: { id: string; name: string };
  browserUpload?: boolean;
}) {
  const [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState("");
  const [room, setRoom] = useState<Room | null>(null),
    [tab, setTab] = useState("feed");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<
    "create" | "join" | "session" | "import" | "invite" | null
  >(null);
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [code, setCode] = useState("");
  const [sessionTitle, setSessionTitle] = useState(""),
    [tool, setTool] = useState("Codex");
  const [sessionId, setSessionId] = useState(""),
    [session, setSession] = useState<Session | null>(null),
    [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [role, setRole] = useState("user"),
    [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [importText, setImportText] = useState(""),
    [discussionDrafts, setDiscussionDrafts] = useState<Record<string, string>>(
      {},
    );
  const [taskTitle, setTaskTitle] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null);
  const [fileDetail, setFileDetail] = useState<{
    file: FileItem;
    post: Post | null;
  } | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const selection = useRef({ projectId, sessionId });
  selection.current = { projectId, sessionId };
  const fileInput = useRef<HTMLInputElement>(null);
  const memberButton = useRef<HTMLButtonElement>(null);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSyncError("");
    setFileDetail(null);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "操作失败，请重试。";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };
  const refreshProjects = useCallback(async () => {
    const data = await api("projects");
    setProjects(data.projects);
    return data.projects as Project[];
  }, []);
  const refreshRoom = useCallback(async (pid: string) => {
    const data = await api("room?projectId=" + encodeURIComponent(pid));
    if (selection.current.projectId === pid) setRoom(data);
    return data as Room;
  }, []);
  const refreshMessages = useCallback(async (sid: string) => {
    const data = await api("messages?sessionId=" + encodeURIComponent(sid));
    if (selection.current.sessionId === sid) {
      setSession(data.session);
      setMessages(data.messages);
    }
    return data as { session: Session; messages: TranscriptMessage[] };
  }, []);
  useEffect(() => {
    let active = true;
    refreshProjects()
      .then((ps) => {
        if (active && ps.length) {
          const wanted = new URLSearchParams(window.location.search).get(
            "project",
          );
          setProjectId(
            ps.find((project) => project.id === wanted)?.id || ps[0].id,
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshProjects]);
  useEffect(() => {
    setRoom(null);
    setShowMembers(false);
    setFileDetail(null);
    setSessionId("");
    setSession(null);
    setMessages([]);
    setTaskTitle("");
    setError("");
    if (!projectId) return;
    let active = true,
      inFlight = false;
    const load = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        await refreshRoom(projectId);
        if (active) setSyncError("");
      } catch (e) {
        if (active) setSyncError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(load, 2_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId, refreshRoom]);
  useEffect(() => {
    setSession(null);
    setMessages([]);
    if (sessionId)
      void refreshMessages(sessionId).catch((e) => setError(e.message));
  }, [sessionId, refreshMessages]);
  useEffect(() => {
    if (room && !sessionId && room.sessions.length)
      setSessionId(room.sessions[0].id);
  }, [room, sessionId]);
  const stageProgress = async (sid: string) => {
    const data = await refreshMessages(sid);
    const pending = data.messages.filter(
      (m) => m.id > data.session.published_through,
    );
    if (!pending.length)
      throw new Error("没有新增对话。先录入或导入本次与 AI 的交流。");
    setSessionId(sid);
    setTab("conversations");
    setDraft({
      session: data.session,
      start: data.session.published_through,
      end: pending.at(-1)!.id,
      messages: pending.map((m) => ({ ...m, selected: true })),
      title: (data.session.title + " · 进度").slice(0, 150),
      summary: excerptSummary(pending),
      summaryEdited: false,
      nextSteps: "",
      evidenceType: "待复核",
      taskId: "none",
      fileIds: [],
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return {
      status: "preview_opened",
      messages: pending.length,
      requiresUserPublication: true,
    };
  };
  const agentActions = useRef({ room, stageProgress });
  agentActions.current = { room, stageProgress };
  useEffect(() => {
    type Registry = {
      registerTool: (
        tool: unknown,
        options: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: Registry })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: "get_project_state",
        title: "查看当前项目",
        description:
          "Read the currently visible project, team tasks and published progress. Personal conversation contents are excluded.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input: unknown) {
          if (!input || typeof input !== "object" || Object.keys(input).length)
            throw new Error("Expected an empty object.");
          const r = agentActions.current.room;
          if (!r) throw new Error("请先选择一个项目。");
          return {
            project: { id: r.project.id, name: r.project.name },
            tasks: r.tasks,
            files: r.files,
            progress: r.posts.map((p) => ({
              title: p.title,
              summary: p.summary,
              author: p.author,
              created_at: p.created_at,
            })),
          };
        },
      },
      {
        name: "stage_progress_publication",
        title: "预览新增进度",
        description:
          "Open the same publication preview as the UI for one of the current user’s conversations. This stages a draft; it does not publish to the team. Human confirmation is required.",
        inputSchema: {
          type: "object",
          properties: { sessionId: { type: "string" } },
          required: ["sessionId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(input: unknown) {
          if (
            !input ||
            typeof input !== "object" ||
            Object.keys(input).some((k) => k !== "sessionId") ||
            typeof (input as { sessionId?: unknown }).sessionId !== "string"
          )
            throw new Error("Expected a sessionId string.");
          const sid = (input as { sessionId: string }).sessionId;
          if (!agentActions.current.room?.sessions.some((s) => s.id === sid))
            throw new Error("这段对话不在当前项目里。");
          return agentActions.current.stageProgress(sid);
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => console.warn("WebMCP registration unavailable"));
      } catch {
        console.warn("WebMCP registration unavailable");
      }
    return () => lifecycle.abort();
  }, []);
  const createProject = async (demo = false) => {
    const result = await api("projects", {
      name: demo ? "低功耗环境监测 · 示例" : name,
      description: demo
        ? "电子设计练习空间：完成传感器采集、功耗优化和实验验证。示例内容可用于体验发布流程。"
        : description,
    });
    if (demo) {
      await api("tasks", {
        projectId: result.id,
        title: "测量深度睡眠电流，记录测试条件",
      });
      await api("tasks", {
        projectId: result.id,
        title: "设计温湿度数据采集与异常提示",
      });
      const s = await api("sessions", {
        projectId: result.id,
        title: "功耗优化方案讨论（示例）",
        tool: "Codex",
      });
      await api("messages", {
        sessionId: s.id,
        messages: [
          {
            role: "user",
            content:
              "【示例对话】我们做一个 ESP32 环境监测节点，希望延长电池续航。请帮我规划功耗测试。",
          },
          {
            role: "assistant",
            content:
              "【示例回答】可以先分别测量采样、无线发送和深度睡眠三个阶段的电流，再结合各阶段持续时间估算平均功耗。需要用实际测量结果验证；以下建议尚未经过实验。",
          },
        ],
      });
    }
    await refreshProjects();
    setProjectId(result.id);
    setTab("files");
    setModal(null);
    setName("");
    setDescription("");
    toast.success(
      demo ? "示例项目已建立，可以预览并发布示例对话。" : "项目已建立",
    );
  };
  const editReviewMessage = (
    index: number,
    patch: { selected?: boolean; content?: string },
  ) =>
    setDraft((current) => {
      if (!current) return current;
      const messages = current.messages.map((m, i) =>
        i === index ? { ...m, ...patch } : m,
      );
      return {
        ...current,
        messages,
        summary: current.summaryEdited
          ? current.summary
          : excerptSummary(messages.filter((m) => m.selected)),
      };
    });
  const publish = async () => {
    if (!draft) return;
    const d = draft;
    await api("publish", {
      sessionId: d.session.id,
      start: d.start,
      end: d.end,
      messages: d.messages
        .filter((m) => m.selected)
        .map((m) => ({ id: m.id, content: m.content })),
      title: d.title,
      summary: d.summary,
      nextSteps: d.nextSteps,
      evidenceType: d.evidenceType,
      taskId: d.taskId === "none" ? null : d.taskId,
      fileIds: d.fileIds,
    });
    setDraft(null);
    await Promise.all([
      refreshRoom(d.session.project_id),
      refreshMessages(d.session.id),
    ]);
    setTab("feed");
    toast.success("进度已发布，发布分界点已更新。");
  };
  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024)
      throw new Error("单个附件不能超过 10 MB。");
    if (!file.size) throw new Error("文件为空。");
    const response = await fetch(
      "/api/files?projectId=" +
        encodeURIComponent(projectId) +
        "&name=" +
        encodeURIComponent(file.name),
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      },
    );
    const result: any = await response.json();
    if (!response.ok) throw new Error(result.error || "上传失败");
    await refreshRoom(projectId);
    toast.success("附件已保存，团队成员可下载。");
  };
  const openFile = async (file: FileItem) => {
    const result = await api("files/" + file.id + "/context");
    setFileDetail({ file, post: result.post });
  };
  const completed = room?.tasks.filter((t) => t.status === "done").length || 0;
  const pending =
    room?.sessions.reduce((sum, s) => sum + s.pending_count, 0) || 0;
  const formError = error || syncError ? (
    <p className="error-banner" role="alert">
      {error || syncError}
      <button
        type="button"
        onClick={() => { setError(""); setSyncError(""); }}
        aria-label="关闭错误提示"
      >
        ×
      </button>
    </p>
  ) : null;

  return (
    <SidebarProvider className="chat-shell">
      <Toaster richColors position="top-center" />
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const selected = Array.from(e.target.files || []);
          e.target.value = "";
          if (selected.length)
            void run(async () => {
              for (const file of selected) await upload(file);
            });
        }}
      />
      <Sidebar>
        <SidebarHeader className="brand">
          <div className="brand-icon">
            <Layers3 size={23} />
          </div>
          <div>
            <strong>共研</strong>
            <span>共享工作区</span>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-4">
          <Button className="new-project" onClick={() => setModal("create")}>
            <Plus size={17} />
            新建工作区
          </Button>
          <div className="sidebar-label">
            工作区 <span>{projects.length}</span>
          </div>
          <nav className="project-nav" aria-label="我的项目">
            {projects.map((p) => (
              <button
                key={p.id}
                className={projectId === p.id ? "active" : ""}
                onClick={() => {
                  setProjectId(p.id);
                  setTab("feed");
                }}
              >
                <span className="project-list-avatar">
                  <MessageSquare size={18} />
                </span>
                <span className="project-entry-text">
                  <strong>{p.name}</strong>
                  <small>{p.description || "文件与 AI 工作记录"}</small>
                </span>
              </button>
            ))}
          </nav>
          <button className="join-project" onClick={() => setModal("join")}>
            <Users size={16} />
            通过邀请码加入
          </button>
        </SidebarContent>
        <SidebarFooter className="account">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            <strong>{user.name}</strong>
            <span>已登录 · 我的工作台</span>
          </div>
          {browserUpload && <button className="account-logout" onClick={async () => { const response = await fetch("/api/auth/logout", { method: "POST" }); if (response.ok) window.location.assign("/login"); else toast.error("退出失败，请重试。"); }}>退出</button>}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger aria-label="切换项目侧栏" />
            <h1 className="truncate">{room?.project.name || "我的项目"}</h1>
          </div>
          {room && (
            <div className="group-actions">
              <Button
                variant="ghost"
                onClick={() => setShowMembers(true)}
                aria-label="查看群成员"
                ref={memberButton}
              >
                <Users size={16} />
                {room.members.length}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setModal("invite")}
              >
                邀请
              </Button>
            </div>
          )}
        </header>
        <main className="workbench">
          {formError}
          {!projectId ? (
            <section className="welcome">
              <h1>把研究过程分享给同伴。</h1>
              <p className="welcome-text">
                粘贴 Codex 对话 Markdown，关联文件一起分享。组员打开就能阅读。
              </p>
              <div className="welcome-actions">
                <Button
                  disabled={loading || busy}
                  onClick={() => setModal("create")}
                >
                  <Plus />
                  建立工作区
                </Button>
                <Button
                  variant="outline"
                  disabled={loading || busy}
                  onClick={() => setModal("join")}
                >
                  加入工作区
                  <ArrowUpRight />
                </Button>
              </div>
              <Button
                variant="ghost"
                disabled={loading || busy}
                onClick={() => run(() => createProject(true))}
              >
                用示例体验
              </Button>
            </section>
          ) : !room ? (
            <div className="loading-state" role="status">
              <RefreshCw className="animate-spin" />
              正在打开项目…
              {error && (
                <Button
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      await refreshRoom(projectId);
                    })
                  }
                >
                  重试
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="project-layout">
                <section className="workspace-panel">
                  <Tabs value={tab} onValueChange={setTab}>
                    <div className="tabbar">
                      <TabsList>
                        <TabsTrigger value="files">
                          <FileText />
                          文件
                        </TabsTrigger>
                        <TabsTrigger value="feed">
                          <MessageSquare />
                          共享对话
                        </TabsTrigger>
                        {(tab === "conversations" || tab === "tasks") && (
                          <TabsTrigger value={tab}>
                            {tab === "tasks" ? "任务" : "手动记录"}
                          </TabsTrigger>
                        )}
                      </TabsList>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="工作区选项"
                          >
                            <MoreHorizontal size={18} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <a href={"http://127.0.0.1:6062/?project=" + encodeURIComponent(projectId)} target="_blank" rel="noopener noreferrer">
                              上传 Markdown 与工作目录
                            </a>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <TabsContent
                      value="feed"
                      className="m-0 chat-content readonly-room-content"
                    >
                      <SharedConversations
                        browserUpload={browserUpload}
                        posts={room.posts}
                        files={room.files}
                        projectId={projectId}
                        userId={user.id}
                        ownerId={room.project.owner_id}
                        onChanged={() => refreshRoom(projectId)}
                      />
                    </TabsContent>
                    <TabsContent value="conversations" className="m-0">
                      <div className="panel-intro">
                        <div>
                          <h2>我的 AI 对话</h2>
                          <p>
                            <LockKeyhole size={13} />
                            这里只展示你自己的对话。确认发布后，所选内容才进入项目群。
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => setModal("session")}
                        >
                          <Plus size={16} />
                          新建对话
                        </Button>
                      </div>
                      {!room.sessions.length ? (
                        <Empty icon={Sparkles} title="保存一段探索过程">
                          点击“新建对话”，为本次研究、调试或方案讨论起个名字。
                        </Empty>
                      ) : (
                        <>
                          <div className="conversation-toolbar">
                            <Choice
                              label="选择个人对话"
                              value={sessionId || room.sessions[0].id}
                              onChange={setSessionId}
                              options={room.sessions.map((s) => ({
                                value: s.id,
                                label: s.title + " · " + s.tool,
                              }))}
                            />
                            <Button
                              variant="outline"
                              disabled={!session || busy}
                              onClick={() => setModal("import")}
                            >
                              <Upload size={15} />
                              导入
                            </Button>
                            <Button
                              disabled={!session || busy}
                              onClick={() =>
                                run(async () => {
                                  await stageProgress(sessionId);
                                })
                              }
                            >
                              预览新增进度
                              <ArrowUpRight size={16} />
                            </Button>
                          </div>
                          <div className="private-messages">
                            {messages.length === 0 ? (
                              <Empty
                                icon={MessageSquare}
                                title="把本次与 AI 的交流放进来"
                              >
                                支持逐条录入，或一次导入带“用户：”“AI：”标记的对话。
                              </Empty>
                            ) : (
                              messages.map((m, i) => (
                                <div key={m.id}>
                                  {m.id > (session?.published_through || 0) &&
                                    i > 0 &&
                                    messages[i - 1].id <=
                                      (session?.published_through || 0) && (
                                      <div className="publication-line">
                                        上次发布到这里 · 以下是新增对话
                                      </div>
                                    )}
                                  <article
                                    className={"private-message " + m.role}
                                  >
                                    <div>
                                      <strong>
                                        {m.role === "user"
                                          ? "我"
                                          : session?.tool || "AI"}
                                      </strong>
                                      <span>
                                        {m.id <=
                                        (session?.published_through || 0)
                                          ? "已处理的发布范围"
                                          : "尚未发布"}
                                      </span>
                                    </div>
                                    <p className="preserve">{m.content}</p>
                                  </article>
                                </div>
                              ))
                            )}
                          </div>
                          <form
                            className="message-composer"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void run(async () => {
                                await api("messages", {
                                  sessionId,
                                  messages: [
                                    {
                                      role,
                                      content: messageDrafts[sessionId] || "",
                                    },
                                  ],
                                });
                                setMessageDrafts((prev) => ({
                                  ...prev,
                                  [sessionId]: "",
                                }));
                                await Promise.all([
                                  refreshMessages(sessionId),
                                  refreshRoom(projectId),
                                ]);
                                toast.success("已保存到个人对话");
                              });
                            }}
                          >
                            <label htmlFor="message-content">
                              录入一条消息
                            </label>
                            <div className="message-role">
                              <Choice
                                label="消息角色"
                                value={role}
                                onChange={setRole}
                                options={[
                                  { value: "user", label: "我 / 用户" },
                                  { value: "assistant", label: "AI 回答" },
                                ]}
                              />
                              <span>原始内容保存在个人对话中</span>
                            </div>
                            <Textarea
                              id="message-content"
                              maxLength={20000}
                              placeholder="粘贴你提出的问题，或 AI 的回答…"
                              value={messageDrafts[sessionId] || ""}
                              onChange={(e) =>
                                setMessageDrafts((prev) => ({
                                  ...prev,
                                  [sessionId]: e.target.value,
                                }))
                              }
                            />
                            <div className="flex justify-end">
                              <Button
                                disabled={
                                  busy ||
                                  !session ||
                                  !(messageDrafts[sessionId] || "").trim()
                                }
                                type="submit"
                              >
                                保存消息
                              </Button>
                            </div>
                          </form>
                        </>
                      )}
                    </TabsContent>
                    <TabsContent value="tasks" className="m-0">
                      <div className="panel-intro">
                        <div>
                          <h2>把下一步分给合适的人</h2>
                          <p>任务领取后会显示负责人，减少重复投入。</p>
                        </div>
                        <span className="quiet-label">
                          {completed} / {room.tasks.length} 已完成
                        </span>
                      </div>
                      <form
                        className="task-create"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(async () => {
                            await api("tasks", { projectId, title: taskTitle });
                            setTaskTitle("");
                            await refreshRoom(projectId);
                          });
                        }}
                      >
                        <Input
                          aria-label="新任务名称"
                          placeholder="例如：测量传感器采样误差，记录测试条件"
                          maxLength={150}
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                        />
                        <Button
                          type="submit"
                          disabled={busy || !taskTitle.trim()}
                        >
                          <Plus size={16} />
                          添加任务
                        </Button>
                      </form>
                      <div className="tasks-list">
                        {!room.tasks.length ? (
                          <Empty
                            icon={CheckCircle2}
                            title="先确定一个可以完成的任务"
                          >
                            每个任务只安排一个负责人，发布进度时可关联到任务。
                          </Empty>
                        ) : (
                          room.tasks.map((t) => (
                            <div className={"task-row " + t.status} key={t.id}>
                              <span className="task-icon">
                                {t.status === "done" ? (
                                  <Check size={18} />
                                ) : t.status === "doing" ? (
                                  <Clock3 size={18} />
                                ) : (
                                  <span />
                                )}
                              </span>
                              <div>
                                <h3>{t.title}</h3>
                                <p>
                                  {t.status === "open"
                                    ? "等待领取"
                                    : t.assignee_name || "组长"}
                                  <span>
                                    {t.status === "done"
                                      ? "已完成"
                                      : t.status === "doing"
                                        ? "进行中"
                                        : ""}
                                  </span>
                                </p>
                              </div>
                              {t.status === "open" ? (
                                <Button
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () => {
                                      await api(
                                        "tasks/" + t.id,
                                        { action: "claim" },
                                        "PATCH",
                                      );
                                      await refreshRoom(projectId);
                                      toast.success("任务已领取");
                                    })
                                  }
                                >
                                  我来做
                                </Button>
                              ) : t.status === "doing" &&
                                (t.assignee === user.id ||
                                  room.project.owner_id === user.id) ? (
                                <Button
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () => {
                                      await api(
                                        "tasks/" + t.id,
                                        { action: "complete" },
                                        "PATCH",
                                      );
                                      await refreshRoom(projectId);
                                    })
                                  }
                                >
                                  标为完成
                                </Button>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="files" className="m-0">
                      <div className="panel-intro">
                        <div>
                          <h2>
                            文件{" "}
                            <span className="file-count">
                              {room.files.length}
                            </span>
                          </h2>
                          <p>点开文件，就能看到相关的 Codex 对话。</p>
                        </div>
                      </div>
                      <p className="file-sync-note">
                        <Sparkles size={13} />在 Codex
                        复制对话为 Markdown，上传对话与工作目录，一起分享。
                      </p>
                      <div className="files-list">
                        {!room.files.length ? (
                          <Empty icon={FileText} title="从第一个文件开始协作">
                            点击“分享 Markdown”，上传对话与本机工作目录。
                          </Empty>
                        ) : (
                          room.files.map((f) => (
                            <article className="file-card" key={f.id}>
                              <button
                                className="file-open"
                                onClick={() => run(() => openFile(f))}
                              >
                                <div className="file-icon">
                                  <FileText size={22} />
                                </div>
                                <div>
                                  <strong>{f.name}</strong>
                                  <span>
                                    {size(f.size)} · {f.author || "项目成员"} ·{" "}
                                    {time(f.created_at)}
                                  </span>
                                  <span
                                    className={
                                      f.post_id
                                        ? "file-chat-link"
                                        : "file-chat-empty"
                                    }
                                  >
                                    {f.post_id
                                      ? "查看关联对话 →"
                                      : "仅文件 · 暂无关联对话"}
                                  </span>
                                </div>
                              </button>
                              <a
                                className="file-download"
                                href={"/api/files/" + f.id}
                                aria-label={"下载 " + f.name}
                              >
                                <Download size={18} />
                              </a>
                            </article>
                          ))
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </section>
                <Dialog open={showMembers} onOpenChange={setShowMembers}>
                  <DialogContent
                    className="members-modal"
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                      memberButton.current?.focus();
                    }}
                  >
                    <DialogHeader>
                      <DialogTitle>群成员 · {room.members.length}</DialogTitle>
                      <DialogDescription>{room.project.name}</DialogDescription>
                    </DialogHeader>
                    <aside className="project-context">
                      <div className="context-block">
                        <span className="eyebrow">共同的进展</span>
                        <div className="completion">
                          <strong>{completed}</strong>
                          <span>/ {room.tasks.length} 项任务</span>
                        </div>
                        <div className="progress-track">
                          <span
                            style={{
                              width:
                                (room.tasks.length
                                  ? (completed / room.tasks.length) * 100
                                  : 0) + "%",
                            }}
                          />
                        </div>
                        <p>
                          {
                            room.tasks.filter((t) => t.status === "doing")
                              .length
                          }{" "}
                          项正在推进 ·{" "}
                          {room.tasks.filter((t) => t.status === "open").length}{" "}
                          项待领取
                        </p>
                      </div>
                      <div className="context-block">
                        <h3>
                          项目成员 <span>{room.members.length}</span>
                        </h3>
                        {room.members.map((m) => (
                          <div className="member-row" key={m.user_id}>
                            <span className="avatar small">
                              {m.name.slice(0, 1)}
                            </span>
                            <span>
                              {m.name}
                              {m.user_id === user.id ? "（我）" : ""}
                            </span>
                            <small>
                              {m.role === "owner" ? "组长" : "成员"}
                            </small>
                          </div>
                        ))}
                      </div>
                      <button
                        className="refresh-link"
                        onClick={() =>
                          run(async () => {
                            await refreshRoom(projectId);
                            toast.success("已刷新");
                          })
                        }
                        disabled={busy}
                      >
                        <RefreshCw size={14} />
                        刷新项目进度
                      </button>
                    </aside>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          )}
        </main>
      </SidebarInset>
      <Dialog
        open={modal !== null}
        onOpenChange={(v) => {
          if (!v && !busy) setModal(null);
        }}
      >
        <DialogContent className="simple-modal">
          <DialogHeader>
            <DialogTitle>
              {modal === "create"
                ? "建立一个项目群"
                : modal === "join"
                  ? "加入共同的项目"
                  : modal === "session"
                    ? "新建个人 AI 对话"
                    : modal === "import"
                      ? "导入与 AI 的对话"

                        : "邀请项目成员"}
            </DialogTitle>
            <DialogDescription>
              {modal === "create"
                ? "为科研、电子设计或课程项目建立共同的工作空间。"
                : modal === "join"
                  ? "请输入组员给你的项目邀请码。"
                  : modal === "session"
                    ? "这段对话只有你能查看，发布时再选择要分享的内容。"
                    : modal === "import"
                      ? "粘贴文本或 JSON 消息记录，先保存到个人对话。每次最多 100 条。"

                        : "成员需要登录，并具备这个网站的访问权限。加入后可看团队动态、任务和成果。"}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {modal === "create" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => createProject());
              }}
              className="modal-form"
            >
              <label htmlFor="project-name">项目名称</label>
              <Input
                id="project-name"
                maxLength={100}
                placeholder="例如：低功耗环境监测节点"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <label htmlFor="project-description">目标与说明</label>
              <Textarea
                id="project-description"
                maxLength={3000}
                placeholder="我们要解决什么问题？"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <DialogFooter>
                <Button type="submit" disabled={busy || !name.trim()}>
                  建立项目
                </Button>
              </DialogFooter>
            </form>
          )}
          {modal === "join" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const r = await api("join", { code: code.trim() });
                  await refreshProjects();
                  setProjectId(r.id);
                  setCode("");
                  setModal(null);
                  toast.success("已加入项目");
                });
              }}
              className="modal-form"
            >
              <label htmlFor="invite-code">项目邀请码</label>
              <Input
                id="invite-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <DialogFooter>
                <Button disabled={busy || !code.trim()}>加入项目</Button>
              </DialogFooter>
            </form>
          )}
          {modal === "session" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const s = await api("sessions", {
                    projectId,
                    title: sessionTitle,
                    tool,
                  });
                  await refreshRoom(projectId);
                  setSessionId(s.id);
                  setSessionTitle("");
                  setTab("conversations");
                  setModal(null);
                });
              }}
              className="modal-form"
            >
              <label htmlFor="session-title">本次对话的主题</label>
              <Input
                id="session-title"
                maxLength={150}
                placeholder="例如：传感器误差分析"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                required
              />
              <label htmlFor="ai-tool">使用的 AI 工具</label>
              <Input
                id="ai-tool"
                maxLength={80}
                placeholder="Codex / Claude / ChatGPT…"
                value={tool}
                onChange={(e) => setTool(e.target.value)}
                required
              />
              <DialogFooter>
                <Button disabled={busy || !sessionTitle.trim() || !tool.trim()}>
                  新建对话
                </Button>
              </DialogFooter>
            </form>
          )}
          {modal === "import" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const parsed = parseTranscript(importText);
                  if (!parsed.length) throw new Error("没有识别到消息。");
                  await api("messages", { sessionId, messages: parsed });
                  await Promise.all([
                    refreshMessages(sessionId),
                    refreshRoom(projectId),
                  ]);
                  setImportText("");
                  setModal(null);
                  toast.success("已导入 " + parsed.length + " 条个人消息");
                });
              }}
              className="modal-form"
            >
              <label htmlFor="import-content">对话文本 / JSON</label>
              <Textarea
                id="import-content"
                className="import-area"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={
                  '用户：请帮我分析这组实验数据。\nAI：先检查测量条件和误差来源…\n\n也支持 [{"role":"user","content":"问题"}]'
                }
              />
              <label className="import-file">
                或选择 .txt / .json 文件
                <input
                  type="file"
                  accept=".txt,.json,text/plain,application/json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 500000) {
                      toast.error("导入文件不能超过 500 KB。");
                      return;
                    }
                    void f
                      .text()
                      .then(setImportText)
                      .catch(() => toast.error("文件读取失败。"));
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="form-help">
                导入会追加内容。请只导入尚未保存的消息，避免重复记录。
              </p>
              <DialogFooter>
                <Button disabled={busy || !importText.trim()}>
                  保存到个人对话
                </Button>
              </DialogFooter>
            </form>
          )}
          {modal === "invite" && room && (
            <div className="modal-form">
              <label htmlFor="shared-invite">项目邀请码</label>
              <div className="flex gap-2">
                <Input
                  id="shared-invite"
                  value={room.project.invite_code || ""}
                  readOnly
                />
                <Button
                  variant="outline"
                  aria-label="复制邀请码"
                  onClick={() =>
                    run(async () => {
                      await navigator.clipboard.writeText(
                        room.project.invite_code || "",
                      );
                      toast.success("邀请码已复制");
                    })
                  }
                >
                  <Copy size={17} />
                </Button>
              </div>
              <p className="form-help">
                把网站地址和邀请码交给组员。网站目前默认私有；网站访问权限与项目成员资格分别管理。
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setModal(null)}>
                  完成
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!fileDetail}
        onOpenChange={(v) => {
          if (!v) setFileDetail(null);
        }}
      >
        <DialogContent className="file-detail-modal">
          <DialogHeader>
            <DialogTitle>{fileDetail?.file.name}</DialogTitle>
            <DialogDescription>
              {fileDetail
                ? size(fileDetail.file.size) +
                  " · " +
                  fileDetail.file.author +
                  " · " +
                  time(fileDetail.file.created_at)
                : ""}
            </DialogDescription>
          </DialogHeader>
          {fileDetail?.post ? (
            <div className="file-detail-body">
              <div className="linked-update">
                <span className="eyebrow">关联的 Codex 工作记录</span>
                <h3>{fileDetail.post.title}</h3>
                <p>{fileDetail.post.summary}</p>
                <small>
                  {fileDetail.post.author} 上传 ·{" "}
                  {time(fileDetail.post.created_at)}
                </small>
              </div>
              <div className="linked-messages">
                {JSON.parse(fileDetail.post.transcript).map(
                  (
                    m: { id: string | number; role: string; content: string },
                    index: number,
                  ) => (
                    <div
                      className={"shared-message " + m.role}
                      key={String(m.id) + index}
                    >
                      <strong>
                        {m.role === "user" ? "我 / 上传者" : "Codex"}
                      </strong>
                      <MarkdownBody
                        content={m.content}
                        references={
                          JSON.parse(fileDetail.post?.transcript || "[]")[0]
                            ?.references || []
                        }
                      />
                    </div>
                  ),
                )}
                {JSON.parse(fileDetail.post.transcript).length === 0 && (
                  <p className="form-help">本次没有新增的已完成对话。</p>
                )}
              </div>
            </div>
          ) : (
            <p className="form-help">
              这个文件通过网页直接上传，暂未关联 AI 对话。通过 Codex
              上传面板提交的文件会自动带上对话记录。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFileDetail(null)}>
              关闭
            </Button>
            {fileDetail && (
              <Button asChild>
                <a href={"/api/files/" + fileDetail.file.id}>
                  <Download size={16} />
                  下载文件
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!draft}
        onOpenChange={(v) => {
          if (!v && !busy) setDraft(null);
        }}
      >
        <DialogContent className="publication-modal" showCloseButton={!busy}>
          <DialogHeader>
            <span className="eyebrow">REVIEW & SHARE</span>
            <DialogTitle>把本次探索分享给团队</DialogTitle>
            <DialogDescription>
              这次范围内共 {draft?.messages.length || 0}{" "}
              条新增消息。原始对话仍保留，团队收到的是你确认的版本。
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <>
              <div className="publication-scroll">
                <div className="modal-form">
                  <label htmlFor="progress-title">进度标题</label>
                  <Input
                    id="progress-title"
                    maxLength={150}
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                  />
                  <label htmlFor="progress-summary">
                    进度摘要 <span>根据对话摘录生成，可修改</span>
                  </label>
                  <Textarea
                    id="progress-summary"
                    maxLength={6000}
                    value={draft.summary}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        summary: e.target.value,
                        summaryEdited: true,
                      })
                    }
                  />
                  <label htmlFor="progress-next">下一步 / 需要协助</label>
                  <Textarea
                    id="progress-next"
                    maxLength={3000}
                    placeholder="还有什么没有验证？需要谁接着做？"
                    value={draft.nextSteps}
                    onChange={(e) =>
                      setDraft({ ...draft, nextSteps: e.target.value })
                    }
                  />
                  <div className="form-grid">
                    <div>
                      <label>成果类型</label>
                      <Choice
                        label="成果类型"
                        value={draft.evidenceType}
                        onChange={(v) =>
                          setDraft({ ...draft, evidenceType: v })
                        }
                        options={[
                          "待复核",
                          "实测记录",
                          "仿真结果",
                          "AI 推断",
                        ].map((v) => ({ value: v, label: v }))}
                      />
                    </div>
                    <div>
                      <label>关联任务</label>
                      <Choice
                        label="关联任务"
                        value={draft.taskId}
                        onChange={(v) => setDraft({ ...draft, taskId: v })}
                        options={[
                          { value: "none", label: "暂不关联" },
                          ...room!.tasks.map((t) => ({
                            value: t.id,
                            label: t.title,
                          })),
                        ]}
                      />
                    </div>
                  </div>
                </div>
                <div className="review-heading">
                  <h3>确认分享的对话</h3>
                  <span>
                    {draft.messages.filter((m) => m.selected).length} /{" "}
                    {draft.messages.length} 条已选
                  </span>
                </div>
                <p className="form-help">
                  可取消勾选或删改敏感内容。未手动修改的摘要会同步更新；请同时检查你编辑过的摘要。发布成功后，此次范围内未勾选的消息也会跳过，下一次从本次范围末尾继续。
                </p>
                {draft.messages.map((m, i) => (
                  <div
                    key={m.id}
                    className={
                      "review-message " + (!m.selected ? "excluded" : "")
                    }
                  >
                    <div>
                      <Checkbox
                        id={"review-" + m.id}
                        checked={m.selected}
                        onCheckedChange={(v) =>
                          editReviewMessage(i, { selected: v === true })
                        }
                      />
                      <label htmlFor={"review-" + m.id}>
                        {m.role === "user" ? "我" : draft.session.tool}
                      </label>
                      <span>第 {i + 1} 条</span>
                    </div>
                    <Textarea
                      aria-label={"第 " + (i + 1) + " 条分享内容"}
                      maxLength={20000}
                      disabled={!m.selected}
                      value={m.content}
                      onChange={(e) =>
                        editReviewMessage(i, { content: e.target.value })
                      }
                    />
                  </div>
                ))}
                {room!.files.length > 0 && (
                  <div className="publication-files">
                    <h3>关联成果附件</h3>
                    <p className="form-help">最多选择 10 个附件。</p>
                    {room!.files.map((f) => (
                      <label key={f.id}>
                        <Checkbox
                          checked={draft.fileIds.includes(f.id)}
                          disabled={
                            !draft.fileIds.includes(f.id) &&
                            draft.fileIds.length >= 10
                          }
                          onCheckedChange={(v) =>
                            setDraft({
                              ...draft,
                              fileIds:
                                v === true
                                  ? [...draft.fileIds, f.id]
                                  : draft.fileIds.filter((id) => id !== f.id),
                            })
                          }
                        />
                        <FileText size={15} />
                        <span>{f.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                {error && (
                  <p className="error-banner" role="alert">
                    {error}
                  </p>
                )}
              </div>
              <DialogFooter className="publication-footer">
                <span>确认后项目成员可见</span>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  继续编辑，暂不发布
                </Button>
                <Button
                  disabled={
                    busy ||
                    !draft.title.trim() ||
                    !draft.messages.some((m) => m.selected) ||
                    draft.messages.some((m) => m.selected && !m.content.trim())
                  }
                  onClick={() => run(publish)}
                >
                  <Send size={16} />
                  {busy ? "正在保存…" : "确认发布进度"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
