// Python 运行 Worker（经典 Worker + Pyodide）
importScripts("/pyodide/pyodide.js");

let pyodidePromise = null;
let stdoutChunks = [];

const SCRIPT = `
import sys, traceback
ns = {"__builtins__": __builtins__, "__name__": "__qb_main__"}
try:
    for __qb_n, __qb_v in __qb_named:
        exec(__qb_n + " = " + __qb_v, ns)
    __qb_pos = [eval(__qb_v, ns) for __qb_v in __qb_positional]
    exec(__qb_code, ns)
    fn = None
    if __qb_fn:
        if __qb_fn in ns and callable(ns[__qb_fn]):
            fn = ns[__qb_fn]
        else:
            for v in ns.values():
                if isinstance(v, type) and getattr(v, "__module__", "") == "__qb_main__":
                    m = v.__dict__.get(__qb_fn)
                    if callable(m):
                        try:
                            fn = getattr(v(), __qb_fn)
                        except Exception:
                            fn = lambda *a, _m=m: _m(None, *a)
                        break
    if fn is None:
        cands = [v for v in ns.values()
                 if callable(v) and not isinstance(v, type)
                 and getattr(v, "__module__", "") == "__qb_main__"]
        if len(cands) == 1:
            fn = cands[0]
        elif len(cands) > 1:
            raise Exception("检测到多个函数定义，请只保留与模板同名的一个")
    if fn is None:
        raise Exception("没有找到可调用的函数")
    args = []
    pi = 0
    for p in __qb_params:
        if p in ("self", "cls"):
            continue
        if p in ns:
            args.append(ns[p])
        else:
            if pi >= len(__qb_pos):
                raise Exception("输入缺少参数：" + p)
            args.append(__qb_pos[pi])
            pi += 1
    if not args and __qb_pos:
        args = list(__qb_pos)
    result = fn(*args)
    if isinstance(result, str):
        __qb_result_str = result
    else:
        __qb_result_str = repr(result)
    __qb_ok = True
except Exception:
    __qb_ok = False
    __qb_error = traceback.format_exc()
`;

self.onmessage = async (event) => {
  const { code, named, positional, fnName, paramNames } = event.data;
  try {
    if (!pyodidePromise) {
      self.postMessage({ type: "loading" });
      pyodidePromise = loadPyodide({ indexURL: "/pyodide/" }).catch((err) => {
        pyodidePromise = null;
        throw err;
      });
    }
    const pyodide = await pyodidePromise;
    stdoutChunks = [];
    pyodide.setStdout({ batched: (s) => stdoutChunks.push(s) });
    pyodide.setStderr({ batched: (s) => stdoutChunks.push(s) });
    const g = pyodide.globals;
    g.set("__qb_code", code);
    g.set("__qb_named", named);
    g.set("__qb_positional", positional);
    g.set("__qb_fn", fnName || "");
    g.set("__qb_params", paramNames || []);
    self.postMessage({ type: "ready" });
    const t0 = performance.now();
    pyodide.runPython(SCRIPT);
    const ms = Math.round(performance.now() - t0);
    const ok = g.get("__qb_ok");
    let error = null;
    let result = "";
    if (ok) {
      result = g.get("__qb_result_str");
      pyodide.runPython("del __qb_code, __qb_named, __qb_positional, __qb_fn, __qb_params, __qb_pos, __qb_ok, __qb_result_str");
    } else {
      error = g.get("__qb_error");
      pyodide.runPython("del __qb_code, __qb_named, __qb_positional, __qb_fn, __qb_params, __qb_pos, __qb_ok, __qb_error");
    }
    self.postMessage({ ok, stdout: stdoutChunks.join(""), result, error, ms });
  } catch (err) {
    self.postMessage({
      type: "load-failed",
      error: `Python 环境加载失败：${(err && err.message) || err}`,
    });
  }
};
