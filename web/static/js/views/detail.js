import { getJSON, el } from "../api.js?v=25";
import { renderMarkdown } from "../markdown.js?v=25";
import { highlightCodeBlocks, paintCode } from "../highlight.js?v=25";
import { createStudyStore, STATE_LABELS, STUDY_STATES } from "../study.js?v=25";
import { codeEditor } from "./editor.js?v=25";
import { statementArticle } from "../statement.js?v=25";
import { getVerdict } from "../pairs.js?v=25";

const DIFFICULTY_LABELS = { easy: "简单", medium: "中等", hard: "困难" };
const CATEGORY_LABELS = {
  algorithm: "算法",
  database: "数据库",
  shell: "Shell",
  concurrency: "并发",
  javascript: "JavaScript",
  pandas: "Pandas",
};

function backToList() {
  const saved = sessionStorage.getItem("qb.listScroll");
  if (saved) {
    try {
      const { hash } = JSON.parse(saved);
      if (hash && hash.startsWith("#/problems")) {
        location.hash = hash;
        return;
      }
    } catch {
      // fall through
    }
  }
  location.hash = "#/problems";
}

function stripLock(title) {
  return (title || "").replace(/\s*🔒\s*$/, "");
}

function header(data) {
  const p = data.problem;
  const c = data.content;
  const wrap = el("div", "detail-header");
  const back = el("button", "btn back-link", "← 返回题库");
  back.type = "button";
  back.addEventListener("click", backToList);
  const titleRow = el("div", "detail-title-row");
  titleRow.append(el("h1", "detail-title", `${p.display_id ? `#${p.display_id} ` : ""}${stripLock(c.title)}`));
  const badges = el("div", "card-badges");
  badges.append(el("span", `badge badge-${p.difficulty || "unknown"}`, DIFFICULTY_LABELS[p.difficulty] || "难度未知"));
  if (p.category) badges.append(el("span", "badge", CATEGORY_LABELS[p.category] || p.category));
  if (p.is_paid_only === 1) badges.append(el("span", "badge badge-premium", "Premium"));
  badges.append(el("span", "badge badge-muted", `${p.site} · ${c.locale}`));
  titleRow.append(badges);
  const metaRow = el("div", "detail-meta-row");
  metaRow.append(el("span", "muted", p.slug));
  if (data.alternates.same_problem_other_locale) {
    const other = c.locale === "zh-CN" ? "en" : "zh-CN";
    const toggle = el("a", "btn btn-small", other === "zh-CN" ? "对照中文" : "English");
    toggle.href = `#/problem/${p.site}/${p.slug}?locale=${other}`;
    metaRow.append(toggle);
  }
  if (p.url) {
    const official = el("a", "btn btn-small", "↗ 原题");
    official.href = p.url;
    official.target = "_blank";
    official.rel = "noopener noreferrer";
    metaRow.append(official);
  }
  wrap.append(back, titleRow, metaRow);
  return wrap;
}

function premiumBanner(data) {
  if (data.problem.is_paid_only !== 1) return null;
  const cov = data.content.coverage;
  const banner = el("div", "premium-banner");
  banner.append(
    el("span", "badge badge-premium", "Premium 会员题"),
    el("p", null, [
      "本地快照未提供判题与题解，会员题资料来自公开来源，完整度：",
      cov.statement ? "题干✓" : "题干✗",
      " · ",
      cov.examples ? "示例✓" : "示例✗",
      " · ",
      cov.hints ? "提示✓" : "提示✗",
      " · ",
      cov.starter_code ? "模板✓" : "模板✗",
    ].join("")),
  );
  const zone = el("a", null, "前往 Premium 会员题专区 →");
  zone.href = "#/premium";
  banner.append(zone);
  banner.append(el("p", "premium-banner-note",
    "数据质量页中的 paid_statement_absent 记录指向 leetcode-api 缓存里的空正文；当前展示的是 doocs 快照正文。"));
  return banner;
}

function statementTab(data) {
  const c = data.content;
  const wrap = el("div", "tab-pane");
  if (!c.coverage.statement) {
    wrap.append(el("p", "muted", "来源快照未提供该题题干，可点击右上角 ↗ 原题 前往 LeetCode 查看。"));
    return wrap;
  }
  wrap.append(statementArticle(c.statement_markdown));
  if (c.constraints.length) {
    const details = el("details", "detail-block");
    details.append(el("summary", null, `约束条件 (${c.constraints.length})`));
    const list = el("ul", "constraint-list");
    c.constraints.forEach((item) => {
      const li = el("li");
      li.innerHTML = renderMarkdown(item);
      highlightCodeBlocks(li);
      list.append(li);
    });
    details.append(list);
    wrap.append(details);
  }
  if (c.follow_ups.length) {
    const details = el("details", "detail-block");
    details.append(el("summary", null, `进阶问题 (${c.follow_ups.length})`));
    const list = el("ul", "constraint-list");
    c.follow_ups.forEach((item) => {
      const li = el("li");
      li.innerHTML = renderMarkdown(item);
      highlightCodeBlocks(li);
      list.append(li);
    });
    details.append(list);
    wrap.append(details);
  }
  if (data.examples.length) {
    const details = el("details", "detail-block");
    details.append(el("summary", null, `结构化示例 (${data.examples.length})`));
    const list = el("div", "example-list");
    data.examples.forEach((ex) => {
      const box = el("div", "example-card");
      box.append(el("p", "example-label", `示例 ${ex.ordinal}`));
      if (ex.input_text !== null) box.append(el("p", null, ["输入：", el("code", null, ex.input_text)]));
      if (ex.output_text !== null) box.append(el("p", null, ["输出：", el("code", null, ex.output_text)]));
      if (ex.explanation) {
        const expl = el("div", "example-explanation");
        expl.innerHTML = renderMarkdown(ex.explanation);
        highlightCodeBlocks(expl);
        box.append(expl);
      }
      (ex.images || []).forEach((url) => {
        const img = el("img", "example-img");
        img.src = url;
        img.alt = "示例图片";
        img.loading = "lazy";
        box.append(img);
      });
      list.append(box);
    });
    details.append(list);
    wrap.append(details);
  }
  return wrap;
}

function hintsTab(data) {
  const wrap = el("div", "tab-pane");
  if (!data.hints.length) {
    wrap.append(el("p", "muted", "该来源未提供提示。"));
    return wrap;
  }
  const list = el("div", "hint-list");
  data.hints.forEach((hint) => {
    const item = el("details", "hint-item");
    item.append(el("summary", null, `提示 ${hint.ordinal}`));
    const body = el("div", "markdown-body hint-body");
    body.innerHTML = renderMarkdown(hint.body);
    highlightCodeBlocks(body);
    item.append(body);
    list.append(item);
  });
  wrap.append(list);
  return wrap;
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

function starterTab(data) {
  const wrap = el("div", "tab-pane");
  const starters = data.starter_code;
  if (!starters.length) {
    wrap.append(el("p", "muted", "该来源未提供代码模板。"));
    return wrap;
  }
  const controls = el("div", "starter-controls");
  const select = document.createElement("select");
  select.setAttribute("aria-label", "选择语言");
  starters.forEach((s, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = s.language_name || s.language;
    select.append(option);
  });
  const copy = el("button", "btn btn-small copy-btn", "复制");
  copy.type = "button";
  const pre = el("pre", "code-block");
  const code = el("code", null, "");
  pre.append(code);
  const note = el("p", "muted starter-note");
  let current = 0;
  const show = (index) => {
    current = index;
    const s = starters[index];
    paintCode(code, s.template, s.language);
    note.textContent = s.suspected_implementation
      ? "注意：该模板疑似完整实现而非起始模板。"
      : `语言：${s.language_name || s.language}`;
  };
  copy.addEventListener("click", () => copyText(starters[current].template, copy));
  select.addEventListener("change", () => show(Number(select.value)));
  show(0);
  controls.append(select, copy);
  wrap.append(controls, pre, note);
  return wrap;
}

function sourceTab(data) {
  const wrap = el("div", "tab-pane");
  const c = data.content;
  const prov = data.provenance;
  if (!prov.length) {
    wrap.append(el("p", "muted", "无来源记录。"));
  } else {
    const list = el("ul", "source-list");
    prov.forEach((item) => {
      const li = el("li");
      li.append(
        el("p", null, ["来源：", el("strong", null, item.source_name)]),
        el("p", null, ["路径：", el("code", null, item.repo_path)]),
        item.git_commit ? el("p", null, ["commit：", el("code", null, item.git_commit.slice(0, 12))]) : "",
        el("p", null, ["抓取时间：", el("span", null, item.retrieved_at)]),
        el("p", null, ["提取定位：", el("code", null, item.extract_locator)]),
      );
      list.append(li);
    });
    wrap.append(list);
  }
  const info = el("p", null, [
    `正文修订版 ${c.revision} · 历史版本 ${c.history_versions} 个 · 提取状态：${c.extraction_status}`,
  ]);
  wrap.append(info);
  if (data.issues.length) {
    const details = el("details", "detail-block");
    details.append(el("summary", null, `数据问题 (${data.issues.length})`));
    const list = el("ul", "issue-list");
    data.issues.forEach((issue) => {
      const li = el("li");
      li.append(
        el("span", "badge badge-muted", issue.issue_type),
        el("span", "muted", ` ${issue.severity}`),
      );
      if (issue.message) li.append(el("p", "muted", issue.message));
      list.append(li);
    });
    details.append(list);
    wrap.append(details);
  }
  return wrap;
}

function studyBlock(data) {
  const p = data.problem;
  const c = data.content;
  const store = createStudyStore(localStorage);
  const block = el("div", "side-block study-block");
  block.append(el("h2", null, "学习清单"));
  const problemMeta = {
    display_id: p.display_id,
    title: stripLock(c.title),
    difficulty: p.difficulty,
    category: p.category,
    is_paid_only: p.is_paid_only,
  };

  function render() {
    block.replaceChildren(el("h2", null, "学习清单"));
    const item = store.get(p.site, p.slug, c.locale);

    const favBtn = el("button", `btn btn-small study-btn${item && item.favorite ? " study-on" : ""}`,
      item && item.favorite ? "★ 已收藏" : "☆ 收藏");
    favBtn.setAttribute("aria-pressed", String(Boolean(item && item.favorite)));
    favBtn.addEventListener("click", () => {
      if (!item) store.setState(p.site, p.slug, c.locale, "want");
      store.toggleFavorite(p.site, p.slug, c.locale);
      if (!store.get(p.site, p.slug, c.locale).problem) {
        store.update(p.site, p.slug, c.locale, { problem: problemMeta });
      }
      render();
    });
    block.append(favBtn);

    const stateRow = el("div", "study-states");
    STUDY_STATES.forEach((state) => {
      const active = item && item.state === state;
      const btn = el("button", `btn btn-small study-btn${active ? " study-on" : ""}`, STATE_LABELS[state]);
      btn.setAttribute("aria-pressed", String(Boolean(active)));
      btn.addEventListener("click", () => {
        store.setState(p.site, p.slug, c.locale, state);
        if (!store.get(p.site, p.slug, c.locale).problem) {
          store.update(p.site, p.slug, c.locale, { problem: problemMeta });
        }
        render();
      });
      stateRow.append(btn);
    });
    block.append(stateRow);

    const noteArea = document.createElement("textarea");
    noteArea.className = "study-note";
    noteArea.rows = 3;
    noteArea.placeholder = "写点自己的笔记（只存本地，纯文本）…";
    noteArea.setAttribute("aria-label", "本地笔记");
    noteArea.value = item && item.note ? item.note : "";
    const saveNote = el("button", "btn btn-small", "保存笔记");
    saveNote.addEventListener("click", () => {
      const text = noteArea.value.trim();
      if (!text && !item) return;
      store.setState(p.site, p.slug, c.locale, item && item.state ? item.state : "want");
      store.setNote(p.site, p.slug, c.locale, text);
      if (!store.get(p.site, p.slug, c.locale).problem) {
        store.update(p.site, p.slug, c.locale, { problem: problemMeta });
      }
      const saved = el("span", "study-saved", "已保存 ✓");
      block.append(saved);
      setTimeout(() => saved.remove(), 1500);
    });
    block.append(noteArea, saveNote);
    block.append(el("p", "muted study-hint", "仅保存在当前浏览器，不影响题目阅读"));
  }

  render();
  return block;
}

function extraBlocks(data) {
  const p = data.problem;
  const c = data.content;
  const wrap = el("div", "detail-extra");
  const tagsBlock = el("div", "side-block");
  tagsBlock.append(el("h2", null, "标签"));
  if (data.tags.length) {
    const tags = el("div", "card-tags");
    data.tags.forEach((tag) => tags.append(el("span", "tag", tag)));
    tagsBlock.append(tags);
  } else {
    tagsBlock.append(el("p", "muted", "无标签"));
  }
  const sourceBlock = el("div", "side-block");
  sourceBlock.append(el("h2", null, "来源"));
  if (data.provenance.length) {
    const names = [...new Set(data.provenance.map((item) => item.source_name))];
    sourceBlock.append(el("p", null, names.join(" + ")));
    if (data.provenance[0].retrieved_at) {
      sourceBlock.append(el("p", "muted", `抓取于 ${data.provenance[0].retrieved_at.slice(0, 10)}`));
    }
  } else {
    sourceBlock.append(el("p", "muted", "无来源记录"));
  }
  sourceBlock.append(
    el("p", "muted", `修订版 ${c.revision} · 历史 ${c.history_versions} 个`),
  );
  const linksBlock = el("div", "side-block");
  linksBlock.append(el("h2", null, "关联"));
  if (data.alternates.other_site_same_display_id) {
    const other = data.alternates.other_site_same_display_id;
    const link = el("a", null, `同一题号在 ${other} →`);
    link.href = `#/problem/${other}/${p.slug}?locale=${other === "leetcode.cn" ? "zh-CN" : "en"}`;
    linksBlock.append(el("p", null, link));
    if (p.display_id) {
      const compareLink = el("a", null, "中英对照 →");
      compareLink.href = `#/compare/${encodeURIComponent(p.display_id)}`;
      const row = el("p", null, compareLink);
      const verdict = getVerdict(p.display_id, p.slug);
      if (verdict === "confirmed") {
        row.append(el("span", "badge badge-easy", "已核实同题"));
      } else if (verdict === "rejected") {
        row.append(el("span", "badge badge-medium", "已标记非同题"));
      } else {
        row.append(el("span", "badge badge-muted", "配对未核实"));
      }
      linksBlock.append(row);
    }
  } else {
    linksBlock.append(el("p", "muted", "无关联题目"));
  }
  if (p.url) {
    const official = el("a", null, "LeetCode 原题 ↗");
    official.href = p.url;
    official.target = "_blank";
    official.rel = "noopener noreferrer";
    linksBlock.append(el("p", null, official));
  }
  wrap.append(tagsBlock, sourceBlock, linksBlock);
  return wrap;
}

function versionsTab(data) {
  const wrap = el("div", "version-tab-body");
  const p = data.problem;
  const c = data.content;
  const currentSource = data.provenance.length
    ? [...new Set(data.provenance.map((item) => item.source_name))].join(" + ")
    : "未知来源";
  wrap.append(el("p", "muted",
    `同一题的不同来源快照各保留一份，当前展示 revision ${c.revision}（来源：${currentSource}）。点击版本查看其完整题干。`));
  const list = el("div", "version-list");
  const viewer = el("div", "version-viewer",
    el("p", "muted", "尚未选择版本。"));
  wrap.append(list, viewer);
  const base = `/api/problems/${encodeURIComponent(p.site)}/${encodeURIComponent(p.slug)}/versions`;
  let activeBtn = null;

  async function showVersion(id) {
    viewer.replaceChildren(el("p", "muted", "加载中…"));
    try {
      const res = await getJSON(base, { locale: c.locale, version: id });
      const v = res.version;
      const box = el("div", "version-detail");
      const head = el("div", "version-head");
      head.append(el("h3", "version-title", v.title || stripLock(c.title)));
      const badges = el("div", "card-badges");
      badges.append(el("span", `badge ${v.is_current ? "badge-current" : "badge-muted"}`,
        v.is_current ? "当前展示" : "历史快照"));
      if (v.revision !== null && v.revision !== undefined) {
        badges.append(el("span", "badge badge-muted", `revision ${v.revision}`));
      }
      const sourceNames = [...new Set(v.provenance.map((item) => item.source_name))];
      if (sourceNames.length) {
        badges.append(el("span", "badge badge-muted", `来源 ${sourceNames.join(" + ")}`));
      }
      head.append(badges);
      box.append(head);
      if (v.statement_markdown && v.statement_markdown.trim()) {
        box.append(statementArticle(v.statement_markdown));
      } else {
        box.append(el("p", "muted", "该来源版本没有正文。"));
      }
      if (v.examples.length) {
        box.append(el("p", "muted", `该版本附带结构化示例 ${v.examples.length} 条。`));
      }
      viewer.replaceChildren(box);
    } catch (err) {
      viewer.replaceChildren(el("p", "error", `加载版本内容失败：${err.message}`));
    }
  }

  getJSON(base, { locale: c.locale }).then((res) => {
    const versions = res.versions;
    if (versions.length <= 1) {
      list.append(el("p", "muted", "该题只有一个来源版本。"));
      return;
    }
    versions.forEach((v) => {
      const label = [
        v.source_name || "未知来源",
        `${v.statement_chars || 0} 字符`,
        v.is_current ? "当前" : "历史",
      ].join(" · ");
      const btn = el("button", `btn btn-small version-btn${v.is_current ? " version-current" : ""}`, label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (activeBtn) activeBtn.classList.remove("active");
        btn.classList.add("active");
        activeBtn = btn;
        showVersion(v.id);
      });
      list.append(btn);
    });
  }).catch((err) => {
    list.replaceChildren(el("p", "error", `加载版本列表失败：${err.message}`));
  });
  return wrap;
}

function tabbed(data) {
  const tabs = [
    { id: "statement", label: "题目", build: () => statementTab(data) },
    { id: "hints", label: `提示 (${data.hints.length})`, build: () => hintsTab(data) },
    { id: "starter", label: `代码模板 (${data.starter_code.length})`, build: () => starterTab(data) },
    { id: "source", label: "来源", build: () => sourceTab(data) },
  ];
  if (data.content.history_versions > 1) {
    tabs.push({
      id: "versions",
      label: `版本 (${data.content.history_versions})`,
      lazy: true,
      build: () => versionsTab(data),
    });
  }
  const wrap = el("div", "tabs");
  const bar = el("div", "tab-bar");
  const panes = el("div", "tab-panes");
  const byId = {};
  const activate = (tab, pane) => {
    bar.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    Object.values(byId).forEach((p) => p.classList.remove("active"));
    if (tab.lazy && !pane.dataset.built) {
      pane.dataset.built = "1";
      pane.replaceChildren(tab.build());
    }
    pane.classList.add("active");
  };
  tabs.forEach((tab, index) => {
    const btn = el("button", `tab-btn${index === 0 ? " active" : ""}`, tab.label);
    btn.type = "button";
    btn.addEventListener("click", () => activate(tab, byId[tab.id]));
    bar.append(btn);
    const pane = tab.lazy ? el("div", "tab-pane") : tab.build();
    if (index === 0) {
      pane.classList.add("active");
      if (tab.lazy && !pane.dataset.built) {
        pane.dataset.built = "1";
        pane.replaceChildren(tab.build());
      }
    }
    byId[tab.id] = pane;
    panes.append(pane);
  });
  wrap.append(bar, panes);
  return wrap;
}

export async function renderDetail(params) {
  const app = document.getElementById("app");
  const site = params.get("site");
  const slug = params.get("slug");
  const locale = params.get("locale") || "";
  app.replaceChildren(el("p", "muted", "加载中…"));
  let data;
  try {
    data = await getJSON(`/api/problems/${encodeURIComponent(site)}/${encodeURIComponent(slug)}`, { locale });
  } catch (err) {
    app.replaceChildren();
    const box = el("div", "empty-state");
    box.append(
      el("p", null, "无法加载题目详情"),
      el("p", "muted", `${err.message}（题目可能不存在，或该语言版本未收录）`),
      el("button", "btn", "← 返回题库"),
    );
    box.querySelector("button").addEventListener("click", backToList);
    app.append(box);
    return;
  }
  const container = el("div", "detail-layout");
  const main = el("div", "detail-main");
  const banner = premiumBanner(data);
  if (banner) main.append(banner);
  main.append(tabbed(data), extraBlocks(data));
  const code = el("div", "detail-code");
  code.append(codeEditor(data), studyBlock(data));
  container.append(main, code);
  app.replaceChildren();
  app.append(header(data), container);
  document.title = `${data.problem.display_id ? `#${data.problem.display_id} ` : ""}${stripLock(data.content.title)} · LeetCode 题库`;
}
