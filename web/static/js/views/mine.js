import { getJSON, el } from "../api.js?v=25";
import { navigate } from "../router.js?v=25";
import {
  createStudyStore,
  STATE_LABELS,
  buildTagProgress,
  buildHeatmap,
  buildAnkiCsv,
} from "../study.js?v=25";

const DIFFICULTY_LABELS = { easy: "简单", medium: "中等", hard: "困难" };
const CATEGORY_LABELS = {
  algorithm: "算法",
  database: "数据库",
  shell: "Shell",
  concurrency: "并发",
  javascript: "JavaScript",
  pandas: "Pandas",
};
const TABS = [
  { value: "all", label: "全部" },
  { value: "want", label: "想刷" },
  { value: "doing", label: "进行中" },
  { value: "done", label: "已刷" },
  { value: "favorite", label: "收藏" },
];

// 标签缓存：跨页面渲染复用，按 key 增量补取
const tagsByKey = new Map();

async function fetchTags(keys) {
  const missing = keys.filter((key) => !tagsByKey.has(key));
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      const data = await getJSON("/api/tags/by-slugs", { keys: chunk.join(",") });
      for (const [key, tags] of Object.entries(data.tags || {})) {
        tagsByKey.set(key, tags);
      }
    } catch {
      // 标签取不到时进度卡降级为空，不影响清单
    }
  }
}

function stateFromParams(params) {
  const tab = params.get("tab") || "all";
  return {
    tab: TABS.some((t) => t.value === tab) ? tab : "all",
    difficulty: params.get("difficulty") || "",
    category: params.get("category") || "",
  };
}

function queryFromState(state) {
  const query = {};
  if (state.tab !== "all") query.tab = state.tab;
  if (state.difficulty) query.difficulty = state.difficulty;
  if (state.category) query.category = state.category;
  return query;
}

function splitKey(key) {
  const [site, slug, locale] = key.split(":");
  return { site, slug, locale };
}

function entries(store) {
  return Object.entries(store.all()).map(([key, item]) => ({ key, ...splitKey(key), item }));
}

function matchesTab(entry, tab) {
  if (tab === "all") return true;
  if (tab === "favorite") return Boolean(entry.item.favorite);
  return entry.item.state === tab;
}

function matchesFilters(entry, state) {
  const problem = entry.item.problem;
  if (state.difficulty && problem?.difficulty !== state.difficulty) return false;
  if (state.category && problem?.category !== state.category) return false;
  return true;
}

function stateBadge(state) {
  const kind = state === "done" ? "easy" : state === "doing" ? "medium" : "hard";
  return el("span", `badge badge-${kind}`, STATE_LABELS[state] || state);
}

function fmtDate(iso) {
  return (iso || "").slice(0, 10);
}

function buildTabs(store, state) {
  const nav = el("div", "mine-tabs");
  const allEntries = entries(store);
  TABS.forEach((tab) => {
    const count = allEntries.filter((entry) => matchesTab(entry, tab.value)).length;
    const link = el("a", `mine-tab${state.tab === tab.value ? " active" : ""}`,
      el("span", null, tab.label), el("span", "mine-tab-count", String(count)));
    link.href = `#/mine?${new URLSearchParams(queryFromState({ ...state, tab: tab.value }))}`;
    nav.append(link);
  });
  return nav;
}

function buildFilters(state) {
  const row = el("div", "mine-filters");
  const makeSelect = (label, key, options) => {
    const field = el("label", "filter-field");
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    select.append(el("option", null, `全部${label}`));
    options.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    });
    select.value = state[key];
    select.addEventListener("change", () => {
      navigate("/mine", queryFromState({ ...state, [key]: select.value }));
    });
    field.append(el("span", "filter-label", label), select);
    return field;
  };
  row.append(
    makeSelect("难度", "difficulty", Object.entries(DIFFICULTY_LABELS)),
    makeSelect("类别", "category", Object.entries(CATEGORY_LABELS)),
  );
  const hasFilter = state.difficulty || state.category;
  if (hasFilter) {
    const clear = el("button", "btn btn-clear-inline", "清空筛选");
    clear.addEventListener("click", () => navigate("/mine", queryFromState({ ...state, difficulty: "", category: "" })));
    row.append(clear);
  }
  return row;
}

