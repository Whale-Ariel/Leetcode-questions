import { getJSON, el } from "../api.js?v=25";
import {
  countVerdicts,
  getVerdict,
  loadVerdicts,
  pairKey,
  setVerdict,
} from "../pairs.js?v=25";

const PAGE_SIZE = 20;
const DIFFICULTY_LABELS = { easy: "简单", medium: "中等", hard: "困难" };
const TABS = [
  { id: "pending", label: "待核实" },
  { id: "confirmed", label: "已确认" },
  { id: "rejected", label: "已拒绝" },
  { id: "all", label: "全部" },
];

let allPairs = null; // [{slug, display_id}] 模块级缓存

async function loadAllPairs() {
  if (!allPairs) {
    const data = await getJSON("/api/pairs/all");
    allPairs = data.items.slice().sort((a, b) => {
      const na = Number(a.display_id);
      const nb = Number(b.display_id);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.slug.localeCompare(b.slug);
    });
  }
  return allPairs;
}

function filteredPairs(state, verdicts) {
  const q = state.q.trim().toLowerCase();
  const needle = q.startsWith("#") ? q.slice(1) : q;
  return allPairs.filter((pair) => {
    const verdict = getVerdict(pair.display_id, pair.slug);
    if (state.tab === "pending" && verdict) return false;
    if (state.tab === "confirmed" && verdict !== "confirmed") return false;
    if (state.tab === "rejected" && verdict !== "rejected") return false;
    if (!needle) return true;
    return pair.slug.includes(needle) || pair.display_id === needle;
  });
}

function stateFromParams(params) {
  const tab = params.get("tab") || "pending";
  return {
    tab: TABS.some((t) => t.id === tab) ? tab : "pending",
    q: params.get("q") || "",
    page: Math.max(1, parseInt(params.get("page") || "1", 10) || 1),
  };
}

function queryFromState(state) {
  const query = {};
  if (state.tab !== "pending") query.tab = state.tab;
  if (state.q) query.q = state.q;
  if (state.page > 1) query.page = String(state.page);
  return query;
}

function verdictCard(pair, onChanged) {
  const card = el("div", "pair-card");
  const head = el("div", "pair-head");
  head.append(el("strong", null, `#${pair.display_id} ${pair.slug}`));
  const verdict = getVerdict(pair.display_id, pair.slug);
  card.dataset.displayId = pair.display_id;
  card.dataset.slug = pair.slug;

  const columns = el("div", "pair-columns");
  const comCol = el("div", "pair-site");
  comCol.append(el("span", "badge badge-muted", "leetcode.com"));
  const cnCol = el("div", "pair-site");
  cnCol.append(el("span", "badge badge-muted", "leetcode.cn"));
  if (pair.com) {
    comCol.append(el("p", null, [
      `${DIFFICULTY_LABELS[pair.com.difficulty] || "难度未知"} · `,
      pair.com.title ? pair.com.title.replace(/\s*🔒\s*$/, "") : "(无标题)",
    ]));
  } else {
    comCol.append(el("p", "muted", "库中无此题"));
  }
  if (pair.cn) {
    cnCol.append(el("p", null, [
      `${DIFFICULTY_LABELS[pair.cn.difficulty] || "难度未知"} · `,
      pair.cn.title ? pair.cn.title.replace(/\s*🔒\s*$/, "") : "(无标题)",
    ]));
  } else {
    cnCol.append(el("p", "muted", "库中无此题"));
  }
  columns.append(comCol, cnCol);
  card.append(head, columns);

  const actions = el("div", "pair-actions");
  const confirmBtn = el("button", `btn btn-small${verdict === "confirmed" ? " study-on" : ""}`,
    verdict === "confirmed" ? "✓ 已确认同题" : "确认同题");
  confirmBtn.type = "button";
  const rejectBtn = el("button", `btn btn-small${verdict === "rejected" ? " study-on" : ""}`,
    verdict === "rejected" ? "✗ 已标记非同题" : "非同题");
  rejectBtn.type = "button";
  const undoBtn = el("button", "btn btn-small", "撤销");
  undoBtn.type = "button";
  undoBtn.disabled = !verdict;
  confirmBtn.addEventListener("click", () => {
    setVerdict(pair.display_id, pair.slug, "confirmed");
    onChanged();
  });
  rejectBtn.addEventListener("click", () => {
    setVerdict(pair.display_id, pair.slug, "rejected");
    onChanged();
  });
  undoBtn.addEventListener("click", () => {
    setVerdict(pair.display_id, pair.slug, null);
    onChanged();
  });
  actions.append(confirmBtn, rejectBtn, undoBtn);
  card.append(actions);
  return card;
}

function buildPagination(total, page, onPage) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const nav = el("nav", "pagination");
  nav.setAttribute("aria-label", "分页");
  const go = (target) => onPage(Math.min(Math.max(1, target), totalPages));
  const prev = el("button", "btn page-btn", "上一页");
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => go(page - 1));
  nav.append(prev);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  let last = 0;
  for (const p of sorted) {
    if (p - last > 1) nav.append(el("span", "page-gap", "…"));
    const btn = el("button", `btn page-btn${p === page ? " active" : ""}`, String(p));
    btn.addEventListener("click", () => go(p));
    nav.append(btn);
    last = p;
  }
  const next = el("button", "btn page-btn", "下一页");
  next.disabled = page >= totalPages;
  next.addEventListener("click", () => go(page + 1));
  nav.append(next);
  return nav;
}

