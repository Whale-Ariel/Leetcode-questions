const ALLOWED_TAGS = [
  "sup", "sub", "code", "strong", "em", "b", "i", "u", "s", "br",
  "pre", "ul", "ol", "li", "p", "span", "div", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td",
];

const SAFE_URL_RE = /^(https?:\/\/)/i;
const IMG_URL_RE = /^(https?:\/\/|data:image\/)/i;

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function protectTags(text) {
  const placeholders = [];
  const tagRe = new RegExp(`</?(${ALLOWED_TAGS.join("|")})(?:\\s[^<>]*?)?/?>`, "gi");
  const safe = text.replace(tagRe, (match) => {
    const name = match.replace(/^<\//, "<").replace(/^</, "").replace(/[^a-z0-9].*$/, "").toLowerCase();
    const close = match.startsWith("</");
    const self = match.endsWith("/>");
    const token = `\u0000${placeholders.length}\u0000`;
    placeholders.push(close ? `</${name}>` : self ? `<${name}>` : `<${name}>`);
    return token;
  });
  return { safe, placeholders };
}

function restoreTags(text, placeholders) {
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);
}

function renderInline(text) {
  let out = text;
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    if (!IMG_URL_RE.test(url)) return "";
    return `<img src="${url}" alt="${alt}" loading="lazy">`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    if (!SAFE_URL_RE.test(url)) return label;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  return out;
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    const list = line.match(/^\s*([-*]|\d+[.)])\s+(.*)$/);
    if (list) {
      const ordered = /^\d+[.)]/.test(list[1]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const item = lines[i].match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1])}</li>`);
        i += 1;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      const quoted = [];
      while (i < lines.length && lines[i].trim()) {
        const q = lines[i].match(/^>\s?(.*)$/);
        if (!q) break;
        quoted.push(q[1]);
        i += 1;
      }
      out.push(`<blockquote>${renderInline(quoted.join(" "))}</blockquote>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim()) {
      const next = lines[i];
      if (/^\s*(?:[-*]|\d+[.)])\s+/.test(next) || /^>\s?/.test(next) || /^(#{1,6})\s+/.test(next)) break;
      para.push(next);
      i += 1;
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function renderMarkdown(text) {
  if (!text) return "";
  const { safe, placeholders } = protectTags(text);
  const escaped = escapeHtml(safe);
  const parts = escaped.split(/```/);
  let html = "";
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 0) {
      html += renderBlocks(parts[i].split("\n"));
    } else {
      const fence = parts[i].match(/^([\w+-]+)[ \t]*\n/);
      const body = fence ? parts[i].slice(fence[0].length) : parts[i].replace(/^\n/, "");
      const cls = fence
        ? ` class="language-${fence[1].toLowerCase().replace(/[^a-z0-9+-]/g, "")}"`
        : "";
      html += `<pre><code${cls}>${body}</code></pre>`;
    }
  }
  return restoreTags(html, placeholders);
}
