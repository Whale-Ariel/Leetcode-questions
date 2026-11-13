// 跨站配对判定：仅保存在浏览器本地，不写数据库
const KEY = "qb.pairs";
const VERDICTS = { confirmed: "confirmed", rejected: "rejected" };

export const VERDICT_LABELS = { confirmed: "已确认同题", rejected: "非同题" };

export function loadVerdicts() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function pairKey(displayId, slug) {
  return `${displayId}:${slug}`;
}

export function getVerdict(displayId, slug) {
  const item = loadVerdicts()[pairKey(displayId, slug)];
  return item ? item.verdict : null;
}

export function setVerdict(displayId, slug, verdict) {
  if (verdict !== null && !VERDICTS[verdict]) return;
  const items = loadVerdicts();
  const key = pairKey(displayId, slug);
  if (verdict === null) {
    delete items[key];
  } else {
    items[key] = { verdict, updated_at: new Date().toISOString() };
  }
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function countVerdicts() {
  const items = loadVerdicts();
  let confirmed = 0;
  let rejected = 0;
  for (const item of Object.values(items)) {
    if (item.verdict === "confirmed") confirmed += 1;
    else if (item.verdict === "rejected") rejected += 1;
  }
  return { confirmed, rejected, reviewed: confirmed + rejected };
}
