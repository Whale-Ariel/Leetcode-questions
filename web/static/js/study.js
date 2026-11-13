const STORAGE_KEY = "qb.study";
export const STUDY_STATES = ["want", "doing", "done"];
export const STATE_LABELS = { want: "想刷", doing: "进行中", done: "已刷" };
const KEY_RE = /^[a-z0-9-]+\.[a-z0-9-]+:[a-z0-9-]+:(en|zh-CN)$/;
const DIFFICULTY_LABELS = { easy: "简单", medium: "中等", hard: "困难" };
const CATEGORY_LABELS = {
  algorithm: "算法",
  database: "数据库",
  shell: "Shell",
  concurrency: "并发",
  javascript: "JavaScript",
  pandas: "Pandas",
};

function emptyData() {
  return { version: 1, items: {} };
}

function isValidItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (!STUDY_STATES.includes(item.state)) return false;
  if (item.favorite !== undefined && typeof item.favorite !== "boolean") return false;
  if (item.note !== undefined && typeof item.note !== "string") return false;
  if (item.updated_at !== undefined && typeof item.updated_at !== "string") return false;
  return true;
}

export function createStudyStore(storage) {
  function load() {
    try {
      const raw = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      if (raw && raw.version === 1 && raw.items && typeof raw.items === "object"
          && !Array.isArray(raw.items)) {
        return raw;
      }
    } catch {
      // corrupted storage falls through to a fresh list
    }
    return emptyData();
  }

  function save(data) {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function keyOf(site, slug, locale) {
    return `${site}:${slug}:${locale}`;
  }

  function get(site, slug, locale) {
    return load().items[keyOf(site, slug, locale)] || null;
  }

  function update(site, slug, locale, patch) {
    const data = load();
    const key = keyOf(site, slug, locale);
    const prev = data.items[key] || {};
    const next = { ...prev, ...patch, updated_at: new Date().toISOString() };
    data.items[key] = next;
    save(data);
    return next;
  }

  function remove(site, slug, locale) {
    const data = load();
    delete data.items[keyOf(site, slug, locale)];
    save(data);
  }

  function setState(site, slug, locale, state) {
    if (!STUDY_STATES.includes(state)) return null;
    return update(site, slug, locale, { state });
  }

  function toggleFavorite(site, slug, locale) {
    const item = get(site, slug, locale);
    if (!item) return null;
    return update(site, slug, locale, { favorite: !item.favorite });
  }

  function setNote(site, slug, locale, note) {
    return update(site, slug, locale, { note: String(note ?? "").slice(0, 2000) });
  }

  function all() {
    return load().items;
  }

  function parseImport(text) {
    let parsed;
    try {
      parsed = JSON.parse(String(text));
    } catch {
      return { ok: false, valid: {}, invalid: 0, reason: "不是合法的 JSON" };
    }
    if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== "object"
        || Array.isArray(parsed.items)) {
      return { ok: false, valid: {}, invalid: 0, reason: "version 或 items 结构不正确" };
    }
    const valid = {};
    let invalid = 0;
    for (const [key, item] of Object.entries(parsed.items)) {
      if (KEY_RE.test(key) && isValidItem(item)) {
        valid[key] = item;
      } else {
        invalid += 1;
      }
    }
    return { ok: true, valid, invalid };
  }

  function importJson(text) {
    const parsed = parseImport(text);
    if (!parsed.ok) return { ok: false, added: 0, overwritten: 0, invalid: 0, reason: parsed.reason };
    const data = load();
    let added = 0;
    let overwritten = 0;
    for (const [key, item] of Object.entries(parsed.valid)) {
      if (key in data.items) {
        overwritten += 1;
      } else {
        added += 1;
      }
      data.items[key] = item;
    }
    save(data);
    return { ok: true, added, overwritten, invalid: parsed.invalid };
  }

  function exportJson() {
    return JSON.stringify(load(), null, 2);
  }

  function clear() {
    storage.removeItem(STORAGE_KEY);
  }

  return {
    load, get, update, remove, setState, toggleFavorite, setNote,
    all, parseImport, importJson, exportJson, clear, keyOf,
  };
}

// 以下为纯函数，供“我的”页与 Node 测试使用

// entries: [{key, item}], tagsByKey: {key: [tagCode]} -> 按标签汇总总标记数与已刷数
export function buildTagProgress(entries, tagsByKey) {
  const totals = new Map();
  const done = new Map();
  for (const entry of entries) {
    const tags = tagsByKey[entry.key] || [];
    for (const tag of tags) {
      totals.set(tag, (totals.get(tag) || 0) + 1);
      if (entry.item.state === "done") done.set(tag, (done.get(tag) || 0) + 1);
    }
  }
  return [...totals.entries()]
    .map(([tag, total]) => ({ tag, total, done: done.get(tag) || 0 }))
    .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
}

// items: {key: {updated_at}} -> 最近 weeks 周的每日活动格（UTC 对齐周日）
export function buildHeatmap(items, today = new Date(), weeks = 26) {
  const counts = new Map();
  for (const item of Object.values(items || {})) {
    const date = String((item && item.updated_at) || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      counts.set(date, (counts.get(date) || 0) + 1);
    }
  }
  const day = 24 * 60 * 60 * 1000;
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = new Date(end - (weeks - 1) * 7 * day);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // 对齐到周日
  const cells = [];
  for (let t = start.getTime(); t <= end; t += day) {
    const date = new Date(t).toISOString().slice(0, 10);
    cells.push({ date, count: counts.get(date) || 0 });
  }
  return cells;
}

// entries: [{key, item}] -> Anki 可导入的 CSV 文本（Front, Back, Tags）
export function buildAnkiCsv(entries, tagsByKey) {
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const siteUrl = (site, slug) => {
    const host = site === "leetcode.cn" ? "leetcode.cn/problems" : "leetcode.com/problems";
    return `https://${host}/${slug}/`;
  };
  const rows = entries
    .slice()
    .sort((a, b) => {
      const na = Number(a.item.problem && a.item.problem.display_id);
      const nb = Number(b.item.problem && b.item.problem.display_id);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.key.localeCompare(b.key);
    })
    .map((entry) => {
      const { site, slug, item } = entry;
      const problem = item.problem || {};
      const front = `${problem.display_id ? `#${problem.display_id} ` : ""}${problem.title || slug}`;
      const backLines = [
        `状态：${STATE_LABELS[item.state] || item.state}`,
        problem.difficulty ? `难度：${DIFFICULTY_LABELS[problem.difficulty] || problem.difficulty}` : "",
        problem.category ? `类别：${CATEGORY_LABELS[problem.category] || problem.category}` : "",
        item.note ? `笔记：${item.note}` : "",
        siteUrl(site, slug),
      ].filter(Boolean);
      const tagCodes = tagsByKey[entry.key] || [];
      const tags = [
        "qb",
        item.state,
        problem.difficulty,
        problem.category,
        problem.is_paid_only === 1 ? "premium" : "",
        ...tagCodes,
      ].filter(Boolean).join(" ");
      return [escape(front), escape(backLines.join("\n")), escape(tags)].join(",");
    });
  return ["#separator:Comma", "#html:false", "#tags column:3", "Front,Back,Tags", ...rows].join("\n");
}
