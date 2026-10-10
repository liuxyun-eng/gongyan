import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getChatGPTUser, chatGPTSignInPath, type ChatGPTUser } from "@/app/chatgpt-auth";

export const SESSION_COOKIE = "gongyan_session";
export const SESSION_AGE = 30 * 24 * 60 * 60;
export const standalone = () => env.AUTH_MODE === "standalone";
export const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
export async function hash(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
export async function equalSecret(left: string, right: string) {
  const a = await hash(left), b = await hash(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function passwordHash(password: string, salt: string) {
  if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32) throw new Error("Account authentication is not configured");
  // The pepper lives only in Worker secrets. A database export cannot test guesses without it.
  const pepper = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prepared = await crypto.subtle.sign("HMAC", pepper, new TextEncoder().encode(password));
  const key = await crypto.subtle.importKey("raw", prepared, "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100_000 }, key, 256));
}
export function cookieToken(value: string | null) {
  return value?.split(";").map(p => p.trim()).find(p => p.startsWith(SESSION_COOKIE + "="))?.slice(SESSION_COOKIE.length + 1) || "";
}
export function sessionCookie(token: string, secure: boolean, age = SESSION_AGE) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
}
export function returnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  const url = new URL(value, "https://gongyan.invalid");
  return url.origin === "https://gongyan.invalid" && !url.pathname.startsWith("/login") ? url.pathname + url.search : "/";
}
export async function getUser(): Promise<ChatGPTUser | null> {
  if (!standalone()) return getChatGPTUser();
  // Public Workers must never trust the platform identity headers supplied by a caller.
  const token = cookieToken((await headers()).get("cookie"));
  if (!/^[a-f0-9]{64}$/.test(token) || !env.DB) return null;
  const account = await env.DB.prepare("SELECT a.id,a.username,a.name FROM login_sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(await hash(token), Date.now()).first<{ id: string; username: string; name: string }>();
  return account ? { userId: account.id, displayName: account.name, fullName: account.name, email: account.username } : null;
}
export async function requireUser(returnTo: string) {
  const user = await getUser();
  if (user) return user;
  redirect(standalone() ? "/login?return_to=" + encodeURIComponent(returnPath(returnTo)) : chatGPTSignInPath(returnTo));
}