function exportVerdicts() {
  const blob = new Blob([JSON.stringify(loadVerdicts(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "qb-pair-verdicts.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importVerdicts(file, afterChange) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("文件格式不对：应为对象");
    }
    const valid = {};
    for (const [key, item] of Object.entries(data)) {
      if (!item || typeof item !== "object") continue;
      if (item.verdict !== "confirmed" && item.verdict !== "rejected") continue;
      if (!/^[^:]+:[^:]+$/.test(key)) continue;
      valid[key] = { verdict: item.verdict, updated_at: item.updated_at || null };
    }
    if (!Object.keys(valid).length) {
      throw new Error("没有找到有效的判定记录（verdict 须为 confirmed 或 rejected）");
    }
    // 覆盖式导入，与学习清单策略一致
    localStorage.setItem("qb.pairs", JSON.stringify(valid));
    afterChange();
  } catch (err) {
    alert(`导入失败：${err.message}`);
  }
}

export async function renderReview(params) {
  const app = document.getElementById("app");
  document.title = "配对核实 · LeetCode 题库";
  const state = stateFromParams(params);
  app.replaceChildren(el("p", "muted", "加载中…"));

  try {
    await loadAllPairs();
  } catch (err) {
    app.replaceChildren(el("p", "error", `加载配对候选失败：${err.message}`));
    return;
  }

  const navigate = (next) => {
    const query = queryFromState(next);
    const qs = new URLSearchParams(query).toString();
    location.hash = `#/review${qs ? `?${qs}` : ""}`;
  };

  const page = el("div", "issues-page");
  page.append(el("h1", "page-title", "跨站配对核实"));
  page.append(el("p", "muted",
    "中文站与国际站按 slug 相同推断为同一题，尚未核实。请人工确认：两列标题确实指向同一道题时点“确认同题”。判定只保存在当前浏览器，不会写数据库。"));

  const counts = countVerdicts();
  const summary = el("p", "muted result-count",
    `共 ${allPairs.length.toLocaleString("en-US")} 对候选 · 已核实 ${counts.reviewed}（确认 ${counts.confirmed} / 拒绝 ${counts.rejected}）`);

  const tabBar = el("div", "issue-filters");
  TABS.forEach((tab) => {
    const btn = el("button", `btn btn-small${state.tab === tab.id ? " study-on" : ""}`, tab.label);
    btn.type = "button";
    btn.addEventListener("click", () => navigate({ ...state, tab: tab.id, page: 1 }));
    tabBar.append(btn);
  });

  const searchLabel = el("label", "filter-field");
  searchLabel.append(el("span", "filter-label", "搜索"));
  const search = document.createElement("input");
  search.type = "search";
  search.value = state.q;
  search.placeholder = "slug 或题号，回车搜索";
  search.setAttribute("aria-label", "搜索配对");
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") navigate({ ...state, q: search.value.trim(), page: 1 });
  });
  searchLabel.append(search);
  tabBar.append(searchLabel);

  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json";
  importInput.hidden = true;
  const importBtn = el("button", "btn btn-small", "导入判定");
  importBtn.type = "button";
  importBtn.addEventListener("click", () => importInput.click());
  const exportBtn = el("button", "btn btn-small", "导出判定");
  exportBtn.type = "button";
  exportBtn.addEventListener("click", exportVerdicts);
  tabBar.append(importBtn, exportBtn, importInput);

  page.append(summary, tabBar);

  const listWrap = el("div", "pair-list");
  const paginationWrap = el("div", null);
  page.append(listWrap, paginationWrap);
  app.replaceChildren(page);

  const pairs = filteredPairs(state, loadVerdicts());
  const totalPages = Math.max(1, Math.ceil(pairs.length / PAGE_SIZE));
  const safePage = Math.min(state.page, totalPages);
  const pageItems = pairs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const rerender = () => renderReview(new URLSearchParams(queryFromState({ ...state, page: safePage })));

  const token = Symbol("page");
  renderReview._token = token;
  const renderCards = async () => {
    let withTitles;
    if (!pageItems.length) {
      withTitles = [];
    } else {
      try {
        const ids = pageItems.map((p) => p.display_id);
        const data = await getJSON("/api/pairs", { ids: ids.join(",") });
        if (renderReview._token !== token) return; // 用户已翻页，丢弃过期结果
        withTitles = data.items;
      } catch (err) {
        listWrap.replaceChildren(el("p", "error", `加载标题失败：${err.message}`));
        return;
      }
    }
    if (!pageItems.length) {
      listWrap.replaceChildren(el("p", "muted",
        state.tab === "pending" ? "没有待核实的配对（或搜索无结果）" : "此视图下没有记录"));
    } else {
      listWrap.replaceChildren(...withTitles.map((pair) => verdictCard(pair, rerender)));
    }
    paginationWrap.replaceChildren(
      el("p", "muted result-count",
        `符合条件 ${pairs.length.toLocaleString("en-US")} 对 · 第 ${safePage} / ${totalPages} 页`),
      buildPagination(pairs.length, safePage, (target) => navigate({ ...state, page: target })),
    );
  };
  renderCards();

  importInput.addEventListener("change", () => {
    if (importInput.files && importInput.files[0]) {
      importVerdicts(importInput.files[0], rerender);
      importInput.value = "";
    }
  });
}
