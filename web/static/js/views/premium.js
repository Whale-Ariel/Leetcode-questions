import { getJSON, el } from "../api.js?v=25";
import { navigate } from "../router.js?v=25";
import { createStudyStore, STATE_LABELS, STUDY_STATES } from "../study.js?v=25";

const DIFFICULTY_LABELS = { easy: "简单", medium: "中等", hard: "困难" };
const DIFFICULTY_ORDER = ["easy", "medium", "hard"];
const CATEGORY_LABELS = {
  algorithm: "算法",
  database: "数据库",
  javascript: "JavaScript",
  pandas: "Pandas",
  concurrency: "并发",
  shell: "Shell",
};
const SOURCE_NOTE = "会员标记来自 leetcode.com 公开快照；题干由 doocs 公开快照提供。本站不抓取、不提供 LeetCode 官方会员内容，需要完整体验请支持官方。";

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

function stateFromParams(params) {
  return {
    q: params.get("q") || "",
    difficulty: params.get("difficulty") || "",
    category: params.get("category") || "",
    tag: params.get("tag") || "",
    has_examples: params.get("has_examples") === "1",
    sort: params.get("sort") || "display_id",
    page: Math.max(1, parseInt(params.get("page") || "1", 10) || 1),
  };
}

function queryFromState(state) {
  const query = { page: state.page === 1 ? "" : String(state.page) };
  if (state.q) query.q = state.q;
  if (state.difficulty) query.difficulty = state.difficulty;
  if (state.category) query.category = state.category;
  if (state.tag) query.tag = state.tag;
  if (state.has_examples) query.has_examples = "1";
  if (state.sort !== "display_id") query.sort = state.sort;
  return query;
}

function apiQuery(state) {
  return { ...queryFromState(state), paid: "1", page_size: "20" };
}

function distRow(label, count) {
  const chip = el("span", "dist-chip");
  chip.append(el("span", "dist-label", label), el("span", "dist-count", fmt(count)));
  return chip;
}

function quickLink(label, count, params) {
  const link = el("a", "quick-link");
  link.href = `#/premium?${new URLSearchParams(params)}`;
  link.append(el("span", null, label), el("span", "quick-count", fmt(count)));
  return link;
}

function renderSummary(summary, state) {
  const block = el("div", "premium-summary");

  const titleRow = el("div", "premium-title-row");
  titleRow.append(el("h1", "page-title", "Premium 会员题"));
  const randomBtn = el("button", "btn", "随机一道 Premium");
  randomBtn.addEventListener("click", async () => {
    try {
      const data = await getJSON("/api/random", { paid: "1" });
      const item = data.random;
      location.replace(`#/problem/${item.site}/${item.slug}?locale=${item.locale}`);
    } catch (err) {
      block.append(el("p", "error", `随机加载失败：${err.message}`));
    }
  });
  titleRow.append(randomBtn);
  block.append(titleRow);
  block.append(el("p", "muted", `${fmt(summary.total)} 道 · 全部来自 ${summary.site} 快照`));

  const note = el("div", "premium-source-note");
  note.append(el("p", null, SOURCE_NOTE));
  block.append(note);

  const dists = el("div", "dist-row");
  DIFFICULTY_ORDER.forEach((key) => {
    if (summary.by_difficulty[key]) dists.append(distRow(DIFFICULTY_LABELS[key], summary.by_difficulty[key]));
  });
  block.append(el("p", "dist-title", "难度分布"), dists);

  const cats = el("div", "dist-row");
  Object.entries(summary.by_category).forEach(([key, count]) => {
    cats.append(distRow(CATEGORY_LABELS[key] || key, count));
  });
  block.append(el("p", "dist-title", "类别分布"), cats);

  const quick = el("div", "dist-row");
  quick.append(
    quickLink("数据库", summary.by_category.database || 0, { category: "database" }),
    quickLink("困难", summary.by_difficulty.hard || 0, { difficulty: "hard" }),
    quickLink("有结构化示例", summary.with_examples, { has_examples: "1" }),
    quickLink("简单", summary.by_difficulty.easy || 0, { difficulty: "easy" }),
  );
  block.append(el("p", "dist-title", "快捷集合"), quick);

  const hasFilter = state.q || state.difficulty || state.category || state.tag || state.has_examples;
  if (hasFilter) {
    const clear = el("button", "btn btn-clear-inline", "清空筛选");
    clear.addEventListener("click", () => navigate("/premium"));
    block.append(el("div", "premium-clear-row", clear));
  }
  return block;
}

