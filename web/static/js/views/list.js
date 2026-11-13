import { getJSON, el } from "../api.js?v=25";
import { navigate } from "../router.js?v=25";

let scrollTimer = null;
window.addEventListener("scroll", () => {
  if (!location.hash.startsWith("#/problems")) return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    sessionStorage.setItem("qb.listScroll", JSON.stringify({ hash: location.hash, y: window.scrollY }));
  }, 100);
}, { passive: true });

function restoreScroll() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("qb.listScroll") || "null");
    if (saved && saved.hash === location.hash) {
      sessionStorage.removeItem("qb.listScroll");
      if (saved.y) window.scrollTo(0, saved.y);
    }
  } catch {
    sessionStorage.removeItem("qb.listScroll");
  }
}

const DIFFICULTY_LABELS = { easy: "简单", medium: "中等", hard: "困难" };
const CATEGORY_LABELS = {
  algorithm: "算法",
  database: "数据库",
  shell: "Shell",
  concurrency: "并发",
  javascript: "JavaScript",
  pandas: "Pandas",
  unknown: "未分类",
};
const PAID_LABELS = { "": "全部", 0: "免费题", 1: "Premium 会员题", unknown: "未标注" };

function stateFromParams(params) {
  return {
    q: params.get("q") || "",
    site: params.get("site") || "",
    locale: params.get("locale") || "",
    difficulty: params.getAll("difficulty"),
    category: params.getAll("category"),
    paid: params.get("paid") || "",
    sort: params.get("sort") || "display_id",
    page: Math.max(1, parseInt(params.get("page") || "1", 10) || 1),
  };
}

function queryFromState(state) {
  const query = {
    q: state.q,
    site: state.site,
    locale: state.locale,
    paid: state.paid,
    sort: state.sort,
  };
  if (state.page > 1) query.page = state.page;
  return { ...query, difficulty: state.difficulty, category: state.category };
}

function checkboxGroup(title, options, selected, onChange) {
  const fieldset = el("fieldset", "filter-group");
  const legend = el("legend", null, title);
  fieldset.append(legend);
  for (const { value, label } of options) {
    const labelNode = el("label", "filter-check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = selected.includes(value);
    input.addEventListener("change", () => {
      const next = selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value];
      onChange(next);
    });
    labelNode.append(input, el("span", null, label));
    fieldset.append(labelNode);
  }
  return fieldset;
}

