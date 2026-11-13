# LeetCode 题库本地网页版 · 开发方案

- 文档版本：v1.1（草案）
- 编写日期：2026-11-10
- 目标读者：项目作者 / 前端初学者
- 前置约束：**只读数据库，不改动 `db/question-bank.sqlite` 和现有表结构；不引入 pip 依赖；不把 85MB 数据整体发给浏览器。**
- v1.1 变更：新增 §6「会员题专区设计（A+B 方案）」，并同步更新功能范围、接口、实施计划、测试与风险。

---

## 1. 一句话目标

给现有的 8202 道题做一个**打开即用、离线可跑、能搜能筛能读**的本地网页界面。它像 LeetCode 的"题库浏览页 + 题目详情页"，并额外提供 **Premium 会员题专区 + 本地学习清单**；不含判题、提交和题解。

启动方式目标：

```bash
python -m qb.cli serve --db db/question-bank.sqlite --port 8000
# 浏览器打开 http://127.0.0.1:8000
```

---

## 2. 产品定位与设计原则

### 2.1 定位

| 用户 | 场景 | 网页要解决的问题 |
| --- | --- | --- |
| 刷题的人 | 想按难度/类别/标签找题、看题干 | 比翻 README 和敲 SQL 快得多 |
| 学数据的人 | 想看真实数据库长什么样 | 把表关系可视化、可点开看来源 |
| 项目作者 | 想检查数据质量 | 有统计页和问题清单页 |

### 2.2 五条设计原则

1. **本地优先**：服务只监听 `127.0.0.1`，不联网、无登录、无埋点。
2. **只读**：所有接口只执行 `SELECT`；写操作一律不存在。
3. **打开即题库**：不做营销首页，首页就是题目列表。
4. **诚实展示数据**：会员题没题干、类别为空、来源冲突，都明确显示原因，不假装完整。
5. **零构建**：不用 npm、不用打包器，改完刷新浏览器即可看到效果。

---

## 3. 功能范围

### 3.1 P0（第一版必须完成）

- 题目列表：分页、总数、按题号排序
- 搜索：题号（`1` 或 `#1`）、slug（`two-sum`）、标题（中英文包含匹配）
- 筛选：站点（`.com` / `.cn`）、语言（`en` / `zh-CN`）、难度、类别
- 题目详情：题干 Markdown、难度/类别/会员标记、标签、来源信息
- 示例、提示、初始代码模板（语言切换 + 复制）
- Premium 会员题：徽章、列表筛选（会员/免费/未标注）、独立专区页、专区统计
- 会员题来源说明与资料完整度提示（题干/结构化示例/提示/模板）
- 深色/浅色主题，桌面与手机自适应
- 随机一题
- 统计概览页（总量、难度分布、类别分布）

### 3.2 P1（第一版之后增强）

- 标签浏览与按标签筛选
- "搜索题干"开关（默认只搜标题/slug/题号，避免慢查询）
- 本地学习清单：想刷 / 进行中 / 已刷 / 收藏 / 笔记（`localStorage`），支持导出导入
- Premium 学习进度、随机会员题、每日会员题
- 中英对照页（按 `display_id` 并排显示，标注"配对未核实"）
- 数据质量页（浏览 `data_issue` 的 8632 条问题）
- 每日一题（按日期确定性抽取）
- 键盘快捷键：`/` 搜索、`r` 随机、`j/k` 上下选择、`Enter` 打开

### 3.3 P2（可选）

- 题干历史版本查看（`problem_content` 中 `is_current = 0` 的行）
- 数学公式渲染（KaTeX，本地引入）
- 代码语法高亮（highlight.js，本地引入）
- 导出单题 Markdown / 按筛选导出 JSON
- 纯静态导出（把子集题打包成 JSON + HTML，可放到静态托管）
- 标签关系图、学习路径推荐

### 3.4 明确不做

- 在线判题、运行用户代码、提交到 LeetCode
- 题解、答案、复杂度分析（库里本来就没有）
- 用户账号、云同步、评论
- 网站自身的订阅、支付、会员等级和内容权限
- 对已有会员题题干做模糊、遮挡或假解锁
- 抓取会员题正文
- 修改数据库或重新运行导入流水线
- 把 85MB 数据库或全部题干一次性塞进前端

---

## 4. 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| Web 服务 | Python 标准库 `http.server.ThreadingHTTPServer` | 与项目"只用标准库"的约束一致，零安装 |
| 数据访问 | `sqlite3` 只读连接（`mode=ro` + `query_only`） | 不复制数据、不会误写，直接复用现有索引 |
| 前端 | 原生 HTML + CSS + ES Modules | 无构建步骤，初学者可读可改 |
| Markdown | `marked` + `DOMPurify`（各一个文件，本地 vendored） | 题干是 Markdown 且属于不可信文本，必须渲染后消毒 |
| 路由 | Hash 路由（`#/problem/...`） | 不需要服务端 rewrite，刷新/分享链接不会 404 |
| 状态 | 单个 `state` 对象 + URL 查询参数 | 筛选条件可分享、可前进后退 |
| 本地数据 | `localStorage` | 收藏/笔记无需后端和账号 |
| 测试 | `unittest` + `urllib.request`；UI 用浏览器人工/自动化走查 | 标准库即可，无额外依赖 |

**被否决的方案：**

- React/Vite：需要 Node、依赖和构建产物，违背"零依赖离线"目标。
- Flask/FastAPI：需要 `pip install`。
- 纯静态前端直接读 85MB SQLite：浏览器端 SQLite WASM 体积大、加载慢，且要额外处理 CORS。
- GitHub Pages 直接部署：Python 服务跑不了；且公开转载题干有版权风险（见 §13）。

---

## 5. 信息架构与页面原型

### 5.1 路由

```text
#/problems?q=&site=&locale=&difficulty=&category=&tag=&paid=&statement=&sort=&page=
#/premium?q=&difficulty=&category=&tag=&has_examples=&sort=&page=
#/problem/{site}/{slug}?locale=en
#/compare/{display_id}
#/stats
#/issues?type=&severity=&page=
#/mine
```

设计约定：

- 所有筛选条件都写进 URL，刷新不丢状态。
- 默认站点 `leetcode.com`、默认语言 `en`；选 `.cn` 时自动切到 `zh-CN`。
- 会员筛选参数 `paid` 取值为 `1`（会员）、`0`（免费）、`unknown`（未标注）。
- 专区页固定 `site=leetcode.com`，语言默认 `en`。
- 详情页的"返回"保留来源列表的筛选和滚动位置（`sessionStorage` 记录）。

### 5.2 题库列表页（首页）

