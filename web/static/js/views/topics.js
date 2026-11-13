import { getJSON, el } from "../api.js?v=25";
import { buildTopics } from "../topics-data.js?v=25";
import {
  loadAuthState,
  getAuthState,
  ROLE_LABELS,
} from "../auth.js?v=25";

function demoNotice() {
  return el("p", "muted demo-note",
    "权限说明：本页入口需要“高级用户”角色。角色只控制界面与附加功能入口，不涉及支付；所有题目对任何角色都可完整阅读。");
}

function roleBadge(auth) {
  const label = auth.authenticated
    ? `${auth.username} · ${ROLE_LABELS[auth.role] || auth.role}`
    : "未登录";
  return el("span", `badge ${auth.authenticated && auth.role === "premium" ? "badge-premium" : "badge-muted"}`,
    `当前身份：${label}`);
}

function lockedPanel(auth) {
  const panel = el("div", "empty-state locked-panel");
  panel.append(
    roleBadge(auth),
    el("p", null, "高级专区需要以“高级用户”角色登录"),
    el("p", "muted",
      "内置测试账号 premium / premium123456 可体验本页；注册的新账号为普通用户。角色不影响题目阅读。"),
  );
  const row = el("div", "locked-actions");
  const loginLink = el("a", "btn btn-run", "登录");
  loginLink.href = "#/login";
  const registerLink = el("a", "btn", "注册");
  registerLink.href = "#/register";
  row.append(loginLink, registerLink);
  panel.append(row, demoNotice());
  return panel;
}

function topicCard(topic) {
  const card = el("a", "topic-card");
  card.href = topic.href;
  card.append(
    el("div", "topic-head",
      el("strong", null, topic.title),
      el("span", "badge badge-premium", `${topic.count} 题`),
    ),
    el("p", "muted", topic.desc),
  );
  return card;
}

function unlockedPanel(topics, auth) {
  const wrap = el("div", "topics-unlocked");
  wrap.append(roleBadge(auth));
  wrap.append(el("p", "muted",
    "以下专题是会员题的策展入口（数据来自公开快照，内容本身对所有人公开）。"));
  const grid = el("div", "topics-grid");
  topics.forEach((topic) => grid.append(topicCard(topic)));
  wrap.append(grid);
  wrap.append(el("p", "muted",
    "提示：用其他测试账号（guest / user）登录或退出后再访问本页，可对比不同角色的界面差异。"));
  wrap.append(demoNotice());
  return wrap;
}

export async function renderTopics() {
  const app = document.getElementById("app");
  document.title = "高级专区 · LeetCode 题库";
  app.replaceChildren(el("p", "muted", "加载中…"));

  const auth = await loadAuthState(true);
  let topics = [];
  try {
    const summary = await getJSON("/api/premium/summary");
    topics = buildTopics(summary);
  } catch {
    topics = [];
  }

  const page = el("div", "topics-page");
  page.append(el("h1", "page-title", "高级专区"));
  const premium = auth.authenticated && auth.role === "premium";
  if (!premium) {
    page.append(lockedPanel(auth));
  } else if (!topics.length) {
    page.append(el("p", "error", "专题数据加载失败，请确认本地服务已启动。"));
  } else {
    page.append(unlockedPanel(topics, auth));
  }
  app.replaceChildren(page);
}