function buildRows(store, state, listArea, statusLine) {
  const rows = entries(store)
    .filter((entry) => matchesTab(entry, state.tab) && matchesFilters(entry, state))
    .sort((a, b) => (b.item.updated_at || "").localeCompare(a.item.updated_at || ""));
  statusLine.textContent = `当前 ${rows.length} 条记录`;
  if (!rows.length) {
    const empty = el("div", "empty-state");
    empty.append(
      el("p", null, state.tab === "all" ? "还没有任何学习记录" : "这个标签下还没有记录"),
      el("p", "muted", "在题目详情页或会员题卡片上可以标记状态、收藏、写笔记"),
    );
    const toBank = el("a", null, "去题库 →");
    toBank.href = "#/problems";
    const toPremium = el("a", null, "去 Premium 专区 →");
    toPremium.href = "#/premium";
    const links = el("p", null, toBank, " ", toPremium);
    empty.append(links);
    listArea.append(empty);
    return;
  }
  rows.forEach((entry) => listArea.append(rowCard(store, entry, () => {
    buildRows(store, state, listArea, statusLine);
  })));
}

function rowCard(store, entry, onChanged) {
  const { site, slug, locale, item } = entry;
  const problem = item.problem || {};
  const card = el("article", "problem-card mine-row");
  const main = el("div", "card-main");
  const title = el("a", "card-title", problem.title || slug);
  title.href = `#/problem/${site}/${slug}?locale=${locale}`;
  main.append(title);
  const badges = el("div", "card-badges");
  badges.append(stateBadge(item.state));
  if (item.favorite) badges.append(el("span", "badge badge-premium", "★ 收藏"));
  if (problem.difficulty) badges.append(el("span", `badge badge-${problem.difficulty}`, DIFFICULTY_LABELS[problem.difficulty] || problem.difficulty));
  if (problem.category) badges.append(el("span", "badge", CATEGORY_LABELS[problem.category] || problem.category));
  if (problem.is_paid_only === 1) badges.append(el("span", "badge badge-premium", "Premium"));
  badges.append(el("span", "badge badge-muted", `${site} · ${locale}`));
  main.append(badges);
  const meta = el("div", "card-meta", `更新于 ${fmtDate(item.updated_at)}`);
  const removeBtn = el("button", "btn btn-small mine-remove", "移除");
  removeBtn.addEventListener("click", () => {
    store.remove(site, slug, locale);
    onChanged();
  });
  meta.append(removeBtn);
  card.append(main, meta);
  if (item.note) {
    card.append(el("p", "mine-note", item.note));
  }
  return card;
}

function buildTagProgressCard(allEntries, cardSlot) {
  const entriesWithTags = allEntries.filter((entry) => tagsByKey.has(entry.key));
  const progress = buildTagProgress(entriesWithTags, Object.fromEntries(tagsByKey));
  const card = el("div", "status-card mine-tags");
  card.append(el("h2", null, "标签进度"));
  if (!progress.length) {
    card.append(el("p", "muted", "标记题目后这里会显示各标签的进度（数据来自公开快照的标签）。"));
    cardSlot.replaceChildren(card);
    return;
  }
  const top = progress.slice(0, 10);
  top.forEach(({ tag, total, done }) => {
    const row = el("div", "tag-progress-row");
    const label = el("a", "tag-progress-tag", tag);
    label.href = `#/problems?tag=${encodeURIComponent(tag)}`;
    const text = el("span", "muted tag-progress-text", `已刷 ${done} / ${total}`);
    const track = el("div", "bar-track tag-bar-track");
    const bar = el("div", "bar bar-easy");
    bar.style.width = total ? `${Math.max(2, Math.round((done / total) * 100))}%` : "0";
    track.append(bar);
    row.append(label, track, text);
    card.append(row);
  });
  const rest = progress.length - top.length;
  if (rest > 0) {
    card.append(el("p", "muted", `还有 ${rest} 个标签未展示`));
  }
  cardSlot.replaceChildren(card);
}