```text
┌────────────────────────────────────────────────────────────────────┐
│  ◇ LeetCode 题库    题库   统计   数据质量   我的      [随机] [☾]  │
├──────────────┬─────────────────────────────────────────────────────┤
│ 搜索 [two-sum…]│ 共 8,202 题 · 当前筛选 646 题      排序 [题号 ▾]   │
│              │ ┌─────────────────────────────────────────────────┐ │
│ 站点         │ │ #1  Two Sum                    [简单] [算法]     │ │
│ ● 全部       │ │ two-sum · en · leetcode.com                     │ │
│ ○ leetcode.com│ │ 题干 1,252 字符 · 模板 4 种                     │ │
│ ○ leetcode.cn│ └─────────────────────────────────────────────────┘ │
│              │ ┌─────────────────────────────────────────────────┐ │
│ 难度         │ │ #2  Add Two Numbers            [中等] [算法]     │ │
│ ☑ 简单       │ │ ...                                             │ │
│ ☑ 中等       │ └─────────────────────────────────────────────────┘ │
│ ☑ 困难       │                                                     │
│              │              [上一页] 1 2 3 … 411 [下一页]          │
│ 类别         │                                                     │
│ ☑ 数据库     │                                                     │
│              │                                                     │
│ 标签 [搜索…] │                                                     │
│ [清空筛选]   │                                                     │
└──────────────┴─────────────────────────────────────────────────────┘
```

交互细节：

- 搜索框输入 300ms 防抖；回车立即搜索。
- 搜索关键词命中题号时，列表项在标题前高亮题号。
- 难度用"颜色 + 文字"双重表达，不单靠颜色。
- 卡片显示：题号、标题、难度、类别、站点/语言、Premium 徽章、标签（最多 4 个，多出显示 `+n`）、题干/示例/模板可用状态。
- 会员题且当前正文确实为空时，卡片显示"正文未提供"小标记；当前快照的 789 道会员题都有正文，不显示该标记。
- 无结果时给出可操作建议：清空筛选、切换站点、检查中文关键词。

### 5.3 题目详情页

```text
┌────────────────────────────────────────────────────────────────────┐
│ ← 返回题库        #1 Two Sum      [简单] [算法] [会员?]             │
│ leetcode.com · en · two-sum      [收藏] [标记已做] [对照中文] [↗]  │
├──────────────────────────────────────────────┬─────────────────────┤
│ 题目 | 提示 (3) | 代码模板 (4) | 来源          │  标签                │
│                                              │  array              │
│ You are given an array of integers `nums`…   │  hash-table         │
│                                              │                     │
│ **Example 1:**                               │  来源                │
│ Input: nums = [2,7,11,15], target = 9        │  neenza             │
│ Output: [0,1]                                │  commit abc123      │
│                                              │  抓取于 2026-11-06   │
│ 约束 / 提示 / 后续问题                        │  修订版 2            │
│                                              │  历史版本 1          │
└──────────────────────────────────────────────┴─────────────────────┘
```

标签页内容：

1. **题目**：题干 Markdown + 结构化示例（默认折叠，避免与题干内示例重复）。
2. **提示**：可折叠列表；没有提示时显示"该来源未提供提示"。
3. **代码模板**：语言下拉/标签切换，等宽代码块，一键复制。
4. **来源**：`source_name`、`repo_path`、`git_commit`、`retrieved_at`、`revision`、`extraction_status`、该题相关的 `data_issue`。

特殊状态：

| 情况 | 页面表现 |
| --- | --- |
| 会员题且正文为空 | 说明"来源快照未提供会员题正文"，提供 LeetCode 原链接，不显示空白 |
| `category` 为空 | 显示"未分类"，不猜测 |
| `difficulty` 为空 | 显示"难度未知" |
| 题干里有外链图片 | 渲染为可点击链接 + "图片需联网查看"占位，不让页面卡住 |
| 题干含 HTML/脚本 | 经 DOMPurify 清洗，绝不直接插入 |
| 中文题无类别 | 正常显示，筛选"未分类"可找到 |

### 5.4 中英对照页（P1）

```text
#1  Two Sum / 两数之和
[提示] 两侧题目由 display_id 相同推断，尚未人工核实，正文可能不同来源。

┌──────────────────────┬──────────────────────┐
│ English (.com)       │ 中文 (.cn)            │
│ You are given…       │ 给定一个整数数组…      │
│ Example 1 …          │ 示例 1 …              │
└──────────────────────┴──────────────────────┘
```

数据没有真正合并，这是**并排展示**，不是同一份正文。

### 5.5 统计页

- 顶部数字卡：题目 8,202；国际站 4,101；中文站 4,101；Premium 会员题 789；题干版本 15,216；示例 33,847；问题 8,632。
- 难度条形图：简单 1,950 / 中等 4,278 / 困难 1,974（用 CSS 条形，不引入图表库）。
- 类别分布：算法 3,683、数据库 646、JavaScript 134、Pandas 30、并发 18、Shell 8、未分类 3,683。
- 数据问题分布：`identity_field_mismatch` 4,103、`content_conflict` 2,950、`paid_statement_absent` 789、`statement_missing` 789、`difficulty_conflict` 1。
- 页脚注明统计口径："实时查询当前 SQLite 快照，生成于 2026-11-06"。

### 5.6 数据质量页（P1）

- 筛选：问题类型、严重程度、状态。
- 表格：问题类型、说明、关联题目（可点进详情）、状态、详情（折叠 JSON）。
- 用大白话解释每类问题，例如：
  - `content_conflict`：同一题不同来源正文不一致，已各留一份。
  - `identity_field_mismatch`：跨站字段对应不上，待核实。
  - `paid_statement_absent`：leetcode-api 缓存中的会员题正文为空；当前正文可能来自 doocs，页面需按 `is_current` 判断，不能一概说"缺正文"。

### 5.7 "我的"页（P1）

- 学习清单标签页：全部 / 想刷 / 进行中 / 已刷 / 收藏。
- 可按难度、类别筛选；Premium 专区显示"已标记 12 / 789"进度。
- 笔记列表与导出/导入本地数据 JSON；清空需二次确认。
- 明确提示："仅保存在当前浏览器，换浏览器/清缓存会丢失。"

---

## 6. 会员题专区设计（A+B 方案）

### 6.1 定位与命名

本节采用 **A + B** 组合：

- **A. Premium 会员题专区**：把库里的 789 道 LeetCode 会员题做成可筛选、可阅读、可统计的独立专区。
- **B. 本地学习清单**：用浏览器本地存储管理"想刷 / 进行中 / 已刷 / 收藏 / 笔记"，不涉及账号。

