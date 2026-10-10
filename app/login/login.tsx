"use client";
import { useState } from "react";
import { Layers } from "lucide-react";
export default function Login({ registrationOpen = false }: { registrationOpen?: boolean } = {}) {
  const [register, setRegister] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/auth/" + (register ? "register" : "login"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "登录失败，请重试。");
      const requested = new URLSearchParams(window.location.search).get("return_to") || "/";
      const destination = new URL(requested, window.location.origin);
      window.location.assign(destination.origin === window.location.origin && !destination.pathname.startsWith("/login") ? destination.pathname + destination.search : "/");
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }
  return <main className="simple-page"><section className="simple-card login-card">
    <a className="simple-brand" href="/"><Layers size={23} />共研</a>
    <h1>{register ? "加入共研" : "登录共研"}</h1><p>与伙伴分享 AI 对话和工作文件。</p>
    <form onSubmit={submit}>
      {register && <label>你的名字<input name="name" autoComplete="name" maxLength={50} required /></label>}
      <label>账号<input name="username" autoComplete="username" pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}" minLength={3} maxLength={32} required placeholder="英文字母或数字，至少 3 位" /></label>
      <label>密码<input type="password" name="password" autoComplete={register ? "new-password" : "current-password"} minLength={10} maxLength={128} required placeholder="至少 10 位" /></label>
      {register && !registrationOpen && <label>注册邀请码<input name="code" autoComplete="off" required placeholder="向网站创建者获取" /></label>}
      {error && <p className="simple-error" role="alert">{error}</p>}
      <button className="simple-primary" disabled={busy}>{busy ? "请稍候…" : register ? "注册并登录" : "登录"}</button>
    </form>
    <button className="simple-link" disabled={busy} onClick={() => { setRegister(!register); setError(""); }}>{register ? "已有账号，去登录" : "第一次使用？注册账号"}</button>
  </section></main>;
}
