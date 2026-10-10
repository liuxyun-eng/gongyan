import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Layers, RefreshCw } from "lucide-react";
import Workspace from "../../app/workspace";
import Login from "../../app/login/login";
import Share from "../../app/share/share";
import "../../app/globals.css";
import "../../app/simple-pages.css";
import "../../app/chat-shell.css";
import "../../app/readonly-conversations.css";
import "katex/dist/katex.min.css";

type User = { id: string; name: string };
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    setState("loading");
    fetch("/api/auth/me", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (response.status === 401) { setUser(null); setState("ready"); return; }
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Unavailable");
        const result = await response.json() as { user?: User | null };
        if (result.user && (typeof result.user.id !== "string" || typeof result.user.name !== "string")) throw new Error("Invalid identity");
        setUser(result.user || null); setState("ready");
      })
      .catch(() => { if (!controller.signal.aborted || !cancelled) setState("unavailable"); })
      .finally(() => clearTimeout(timer));
    let cancelled = false;
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [retry]);
  if (state !== "ready") return <main className="simple-page"><section className="simple-card login-card">
    <a className="simple-brand" href="/"><Layers size={23} />共研</a>
    <h1>与伙伴分享 AI 对话和文件</h1>
    <p>{state === "loading" ? "正在连接工作区…" : "服务暂时不可用，请稍后重试。你的本地文件不会因此丢失。"}</p>
    {state === "unavailable" && <button className="simple-primary" onClick={() => setRetry(n => n + 1)}><RefreshCw size={16} style={{ display: "inline", marginRight: 8 }} />刷新状态</button>}
  </section></main>;
  if (!user || window.location.pathname.startsWith("/login")) return <Login registrationOpen />;
  if (window.location.pathname.startsWith("/share")) return <Share />;
  return <Workspace browserUpload user={user} />;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