这里的"会员"指 **LeetCode Premium 题目**，不是网站自身的付费会员。第一版**不做**注册、登录、订阅和支付。

界面命名统一为：

- 导航入口：`Premium 会员题`
- 徽章：`Premium`
- 页面标题：`Premium 会员题`
- 避免使用"开通会员""会员权益""解锁"等容易误解的文案

专区页固定显示来源说明：

> 会员标记来自 leetcode.com 公开快照；题干由 doocs 公开快照提供。本站不抓取、不提供 LeetCode 官方会员内容，需要完整体验请支持官方。

### 6.2 数据口径（当前快照）

| 指标 | 当前值 | 说明 |
| --- | --- | --- |
| `is_paid_only = 1` | 789 道 | 全部属于 `leetcode.com` |
| `is_paid_only = 0` | 3,312 道 | 国际站免费题 |
| `is_paid_only IS NULL` | 4,101 道 | 全部是 `leetcode.cn`，表示"未标注"，不是免费 |
| 会员题有当前题干 | 789 / 789 | 当前正文均来自 doocs 快照 |
| 会员题有结构化示例 | 733 / 789 | 共 1,552 条示例 |
| 会员题有提示 | 0 | 该来源未提供 |
| 会员题有代码模板 | 0 | 该来源未提供 |
| 标题含 `🔒` | 789 / 789 | 展示时剥离，统一用徽章表达 |

难度与类别分布：

| 维度 | 会员题 | 国际站免费题 |
| --- | --- | --- |
| 简单 | 129 | 846 |
| 中等 | 465 | 1,674 |
| 困难 | 195 | 792 |
| 算法 | 538 | 3,145 |
| 数据库 | 218 | 105 |
| JavaScript | 30 | 37 |
| 并发 | 3 | 6 |
| Pandas | 0 | 15 |
| Shell | 0 | 4 |

强制口径：

1. **只认 `problem.is_paid_only`**，不从标题里的 `🔒` 推断会员状态。
2. 列表和详情必须使用 `is_current = 1` 的正文版本。
3. `leetcode.cn` 的 `NULL` 在筛选和界面中单独显示为"未标注"。
4. 展示标题时剥离末尾的 `🔒`，保留数据库原值不动。
5. `paid_statement_absent` 的 789 条问题指向 leetcode-api 的**非当前空正文**，当前正文已由 doocs 提供；详情页不得把它显示成"会员题缺少题干"。
6. 不对已存在的题干做模糊、遮挡或假解锁。

### 6.3 路由与入口

新增路由：

```text
#/premium?q=&difficulty=&category=&tag=&sort=&page=
```

五个入口：

1. 顶部导航：`Premium 会员题` + 数量角标 `789`。
2. 题库列表筛选：`全部 / 免费题 / Premium 会员题 / 未标注`，分别对应 `paid` 参数不传、`0`、`1`、`unknown`。
3. 统计页：点击"789 会员题"数字卡进入专区。
4. 题目详情：会员题顶部显示 Premium 横幅，并链接到专区。
5. 随机按钮：增加"随机一道 Premium"选项。

### 6.4 专区页结构

```text
Premium 会员题
789 道 · 全部来自 leetcode.com 快照

[说明条] 会员标记来自 leetcode.com；题干由 doocs 快照提供；
         本站不抓取、不提供 LeetCode 官方会员内容。

[难度分布] 简单 129 | 中等 465 | 困难 195
[类别分布] 算法 538 | 数据库 218 | JavaScript 30 | 并发 3

[快捷集合] 数据库 218 | 困难 195 | 有结构化示例 733 | 简单 129

[搜索] [难度] [类别] [标签] [排序]
[Premium 题目卡片列表 / 分页]
```

要求：

- 顶部统计数字由 `/api/premium/summary` 实时返回，不在前端写死。
- 快捷集合本质是带预设参数的链接，例如：
  - 数据库：`#/premium?category=database`
  - 困难：`#/premium?difficulty=hard`
  - 有结构化示例：`#/premium?has_examples=1`
- 搜索默认只搜题号、slug、标题；题干搜索仍由用户显式开启。
- 空结果时提示"清空筛选"或"查看全部会员题"。

### 6.5 列表卡片

每张会员题卡片包含：

- 金色 `Premium` 徽章。
- 题号、清洗后的标题、难度、类别。
- 站点/语言：`leetcode.com · en`。
- 标签最多 4 个，多出显示 `+n`。
- 资料状态：
  - `题干 ✓`
  - `结构化示例 ✓` 或 `结构化示例 —`
  - `提示 —`
  - `模板 —`
- 来源小字：`题干来源：doocs 快照`
- 学习清单按钮：收藏、标记状态（想刷 / 进行中 / 已刷）。

"结构化示例 —" 不能写成"无示例"，因为题干正文里可能仍包含 Example，只是没有被结构化提取。

### 6.6 详情页

在通用详情页基础上增加：

1. **Premium 横幅**：说明这是会员题、来源是公开快照、附官方链接。
2. **资料完整度卡**：题干、结构化示例、提示、代码模板四项状态。
3. **来源卡**：`source_name = doocs`、`repo_path`、`git_commit`、`retrieved_at`、`revision`。
4. **学习清单操作**：收藏、想刷 / 进行中 / 已刷、写本地笔记。
5. **相关问题说明**：如果展示 `data_issue`，对 789 条 `paid_statement_absent` 加解释："该记录指向 leetcode-api 缓存中的空正文，当前展示的是 doocs 快照正文。"

异常状态：

| 情况 | 表现 |
| --- | --- |
| 当前正文为空（未来数据可能出现） | 显示"来源快照未提供会员题正文"，给官方链接，不做假遮挡 |
| 结构化示例未提取 | 显示"结构化示例未提取，题干中可能仍含示例" |
| 提示 / 模板为空 | 显示"该来源未提供"，不留白 |
| 中文站会员状态未知 | 显示"会员状态未标注"，不显示"免费" |
| 标题带 `🔒` | 展示时剥离，徽章表达会员属性 |

### 6.7 本地学习清单（B 方案）

存储结构（`localStorage`，键名 `qb.study`）：

```json
{
  "version": 1,
  "items": {
    "leetcode.com:binary-tree-upside-down:en": {
      "state": "want",
      "favorite": true,
      "note": "先看二叉树翻转的迭代写法",
      "updated_at": "2026-11-10T12:00:00Z"
    }
  }
}
```

规则：

- 键使用 `site:slug:locale`，避免中英文互相覆盖。
- `state` 只允许 `want` / `doing` / `done` 三个值。
- `favorite` 与状态独立，可以"已刷 + 收藏"。
- 笔记只存用户自己写的短文本，不回填题解；纯文本渲染，禁止 HTML。
- 不存账号、不联网、不上传。

