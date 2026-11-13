import assert from "node:assert/strict";
import {
  createStudyStore,
  buildTagProgress,
  buildHeatmap,
  buildAnkiCsv,
} from "../web/static/js/study.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL - ${name}: ${err.message}`);
  }
}

test("update creates item with updated_at and metadata", () => {
  const store = createStudyStore(fakeStorage());
  store.setState("leetcode.com", "two-sum", "en", "want");
  const item = store.get("leetcode.com", "two-sum", "en");
  assert.equal(item.state, "want");
  assert.match(item.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  store.update("leetcode.com", "two-sum", "en", { problem: { title: "Two Sum" } });
  assert.equal(store.get("leetcode.com", "two-sum", "en").state, "want");
  assert.equal(store.get("leetcode.com", "two-sum", "en").problem.title, "Two Sum");
});

test("keys isolate site and locale", () => {
  const store = createStudyStore(fakeStorage());
  store.setState("leetcode.com", "two-sum", "en", "doing");
  store.setState("leetcode.cn", "two-sum", "zh-CN", "done");
  assert.equal(store.get("leetcode.com", "two-sum", "en").state, "doing");
  assert.equal(store.get("leetcode.cn", "two-sum", "zh-CN").state, "done");
});

test("invalid state is rejected", () => {
  const store = createStudyStore(fakeStorage());
  assert.equal(store.setState("leetcode.com", "two-sum", "en", "nope"), null);
  assert.equal(store.get("leetcode.com", "two-sum", "en"), null);
});

test("favorite is independent from state", () => {
  const store = createStudyStore(fakeStorage());
  store.setState("leetcode.com", "two-sum", "en", "done");
  store.toggleFavorite("leetcode.com", "two-sum", "en");
  const item = store.get("leetcode.com", "two-sum", "en");
  assert.equal(item.favorite, true);
  assert.equal(item.state, "done");
  store.toggleFavorite("leetcode.com", "two-sum", "en");
  assert.equal(store.get("leetcode.com", "two-sum", "en").favorite, false);
});

test("note is stored and truncated", () => {
  const store = createStudyStore(fakeStorage());
  store.setState("leetcode.com", "two-sum", "en", "want");
  store.setNote("leetcode.com", "two-sum", "en", "用哈希表");
  assert.equal(store.get("leetcode.com", "two-sum", "en").note, "用哈希表");
  store.setNote("leetcode.com", "two-sum", "en", "x".repeat(5000));
  assert.equal(store.get("leetcode.com", "two-sum", "en").note.length, 2000);
});

test("remove deletes only the target item", () => {
  const store = createStudyStore(fakeStorage());
  store.setState("leetcode.com", "a", "en", "want");
  store.setState("leetcode.com", "b", "en", "want");
  store.remove("leetcode.com", "a", "en");
  assert.equal(store.get("leetcode.com", "a", "en"), null);
  assert.ok(store.get("leetcode.com", "b", "en"));
});

test("import adds and overwrites with counts", () => {
  const store = createStudyStore(fakeStorage());
  store.setState("leetcode.com", "two-sum", "en", "doing");
  const payload = JSON.stringify({
    version: 1,
    items: {
      "leetcode.com:two-sum:en": { state: "done", favorite: false, note: "", updated_at: "2026-11-01T00:00:00Z" },
      "leetcode.com:add-two-numbers:en": { state: "want", favorite: true, note: "链表", updated_at: "2026-11-02T00:00:00Z" },
    },
  });
  const result = store.importJson(payload);
  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  assert.equal(result.overwritten, 1);
  assert.equal(store.get("leetcode.com", "two-sum", "en").state, "done");
  assert.equal(store.get("leetcode.com", "add-two-numbers", "en").favorite, true);
});

test("import rejects broken json, bad version, bad keys, bad items", () => {
  const store = createStudyStore(fakeStorage());
  assert.equal(store.importJson("{nope").ok, false);
  assert.equal(store.importJson('{"version":2,"items":{}}').ok, false);
  assert.equal(store.importJson('{"version":1,"items":[]}').ok, false);
  const result = store.importJson(JSON.stringify({
    version: 1,
    items: {
      "bad key": { state: "want" },
      "leetcode.com:two-sum:en": { state: "invalid" },
      "leetcode.com:two-sum:fr": { state: "want" },
      "leetcode.com:add-two-numbers:en": { state: "done" },
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  assert.equal(result.invalid, 3);
});

test("preflight counts conflicts without applying", () => {
  const store = createStudyStore(fakeStorage());
  store.setState("leetcode.com", "two-sum", "en", "doing");
  const parsed = store.parseImport(JSON.stringify({
    version: 1,
    items: { "leetcode.com:two-sum:en": { state: "done" } },
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.invalid, 0);
  assert.equal(store.get("leetcode.com", "two-sum", "en").state, "doing");
});

test("export roundtrip preserves items", () => {
  const storage = fakeStorage();
  const store = createStudyStore(storage);
  store.setState("leetcode.com", "two-sum", "en", "want");
  store.setNote("leetcode.com", "two-sum", "en", "哈希表");
  const json = store.exportJson();
  const other = createStudyStore(fakeStorage());
  const result = other.importJson(json);
  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  assert.deepEqual(other.get("leetcode.com", "two-sum", "en").note, "哈希表");
});

test("clear empties storage and survives corrupted data", () => {
  const storage = fakeStorage();
  storage.setItem("qb.study", "not json at all");
  const store = createStudyStore(storage);
  assert.deepEqual(store.all(), {});
  store.setState("leetcode.com", "two-sum", "en", "want");
  store.clear();
  assert.equal(storage.getItem("qb.study"), null);
  assert.deepEqual(store.all(), {});
});

test("buildTagProgress aggregates totals and done per tag", () => {
  const entries = [
    { key: "k1", item: { state: "done" } },
    { key: "k2", item: { state: "doing" } },
    { key: "k3", item: { state: "done" } },
    { key: "k4", item: { state: "want" } },
  ];
  const tagsByKey = {
    k1: ["array", "hash-table"],
    k2: ["array"],
    k3: ["array", "two-pointers"],
  };
  const progress = buildTagProgress(entries, tagsByKey);
  assert.deepEqual(progress, [
    { tag: "array", total: 3, done: 2 },
    { tag: "hash-table", total: 1, done: 1 },
    { tag: "two-pointers", total: 1, done: 1 },
  ]);
});

test("buildHeatmap aligns weeks to Sunday and counts per day", () => {
  const items = {
    a: { updated_at: "2026-11-12T08:00:00Z" },
    b: { updated_at: "2026-11-12T09:00:00Z" },
    c: { updated_at: "2026-11-12T10:00:00Z" },
    d: { updated_at: "2026-11-13T00:00:00Z" },
    bad: { updated_at: "not-a-date" },
  };
  const today = new Date("2026-11-13T12:00:00Z"); // 周五
  const cells = buildHeatmap(items, today, 4);
  assert.equal(cells.length, 27); // 4 周起点对齐周日，最后一周截至今天（不完整）
  assert.equal(cells[0].date, "2026-10-18"); // 周日
  assert.equal(cells[cells.length - 1].date, "2026-11-13");
  const nov12 = cells.find((c) => c.date === "2026-11-12");
  assert.equal(nov12.count, 3);
  const empty = cells.find((c) => c.date === "2026-11-10");
  assert.equal(empty.count, 0);
});

test("buildAnkiCsv escapes quotes and carries tags", () => {
  const entries = [
    {
      key: "leetcode.com:two-sum:en",
      site: "leetcode.com",
      slug: "two-sum",
      item: {
        state: "done",
        note: '用 "哈希表"，一次遍历',
        updated_at: "2026-11-01T00:00:00Z",
        problem: {
          display_id: "1", title: "Two Sum", difficulty: "easy",
          category: "algorithm", is_paid_only: 0,
        },
      },
    },
  ];
  const csv = buildAnkiCsv(entries, {
    "leetcode.com:two-sum:en": ["array", "hash-table"],
  });
  assert.ok(csv.includes("#separator:Comma"));
  assert.ok(csv.includes("#tags column:3"));
  assert.ok(csv.includes('"#1 Two Sum"'));
  assert.ok(csv.includes('""哈希表""'));
  assert.ok(csv.includes("难度：简单"));
  assert.ok(csv.includes('"qb done easy algorithm array hash-table"'));
  assert.ok(csv.includes("https://leetcode.com/problems/two-sum/"));
});

test("buildAnkiCsv sorts by display id", () => {
  const mk = (id, slug) => ({
    key: `leetcode.com:${slug}:en`,
    item: { state: "want", problem: { display_id: id, title: slug } },
  });
  const csv = buildAnkiCsv([mk("10", "b"), mk("2", "a")], {});
  const i2 = csv.indexOf('"#2 ');
  const i10 = csv.indexOf('"#10 ');
  assert.ok(i2 !== -1 && i10 !== -1 && i2 < i10);
});

if (failures) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log("all study tests passed");
