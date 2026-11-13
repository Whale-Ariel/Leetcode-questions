// 运行器：纯逻辑（可在 Node 测试）+ 浏览器 Worker 调度
export const RUN_TIMEOUT_MS = 3000;

export function normalizeQuotes(text) {
  return String(text).replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

export function splitTopLevel(text) {
  text = String(text).replace(/\r\n/g, "\n");
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[" || ch === "(" || ch === "{") depth += 1;
    else if (ch === "]" || ch === ")" || ch === "}") depth = Math.max(0, depth - 1);
    else if ((ch === "," || ch === "\n") && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

// "nums = [2,7,11,15], target = 9" -> [{name:"nums", value:"[2,7,11,15]"}, ...]
// 无名字的条目 name 为空字符串，按位置传入
export function parseAssignments(text) {
  const entries = [];
  for (const part of splitTopLevel(normalizeQuotes(text))) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      entries.push({ name: "", value: part.trim() });
      continue;
    }
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    entries.push({ name, value: part.slice(idx + 1).trim() });
  }
  return entries;
}

export function analyzeTemplate(template, lang) {
  if (!template) return { name: null, params: [] };
  if (lang === "python" || lang === "python3") {
    const m = String(template).match(/def\s+(\w+)\s*\(([^)]*)\)/);
    if (!m) return { name: null, params: [] };
    const params = m[2].split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split(":")[0].trim())
      .filter((p) => p && p !== "self" && p !== "cls");
    return { name: m[1], params };
  }
  let m = String(template).match(
    /(?:function\s+(\w+)|(?:var|let|const)\s+(\w+)\s*=\s*function)\s*\(([^)]*)\)/,
  );
  if (m) {
    return { name: m[1] || m[2], params: splitParams(m[3]) };
  }
  m = String(template).match(/(?:var|let|const)\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>/);
  if (m) return { name: m[1], params: splitParams(m[2]) };
  return { name: null, params: [] };
}

function splitParams(text) {
  return text.split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/=.*$/, "").trim());
}

export function findFunctions(code, lang) {
  const names = new Set();
  if (lang === "python" || lang === "python3") {
    const re = /^\s*def\s+(\w+)\s*\(/gm;
    let m;
    while ((m = re.exec(code))) names.add(m[1]);
  } else {
    const re = /(?:function\s+(\w+)|(?:var|let|const)\s+(\w+)\s*=\s*(?:function|\())/g;
    let m;
    while ((m = re.exec(code))) names.add(m[1] || m[2]);
  }
  return [...names];
}

export function resolveCallTarget(code, lang, templateName) {
  const fns = findFunctions(code, lang);
  if (fns.length === 0) {
    return { error: "没有找到函数定义。请保留模板中的函数，或自己定义一个函数。" };
  }
  if (templateName && fns.includes(templateName)) return { name: templateName };
  if (fns.length === 1) return { name: fns[0] };
  const shown = fns.slice(0, 5).join("、");
  return {
    error: `找到多个函数（${shown}）。请只保留一个，${templateName ? `最好与模板同名（${templateName}）` : "或用自定义输入逐个验证"}`,
  };
}

export function normalizeOutput(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim().replace(/[ \t]+$/gm, "");
}

// 返回 true 一致 / false 不一致 / null 没有预期输出可比
export function compareOutput(actual, expected) {
  if (expected === null || expected === undefined || String(expected).trim() === "") return null;
  const a = normalizeOutput(actual);
  const e = normalizeOutput(expected);
  if (a === e) return true;
  return a.replace(/\s+/g, "") === e.replace(/\s+/g, "");
}

const PYODIDE_TIMEOUT_MS = 15000;

export function runCode({ lang, code, inputText, fnName, paramNames }) {
  const isPython = lang === "python" || lang === "python3";
  const named = [];
  const positional = [];
  for (const entry of parseAssignments(inputText)) {
    if (entry.name) named.push([entry.name, entry.value]);
    else positional.push(entry.value);
  }
  return new Promise((resolve) => {
    const q = new URL(import.meta.url).search;
    const base = new URL(isPython ? "./pyodide-worker.js" : "./runner-worker.js", import.meta.url);
    base.search = q;
    let worker;
    try {
      worker = new Worker(base.href, isPython ? {} : { type: "module" });
    } catch (err) {
      resolve({ ok: false, error: `无法启动运行器：${err.message}` });
      return;
    }
    let timeout = setTimeout(
      () => {
        worker.terminate();
        resolve({
          ok: false,
          timedOut: true,
          error: isPython
            ? "运行超时。若这是首次运行，可能是 Python 环境加载失败；若代码有死循环，请检查循环条件。"
            : "运行超时（3 秒），代码可能存在死循环",
        });
      },
      isPython ? PYODIDE_TIMEOUT_MS : RUN_TIMEOUT_MS,
    );
    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === "loading") {
        // Python 环境开始加载：保持 15 秒加载宽限，等 "ready" 再收紧
        return;
      }
      if (msg.type === "ready") {
        // 环境就绪，马上执行用户代码：从此刻起只给 3 秒
        clearTimeout(timeout);
        timeout = setTimeout(
          () => {
            worker.terminate();
            resolve({ ok: false, timedOut: true, error: "运行超时（3 秒），代码可能存在死循环" });
          },
          RUN_TIMEOUT_MS,
        );
        return;
      }
      if (msg.type === "load-failed") {
        clearTimeout(timeout);
        worker.terminate();
        resolve({ ok: false, error: msg.error || "Python 环境加载失败" });
        return;
      }
      clearTimeout(timeout);
      worker.terminate();
      resolve(msg);
    };
    worker.onerror = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve({ ok: false, error: `运行器错误：${e.message || "未知"}` });
    };
    worker.postMessage({ code, named, positional, fnName, paramNames });
  });
}

export function runSql({ setupSql, querySql }) {
  return new Promise((resolve) => {
    const q = new URL(import.meta.url).search;
    const base = new URL("./sql-worker.js", import.meta.url);
    base.search = q;
    let worker;
    try {
      worker = new Worker(base.href);
    } catch (err) {
      resolve({ ok: false, error: `无法启动 SQL 运行器：${err.message}` });
      return;
    }
    let timeout = setTimeout(() => {
      worker.terminate();
      resolve({
        ok: false,
        error: "运行超时（3 秒），查询可能涉及过大的笛卡尔积或死循环。",
      });
    }, RUN_TIMEOUT_MS);
    worker.onmessage = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(e.data || { ok: false, error: "运行器返回空结果" });
    };
    worker.onerror = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve({ ok: false, error: `SQL 运行器错误：${e.message || "未知"}` });
    };
    worker.postMessage({ type: "run", setupSql, querySql });
  });
}