function studyRow(item) {
  const store = createStudyStore(localStorage);
  const row = el("div", "study-row");
  const meta = {
    display_id: item.display_id,
    title: (item.title || item.slug).replace(/\s*🔒\s*$/, ""),
    difficulty: item.difficulty,
    category: item.category,
    is_paid_only: item.is_paid_only,
  };

  function render() {
    const current = store.get(item.site, item.slug, item.locale);
    row.replaceChildren();
    const favBtn = el("button", `btn btn-small study-btn${current && current.favorite ? " study-on" : ""}`,
      current && current.favorite ? "★" : "☆");
    favBtn.title = "收藏";
    favBtn.setAttribute("aria-label", "收藏");
    favBtn.setAttribute("aria-pressed", String(Boolean(current && current.favorite)));
    favBtn.addEventListener("click", () => {
      if (!current) store.setState(item.site, item.slug, item.locale, "want");
      store.toggleFavorite(item.site, item.slug, item.locale);
      if (!store.get(item.site, item.slug, item.locale).problem) {
        store.update(item.site, item.slug, item.locale, { problem: meta });
      }
      render();
    });
    row.append(favBtn);

    const select = document.createElement("select");
    select.className = "study-select";
    select.setAttribute("aria-label", "标记状态");
    select.append(el("option", null, "未标记"));
    STUDY_STATES.forEach((state) => {
      const option = document.createElement("option");
      option.value = state;
      option.textContent = STATE_LABELS[state];
      select.append(option);
    });
    select.value = current && current.state ? current.state : "";
    select.addEventListener("change", () => {
      if (select.value) {
        store.setState(item.site, item.slug, item.locale, select.value);
        if (!store.get(item.site, item.slug, item.locale).problem) {
          store.update(item.site, item.slug, item.locale, { problem: meta });
        }
      }
      render();
    });
    row.append(select);
  }

  render();
  return row;
}

function premiumCard(item) {
  const card = el("article", "problem-card premium-card");
  const main = el("div", "card-main");
  const title = el("a", "card-title");
  title.href = `#/problem/${item.site}/${item.slug}?locale=${item.locale}`;
  title.textContent = `${item.display_id ? `#${item.display_id} ` : ""}${(item.title || item.slug).replace(/\s*🔒\s*$/, "")}`;
  main.append(title);
  const badges = el("div", "card-badges");
  badges.append(el("span", "badge badge-premium", "Premium"));
  badges.append(el("span", `badge badge-${item.difficulty || "unknown"}`, DIFFICULTY_LABELS[item.difficulty] || "未知"));
  if (item.category) badges.append(el("span", "badge", CATEGORY_LABELS[item.category] || item.category));
  badges.append(el("span", "badge badge-muted", `${item.site} · ${item.locale}`));
  main.append(badges);
  const tags = el("div", "card-tags");
  item.tags.slice(0, 4).forEach((tag) => tags.append(el("span", "tag", tag)));
  if (item.tags.length > 4) tags.append(el("span", "tag", `+${item.tags.length - 4}`));
  const coverage = el("div", "coverage-row");
  coverage.append(
    el("span", "coverage-item", "题干 ✓"),
    el("span", "coverage-item", item.has_examples ? "结构化示例 ✓" : "结构化示例 —"),
    el("span", "coverage-item coverage-missing", "提示 —"),
    el("span", "coverage-item coverage-missing", "模板 —"),
  );
  const source = el("div", "card-meta", "题干来源：doocs 快照");
  card.append(main, tags, coverage, source, studyRow(item));
  return card;
}

