export function parseHash() {
  const raw = location.hash.slice(1) || "/problems";
  const [path, queryString] = raw.split("?");
  return { path, params: new URLSearchParams(queryString || "") };
}

export function navigate(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item) => qs.append(key, item));
    } else if (value !== null && value !== undefined && value !== "") {
      qs.set(key, value);
    }
  }
  location.hash = qs.toString() ? `${path}?${qs}` : path;
}

function matchPattern(path, pattern) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function startRouter(routes, fallback) {
  async function render() {
    const { path, params } = parseHash();
    let route = null;
    let patternParams = {};
    for (const [pattern, handler] of Object.entries(routes)) {
      if (pattern.includes(":")) {
        const matched = matchPattern(path, pattern);
        if (matched) {
          route = handler;
          patternParams = matched;
          break;
        }
      } else if (pattern === path) {
        route = handler;
        break;
      }
    }
    if (!route) route = fallback;
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patternParams)) {
      if (!merged.has(key)) merged.set(key, value);
    }
    try {
      await route(merged);
    } catch (err) {
      const app = document.getElementById("app");
      app.replaceChildren();
      const box = document.createElement("p");
      box.className = "error";
      box.textContent = `页面加载失败：${err.message}`;
      app.append(box);
    }
  }
  window.addEventListener("hashchange", render);
  return render;
}
