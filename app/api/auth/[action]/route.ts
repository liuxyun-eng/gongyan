import { env } from "cloudflare:workers";
import { AppError, body, checkOrigin, db, id, json, now, text } from "@/lib/server";
import { cookieToken, equalSecret, getUser, hash, passwordHash, randomToken, sessionCookie, SESSION_AGE, standalone } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (new URL(request.url).pathname.split("/").at(-1) !== "me") return json({ error: "未找到这个操作。" }, 404);
  try {
    const user = await getUser();
    if (!user) return json({ user: null }, 401);
    return json({ user: { id: user.userId, name: user.fullName || user.email.split("@")[0] } });
  } catch {
    return json({ error: "登录服务暂时不可用，请稍后重试。" }, 503);
  }
}
export async function POST(request: Request) {
  try {
    if (!standalone()) throw new AppError("未启用独立账号登录。", 404);
    checkOrigin(request);
    const action = new URL(request.url).pathname.split("/").at(-1);
    if (action === "logout") {
      const token = cookieToken(request.headers.get("cookie"));
      if (token) await db().prepare("DELETE FROM login_sessions WHERE token_hash=?").bind(await hash(token)).run();
      const response = json({ success: true });
      response.headers.set("Set-Cookie", sessionCookie("", new URL(request.url).protocol === "https:", 0));
      return response;
    }
    if (!["login", "register"].includes(action || "")) throw new AppError("未找到这个操作。", 404);
    const input = await body(request);
    const username = text(input.username, "账号", 32).toLowerCase();
    const password = typeof input.password === "string" ? input.password : "";
    if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) throw new AppError("账号需为 3—32 位英文字母、数字、下划线或点。");
    if (password.length < 10 || password.length > 128) throw new AppError("密码需为 10—128 位。");
    const date = Date.now();
    // Limit attempts independently by source IP and account. Keys reveal neither IP nor username.
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    for (const value of ["ip:" + ip, "account:" + username]) {
      const key = await hash((env.AUTH_PEPPER || "") + value);
      const attempts = await db().prepare("INSERT INTO auth_attempts(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.expires_at<=? THEN 1 ELSE auth_attempts.count+1 END,expires_at=CASE WHEN auth_attempts.expires_at<=? THEN excluded.expires_at ELSE auth_attempts.expires_at END RETURNING count").bind(key, date + 600_000, date, date).first<{ count: number }>();
      if ((attempts?.count || 0) > (value.startsWith("ip:") ? 30 : 10)) throw new AppError("尝试次数过多，请 10 分钟后重试。", 429);
    }
    let account = await db().prepare("SELECT * FROM accounts WHERE username=?").bind(username).first<{ id: string; name: string; salt: string; password_hash: string }>();
    if (action === "register") {
      if (env.OPEN_REGISTRATION !== "true" && (!env.REGISTRATION_CODE || typeof input.code !== "string" || !await equalSecret(input.code, env.REGISTRATION_CODE))) throw new AppError("注册邀请码无效，请向网站创建者获取。", 403);
      if (account) throw new AppError("这个账号已被使用，请换一个。", 409);
      const name = text(input.name, "名字", 50);
      const salt = randomToken(), uid = id();
      const hashed = await passwordHash(password, salt);
      await db().prepare("INSERT INTO accounts(id,username,name,salt,password_hash,created_at) VALUES (?,?,?,?,?,?)").bind(uid, username, name, salt, hashed, now()).run();
      account = { id: uid, name, salt, password_hash: hashed };
    } else {
      const computed = await passwordHash(password, account?.salt || "unknown-account-dummy-salt");
      if (!account || !await equalSecret(computed, account.password_hash)) throw new AppError("账号或密码不正确。", 401);
    }
    const token = randomToken();
    await db().batch([
      db().prepare("DELETE FROM login_sessions WHERE expires_at<=?").bind(date),
      db().prepare("DELETE FROM auth_attempts WHERE expires_at<=?").bind(date),
      db().prepare("INSERT INTO login_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)").bind(await hash(token), account.id, date + SESSION_AGE * 1000),
    ]);
    const response = json({ user: { id: account.id, name: account.name } }, action === "register" ? 201 : 200);
    response.headers.set("Set-Cookie", sessionCookie(token, new URL(request.url).protocol === "https:"));
    return response;
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    console.error("Account action failed", error);
    return json({ error: "登录服务暂时不可用，请稍后重试。" }, 503);
  }
}
