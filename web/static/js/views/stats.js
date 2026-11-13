import { getJSON, el } from "../api.js?v=25";

const DIFFICULTY_LABELS = { easy: "简单", medium: "中等", hard: "困难" };
const DIFFICULTY_ORDER = ["easy", "medium", "hard"];
const CATEGORY_LABELS = {
  algorithm: "算法",
  database: "数据库",
  javascript: "JavaScript",
  pandas: "Pandas",
  concurrency: "并发",
  shell: "Shell",
  unknown: "未分类",
};
const CATEGORY_ORDER = ["algorithm", "database", "javascript", "pandas", "concurrency", "shell", "unknown"];
const ISSUE_LABELS = {
  content_conflict: "正文冲突",
  difficulty_conflict: "难度冲突",
  identity_field_mismatch: "身份字段不匹配",
  paid_statement_absent: "会员题正文缺失",
  statement_missing: "正文缺失",
};

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

function statCard(label, value, hint, href) {
  const card = el("div", `stat-card${href ? " stat-card-link" : ""}`);
  card.append(el("div", "stat-card-value", fmt(value)), el("div", "stat-card-label", label));
  if (hint) card.append(el("div", "stat-card-hint", hint));
  if (href) {
    const link = el("a", "stat-card-cover");
    link.setAttribute("href", href);
    link.setAttribute("aria-label", `查看${label}`);
    card.append(link);
  }
  return card;
}

function barRow(label, count, max, barClass) {
  const width = max > 0 ? Math.max((count / max) * 100, 2) : 0;
  const bar = el("div", `bar ${barClass || ""}`);
  bar.style.width = `${width}%`;
  const row = el("div", "bar-row");
  row.append(
    el("span", "bar-label", label),
    el("div", "bar-track", bar),
    el("span", "bar-count", fmt(count)),
  );
  return row;
}

function renderDifficulty(stats) {
  const entries = DIFFICULTY_ORDER.map((key) => [DIFFICULTY_LABELS[key], stats[key] || 0]);
  const max = Math.max(...entries.map(([, n]) => n), 1);
  const card = el("div", "status-card");
  card.append(el("h2", null, "难度分布"));
  entries.forEach(([label, count], i) => {
    card.append(barRow(label, count, max, `bar-${DIFFICULTY_ORDER[i]}`));
  });
  return card;
}

function renderCategory(stats) {
  const entries = CATEGORY_ORDER.map((key) => [CATEGORY_LABELS[key], stats[key] || 0]);
  const max = Math.max(...entries.map(([, n]) => n), 1);
  const card = el("div", "status-card");
  card.append(el("h2", null, "类别分布"));
  entries.forEach(([label, count]) => card.append(barRow(label, count, max, "bar-neutral")));
  return card;
}

function renderPremium(premium) {
  const rows = [
    ["有当前题干", `${premium.with_statement} / ${premium.total}`],
    ["有结构化示例", `${premium.with_examples} / ${premium.total}`],
    ["示例总数", `${fmt(premium.example_count)}`],
    ["有提示", `${premium.with_hints}`],
    ["有代码模板", `${premium.with_starter_code}`],
  ];
  const card = el("div", "status-card");
  card.append(el("h2", null, "Premium 会员题概况"));
  rows.forEach(([label, value]) => {
    const row = el("div", "stat-inline-row");
    row.append(el("span", null, label), el("span", "stat-inline-value", value));
    card.append(row);
  });
  const link = el("a", "premium-link", "查看 Premium 会员题专区 →");
  link.setAttribute("href", "#/premium");
  card.append(link);
  return card;
}

function renderIssues(issuesByType) {
  const card = el("div", "status-card");
  card.append(el("h2", null, "数据问题分布"));
  card.append(el("p", "muted", "点击查看对应类型的问题列表"));
  Object.entries(ISSUE_LABELS).forEach(([key, label]) => {
    const count = issuesByType[key] || 0;
    const link = el("a", "issue-stat-row", el("span", null, label), el("span", null, fmt(count)));
    link.setAttribute("href", `#/issues?type=${key}`);
    card.append(link);
  });
  return card;
}

export async function renderStats() {
  const app = document.getElementById("app");
  document.title = "统计 · LeetCode 题库";
  app.replaceChildren(el("p", "muted", "正在统计本地题库…"));
  try {
    const stats = await getJSON("/api/stats");
    const totals = stats.totals;
    const generated = (stats.generated_at || "").replace("T", " ").replace("Z", " UTC");

    const page = el("div", "stats-page");
    page.append(el("h1", "page-title", "题库统计"));

    const cards = el("div", "stat-cards");
    cards.append(
      statCard("题目", totals.problems, "去重后的题目总数"),
      statCard("国际站", totals.com, "leetcode.com"),
      statCard("中文站", totals.cn, "leetcode.cn"),
      statCard("Premium 会员题", totals.premium, "点击进入会员题专区", "#/premium"),
      statCard("题干版本", totals.contents, "跨来源的正文记录"),
      statCard("示例", totals.examples, "结构化示例条数"),
      statCard("数据问题", totals.issues, "详见数据质量页"),
    );
    page.append(cards);

    const grid = el("div", "stats-grid");
    grid.append(renderDifficulty(stats.by_difficulty), renderCategory(stats.by_category));
    page.append(grid);

    const grid2 = el("div", "stats-grid");
    grid2.append(renderPremium(stats.premium), renderIssues(stats.issues_by_type));
    page.append(grid2);

    page.append(el("p", "muted stats-footer", `实时查询当前 SQLite 快照，生成于 ${generated || "未知"}`));
    app.replaceChildren(page);
  } catch (err) {
    app.replaceChildren(el("p", "error", `加载失败：${err.message}`));
  }
}
