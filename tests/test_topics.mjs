import assert from "node:assert/strict";
import { buildTopics } from "../web/static/js/topics-data.js";

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

test("buildTopics curates from summary", () => {
  const summary = {
    total: 789,
    with_examples: 733,
    by_difficulty: { easy: 129, medium: 465, hard: 195 },
    by_category: { algorithm: 538, database: 218, javascript: 30, concurrency: 3 },
    top_tags: [
      { code: "array", count: 326 },
      { code: "database", count: 218 },
    ],
  };
  const topics = buildTopics(summary);
  const ids = topics.map((t) => t.id);
  assert.ok(ids.includes("db"));
  assert.ok(ids.includes("hard"));
  assert.ok(ids.includes("examples"));
  assert.ok(ids.includes("tag-array"));
  const db = topics.find((t) => t.id === "db");
  assert.equal(db.count, 218);
  assert.ok(db.href.includes("category=database"));
  assert.ok(topics.every((t) => t.href.startsWith("#/premium?paid=1")));
});

test("buildTopics tolerates empty summary", () => {
  assert.deepEqual(buildTopics({}), []);
  assert.deepEqual(buildTopics(null), []);
});

if (failures) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log("all topics tests passed");