"我的"页增加：

- 标签页：全部 / 想刷 / 进行中 / 已刷 / 收藏。
- 可按难度、类别筛选。
- Premium 进度：`已标记 12 / 789`，用进度条或环展示。
- 导出 JSON、导入 JSON；导入前校验 `version` 和键格式。
- 冲突策略：导入文件覆盖同键记录，并提示覆盖数量。
- 清空操作二次确认。

学习清单只影响个性化展示，**不影响任何题目的可读性**。

### 6.8 "会员感"与诚实边界

允许的增强：

- 金色主题点缀，仅用于 Premium 徽章、专区标题和进度。
- 专区策展：快捷集合、随机会员题、每日会员题。
- 学习进度环、连续学习天数（可选）。
- 本地笔记与导出。

禁止的做法：

- 对已有题干做模糊、遮罩、"开通后查看"。
- 伪造"官方会员内容"或"已解锁"状态。
- 用 `🔒` 同时出现在标题和徽章里，造成重复和误导。
- 把中文站的 `NULL` 当成免费题。
- 宣传"比官方更全"或"免费解锁会员题"。

### 6.9 内容策划：会员题画像

专区页可以展示几个真实差异：

- **数据库占比**：会员题 27.6%（218 / 789），国际站免费题 3.2%（105 / 3,312）。
- **困难题占比**：会员题 24.7%（195 / 789），免费题 23.9%（792 / 3,312）。
- **结构化示例覆盖率**：92.9%（733 / 789）。
- **提示 / 模板覆盖率**：0%。

建议文案：

> 会员题并不只是"更难"：困难题比例和免费题接近，但数据库方向占比明显更高（27.6% vs 3.2%）。同时，这批会员题的提示和代码模板在快照中均未提供。

这比空泛的"会员题更优质"更可信，也能帮助用户决定要不要刷。

### 6.10 API 设计

扩展现有接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/problems?paid=1` | 会员题列表 |
| GET | `/api/problems?paid=0` | 国际站免费题 |
| GET | `/api/problems?paid=unknown` | `is_paid_only IS NULL`，当前即中文站 |
| GET | `/api/problems?paid=1&has_examples=1` | 有结构化示例的会员题 |
| GET | `/api/premium/summary` | 专区统计与来源说明 |

`/api/premium/summary` 响应示例：

```json
{
  "site": "leetcode.com",
  "total": 789,
  "with_statement": 789,
  "with_examples": 733,
  "example_count": 1552,
  "with_hints": 0,
  "with_starter_code": 0,
  "free_total": 3312,
  "unknown_total": 4101,
  "by_difficulty": {"easy": 129, "medium": 465, "hard": 195},
  "by_category": {"algorithm": 538, "database": 218, "javascript": 30, "concurrency": 3},
  "top_tags": [
    {"code": "array", "count": 326},
    {"code": "database", "count": 218},
    {"code": "hash-table", "count": 128}
  ],
  "source_note": "会员标记来自 leetcode.com；题干来自 doocs 公开快照。",
  "generated_at": "2026-11-06T12:49:09Z"
}
```

实现口径：

- 会员题：`p.is_paid_only = 1 AND c.is_current = 1`。
- 未标注：`p.is_paid_only IS NULL`。
- `free_total` 只统计 `leetcode.com` 且 `is_paid_only = 0` 的题；`unknown_total` 统计 `is_paid_only IS NULL` 的题（当前全部为中文站）。
- 有示例：`EXISTS (SELECT 1 FROM problem_example e WHERE e.content_id = c.id)`。
- 有模板：`EXISTS (SELECT 1 FROM starter_code s WHERE s.problem_id = p.id AND s.is_current = 1)`。
- 标签统计用 `COUNT(DISTINCT p.id)`，避免同一 code 多来源造成重复计数。
- 会员状态筛选只允许 `1` / `0` / `unknown`，其余返回 400。
- 仍为只读接口；学习清单不经过服务端。

### 6.11 验收标准

- [ ] `paid=1` 返回 789 条；`paid=0` 返回 3,312 条；`paid=unknown` 返回 4,101 条。
- [ ] 专区页的难度分布是 129 / 465 / 195，类别分布是 538 / 218 / 30 / 3。
- [ ] 快捷集合"数据库"返回 218 条，"困难"返回 195 条，"有结构化示例"返回 733 条。
- [ ] 卡片和详情均显示 `Premium` 徽章，标题不再出现第二个 `🔒`。
- [ ] 会员题详情显示 doocs 来源、来源说明和资料完整度。
- [ ] 789 条 `paid_statement_absent` 不会被显示成"当前题目缺少题干"。
- [ ] 中文站题目显示"会员状态未标注"，筛选"免费题"不会把它算进去。
- [ ] 学习清单在刷新、关闭浏览器后仍保留；导出后可再导入。
- [ ] "我的"页 Premium 进度只统计 `is_paid_only = 1` 的题。
- [ ] 移动端 375px 下专区页、卡片、筛选抽屉均可用。
- [ ] 全流程无账号、无支付、无内容遮挡。

### 6.12 本专区不做的事

- 不做注册、登录、订阅、支付和权限分级。
- 不锁定、模糊或隐藏已存在的题干。
- 不抓取 LeetCode 官方会员内容。
- 不修改数据库中的 `is_paid_only` 或标题。
- 不把中文站的 `NULL` 解释为免费。
- 不把公开快照包装成"官方会员权益"。

---

## 7. 数据与 API 设计

### 7.1 表到界面的映射

| 界面元素 | 来源表/字段 |
| --- | --- |
| 题号、slug、站点、原链接 | `problem_source_identity.display_id / slug / site / url` |
| 难度、类别、会员标记 | `problem.difficulty / category / is_paid_only` |
| 标题、题干、语言、版本 | `problem_content.title / statement_markdown / locale / revision / is_current` |
| 示例 | `problem_example.input_text / output_text / explanation / images_json` |
| 提示 | `problem_hint.body` |
| 代码模板 | `starter_code.language / template`（`is_current = 1`） |
| 标签、筛选 | `tag.name / tag.code` + `problem_tag` |
| 来源与版本 | `content_provenance` → `source_record`; `content_revision` |
| 问题清单 | `data_issue.issue_type / severity / status / detail_json` |
| 图片 URL | `asset.original_url` + `content_asset` |

**所有列表/详情查询都必须带 `c.is_current = 1`**，否则会命中历史正文版本。

### 7.2 API 一览

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/meta` | 站点、语言、类别、难度的枚举与总数 |
| GET | `/api/problems` | 列表 + 搜索 + 筛选 + 分页 |
| GET | `/api/problems/{site}/{slug}?locale=en` | 单题完整详情 |
| GET | `/api/tags?q=&limit=` | 标签及题目数 |
| GET | `/api/compare?display_id=1` | 中英并排数据 |
| GET | `/api/random?site=&locale=&difficulty=&category=` | 随机一题 |
| GET | `/api/daily` | 每日一题（按日期确定性） |
| GET | `/api/premium/summary` | 会员题专区统计、来源说明与快捷集合计数 |
| GET | `/api/stats` | 统计页数据 |
| GET | `/api/issues?type=&severity=&page=&page_size=` | 问题分页列表 |
| GET | `/api/health` | 服务与数据库连通性 |

