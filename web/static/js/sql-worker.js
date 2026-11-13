// SQL 运行 Worker（经典 Worker + 本地打包的 sql.js，MIT 许可）
importScripts("/vendor/sql-wasm.js");

let sqlPromise = null;

function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: (file) => "/vendor/" + file });
  }
  return sqlPromise;
}

const MAX_ROWS = 500;

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== "run") return;
  const started = Date.now();
  try {
    const SQL = await getSql();
    const db = new SQL.Database();
    try {
      const setup = String(msg.setupSql || "").trim();
      if (setup) db.exec(setup);
      const query = String(msg.querySql || "").trim();
      if (!query) {
        self.postMessage({ ok: false, error: "查询语句为空，请先编写 SELECT。" });
        return;
      }
      const results = db.exec(query);
      const last = results.length ? results[results.length - 1] : null;
      const columns = last ? last.columns : [];
      const rows = (last ? last.values : []).slice(0, MAX_ROWS);
      self.postMessage({
        ok: true,
        columns,
        rows,
        rowCount: last ? last.values.length : 0,
        truncated: last ? last.values.length > MAX_ROWS : false,
        ms: Date.now() - started,
      });
    } finally {
      db.close();
    }
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
