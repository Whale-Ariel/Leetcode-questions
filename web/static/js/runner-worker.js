// JavaScript 运行 Worker（模块 Worker）
function format(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pyToJs(value) {
  return String(value)
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

function parseValue(raw) {
  try {
    return JSON.parse(pyToJs(raw));
  } catch {
    return raw;
  }
}

self.onmessage = (event) => {
  const { code, named, positional, fnName, paramNames } = event.data;
  const started = performance.now();
  try {
    const logs = [];
    const consoleProxy = {
      log: (...args) => logs.push(args.map(format).join(" ")),
      info: (...args) => logs.push(args.map(format).join(" ")),
      warn: (...args) => logs.push(args.map(format).join(" ")),
      error: (...args) => logs.push(args.map(format).join(" ")),
    };
    const namedObj = {};
    for (const [name, value] of named) namedObj[name] = parseValue(value);
    const pos = positional.map(parseValue);
    const factory = new Function(
      "console",
      `"use strict";\n${code}\n;return typeof ${fnName} !== "undefined" ? ${fnName} : null;`,
    );
    const fn = factory(consoleProxy);
    if (typeof fn !== "function") {
      throw new Error(`没有找到函数 ${fnName}。请保留模板中的函数名，或先在输入区用自定义输入验证。`);
    }
    const args = (paramNames || []).map((name) => (name in namedObj ? namedObj[name] : pos.shift()));
    if (!args.length && pos.length) args.push(...pos);
    const result = fn(...args);
    self.postMessage({
      ok: true,
      stdout: logs.join("\n"),
      result: result === undefined ? "" : format(result),
      ms: Math.round(performance.now() - started),
    });
  } catch (err) {
    const msg = String((err && err.message) || err);
    self.postMessage({
      ok: false,
      error: err instanceof SyntaxError ? `代码有语法错误：${msg}` : msg,
      ms: Math.round(performance.now() - started),
    });
  }
};
