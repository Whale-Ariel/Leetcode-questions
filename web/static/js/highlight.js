const LANG_MAP = {
  python3: "python",
  python: "python",
  pythondata: "python",
  golang: "go",
  mysql: "sql",
  mssql: "sql",
  postgresql: "sql",
  oraclesql: "sql",
  racket: "lisp",
};

export function hljsLang(lang) {
  if (!lang || typeof hljs === "undefined") return "";
  const mapped = LANG_MAP[lang] || lang;
  return hljs.getLanguage(mapped) ? mapped : "";
}

export function highlightCodeBlocks(root) {
  if (!root || typeof hljs === "undefined") return;
  root.querySelectorAll("pre code").forEach((block) => {
    if (!/language-[\w+-]/.test(block.className || "")) return;
    delete block.dataset.highlighted;
    hljs.highlightElement(block);
  });
}

export function paintCode(codeEl, text, lang) {
  codeEl.textContent = text;
  if (typeof hljs === "undefined") return;
  const name = hljsLang(lang);
  codeEl.className = name ? `hljs language-${name}` : "hljs";
  delete codeEl.dataset.highlighted;
  hljs.highlightElement(codeEl);
}
