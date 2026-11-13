import { el, getJSON } from "./api.js?v=25";
import { startRouter } from "./router.js?v=25";
import { initKeyboardShortcuts } from "./keynav.js?v=25";
import { renderList } from "./views/list.js?v=25";
import { renderDetail } from "./views/detail.js?v=25";
import { renderStats } from "./views/stats.js?v=25";
import { renderIssues } from "./views/issues.js?v=25";
import { renderPremium } from "./views/premium.js?v=25";
import { renderMine } from "./views/mine.js?v=25";
import { renderReview } from "./views/review.js?v=25";
import { renderCompare } from "./views/compare.js?v=25";
import { renderTopics } from "./views/topics.js?v=25";
import { renderLogin, renderRegister } from "./views/auth.js?v=25";
import { loadAuthState, getAuthState, logout, ROLE_LABELS } from "./auth.js?v=25";

const app = document.getElementById("app");

function setTheme(theme) {
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
  localStorage.setItem("qb.theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("qb.theme");
  const theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  setTheme(theme);
}

function highlightNav() {
  let route = (location.hash.split("?")[0] || "#/problems");
  if (route.startsWith("#/problem/")) route = "#/problems";
  document.querySelectorAll(".nav a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href").split("?")[0] === route);
  });
}

const render = startRouter({
  "/problems": renderList,
  "/problem/:site/:slug": renderDetail,
  "/premium": renderPremium,
  "/stats": renderStats,
  "/issues": renderIssues,
  "/mine": renderMine,
  "/review": renderReview,
  "/compare/:displayId": renderCompare,
  "/topics": renderTopics,
  "/login": renderLogin,
  "/register": renderRegister,
}, () => {
  app.replaceChildren(el("p", "error", "页面不存在"));
});

document.getElementById("theme-toggle").addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(current);
});

document.getElementById("random-select").addEventListener("change", (event) => {
  const paid = event.target.value === "premium" ? "&paid=1" : "";
  location.hash = `#/problems?random=1${paid}`;
  event.target.value = "";
});

window.addEventListener("hashchange", highlightNav);

// 登录态：顶栏渲染 登录/注册 或 用户徽章 + 退出
function renderAuthArea() {
  const area = document.getElementById("auth-area");
  if (!area) return;
  const auth = getAuthState();
  area.replaceChildren();
  if (!auth.authenticated) {
    const loginLink = el("a", "btn btn-small", "登录");
    loginLink.href = "#/login";
    const registerLink = el("a", "btn btn-small auth-register", "注册");
    registerLink.href = "#/register";
    area.append(loginLink, registerLink);
    return;
  }
  const badge = el("span", `badge ${auth.role === "premium" ? "badge-premium" : "badge-muted"}`,
    `${ROLE_LABELS[auth.role] || auth.role}`);
  const name = el("span", "auth-username", auth.username || "");
  const out = el("button", "btn btn-small", "退出");
  out.type = "button";
  out.addEventListener("click", async () => {
    try {
      // logout() 内部会派发 qb.auth.changed，由监听器统一刷新顶栏与视图
      await logout();
    } catch {
      // 退出失败时保持原状
    }
  });
  area.append(badge, name, out);
}

window.addEventListener("qb.auth.changed", () => {
  renderAuthArea();
  render();
});

getJSON("/api/premium/summary")
  .then((summary) => {
    const badge = document.getElementById("premium-count");
    if (badge) badge.textContent = String(summary.total);
  })
  .catch(() => {});

initTheme();
highlightNav();
initKeyboardShortcuts();
// 先取得登录态再渲染首屏，保证视图读到正确的角色
loadAuthState().then(() => {
  renderAuthArea();
  render();
});
