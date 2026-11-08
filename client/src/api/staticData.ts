/**
 * 公开静态站的数据读取。题目来自构建时导出的 JSON，做题记录保存在当前浏览器。
 */
import type {
  Category,
  ProblemDetail,
  ProblemListItem,
  ProblemRecord,
  RecordStats,
  Tag,
} from '../types';

interface CatalogEntry extends ProblemListItem {
  key: string;
}

interface Catalog {
  entries: CatalogEntry[];
  tags: Tag[];
  categories: Category[];
}

interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  difficulty?: string;
  category?: string;
  tag?: string;
  site?: string;
  locale?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

const RECORDS_KEY = 'lq-static-records';

function ok<T>(data: T) {
  return Promise.resolve({ data: { success: true as const, data } });
}

let catalogPromise: Promise<Catalog> | null = null;

function loadCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = fetch(`${import.meta.env.BASE_URL}data/catalog.json`).then((response) => {
      if (!response.ok) {
        throw new Error('题目目录加载失败');
      }
      return response.json() as Promise<Catalog>;
    });
  }
  return catalogPromise;
}

function displayRank(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function matchesSearch(entry: CatalogEntry, search: string): boolean {
  const query = search.toLowerCase();
  return (
    entry.displayId === search
    || (entry.slug ?? '').toLowerCase().includes(query)
    || (entry.title ?? '').toLowerCase().includes(query)
  );
}

async function findEntry(identifier: string, site: string, locale: string): Promise<CatalogEntry | undefined> {
  const catalog = await loadCatalog();
  const scoped = catalog.entries.filter((entry) => entry.site === site && entry.locale === locale);
  return scoped.find((entry) => entry.slug === identifier || entry.displayId === identifier || String(entry.id) === identifier || entry.key === identifier);
}

async function loadDetail(entry: CatalogEntry): Promise<ProblemDetail> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}data/problems/${encodeURIComponent(entry.site)}/${encodeURIComponent(entry.locale)}/${encodeURIComponent(entry.key)}.json`,
  );
  if (!response.ok) {
    throw { response: { status: 404, data: { error: '题目不存在' } } };
  }
  return response.json() as Promise<ProblemDetail>;
}

function readRecords(): ProblemRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]') as ProblemRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecords(records: ProblemRecord[]) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export const staticProblemsApi = {
  getList: async (params: ListParams = {}) => {
    const catalog = await loadCatalog();
    const site = params.site || 'leetcode.com';
    const locale = params.locale || 'en';
    let rows = catalog.entries.filter((entry) => entry.site === site && entry.locale === locale);
    if (params.search) rows = rows.filter((entry) => matchesSearch(entry, params.search!));
    if (params.difficulty) rows = rows.filter((entry) => entry.difficulty === params.difficulty);
    if (params.category) rows = rows.filter((entry) => entry.category === params.category);
    if (params.tag) rows = rows.filter((entry) => entry.tags.includes(params.tag!));

    const direction = params.order === 'desc' ? -1 : 1;
    const sort = params.sort || 'display_id';
    rows.sort((left, right) => {
      let compared = 0;
      if (sort === 'title') compared = (left.title ?? '').localeCompare(right.title ?? '');
      else if (sort === 'difficulty') {
        const rank: Record<string, number> = { easy: 1, medium: 2, hard: 3 };
        compared = (rank[left.difficulty ?? ''] ?? 4) - (rank[right.difficulty ?? ''] ?? 4);
      } else if (sort === 'id') compared = left.id - right.id;
      else compared = displayRank(left.displayId) - displayRank(right.displayId) || (left.displayId ?? '').localeCompare(right.displayId ?? '');
      return compared * direction;
    });

    const page = params.page || 1;
    const limit = params.limit || 20;
    const start = (page - 1) * limit;
    return ok({
      problems: rows.slice(start, start + limit),
      total: rows.length,
      page,
      limit,
      totalPages: Math.ceil(rows.length / limit),
    });
  },

  getDetail: async (identifier: string | number, params?: { site?: string; locale?: string }) => {
    const entry = await findEntry(String(identifier), params?.site || 'leetcode.com', params?.locale || 'en');
    if (!entry) {
      throw { response: { status: 404, data: { error: '题目不存在' } } };
    }
    return ok(await loadDetail(entry));
  },

  getHints: async (identifier: string | number, params?: { site?: string; locale?: string }) => {
    const detail = await staticProblemsApi.getDetail(identifier, params);
    return ok(detail.data.data.hints);
  },

  getTags: async () => ok((await loadCatalog()).tags),

  getCategories: async () => ok((await loadCatalog()).categories),
};

export const staticRecordsApi = {
  getList: async (params?: { status?: string }) => {
    const records = readRecords()
      .filter((record) => !params?.status || record.status === params.status)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    return ok(records);
  },

  getStats: async () => {
    const records = readRecords();
    const catalog = await loadCatalog();
    const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
    const stats: RecordStats = {
      total: records.length,
      byStatus: { not_started: 0, attempting: 0, completed: 0 },
      byDifficulty: { easy: 0, medium: 0, hard: 0 },
      byCategory: {},
      recentRecords: [...records].sort((left, right) => right.updated_at.localeCompare(left.updated_at)).slice(0, 10),
    };
    for (const record of records) {
      stats.byStatus[record.status] += 1;
      const entry = byId.get(record.problem_id);
      const difficulty = entry?.difficulty || 'unknown';
      stats.byDifficulty[difficulty] = (stats.byDifficulty[difficulty] || 0) + 1;
      const category = entry?.category || 'unknown';
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    }
    return ok(stats);
  },

  getRecord: async (problemId: number) => {
    return ok(readRecords().find((record) => record.problem_id === problemId) ?? null);
  },

  upsert: async (data: {
    problemId: number;
    slug: string;
    status?: string;
    language?: string;
    viewedHints?: boolean;
    notes?: string;
  }) => {
    const records = readRecords();
    const now = new Date().toISOString();
    const existing = records.find((record) => record.problem_id === data.problemId);
    if (existing) {
      existing.slug = data.slug;
      existing.status = (data.status as ProblemRecord['status']) || existing.status;
      existing.language = data.language ?? existing.language;
      existing.viewed_hints = data.viewedHints ? 1 : existing.viewed_hints;
      existing.notes = data.notes ?? existing.notes;
      existing.updated_at = now;
      if (existing.status === 'completed' && !existing.completed_at) existing.completed_at = now;
      writeRecords(records);
      return ok(existing);
    }
    const created: ProblemRecord = {
      id: Date.now(),
      user_id: 0,
      problem_id: data.problemId,
      slug: data.slug,
      status: (data.status as ProblemRecord['status']) || 'attempting',
      language: data.language ?? null,
      viewed_hints: data.viewedHints ? 1 : 0,
      started_at: now,
      completed_at: data.status === 'completed' ? now : null,
      notes: data.notes ?? null,
      created_at: now,
      updated_at: now,
    };
    records.push(created);
    writeRecords(records);
    return ok(created);
  },
};