统一响应约定：

- `Content-Type: application/json; charset=utf-8`，`ensure_ascii=False`。
- 出错时：`{"error": {"code": "BAD_REQUEST", "message": "..."}}`，HTTP 400/404/500。
- 分页参数：`page` 默认 1，`page_size` 默认 20，最大 100；超出自动截断。
- 所有文本按原样返回，**不在服务端做 HTML 转义**；渲染安全由前端消毒负责。

### 7.3 `GET /api/problems`

查询参数：

| 参数 | 说明 |
| --- | --- |
| `q` | 关键词：题号、slug 或标题 |
| `search_in` | `meta`（默认，题号/slug/标题）或 `all`（包含题干，较慢） |
| `site` | `leetcode.com` / `leetcode.cn` |
| `locale` | `en` / `zh-CN` |
| `difficulty` | `easy` / `medium` / `hard` |
| `category` | `algorithm` / `database` / `shell` / `concurrency` / `javascript` / `pandas` / `unknown` |
| `tag` | 标签 code，如 `hash-table` |
| `paid` | `1` 会员题 / `0` 免费题 / `unknown` 未标注（`is_paid_only IS NULL`），不传为全部 |
| `has_statement` | `1` 只看有正文的题 |
| `has_examples` | `1` 只看有结构化示例的题（会员题专区快捷集合用） |
| `sort` | `display_id`（默认）/ `difficulty` / `title` |
| `page`, `page_size` | 分页 |

响应示例：

```json
{
  "total": 646,
  "page": 1,
  "page_size": 20,
  "items": [
    {
      "site": "leetcode.com",
      "slug": "two-sum",
      "display_id": "1",
      "title": "Two Sum",
      "difficulty": "easy",
      "category": "algorithm",
      "is_paid_only": 0,
      "locale": "en",
      "statement_chars": 1252,
      "has_statement": true,
      "starter_languages": ["cpp", "java", "python3", "javascript"],
      "tags": ["array", "hash-table"]
    }
  ]
}
```

核心 SQL（参数化，Python 侧拼接条件）：

```sql
SELECT p.id, i.site, i.slug, i.display_id, p.difficulty, p.category,
       p.is_paid_only, c.locale, c.title, c.revision,
       length(c.statement_markdown) AS statement_chars
FROM problem p
JOIN problem_source_identity i ON i.problem_id = p.id
JOIN problem_content c ON c.source_identity_id = i.id AND c.is_current = 1
WHERE (:site IS NULL OR i.site = :site)
  AND (:locale IS NULL OR c.locale = :locale)
  AND (:difficulty IS NULL OR p.difficulty = :difficulty)
  AND (:category IS NULL OR p.category = :category)
  AND (:paid_mode IS NULL
       OR (:paid_mode = 'premium' AND p.is_paid_only = 1)
       OR (:paid_mode = 'free'    AND p.is_paid_only = 0)
       OR (:paid_mode = 'unknown' AND p.is_paid_only IS NULL))
  AND (:has_statement = 0 OR c.statement_markdown IS NOT NULL)
  AND (:has_examples = 0 OR EXISTS (
        SELECT 1 FROM problem_example e WHERE e.content_id = c.id))
  AND (:tag IS NULL OR EXISTS (
        SELECT 1 FROM problem_tag pt JOIN tag t ON t.id = pt.tag_id
        WHERE pt.problem_id = p.id AND t.code = :tag))
ORDER BY CAST(i.display_id AS INTEGER), i.site
LIMIT :limit OFFSET :offset;
```

细节：

- 用 `EXISTS` 过滤标签和示例，避免 JOIN 产生重复行导致 `COUNT(*)` 虚高。
- `display_id` 是 TEXT，排序必须 `CAST(... AS INTEGER)`，否则 `#10` 会排在 `#2` 前面。
- 关键词统一 `TRIM`、限制长度（≤100 字符），`LIKE` 中的 `%` `_` 用 `ESCAPE '\'` 转义。
- 标签在第二查询中按首页 20 个 `problem_id` 批量取，避免 N+1。
- 题干全文搜索第一版用 `LIKE '%q%'`；8202 行规模可接受。若实测 >500ms，再建 FTS5（见 §12）。
- `paid` 参数在服务端映射为 `paid_mode`，只接受 `premium` / `free` / `unknown` 三个值。

### 7.4 `GET /api/problems/{site}/{slug}`

```json
{
  "problem": {
    "site": "leetcode.com",
    "slug": "two-sum",
    "display_id": "1",
    "url": "https://leetcode.com/problems/two-sum/",
    "difficulty": "easy",
    "category": "algorithm",
    "is_paid_only": 0
  },
  "content": {
    "locale": "en",
    "title": "Two Sum",
    "statement_markdown": "You are given an array ...",
    "format": "markdown",
    "revision": 2,
    "extraction_status": "extracted"
  },
  "examples": [
    {"ordinal": 1, "input": "nums = [2,7,11,15], target = 9",
     "output": "[0,1]", "explanation": "Because nums[0] + nums[1] == 9 ...",
     "images": []}
  ],
  "hints": [{"ordinal": 1, "body": "A really brute force way would be ..."}],
  "starter_code": [
    {"language": "python3", "language_name": "Python3", "template": "class Solution:\n    ..."}
  ],
  "tags": ["array", "hash-table"],
  "provenance": {
    "source_name": "neenza", "repo_path": "...", "git_commit": "...",
    "retrieved_at": "2026-11-06T...", "extract_locator": "..."
  },
  "alternates": {
    "same_problem_other_locale": false,
    "other_site_same_display_id": "leetcode.cn"
  },
  "issues": [{"issue_type": "content_conflict", "severity": "info"}]
}
```

实现要点：

