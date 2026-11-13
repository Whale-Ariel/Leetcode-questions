import { el } from "../api.js?v=25";
import { hljsLang } from "../highlight.js?v=25";
import {
  runCode,
  analyzeTemplate,
  resolveCallTarget,
  compareOutput,
  normalizeOutput,
  runSql,
} from "../runner.js?v=25";

const RUNNABLE = { javascript: "javascript", python: "python", python3: "python", sql: "sql" };
const LANG_LABELS = {
  c: "C", cpp: "C++", csharp: "C#", dart: "Dart", elixir: "Elixir", erlang: "Erlang",
  golang: "Go", java: "Java", javascript: "JavaScript", kotlin: "Kotlin", php: "PHP",
  python: "Python", python3: "Python3", racket: "Racket", ruby: "Ruby", rust: "Rust",
  scala: "Scala", sql: "SQL", swift: "Swift", typescript: "TypeScript",
};
const FALLBACK_LANGS = ["python3", "javascript", "golang", "java", "cpp", "c"];
const SKELETONS = {
  python3: "# 在这里写解题函数\n# 测试数据请填到下面的输入框\n",
  python: "# 在这里写解题函数\n# 测试数据请填到下面的输入框\n",
  javascript: "// 在这里写解题函数\n// 测试数据请填到下面的输入框\n",
};

