import { getJSON, postJSON } from "./api.js?v=25";

// 登录态缓存：由服务端 /api/auth/me 决定，前端不自行判断
let state = { loaded: false, authenticated: false, username: null, role: "guest" };

export async function loadAuthState(force = false) {
  if (state.loaded && !force) return state;
  try {
    state = { loaded: true, ...(await getJSON("/api/auth/me")) };
  } catch {
    state = { loaded: true, authenticated: false, username: null, role: "guest" };
  }
  return state;
}

function notifyAuthChanged() {
  if (typeof window !== "undefined" && typeof window.CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("qb.auth.changed"));
  }
}

export function getAuthState() {
  return state;
}

export function isPremiumRole(state = getAuthState()) {
  return state.authenticated && state.role === "premium";
}

export const ROLE_LABELS = { guest: "游客", user: "普通用户", premium: "高级用户" };

export async function login(username, password) {
  const result = await postJSON("/api/auth/login", { username, password });
  await loadAuthState(true);
  notifyAuthChanged();
  return result;
}

export async function register(username, password) {
  const result = await postJSON("/api/auth/register", { username, password });
  await loadAuthState(true);
  notifyAuthChanged();
  return result;
}

export async function logout() {
  await postJSON("/api/auth/logout", {});
  await loadAuthState(true);
  notifyAuthChanged();
}