- 先按 `(site, slug)` 找 identity，再用 `source_identity_id + locale + is_current=1` 找正文。
- `locale` 不传时按站点给默认值：`.com → en`，`.cn → zh-CN`。
- 历史版本数用 `COUNT(*) FROM problem_content WHERE source_identity_id=? AND locale=?`。
- 相关联的问题最多返回 20 条，`detail_json` 解析后返回，避免前端二次解析。
- `is_paid_only = 1` 时返回 Premium 标记和资料完整度；展示标题由前端剥离末尾 `🔒`，数据库原值不改。
- 如果某个 `data_issue` 指向的非当前正文为空，详情页要按当前正文判断状态，不能据此显示"题目缺正文"。

### 7.5 `GET /api/stats`

```json
{
  "generated_at": "2026-11-06T12:49:09Z",
  "totals": {"problems": 8202, "com": 4101, "cn": 4101, "premium": 789,
             "contents": 15216, "examples": 33847, "issues": 8632},
  "by_difficulty": {"easy": 1950, "medium": 4278, "hard": 1974},
  "by_category": {"algorithm": 3683, "database": 646, "javascript": 134,
                  "pandas": 30, "concurrency": 18, "shell": 8, "unknown": 3683},
  "premium": {"total": 789, "with_statement": 789, "with_examples": 733,
              "example_count": 1552, "with_hints": 0, "with_starter_code": 0},
  "issues_by_type": {"identity_field_mismatch": 4103, "content_conflict": 2950,
                     "paid_statement_absent": 789, "statement_missing": 789,
                     "difficulty_conflict": 1}
}
```

全部实时 `GROUP BY` 查询，不依赖 `reports/*.json`；`generated_at` 取 `import_batch.finished_at`。会员题统计与 `/api/premium/summary` 使用同一口径，避免两个页面对不上。

### 7.6 搜索策略

| 阶段 | 方案 | 代价 |
| --- | --- | --- |
| P0 | 题号精确 + slug 精确/前缀 + 标题 `LIKE` | 简单，毫秒级 |
| P0 | 题干 `LIKE`（用户显式打开开关） | 约 100–300ms，可接受 |
| P1 | 内存 LRU 缓存最近 100 次查询 | 重复查询接近 0ms |
| P2 | 生成独立 FTS5 索引（trigram tokenizer） | 需额外构建脚本，中文子串匹配可用 |

注意：FTS5 默认 `unicode61` 对中文分词不友好（"两数之和"可能被当作一个词），必须用 `trigram`。第一版不要提前上 FTS，先测量再决定。

---

## 8. 后端实现方案

### 8.1 新增文件与改动

```text
scripts/qb/server.py          # 新增：HTTP 服务、路由、查询函数
web/static/index.html         # 新增：单页入口
web/static/css/styles.css     # 新增：全部样式与主题变量
web/static/js/app.js          # 新增：启动、路由、状态
web/static/js/api.js          # 新增：fetch 封装、取消请求、错误处理
web/static/js/router.js       # 新增：hash 路由解析
web/static/js/store.js        # 新增：学习清单/收藏/笔记
web/static/js/markdown.js     # 新增：marked + DOMPurify 管道
web/static/js/views/list.js   # 新增：列表页
web/static/js/views/premium.js # 新增：Premium 会员题专区
web/static/js/views/detail.js # 新增：详情页
web/static/js/views/stats.js  # 新增：统计页
web/static/js/views/issues.js # 新增：问题页
web/static/js/views/mine.js   # 新增：我的学习清单
web/static/vendor/marked.min.js
web/static/vendor/purify.min.js
tests/test_web.py             # 新增：API 单元测试
```

对现有文件只做两处小改：

- `scripts/qb/cli.py`：注册 `serve` 子命令，调用 `server.main()`。
- `.gitignore`：忽略 `web/cache/`（若启用 FTS 索引）。

**不修改**：数据库、迁移脚本、导入/清洗代码、README 中的数据说明。

### 8.2 只读连接

现有 `qb.db.connect()` 会 `mkdir` 并设置 WAL，属于写路径，网页服务不能复用。新增：

```python
def connect_ro(path: Path) -> sqlite3.Connection:
    uri = f"file:{path.resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn
```

每个请求开一个连接、用完关闭（SQLite 本地打开成本极低）；`ThreadingHTTPServer` 天然避免跨线程共享连接。

### 8.3 路由与处理器

```python
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # 1) /api/*  -> JSON
        # 2) 其他     -> 静态文件（限制在 web/static 内）
        # 3) 未匹配   -> 404 JSON 或 index.html
```

要求：

- 参数白名单：`site`、`locale`、`category`、`difficulty`、`sort`、`paid` 只接受枚举值，否则 400。
- `slug` 用 `^[a-z0-9-]+$` 校验；`display_id` 只允许数字。
- 静态文件路径 `resolve()` 后必须仍位于 `web/static/`，防目录穿越。
- 只允许 GET/HEAD，其余返回 405。
- 日志只打方法、路径、状态码、耗时，不打印题干。

### 8.4 响应与性能

- 静态资源：`Cache-Control: public, max-age=3600`；API：`no-store`。
- JSON > 2KB 且客户端支持时用 `gzip`。
- 列表查询后批量取标签；详情一次取齐，避免前端瀑布请求。
- 简单内存缓存：`dict` + 上限 100 条，键为规范化后的查询字符串；数据库不变，缓存无需失效。
- 首页只返回摘要（不含题干），详情才返回全文，防止首屏传输几十 MB。

### 8.5 安全响应头

```text
Content-Security-Policy: default-src 'self'; img-src 'self' https: data:;
  style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

- 默认绑定 `127.0.0.1`；提供 `--host` 但启动时打印警告。
- 不开启 CORS；页面与 API 同源。
- 无任何写接口，从设计上消除 CSRF 风险。

---

## 9. 前端实现方案

### 9.1 渲染流程

```text
hashchange → router.parse() → 更新 state → render() → fetch API
                                              ↘ 更新 URL（replaceState）