function loadDrafts() {
  try {
    const raw = JSON.parse(localStorage.getItem("qb.code") || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveDraft(key, text) {
  const drafts = loadDrafts();
  if (text) drafts[key] = text;
  else delete drafts[key];
  localStorage.setItem("qb.code", JSON.stringify(drafts));
}

function copyText(text, button) {
  const done = () => {
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = "复制";
    }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {});
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.append(area);
  area.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    // clipboard unavailable
  }
  area.remove();
}

export function codeEditor(data) {
  const p = data.problem;
  const c = data.content;
  const panel = el("div", "code-panel");

  const starters = data.starter_code || [];
  const languages = starters.length
    ? starters.map((s) => s.language)
    : FALLBACK_LANGS;
  const templateFor = (lang) => {
    const s = starters.find((item) => item.language === lang);
    if (s) return s.template;
    return SKELETONS[lang] || "";
  };

  const draftKeyFor = (lang) => `${p.site}:${p.slug}:${c.locale}:${lang}`;
  const isDatabase = p.category === "database";
  if (isDatabase && !languages.includes("sql")) languages.push("sql");
  let currentLang = isDatabase
    ? "sql"
    : (languages.find((lang) => RUNNABLE[lang]) || languages[0]);
  const sqlSetupKey = `${draftKeyFor("sql")}:setup`;
  const sqlQueryKey = `${draftKeyFor("sql")}:query`;

  panel.append(el("div", "code-panel-head",
    el("h2", null, "写代码"),
    el("span", "muted", "草稿自动保存在本机浏览器"),
  ));

  const toolbar = el("div", "code-toolbar");
  const langLabel = el("label", "filter-field");
  langLabel.append(el("span", "filter-label", "语言"));
  const langSelect = document.createElement("select");
  langSelect.setAttribute("aria-label", "编程语言");
  languages.forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang;
    const runnable = RUNNABLE[lang] ? " · 可运行" : " · 仅编辑";
    option.textContent = `${LANG_LABELS[lang] || lang}${runnable}`;
    langSelect.append(option);
  });
  langSelect.value = currentLang;
  langLabel.append(langSelect);

  const resetBtn = el("button", "btn btn-small", "重置为模板");
  resetBtn.type = "button";
  const copyBtn = el("button", "btn btn-small", "复制");
  copyBtn.type = "button";
  toolbar.append(langLabel, resetBtn, copyBtn);

  const editorWrap = el("div", "code-editor-wrap");
  const highlightPre = el("pre", "code-highlight");
  highlightPre.setAttribute("aria-hidden", "true");
  const highlightCode = el("code", null, "");
  highlightPre.append(highlightCode);

  const editor = document.createElement("textarea");
  editor.className = "code-editor";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "代码编辑区");
  editor.placeholder = "在这里写解题函数";
  editorWrap.append(highlightPre, editor);

  const langNote = el("p", "muted code-lang-note");

  const runRow = el("div", "code-run-row");
  const inputLabel = el("label", "filter-field code-input-field");
  inputLabel.append(el("span", "filter-label", "输入"));
  const inputSelect = document.createElement("select");
  inputSelect.setAttribute("aria-label", "选择示例输入");
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "自定义输入";
  inputSelect.append(customOption);
  data.examples.forEach((ex, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `示例 ${ex.ordinal || index + 1}`;
    inputSelect.append(option);
  });
  inputLabel.append(inputSelect);

  const inputArea = document.createElement("textarea");
  inputArea.className = "code-input";
  inputArea.rows = 2;
  inputArea.spellcheck = false;
  inputArea.setAttribute("aria-label", "输入内容");

  const runBtn = el("button", "btn btn-run", "▶ 运行");
  runBtn.type = "button";
  runRow.append(inputLabel, runBtn);

  const expectedLine = el("p", "muted code-expected");
  const outputBox = el("div", "code-output");
  outputBox.hidden = true;

  // SQL 模式（数据库题）：建表/测试数据 + 查询语句
  const sqlWrap = el("div", "sql-wrap");
  const setupField = el("div", "sql-field");
  const setupArea = document.createElement("textarea");
  setupArea.className = "code-editor sql-setup";
  setupArea.rows = 7;
  setupArea.spellcheck = false;
  setupArea.setAttribute("aria-label", "建表与测试数据");
  setupArea.placeholder = "CREATE TABLE Employee (\n  id INTEGER,\n  name TEXT\n);\nINSERT INTO Employee VALUES (1, 'Alice');";
  setupField.append(
    el("span", "filter-label", "建表与测试数据（CREATE / INSERT）"),
    setupArea,
  );
  const queryField = el("div", "sql-field");
  const queryWrap = el("div", "code-editor-wrap");
  const queryPre = el("pre", "code-highlight");
  queryPre.setAttribute("aria-hidden", "true");
  const queryCode = el("code", null, "");
  queryPre.append(queryCode);
  const queryArea = document.createElement("textarea");
  queryArea.className = "code-editor sql-query";
  queryArea.spellcheck = false;
  queryArea.setAttribute("aria-label", "查询语句");
  queryArea.placeholder = "SELECT name FROM Employee WHERE id = 1;";
  queryWrap.append(queryPre, queryArea);
  queryField.append(el("span", "filter-label", "查询语句（SELECT）"), queryWrap);
  sqlWrap.append(setupField, queryField);

  panel.append(toolbar, editorWrap, sqlWrap, langNote, runRow, inputArea, expectedLine, outputBox);

  let draftTimer = null;
  const currentDraft = () => loadDrafts()[draftKeyFor(currentLang)];
  const hasHljs = typeof hljs !== "undefined";
  if (hasHljs) editorWrap.classList.add("hljs-on");
  if (hasHljs) queryWrap.classList.add("hljs-on");

  function paintHighlight() {
    if (!hasHljs) return;
    if (currentLang === "sql") {
      queryCode.textContent = queryArea.value + "\n";
      const name = hljsLang("sql");
      queryCode.className = name ? `hljs language-${name}` : "";
      delete queryCode.dataset.highlighted;
      if (name) hljs.highlightElement(queryCode);
      return;
    }
    const name = hljsLang(currentLang);
    highlightCode.textContent = editor.value + "\n";
    if (!name) {
      highlightCode.className = "";
      return;
    }
    highlightCode.className = `hljs language-${name}`;
    delete highlightCode.dataset.highlighted;
    hljs.highlightElement(highlightCode);
  }

  function applyMode() {
    const isSql = currentLang === "sql";
    editorWrap.hidden = isSql;
    sqlWrap.hidden = !isSql;
    inputLabel.hidden = isSql;
    inputArea.hidden = isSql;
    expectedLine.hidden = isSql;
    paintHighlight();
  }

  function updateLangNote() {
    if (currentLang === "sql") {
      langNote.textContent = "SQL 在浏览器内的 sql.js（SQLite 内存库）中执行：先建表并插入示例数据，再运行查询。";
      return;
    }
    const runnable = RUNNABLE[currentLang];
    const starter = starters.find((s) => s.language === currentLang);
    if (runnable) {
      langNote.textContent = starter && starter.suspected_implementation
        ? "注意：该模板疑似完整实现而非起始模板。支持本地运行（JavaScript / Python）。"
        : `支持本地运行（${LANG_LABELS[currentLang] || currentLang}）。`;
    } else {
      langNote.textContent = "该语言暂不支持本地运行（可编辑与复制）。支持运行：JavaScript、Python。";
    }
  }

  function loadCurrent() {
    if (currentLang === "sql") {
      const drafts = loadDrafts();
      setupArea.value = drafts[sqlSetupKey] !== undefined ? drafts[sqlSetupKey] : "";
      queryArea.value = drafts[sqlQueryKey] !== undefined ? drafts[sqlQueryKey] : "";
      paintHighlight();
      return;
    }
    const draft = currentDraft();
    if (draft !== undefined && draft !== null) {
      editor.value = draft;
    } else {
      editor.value = templateFor(currentLang);
    }
    paintHighlight();
  }

  function syncInputArea() {
    const value = inputSelect.value;
    if (value === "custom") {
      inputArea.value = "";
      expectedLine.textContent = "自定义输入：运行后只展示输出，不与示例对比。";
      return;
    }
    const ex = data.examples[Number(value)];
    inputArea.value = ex && ex.input_text !== null ? ex.input_text : "";
    expectedLine.textContent = ex && ex.output_text !== null
      ? `预期输出：${ex.output_text}（仅文本对比，不等于官网判题）`
      : "该示例没有预期输出，运行后只展示输出。";
  }

  function renderResult(result) {
    outputBox.hidden = false;
    outputBox.replaceChildren();
    if (!result.ok) {
      const err = el("p", "code-error");
      err.textContent = result.error || "运行失败";
      outputBox.append(err);
      return;
    }
    const lines = [];
    if (result.stdout) lines.push(["stdout", result.stdout]);
    if (result.result !== null && result.result !== "") lines.push(["返回值", result.result]);
    if (!lines.length) lines.push(["stdout", "（无输出）"]);
    lines.forEach(([label, text]) => {
      outputBox.append(el("p", "code-output-label", label));
      const pre = el("pre", "code-output-pre");
      pre.textContent = text;
      outputBox.append(pre);
    });
    const inputValue = inputSelect.value;
    if (inputValue !== "custom") {
      const ex = data.examples[Number(inputValue)];
      const answer = result.result !== null && result.result !== ""
        ? result.result
        : result.stdout || "";
      const verdict = compareOutput(answer, ex && ex.output_text);
      if (verdict === true) {
        outputBox.append(el("p", "code-verdict code-verdict-ok", "✓ 与示例输出一致"));
      } else if (verdict === false) {
        outputBox.append(el("p", "code-verdict code-verdict-bad",
          `✗ 与示例输出不一致（预期：${normalizeOutput(ex.output_text)}）`));
      }
    }
    if (result.ms !== undefined) {
      outputBox.append(el("p", "muted code-ms", `用时 ${result.ms} ms`));
    }
  }

  function renderSqlResult(result) {
    outputBox.hidden = false;
    outputBox.replaceChildren();
    if (!result.ok) {
      outputBox.append(el("p", "code-error", result.error || "SQL 运行失败"));
      return;
    }
    if (!result.columns.length) {
      outputBox.append(el("p", "muted", "查询成功，没有返回结果集（非 SELECT 语句或空结果）。"));
    } else {
      const table = document.createElement("table");
      table.className = "sql-result";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      result.columns.forEach((col) => headRow.append(el("th", null, col)));
      thead.append(headRow);
      const tbody = document.createElement("tbody");
      result.rows.forEach((row) => {
        const tr = document.createElement("tr");
        row.forEach((cell) => {
          const isNull = cell === null || cell === undefined;
          const td = el("td", null, isNull ? "NULL" : String(cell));
          if (isNull) td.classList.add("sql-null");
          tr.append(td);
        });
        tbody.append(tr);
      });
      table.append(thead, tbody);
      const label = `返回 ${result.rowCount} 行${result.truncated ? "（仅显示前 500 行）" : ""}`;
      outputBox.append(el("p", "code-output-label", label), table);
    }
    if (result.ms !== undefined) {
      outputBox.append(el("p", "muted code-ms", `用时 ${result.ms} ms`));
    }
  }

  runBtn.addEventListener("click", async () => {
    if (currentLang === "sql") {
      const setupSql = setupArea.value;
      const querySql = queryArea.value;
      saveDraft(sqlSetupKey, setupSql);
      saveDraft(sqlQueryKey, querySql);
      outputBox.hidden = false;
      outputBox.replaceChildren(el("p", "muted code-ms", "运行中…"));
      renderSqlResult(await runSql({ setupSql, querySql }));
      return;
    }
    const code = editor.value;
    if (!code.trim()) {
      outputBox.hidden = false;
      outputBox.replaceChildren(el("p", "code-error", "代码为空，请先编写代码。"));
      return;
    }
    const runnable = RUNNABLE[currentLang];
    if (!runnable) {
      outputBox.hidden = false;
      outputBox.replaceChildren(el("p", "code-error",
        `暂不支持运行 ${LANG_LABELS[currentLang] || currentLang}。支持运行：JavaScript、Python。`));
      return;
    }
    const info = analyzeTemplate(code, currentLang);
    const target = resolveCallTarget(code, currentLang, info.name);
    if (target.error) {
      outputBox.hidden = false;
      outputBox.replaceChildren(el("p", "code-error", target.error));
      return;
    }
    saveDraft(draftKeyFor(currentLang), code);
    const inputText = inputArea.value;
    outputBox.hidden = false;
    outputBox.replaceChildren(el("p", "muted code-ms", "运行中…"));
    if (runnable === "python") {
      outputBox.append(el("p", "muted code-ms", "首次运行需要加载浏览器内的 Python 环境（约几秒）。"));
    }
    const result = await runCode({
      lang: currentLang,
      code,
      inputText,
      fnName: target.name,
      paramNames: info.name === target.name ? info.params : [],
    });
    renderResult(result);
  });

  langSelect.addEventListener("change", () => {
    if (currentLang === "sql") {
      saveDraft(sqlSetupKey, setupArea.value);
      saveDraft(sqlQueryKey, queryArea.value);
    } else {
      saveDraft(draftKeyFor(currentLang), editor.value);
    }
    currentLang = langSelect.value;
    loadCurrent();
    updateLangNote();
    applyMode();
  });

  resetBtn.addEventListener("click", () => {
    saveDraft(draftKeyFor(currentLang), "");
    if (currentLang === "sql") {
      saveDraft(sqlSetupKey, "");
      saveDraft(sqlQueryKey, "");
      setupArea.value = "";
      queryArea.value = "";
      paintHighlight();
    }
    loadCurrent();
    outputBox.hidden = true;
  });

  copyBtn.addEventListener("click", () => copyText(
    currentLang === "sql" ? queryArea.value : editor.value,
    copyBtn,
  ));

  editor.addEventListener("input", () => {
    paintHighlight();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(draftKeyFor(currentLang), editor.value), 400);
  });

  editor.addEventListener("scroll", () => {
    highlightPre.scrollTop = editor.scrollTop;
    highlightPre.scrollLeft = editor.scrollLeft;
  });

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = editor.selectionStart;
      editor.setRangeText("  ", start, editor.selectionEnd, "end");
    }
  });

  setupArea.addEventListener("input", () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(sqlSetupKey, setupArea.value), 400);
  });

  setupArea.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = setupArea.selectionStart;
      setupArea.setRangeText("  ", start, setupArea.selectionEnd, "end");
    }
  });

  queryArea.addEventListener("input", () => {
    paintHighlight();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(sqlQueryKey, queryArea.value), 400);
  });

  queryArea.addEventListener("scroll", () => {
    queryPre.scrollTop = queryArea.scrollTop;
    queryPre.scrollLeft = queryArea.scrollLeft;
  });

  queryArea.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = queryArea.selectionStart;
      queryArea.setRangeText("  ", start, queryArea.selectionEnd, "end");
    }
  });

  inputSelect.addEventListener("change", syncInputArea);

  loadCurrent();
  updateLangNote();
  applyMode();
  if (data.examples.length) {
    inputSelect.value = "0";
  }
  syncInputArea();
  return panel;
}