function buildHeatmapCard(allEntries, cardSlot) {
  const items = Object.fromEntries(allEntries.map((entry) => [entry.key, entry.item]));
  const cells = buildHeatmap(items);
  const card = el("div", "status-card mine-heatmap");
  card.append(el("h2", null, "学习活动"));
  card.append(el("p", "muted", "最近 26 周内每天有记录更新的题目数（按本地标记时间）。"));
  const grid = el("div", "heatmap-grid");
  grid.setAttribute("role", "img");
  grid.setAttribute("aria-label", "学习活动热力图");
  cells.forEach(({ date, count }) => {
    const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3;
    const cell = el("span", `hm-cell hm-${level}`);
    cell.title = `${date}：${count} 题`;
    cell.dataset.date = date;
    grid.append(cell);
  });
  card.append(grid);
  const legend = el("p", "muted heatmap-legend", [
    "少 ", el("span", "hm-cell hm-0"), " ",
    el("span", "hm-cell hm-1"), " ",
    el("span", "hm-cell hm-2"), " ",
    el("span", "hm-cell hm-3"), " 多",
  ]);
  card.append(legend);
  cardSlot.replaceChildren(card);
}

function buildTools(store, statusArea) {
  const row = el("div", "mine-tools");
  const notify = (text) => {
    statusArea.replaceChildren(el("span", "mine-status", text));
    setTimeout(() => statusArea.replaceChildren(), 4000);
  };

  const exportBtn = el("button", "btn", "导出 JSON");
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([store.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qb-study-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("已导出学习清单 JSON 文件");
  });
  row.append(exportBtn);

  const ankiBtn = el("button", "btn", "导出 Anki CSV");
  ankiBtn.addEventListener("click", () => {
    const allEntries = entries(store);
    if (!allEntries.length) {
      notify("学习清单为空，先去标记一些题目");
      return;
    }
    const csv = buildAnkiCsv(allEntries, Object.fromEntries(tagsByKey));
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qb-anki-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`已导出 ${allEntries.length} 条为 Anki CSV（文件 → 导入 Anki）`);
  });
  row.append(ankiBtn);

  const importLabel = el("label", "btn mine-import-label");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.className = "mine-file-input";
  fileInput.setAttribute("aria-label", "导入 JSON 文件");
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    const text = await file.text();
    const parsed = store.parseImport(text);
    if (!parsed.ok) {
      notify(`导入失败：${parsed.reason}`);
      return;
    }
    const validKeys = Object.keys(parsed.valid);
    const existing = store.all();
    const overwritten = validKeys.filter((key) => key in existing).length;
    const added = validKeys.length - overwritten;
    if (parsed.invalid || overwritten) {
      const parts = [
        `将新增 ${added} 条`,
        overwritten ? `覆盖 ${overwritten} 条已有记录` : "",
        parsed.invalid ? `跳过 ${parsed.invalid} 条无效记录` : "",
      ].filter(Boolean);
      const confirmed = window.confirm(`${parts.join("，")}。导入文件覆盖同键记录，确定继续？`);
      if (!confirmed) return;
    }
    const result = store.importJson(text);
    notify(`导入完成：新增 ${result.added} 条，覆盖 ${result.overwritten} 条，跳过 ${result.invalid} 条`);
    window.dispatchEvent(new Event("qb.study.changed"));
  });
  importLabel.append(fileInput, "导入 JSON");
  row.append(importLabel);

  const clearBtn = el("button", "btn mine-danger", "清空");
  clearBtn.addEventListener("click", () => {
    const confirmed = window.confirm("确定清空所有学习记录（含状态、收藏和笔记）？此操作不可恢复。");
    if (!confirmed) return;
    store.clear();
    notify("已清空全部学习记录");
    window.dispatchEvent(new Event("qb.study.changed"));
  });
  row.append(clearBtn);
  return row;
}