function buildFilters(state, summary) {
  const row = el("div", "premium-filters");

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜索题号、slug 或标题，如 156、binary-tree";
  search.value = state.q;
  search.setAttribute("aria-label", "搜索会员题");
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      navigate("/premium", queryFromState({ ...state, q: search.value.trim(), page: 1 }));
    }, 300);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    clearTimeout(timer);
    navigate("/premium", queryFromState({ ...state, q: search.value.trim(), page: 1 }));
  });
  row.append(search);

  const makeSelect = (label, key, options, allLabel = `全部${label}`) => {
    const field = el("label", "filter-field");
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    select.append(el("option", null, allLabel));
    options.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    });
    select.value = state[key];
    select.addEventListener("change", () => {
      navigate("/premium", queryFromState({ ...state, [key]: select.value, page: 1 }));
    });
    field.append(el("span", "filter-label", label), select);
    return field;
  };

  row.append(
    makeSelect("难度", "difficulty", DIFFICULTY_ORDER.map((key) => [key, DIFFICULTY_LABELS[key]])),
    makeSelect("类别", "category", Object.entries(summary.by_category).map(([key]) => [key, CATEGORY_LABELS[key] || key])),
    makeSelect("标签", "tag", summary.top_tags.map((tag) => [tag.code, `${tag.code} (${tag.count})`])),
  );

  const sort = makeSelect("排序", "sort", [
    ["display_id", "按题号"],
    ["difficulty", "按难度"],
    ["title", "按标题"],
  ], "默认排序");
  row.append(sort);

  const examples = el("label", "filter-check premium-examples-check");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.has_examples;
  checkbox.addEventListener("change", () => {
    navigate("/premium", queryFromState({ ...state, has_examples: checkbox.checked, page: 1 }));
  });
  examples.append(checkbox, el("span", null, "仅看有结构化示例"));
  row.append(examples);
  return row;
}

function buildPagination(state, total, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const nav = el("nav", "pagination");
  nav.setAttribute("aria-label", "分页");
  const pages = new Set([1, totalPages, state.page - 1, state.page, state.page + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const go = (page) => navigate("/premium", queryFromState({ ...state, page }));
  const prev = el("button", "btn page-btn", "上一页");
  prev.disabled = state.page <= 1;
  prev.addEventListener("click", () => go(state.page - 1));
  nav.append(prev);
  let last = 0;
  for (const page of sorted) {
    if (page - last > 1) nav.append(el("span", "page-gap", "…"));
    const btn = el("button", `btn page-btn${page === state.page ? " active" : ""}`, String(page));
    btn.addEventListener("click", () => go(page));
    nav.append(btn);
    last = page;
  }
  const next = el("button", "btn page-btn", "下一页");
  next.disabled = state.page >= totalPages;
  next.addEventListener("click", () => go(state.page + 1));
  nav.append(next);
  return nav;
}

async function loadList(state, listArea, statusLine) {
  try {
    const data = await getJSON("/api/problems", apiQuery(state));
    statusLine.textContent = `当前筛选 ${fmt(data.total)} 道会员题 · 第 ${data.page} / ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
    if (!data.items.length) {
      const empty = el("div", "empty-state");
      empty.append(
        el("p", null, "没有符合条件的会员题"),
        el("p", "muted", "试试清空筛选，或查看全部会员题"),
      );
      listArea.append(empty);
      return;
    }
    data.items.forEach((item) => listArea.append(premiumCard(item)));
    listArea.append(buildPagination(state, data.total, data.page_size));
  } catch (err) {
    listArea.replaceChildren(el("p", "error", `加载失败：${err.message}`));
  }
}

export async function renderPremium(params) {
  const app = document.getElementById("app");
  document.title = "Premium 会员题 · LeetCode 题库";
  const state = stateFromParams(params);
  app.replaceChildren(el("p", "muted", "正在加载会员题专区…"));
  try {
    const summary = await getJSON("/api/premium/summary");
    const page = el("div", "premium-page");
    page.append(renderSummary(summary, state));
    page.append(buildFilters(state, summary));
    page.append(el("p", "muted keynav-hint", "快捷键：/ 聚焦搜索 · j/k 选择题目 · Enter 打开 · r 随机 Premium"));
    const statusLine = el("p", "muted result-count");
    const listArea = el("div", "problem-list");
    page.append(statusLine, listArea);
    app.replaceChildren(page);
    await loadList(state, listArea, statusLine);
  } catch (err) {
    app.replaceChildren(el("p", "error", `加载失败：${err.message}`));
  }
}
