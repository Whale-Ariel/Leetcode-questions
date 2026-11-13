import { getJSON, el } from "../api.js?v=25";
import { navigate } from "../router.js?v=25";

const TYPE_INFO = {
  content_conflict: {
    label: "正文冲突",
    explain: "同一题不同来源的正文不一致，已各留一份（详情里列出冲突的来源）。",
  },
  difficulty_conflict: {
    label: "难度冲突",
    explain: "不同来源标注的难度不一致，待核实。",
  },
  identity_field_mismatch: {
    label: "身份字段不匹配",
    explain: "跨站字段（如 slug）对应不上，暂以库里已有值为准，待核实。",
  },
  paid_statement_absent: {
    label: "会员题正文缺失",
    explain: "leetcode-api 缓存中的会员题正文为空；当前正文可能来自 doocs，页面需按 is_current 判断，不能一概说“缺正文”。",
  },
  statement_missing: {
    label: "正文缺失",
    explain: "所有来源均未提取到该题正文。",
  },
};
const TYPE_ORDER = ["content_conflict", "identity_field_mismatch", "paid_statement_absent", "statement_missing", "difficulty_conflict"];
const SEVERITY_LABELS = { info: "提示", warning: "警告" };
const STATUS_LABELS = { open: "未处理", resolved: "已解决", wontfix: "不处理" };

function stateFromParams(params) {
  return {
    type: params.get("type") || "",
    severity: params.get("severity") || "",
    status: params.get("status") || "",
    page: Math.max(1, parseInt(params.get("page") || "1", 10) || 1),
  };
}

function queryFromState(state) {
  const query = { page: state.page === 1 ? "" : String(state.page) };
  if (state.type) query.type = state.type;
  if (state.severity) query.severity = state.severity;
  if (state.status) query.status = state.status;
  return query;
}

function badge(text, kind) {
  return el("span", `badge ${kind ? `badge-${kind}` : "badge-muted"}`, text);
}

function statusBadge(status) {
  const kind = status === "resolved" ? "easy" : status === "wontfix" ? "muted" : "medium";
  return badge(STATUS_LABELS[status] || status, kind);
}

function buildFilters(state) {
  const row = el("div", "issue-filters");

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
      navigate("/issues", queryFromState({ ...state, [key]: select.value, page: 1 }));
    });
    field.append(el("span", "filter-label", label), select);
    return field;
  };

  row.append(
    makeSelect("问题类型", "type", TYPE_ORDER.map((key) => [key, TYPE_INFO[key].label])),
    makeSelect("严重程度", "severity", Object.entries(SEVERITY_LABELS)),
    makeSelect("状态", "status", Object.entries(STATUS_LABELS)),
  );

  const hasFilter = state.type || state.severity || state.status;
  if (hasFilter) {
    const clear = el("button", "btn btn-clear-inline", "清空筛选");
    clear.addEventListener("click", () => navigate("/issues"));
    row.append(clear);
  }
  return row;
}

function buildLegend() {
  const card = el("div", "status-card issue-legend");
  card.append(el("h2", null, "各类问题的含义"));
  TYPE_ORDER.forEach((key) => {
    const { label, explain } = TYPE_INFO[key];
    card.append(el("p", null, el("strong", null, `${label}：`), explain));
  });
  return card;
}

function problemCell(problem) {
  if (!problem) return el("span", "muted", "—");
  const link = el("a", null, `${problem.display_id}. ${problem.title.replace(/\s*🔒\s*$/, "")}`);
  const query = problem.locale ? `?locale=${problem.locale}` : "";
  link.setAttribute("href", `#/problem/${problem.site}/${problem.slug}${query}`);
  return link;
}

function issueRow(item) {
  const info = TYPE_INFO[item.issue_type] || { label: item.issue_type, explain: "" };
  const severityKind = item.severity === "warning" ? "medium" : "muted";
  const tr = el("tr", null);

  tr.append(
    el("td", null, badge(info.label, severityKind)),
    el("td", "explain-cell", info.explain),
    el("td", null, problemCell(item.problem)),
    el("td", null, statusBadge(item.status)),
  );

  const json = { message: item.message, detail: item.detail };
  const detailTd = el("td", null);
  const details = el("details", null);
  details.append(el("summary", null, "详情"));
  details.append(el("pre", "issue-json", JSON.stringify(json, null, 2)));
  detailTd.append(details);
  tr.append(detailTd);
  return tr;
}

function buildPagination(state, total, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const nav = el("nav", "pagination");
  nav.setAttribute("aria-label", "分页");
  const pages = new Set([1, totalPages, state.page - 1, state.page, state.page + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const go = (page) => navigate("/issues", queryFromState({ ...state, page }));
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

async function loadIssues(state, tableWrap, statusLine) {
  try {
    const data = await getJSON("/api/issues", queryFromState(state));
    statusLine.textContent = `共 ${data.total.toLocaleString("en-US")} 条问题 · 当前第 ${data.page} / ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
    const table = el("table", "issue-table");
    const thead = el("thead", null);
    thead.append(el("tr", null,
      el("th", null, "问题类型"),
      el("th", null, "说明"),
      el("th", null, "关联题目"),
      el("th", null, "状态"),
      el("th", null, "详情"),
    ));
    table.append(thead);
    const tbody = el("tbody", null);
    if (!data.items.length) {
      const emptyTd = el("td", "muted", "没有符合条件的问题");
      emptyTd.setAttribute("colspan", "5");
      tbody.append(el("tr", null, emptyTd));
    } else {
      data.items.forEach((item) => tbody.append(issueRow(item)));
    }
    table.append(tbody);
    tableWrap.replaceChildren(table, buildPagination(state, data.total, data.page_size));
  } catch (err) {
    tableWrap.replaceChildren(el("p", "error", `加载失败：${err.message}`));
  }
}

export async function renderIssues(params) {
  const app = document.getElementById("app");
  document.title = "数据质量 · LeetCode 题库";
  const state = stateFromParams(params);
  app.replaceChildren();

  const page = el("div", "issues-page");
  page.append(el("h1", "page-title", "数据质量"));
  page.append(el("p", "muted", "导入快照时发现的问题清单；仅记录，不影响浏览。"));
  page.append(buildLegend());
  page.append(buildFilters(state));
  const statusLine = el("p", "muted result-count");
  const tableWrap = el("div", "issue-table-wrap");
  page.append(statusLine, tableWrap);
  app.append(page);
  await loadIssues(state, tableWrap, statusLine);
}