```

- 筛选变化：更新 URL → 请求 → 替换列表区域，不整页刷新。
- 输入搜索：300ms 防抖；新请求用 `AbortController` 取消旧请求。
- 列表滚动位置写入 `sessionStorage`，返回时恢复。
- 所有用户可见的标题、标签一律用 `textContent` 或转义，不拼接 HTML 字符串。

### 9.2 Markdown 安全管道

```js
const rawHtml = marked.parse(statementMarkdown, { gfm: true, breaks: false });
const clean = DOMPurify.sanitize(rawHtml, {
  ALLOWED_TAGS: ['p','br','strong','em','code','pre','ul','ol','li','blockquote',
                 'h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td',
                 'a','img','sup','sub','hr','span','div'],
  ALLOWED_ATTR: ['href','src','alt','title','class','colspan','rowspan']
});
container.innerHTML = clean; // 只插入消毒后的 HTML
```

插入后再做两件事：

1. 所有 `<a>` 加 `target="_blank" rel="noopener noreferrer"`。
2. 所有 `<img>` 改为"图片链接 + 占位说明"，因为图片文件没有入库，离线加载必然失败。

**必测用例**：题干包含 `<img src=x onerror=alert(1)>`、`<script>`、`javascript:` 链接时不得执行。

### 9.3 代码模板与复制

- 语言映射：`cpp→C++`、`python3→Python3`、`javascript→JavaScript`、`mysql→MySQL` 等。
- 复制按钮优先 `navigator.clipboard.writeText`；失败回退隐藏 `textarea + execCommand`。
- 复制成功用 `aria-live` 提示"已复制"。

### 9.4 本地学习清单与笔记

```text
qb.study → {
  "version": 1,
  "items": {
    "leetcode.com:two-sum:en": {
      "state": "want" | "doing" | "done",
      "favorite": true,
      "note": "用哈希表…",
      "updated_at": "2026-11-10T12:00:00Z"
    }
  }
}
qb.theme → "light" | "dark" | "auto"
```

- 键包含 site + slug + locale，避免中英文互相覆盖。
- 状态只有想刷 / 进行中 / 已刷；收藏与状态独立。
- "我的"页支持导出/导入 JSON；导入前校验 `version` 和键格式，冲突时以导入文件为准并提示数量。
- 不存储任何题解正文，只有用户自己写的短笔记；笔记按纯文本渲染。
- Premium 进度只统计 `is_paid_only = 1` 的题，且不把学习清单状态当作内容权限。

### 9.5 键盘与可访问性

- 语义化标签：`header/nav/main/aside/footer`，筛选用 `fieldset + legend`。
- 搜索结果数量用 `aria-live="polite"` 播报。
- 焦点样式可见；弹层/抽屉打开时焦点锁定，`Esc` 关闭。
- 难度不只靠颜色，必须带文字；对比度 ≥ 4.5:1。
- 尊重 `prefers-reduced-motion`。

---

## 10. 视觉与响应式规范

### 10.1 设计方向

工具型界面，干净、信息密度高、接近 LeetCode 但更克制。不做大色块营销页。

### 10.2 颜色变量

```css
:root {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --text: #1f2328;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #4f46e5;
  --premium: #b7791f;
  --premium-bg: #fdf6e3;
  --easy: #00a884;
  --medium: #d97706;
  --hard: #dc2626;
  --code-bg: #f3f4f6;
}
[data-theme="dark"] {
  --bg: #0f1115;
  --surface: #171a21;
  --text: #e6e8eb;
  --muted: #9aa4b2;
  --border: #2a2f3a;
  --accent: #818cf8;
  --premium: #e0b252;
  --premium-bg: #2a2415;
  --code-bg: #1e232c;
}
```

- 字体：`system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`
- 代码：`ui-monospace, "Cascadia Code", Consolas, monospace`
- 内容宽度：最大 1280px；题干阅读区最大 75 字符宽。
- 圆角 8px，卡片阴影极轻，避免"卡片套卡片"。

### 10.3 响应式断点

| 宽度 | 布局 |
| --- | --- |
| ≥ 1024px | 左侧 260px 筛选栏 + 右侧列表；详情双栏（正文 + 侧栏） |
| 768–1023px | 筛选栏改为顶部抽屉按钮；详情单栏 |
| < 768px | 单列卡片；筛选全屏抽屉；分页改为"加载更多"；代码块横向滚动 |

---

## 11. 实施计划

一个人开发，按可独立验收的小步推进：

| 阶段 | 内容 | 产出 | 预估 |
| --- | --- | --- | --- |
| M0 骨架 | `server.py` 启动、只读连接、静态文件、`/api/meta`、`/api/health` | 打开网页能看到"服务正常 + 8202 题" | 0.5 天 |
| M1 列表 | `/api/problems` + 列表页 + 筛选 + 搜索 + 分页 + URL 状态 | 首页可用，能按条件找题 | 1 天 |
| M2 详情 | `/api/problems/{site}/{slug}` + 详情页 + Markdown 安全渲染 + 示例/提示/模板 | 点进任意题能完整阅读 | 1 天 |
| M3 数据页 | `/api/stats` + 统计页 + `/api/issues` + 问题页 + 随机/每日一题 | 数据可观测 | 0.5 天 |
| M4 会员题专区 | `paid` 筛选 + `/api/premium/summary` + 专区页 + Premium 徽章 + 来源/完整度提示 | 789 道会员题可筛选、可阅读 | 1 天 |
| M5 学习清单 | `qb.study` + 收藏/想刷/进行中/已刷/笔记 + Premium 进度 + 导出导入 + 中英对照 | 日常学习可用 | 1 天 |
| M6 收尾 | 深色模式、移动端适配、API/安全测试、性能测量、错误态、README 使用说明 | 可交付 | 0.5–1 天 |

合计约 **5–6 个开发日**（初学者按 1.5–2 倍估）。

每个阶段的完成定义：功能可点通 + 无控制台报错 + 对应测试通过 + 在 375px 和 1440px 两种宽度下看过。

---

## 12. 测试与验收

### 12.1 自动化测试（`unittest`）

- **数据层**
  - 总数：`problem = 8202`、`.com = 4101`、`.cn = 4101`。
  - 每个 identity 恰有一条 `is_current = 1` 的正文。
  - 按 `two-sum` / `display_id=1` 能取到英文和中文各一条。
  - 会员口径：`is_paid_only=1` 为 789、`0` 为 3,312、`NULL` 为 4,101。
  - 789 道会员题当前正文全部非空；733 道有结构化示例；提示和代码模板均为 0。
  - 会员题分布固定为简单 129 / 中等 465 / 困难 195，类别 538 / 218 / 30 / 3。
- **API 层**
  - 正常筛选 `category=database&difficulty=easy` 返回正确总数。
  - `paid=1` 返回 789；`paid=0` 返回 3,312；`paid=unknown` 返回 4,101；非法值返回 400。
  - `/api/premium/summary` 的 `total / with_examples / example_count` 与 SQL 一致。
  - `has_examples=1` 在会员题下返回 733。
  - 分页边界：`page_size=1000` 被截断为 100；`page=0` 返回 400 或按 1 处理。
  - 非法站点/类别/难度返回 400；不存在的 slug 返回 404。
  - SQL 注入字符串 `' OR 1=1--` 只当作普通关键词，不改变结果集。
  - 路径穿越 `/../../README.md` 返回 404。
  - 响应头包含 CSP 与 `nosniff`。