function selectFilter(title, options, value, onChange) {
  const labelNode = el("label", "filter-field");
  labelNode.append(el("span", "filter-label", title));
  const select = document.createElement("select");
  for (const { value: optionValue, label } of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  labelNode.append(select);
  return labelNode;
}

function buildSidebar(state) {
  const aside = el("aside", "sidebar");
  aside.append(
    selectFilter("站点", [
      { value: "", label: "全部站点" },
      { value: "leetcode.com", label: "leetcode.com" },
      { value: "leetcode.cn", label: "leetcode.cn" },
    ], state.site, (value) => {
      const next = { ...state, site: value, page: 1 };
      if (value === "leetcode.com" && state.locale !== "en") next.locale = "en";
      if (value === "leetcode.cn" && state.locale !== "zh-CN") next.locale = "zh-CN";
      navigate("/problems", queryFromState(next));
    }),
    selectFilter("语言", [
      { value: "", label: "全部语言" },
      { value: "en", label: "英文 (en)" },
      { value: "zh-CN", label: "中文 (zh-CN)" },
    ], state.locale, (value) => navigate("/problems", queryFromState({ ...state, locale: value, page: 1 }))),
    selectFilter("会员", Object.entries(PAID_LABELS).map(([value, label]) => ({ value, label })),
      state.paid, (value) => navigate("/problems", queryFromState({ ...state, paid: value, page: 1 }))),
    checkboxGroup("难度", [
      { value: "easy", label: "简单" },
      { value: "medium", label: "中等" },
      { value: "hard", label: "困难" },
    ], state.difficulty, (values) => navigate("/problems", queryFromState({ ...state, difficulty: values, page: 1 }))),
    checkboxGroup("类别", Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
      state.category, (values) => navigate("/problems", queryFromState({ ...state, category: values, page: 1 }))),
  );
  const clear = el("button", "btn btn-clear", "清空筛选");
  clear.type = "button";
  clear.addEventListener("click", () => navigate("/problems"));
  aside.append(clear);
  return aside;
}

function problemCard(item) {
  const card = el("article", "problem-card");
  const main = el("div", "card-main");
  const title = el("a", "card-title");
  title.href = `#/problem/${item.site}/${item.slug}?locale=${item.locale}`;
  title.textContent = `${item.display_id ? `#${item.display_id} ` : ""}${(item.title || item.slug).replace(/\s*🔒\s*$/, "")}`;
  main.append(title);
  const badges = el("div", "card-badges");
  const difficulty = el("span", `badge badge-${item.difficulty || "unknown"}`, DIFFICULTY_LABELS[item.difficulty] || "未知");
  badges.append(difficulty);
  if (item.category) badges.append(el("span", "badge", CATEGORY_LABELS[item.category] || item.category));
  if (item.is_paid_only === 1) badges.append(el("span", "badge badge-premium", "Premium"));
  badges.append(el("span", "badge badge-muted", `${item.site} · ${item.locale}`));
  main.append(badges);
  const tags = el("div", "card-tags");
  item.tags.slice(0, 4).forEach((tag) => tags.append(el("span", "tag", tag)));
  if (item.tags.length > 4) tags.append(el("span", "tag", `+${item.tags.length - 4}`));
  const meta = el("div", "card-meta", `题干 ${item.statement_chars ?? 0} 字符 · 代码模板 ${item.starter_languages.length} 种`);
  card.append(main, tags, meta);
  return card;
}

function buildPagination(state, total, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const nav = el("nav", "pagination");
  nav.setAttribute("aria-label", "分页");
  const pages = new Set([1, totalPages, state.page - 1, state.page, state.page + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const go = (page) => navigate("/problems", queryFromState({ ...state, page }));
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
  listArea.replaceChildren(el("p", "muted", "加载中…"));
  try {
    const data = await getJSON("/api/problems", {
      q: state.q,
      site: state.site,
      locale: state.locale,
      paid: state.paid,
      sort: state.sort,
      page: state.page,
      page_size: 20,
      difficulty: state.difficulty,
      category: state.category,
    });
    statusLine.textContent = `共 8,202 题 · 当前筛选 ${data.total} 题`;
    listArea.replaceChildren();
    if (!data.items.length) {
      const empty = el("div", "empty-state");
      empty.append(
        el("p", null, "没有符合条件的题目"),
        el("p", "muted", "试试清空筛选、切换站点，或检查中文关键词"),
      );
      listArea.append(empty);
      return;
    }
    data.items.forEach((item) => listArea.append(problemCard(item)));
    listArea.append(buildPagination(state, data.total, data.page_size));
    restoreScroll();
  } catch (err) {
    listArea.replaceChildren(el("p", "error", `加载失败：${err.message}`));
  }
}

async function jumpToProblem(url, params, failText) {
  const app = document.getElementById("app");
  try {
    const data = await getJSON(url, params);
    const item = data.random || data.daily;
    location.replace(`#/problem/${item.site}/${item.slug}?locale=${item.locale}`);
  } catch (err) {
    app.replaceChildren(el("p", "error", `${failText}：${err.message}`));
  }
}

export async function renderList(params) {
  if (params.get("daily") === "1") {
    await jumpToProblem("/api/daily", {}, "每日一题加载失败");
    return;
  }
  if (params.get("random") === "1") {
    const query = {};
    for (const key of ["site", "locale", "difficulty", "category", "paid"]) {
      if (params.get(key)) query[key] = params.get(key);
    }
    await jumpToProblem("/api/random", query, "随机一题加载失败");
    return;
  }
  const app = document.getElementById("app");
  document.title = "LeetCode 题库 · 本地浏览";
  const state = stateFromParams(params);
  app.replaceChildren();
  const layout = el("div", "list-layout");
  const searchRow = el("div", "search-row");
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜索题号、slug 或标题，如 1、two-sum、两数之和";
  search.value = state.q;
  search.setAttribute("aria-label", "搜索题目");
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      navigate("/problems", queryFromState({ ...state, q: search.value.trim(), page: 1 }));
    }, 300);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    clearTimeout(timer);
    navigate("/problems", queryFromState({ ...state, q: search.value.trim(), page: 1 }));
  });
  searchRow.append(search);
  const sortSelect = document.createElement("select");
  sortSelect.setAttribute("aria-label", "排序");
  [
    { value: "display_id", label: "按题号" },
    { value: "difficulty", label: "按难度" },
    { value: "title", label: "按标题" },
  ].forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    sortSelect.append(option);
  });
  sortSelect.value = state.sort;
  sortSelect.addEventListener("change", () => {
    navigate("/problems", queryFromState({ ...state, sort: sortSelect.value, page: 1 }));
  });
  searchRow.append(sortSelect);
  const statusLine = el("p", "muted result-count");
  const hint = el("p", "muted keynav-hint", "快捷键：/ 聚焦搜索 · j/k 选择题目 · Enter 打开 · r 随机一题");
  const listArea = el("div", "problem-list");
  layout.append(buildSidebar(state), el("div", "list-main", searchRow, hint, statusLine, listArea));
  app.append(layout);
  await loadList(state, listArea, statusLine);
}
