import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 本地打包的 sql.js（MIT 许可）在浏览器 Worker 与 Node 下加载同一份文件
const require = createRequire(import.meta.url);
const vendorDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "web",
  "static",
  "vendor",
);
const initSqlJs = require(join(vendorDir, "sql-wasm.js"));

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL - ${name}: ${err.message}`);
  }
}

const SQL = await initSqlJs({ locateFile: (file) => join(vendorDir, file) });

function execAll(setupSql, querySql) {
  const db = new SQL.Database();
  try {
    if (setupSql.trim()) db.exec(setupSql);
    const results = db.exec(querySql);
    const last = results.length ? results[results.length - 1] : null;
    return last
      ? { columns: last.columns, rows: last.values }
      : { columns: [], rows: [] };
  } finally {
    db.close();
  }
}

await test("create, insert and select", async () => {
  const { columns, rows } = execAll(
    "CREATE TABLE t(a INTEGER, b TEXT); INSERT INTO t VALUES (1, 'x'), (2, NULL);",
    "SELECT a, b FROM t ORDER BY a;",
  );
  assert.deepEqual(columns, ["a", "b"]);
  assert.deepEqual(rows, [[1, "x"], [2, null]]);
});

await test("sqlite functions work", async () => {
  const { rows } = execAll(
    "CREATE TABLE s(v INTEGER); INSERT INTO s VALUES (3), (1), (2);",
    "SELECT COUNT(*), SUM(v), MAX(v) FROM s;",
  );
  assert.deepEqual(rows, [[3, 6, 3]]);
});

await test("join query", async () => {
  const { rows } = execAll(
    "CREATE TABLE a(id INTEGER, name TEXT); CREATE TABLE b(id INTEGER, score INTEGER);"
    + "INSERT INTO a VALUES (1, 'ann'); INSERT INTO b VALUES (1, 90);",
    "SELECT a.name, b.score FROM a JOIN b ON a.id = b.id;",
  );
  assert.deepEqual(rows, [["ann", 90]]);
});

await test("syntax error surfaces message", async () => {
  assert.throws(() => execAll("", "SELEC 1;"), /error/i);
});

await test("query without setup works", async () => {
  const { rows } = execAll("", "SELECT 1 + 1 AS two;");
  assert.deepEqual(rows, [[2]]);
});

if (failures) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log("all sql tests passed");