- **前端安全与本地数据**
  - 用浏览器打开含 XSS 载荷的模拟题干，页面无脚本执行（用 `onerror` 计数器验证）。
  - 学习清单导出的 JSON 再导入后，条目数量、状态、笔记一致。
  - 篡改导入文件的 `version` 或键格式时，页面拒绝导入并提示，不抛异常。
- **性能**
  - 列表首屏 API < 200ms；题干搜索 < 500ms；详情 < 150ms（本机 SSD）。

### 12.2 手工验收清单

- [ ] `python -m qb.cli serve ...` 一条命令可启动，控制台打印访问地址。
- [ ] 搜索 `1`、`#1`、`two-sum`、`两数之和` 都能找到对应题。
- [ ] 切换 `.cn` 后语言自动变 `zh-CN`，中文题干正常显示，无乱码。
- [ ] 筛选"数据库 + 简单"，结果数量与 SQL 手查一致。
- [ ] 详情页完整显示题干、标签、代码模板；复制按钮可用。
- [ ] 导航进入 Premium 会员题专区，显示 789 道、来源说明和难度/类别分布。
- [ ] 专区快捷集合"数据库 218 / 困难 195 / 有结构化示例 733"数量正确。
- [ ] 会员卡片和详情都有 Premium 徽章，标题不出现第二个 `🔒`。
- [ ] 会员题详情显示 doocs 来源、资料完整度和官方链接。
- [ ] 中文站题目在会员筛选中显示"未标注"，不被算作免费题。
- [ ] 收藏/想刷/进行中/已刷/笔记刷新后仍保留；导出 JSON 可再导入。
- [ ] "我的"页 Premium 进度只统计会员题，且不影响题目可读性。
- [ ] 图片占位可点击跳转，不出现破图图标。
- [ ] 深色模式生效并记住选择。
- [ ] 375px 宽度下无横向滚动，筛选抽屉可开合。
- [ ] 键盘 `/` 聚焦搜索，`Esc` 关闭抽屉。
- [ ] 浏览器控制台无报错；Network 无外部请求（图片除外）。

### 12.3 验收口径

- 8202 道题全部可浏览、可搜索到，0 缺失。
- 会员题 789 道可筛选、可阅读，数量与 SQL 口径一致。
- 会员专区不存在账号、支付、内容遮挡或"假解锁"。
- 任何页面都不修改数据库文件（启动前后文件哈希不变）。
- 安全测试全部通过。
- 断网状态下除外部图片外，所有功能正常。

---

## 13. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 题干 HTML 导致 XSS | 高 | DOMPurify + CSP + 专门测试；禁止直接 `innerHTML` 原始内容 |
| 全文搜索慢 | 中 | 默认只搜元数据；题干搜索显式开启；先测量再上 FTS5 trigram |
| 中英文数据被误认为已合并 | 中 | 界面始终显示 site/locale；对照页明确标注"未核实" |
| 会员题空白让人以为页面坏了 | 中 | 专门空态文案 + 外链；卡片加"正文未提供"标记 |
| 会员题被做成假付费墙 | 高 | 789 道题干已在本地，遮挡会误导；只做徽章、筛选和来源说明，不锁定内容 |
| 中文站 `NULL` 被当成免费 | 中 | 筛选单独提供"未标注"，界面不显示"免费" |
| 789 条 `paid_statement_absent` 被误读为缺题干 | 中 | 该问题指向非当前空正文；详情按 `is_current=1` 判断，并在说明里解释 |
| 本地学习清单丢失 | 中 | 明确提示仅存当前浏览器；提供导出/导入 JSON |
| "会员题"与"网站会员"文案混淆 | 中 | 统一叫 Premium 会员题；不出现开通、权益、价格等文案 |
| 示例在题干和结构化字段中重复 | 低 | 题干为主；结构化示例默认折叠 |
| `display_id` 文本排序错乱 | 低 | 统一 `CAST(... AS INTEGER)` |
| 外部图片离线加载失败 | 低 | 转成链接 + 占位；不把图片当核心内容 |
| 85MB 仓库克隆慢 | 低 | 服务端只传输摘要；详情按需加载 |
| 公开部署的版权风险 | 高 | **默认仅本机使用**；公开前必须确认题目文字权利，或只公开元数据 |
| 标准库 HTTP 服务不适合公网 | 中 | 只绑定 127.0.0.1；公网需求改用正式 WSGI/ASGI 服务并加限流 |

---

## 14. 后续可扩展方向

1. **静态导出模式**：按筛选导出一个子集（例如"数据库题 646 道"）为 JSON + 静态页，便于分享。
2. **学习计划**：按标签/难度生成刷题顺序，进度存本地。
3. **题干版本对比**：同一题不同来源的 diff（数据里已经保留多版本）。
4. **全文索引**：FTS5 trigram，支持中文子串搜索与高亮。
5. **CLI 与网页共用查询层**：把列表/详情 SQL 抽成 `qb/query.py`，命令行和网页复用，避免两套逻辑。
6. **导出到 Obsidian/Notion**：单题 Markdown 导出，带来源与标签。
7. **会员题策展与周计划**：基于标签、难度和学习清单自动生成"会员数据库题""会员困难题"等专题计划。
8. **资料完整度补全**：针对会员题缺失的提示和代码模板，另建来源并保留可追溯记录（不在网页端抓取）。

---

## 15. 需要确认的决策（已给默认值）

| 决策 | 默认方案 | 备选 |
| --- | --- | --- |
| 部署形态 | 仅本机 `127.0.0.1` | 公网（需版权与服务器评估） |
| 前端依赖 | 本地 vendored `marked` + `DOMPurify` | 完全零依赖（自写简易渲染，不推荐） |
| 题干搜索 | 默认关闭，按需开启 LIKE | 直接上 FTS5 |
| 会员功能 | **A+B：Premium 会员题专区 + 本地学习清单（已选定）** | 仅专区 / 仅学习清单 |
| 会员账号与支付 | **不做**（无注册、登录、订阅） | 另建在线服务后评估 |
| 会员题内容 | 展示公开快照中已有正文，不遮挡、不假解锁 | 仅显示元数据（信息量更少） |
| 学习清单存储 | 仅 `localStorage`，支持导出导入 | 本地文件 / 后端存储 |
| 首页形态 | 打开即题库列表 | 增加介绍页 |
| 视觉风格 | 类 LeetCode 的克制工具风，Premium 用金色点缀 | 自定义品牌风 |

会员题专区按 **A+B** 执行；其余默认值如无异议，下一步从 **M0 骨架** 开始实现。