export async function renderMine(params) {
  const app = document.getElementById("app");
  document.title = "我的 · LeetCode 题库";
  const state = stateFromParams(params);
  app.replaceChildren(el("p", "muted", "正在读取本地学习清单…"));

  const store = createStudyStore(localStorage);
  const page = el("div", "mine-page");
  page.append(el("h1", "page-title", "我的学习清单"));
  page.append(el("p", "muted mine-warning", "仅保存在当前浏览器，换浏览器或清缓存会丢失。不涉及账号、不上传。"));

  let premiumTotal = null;
  getJSON("/api/premium/summary").then((summary) => {
    premiumTotal = summary.total;
    updateProgress();
  }).catch(() => {});

  function premiumMarked() {
    return entries(store).filter((entry) => entry.item.problem && entry.item.problem.is_paid_only === 1).length;
  }

  function updateProgress() {
    const marked = premiumMarked();
    const total = premiumTotal !== null ? premiumTotal : 789;
    progressBar.replaceChildren();
    const width = total > 0 ? Math.min(100, Math.round((marked / total) * 100)) : 0;
    const bar = el("div", "bar bar-premium");
    bar.style.width = `${Math.max(width, marked > 0 ? 2 : 0)}%`;
    progressBar.append(bar);
    progressText.textContent = premiumTotal !== null
      ? `已标记 ${marked} / ${total} 道 Premium 会员题`
      : `已标记 ${marked} 道 Premium 会员题（总数未取到）`;
  }

  const progressCard = el("div", "status-card mine-progress");
  progressCard.append(el("h2", null, "Premium 会员题进度"));
  const progressText = el("p", "muted", "正在统计…");
  const progressBar = el("div", "bar-track");
  progressCard.append(progressText, progressBar, el("a", "premium-link", "前往 Premium 会员题专区 →"));
  progressCard.querySelector(".premium-link").href = "#/premium";

  const tagsSlot = el("div");
  const heatmapSlot = el("div");

  const allEntries = entries(store);
  const keys = allEntries.map((entry) => entry.key);
  page.append(progressCard);
  page.append(tagsSlot, heatmapSlot);
  page.append(buildTabs(store, state));
  page.append(buildFilters(state));

  const statusLine = el("p", "muted result-count");
  const listArea = el("div", "mine-list");
  page.append(statusLine, listArea);
  const statusArea = el("div", "mine-status-area");
  page.append(buildTools(store, statusArea), statusArea);

  app.replaceChildren(page);
  buildRows(store, state, listArea, statusLine);
  updateProgress();

  if (keys.length) {
    fetchTags(keys).then(() => {
      const current = entries(store);
      buildTagProgressCard(current, tagsSlot);
      buildHeatmapCard(current, heatmapSlot);
    });
  } else {
    buildTagProgressCard([], tagsSlot);
    buildHeatmapCard([], heatmapSlot);
  }

  window.addEventListener("qb.study.changed", () => {
    const tabs = page.querySelector(".mine-tabs");
    if (tabs) tabs.replaceWith(buildTabs(store, stateFromParams(new URLSearchParams(location.hash.split("?")[1] || ""))));
    listArea.replaceChildren();
    const nextState = stateFromParams(new URLSearchParams(location.hash.split("?")[1] || ""));
    buildRows(store, nextState, listArea, statusLine);
    updateProgress();
    fetchTags(entries(store).map((entry) => entry.key)).then(() => {
      buildTagProgressCard(entries(store), tagsSlot);
      buildHeatmapCard(entries(store), heatmapSlot);
    });
  });
}
