export async function getJSON(path, params = {}, signal = null) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
    } else if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  // 传字符串而非 URL 对象：部分嵌入环境（如 IDE 预览）会代理 fetch 并做
  // 结构化克隆，URL 对象无法克隆会抛 "URL object could not be cloned"
  const res = await fetch(url.href, { headers: { Accept: "application/json" }, signal });
  return handleResponse(res);
}

export async function postJSON(path, body) {
  // 传字符串而非 URL 对象，原因同上
  const res = await fetch(new URL(path, window.location.origin).href, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body || {}),
  });
  return handleResponse(res);
}

async function handleResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = data && data.error ? data.error.message : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

function flattenChildren(items) {
  return items.flatMap((child) => (Array.isArray(child) ? flattenChildren(child) : child));
}

export function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of flattenChildren(children)) {
    if (child !== undefined && child !== null) node.append(child);
  }
  return node;
}
