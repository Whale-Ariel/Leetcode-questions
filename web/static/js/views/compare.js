import { getJSON, el } from "../api.js?v=25";
import { statementArticle } from "../statement.js?v=25";
import { getVerdict } from "../pairs.js?v=25";

const DIFFICULTY_LABELS = { easy: "简单", medium: "中等", hard: "困难" };

function columnPanel(siteLabel, detail, slug) {
  const panel = el("section", "compare-col");
  const head = el("div", "compare-col-head");
  head.append(el("span", "badge badge-muted", siteLabel));
  if (!detail) {
    panel.append(head, el("p", "muted", "该语言版本未收录，无法展示正文。"));
    return panel;
  }
  const title = (detail.content.title || "").replace(/\s*🔒\s*$/, "");
  head.append(el("strong", "compare-title", title));
  head.append(el("span", `badge badge-${detail.problem.difficulty || "unknown"}`,
    DIFFICULTY_LABELS[detail.problem.difficulty] || "难度未知"));
  panel.append(head);
  if (detail.content.coverage && detail.content.coverage.statement) {
    panel.append(statementArticle(detail.content.statement_markdown));
  } else {
    panel.append(el("p", "muted", "来源快照未提供该题题干。"));
  }
  const link = el("a", "compare-detail-link", `前往详情页 →`);
  link.href = `#/problem/${detail.problem.site}/${slug}?locale=${detail.content.locale}`;
  panel.append(link);
  return panel;
}

function verdictBanner(displayId, slug) {
  const verdict = getVerdict(displayId, slug);
  const banner = el("div", "compare-banner");
  if (verdict === "confirmed") {
    banner.append(el("span", "badge badge-easy", "已人工核实"));
    banner.append(el("p", null, "你已在配对核实页确认两列是同一道题。正文来自不同快照，表述可能不同。"));
  } else if (verdict === "rejected") {
    banner.append(el("span", "badge badge-medium", "已标记非同题"));
    banner.append(el("p", null, "你已在配对核实页标记两列不是同一道题，此页仅供对照参考。"));
  } else {
    banner.append(el("span", "badge badge-muted", "配对未核实"));
    banner.append(el("p", null, "两侧题号相同是快照推断的结果，尚未人工核实；正文来自不同来源，不是同一份译文。"));
    const link = el("a", "btn btn-small", "前往配对核实 →");
    link.href = `#/review?q=${encodeURIComponent(displayId)}&tab=pending`;
    banner.append(link);
  }
  return banner;
}

export async function renderCompare(params) {
  const app = document.getElementById("app");
  const displayId = (params.get("displayId") || "").replace(/^#/, "");
  document.title = `对照 #${displayId} · LeetCode 题库`;
  app.replaceChildren(el("p", "muted", "加载中…"));

  let pair = null;
  try {
    const data = await getJSON("/api/pairs", { ids: displayId });
    if (data.items.length) pair = data.items[0];
  } catch (err) {
    app.replaceChildren(el("p", "error", `加载配对数据失败：${err.message}`));
    return;
  }
  if (!pair) {
    const box = el("div", "empty-state");
    box.append(
      el("p", null, `没有找到题号 ${displayId} 的跨站配对`),
      el("p", "muted", "中文站与国际站按题号配对，非数字题号（如面试题）不在配对候选里。"),
      el("a", "btn", "← 返回题库"),
    );
    box.querySelector("a").href = "#/problems";
    app.replaceChildren(box);
    return;
  }

  const [comDetail, cnDetail] = await Promise.all([
    pair.com
      ? getJSON(`/api/problems/leetcode.com/${encodeURIComponent(pair.com.slug || pair.slug)}`)
          .catch(() => null)
      : Promise.resolve(null),
    pair.cn
      ? getJSON(`/api/problems/leetcode.cn/${encodeURIComponent(pair.cn.slug || pair.slug)}`)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const page = el("div", "compare-page");
  const head = el("div", "compare-header");
  head.append(el("h1", "page-title", `#${displayId} 中英对照`));
  const comTitle = pair.com && pair.com.title ? pair.com.title.replace(/\s*🔒\s*$/, "") : "";
  const cnTitle = pair.cn && pair.cn.title ? pair.cn.title.replace(/\s*🔒\s*$/, "") : "";
  head.append(el("p", "muted", `${comTitle} / ${cnTitle} · ${pair.slug}`));
  page.append(head, verdictBanner(displayId, pair.slug));

  const grid = el("div", "compare-grid");
  grid.append(
    columnPanel("leetcode.com · English", comDetail, pair.com ? pair.com.slug || pair.slug : pair.slug),
    columnPanel("leetcode.cn · 中文", cnDetail, pair.cn ? pair.cn.slug || pair.slug : pair.slug),
  );
  page.append(grid);
  app.replaceChildren(page);
}
