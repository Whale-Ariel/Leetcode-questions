# LeetCode 题目信息数据库

这是一个可以下载到本地直接查询的 LeetCode 题目信息库。数据在 SQLite 文件里，只用 Python 标准库就能查，不需要安装数据库服务器。

库里保存的是题目本身：题号、标题、难度、类别、题干、示例、约束、提示、初始代码模板、标签，以及每条内容来自哪个快照。不含题解、复杂度分析和答案实现。初始代码模板是 LeetCode 给出的空函数框架，不是解答。

## 下载

```bash
git clone https://github.com/yumengwang63-eng/Leetcode-questions.git
cd Leetcode-questions
```

克隆体积大约 90MB，主要来自 `db/question-bank.sqlite`。也可以在 GitHub 页面用 Code → Download ZIP。

需要 Python 3.10 或更高版本。不需要 pip 安装第三方包。本机不需要单独安装 `sqlite3` 命令。

## 库里有什么

构建时的统计：

| 项目 | 数量 |
| --- | --- |
| 题目 | 8202 |
| 其中 leetcode.com | 4101 |
| 其中 leetcode.cn | 4101 |
| 题干版本 | 15216 |
| 示例 | 33847 |
| 提示 | 10880 |
| 初始代码模板 | 61386 |

leetcode.com 上这份快照里的 4101 个 slug 都在库中。中文题来自 doocs 的中文 README，按 `leetcode.cn` 单独存放，没有自动并进国际站题目。对应关系在 `reports/cross-site-candidates.jsonl`，状态是待核实。

更细的分类、难度和字段缺失统计见 `reports/coverage.json` 与 `reports/quality.json`。

## 网页浏览界面

在仓库根目录启动本地服务器：

```powershell
$env:PYTHONPATH = "$pwd\scripts"
$env:PYTHONUTF8 = "1"

python -m qb.cli serve --db db\question-bank.sqlite --port 8000
```

macOS 或 Linux 把路径写成 `scripts` 和 `db/question-bank.sqlite`。然后用浏览器打开 http://127.0.0.1:8000/ 。服务器只监听本机地址、只读打开数据库，没有任何写入接口，也不需要联网。

页面功能：

- **题库列表**：按站点、语言、会员状态、难度、类别筛选，支持按题号/slug/标题搜索、排序和分页，以及随机一题、每日一题
- **题目详情**：题干、示例、提示、代码模板和来源说明；付费题只展示公开快照里的正文，并明确标注来源
- **写代码（本地运行）**：详情页右侧内置代码编辑器，支持 JavaScript 和 Python 在浏览器内直接运行（Python 由本地打包的 Pyodide 环境执行，首次运行需加载几秒）。可选用题目的示例输入或自定义输入，运行结果与示例输出做纯文本对比。**这不是官方判题，也不会上传提交**——只在本机浏览器里跑你的代码。草稿自动保存在浏览器本地（localStorage）
- **代码语法高亮**：编辑器输入实时着色，代码模板按语言高亮（highlight.js 已本地打包在 `web/static/vendor/`，无需联网）；题干里的示例文字块保持原样，不会被误判成代码
- **键盘快捷键**：题库与会员题列表里按 `/` 聚焦搜索、`j`/`k` 上下选择题目、`Enter` 打开选中题目、`Esc` 取消选择、搜索框内回车立即搜索；任意页面按 `r` 随机一题（输入框和代码编辑器内不生效）
- **题目版本**：详情页"版本"标签页列出同一题的其他来源快照，可查看每个来源的完整题干
- **写 SQL（本地运行）**：数据库题的语言下拉默认提供 SQL 运行器（sql.js 已本地打包在 `web/static/vendor/`，SQLite 内存库）：先在"建表与测试数据"里 CREATE/INSERT，再运行查询，结果以表格展示。**不是官方判题**
- **跨站配对核实**：中文站与国际站按题号配对来自快照推断；页脚"配对核实"入口可人工逐对确认/拒绝（判定仅存浏览器本地，可导出/导入 JSON）
- **中英对照**：`#/compare/{题号}` 并排展示中英题干，并标注配对的核实状态
- **统计**：题库总量、难度与类别分布等实时汇总
- **数据质量**：导入时发现的缺失、冲突和待核实项清单
- **Premium 会员题专区**：789 道会员题的汇总、筛选与快捷集合
- **我的学习清单**：收藏、想刷/进行中/已刷状态和笔记，全部存在浏览器本地（localStorage），可导出/导入 JSON，不会上传；附 Premium 进度、按标签的刷题进度、最近 26 周活动热力图，以及可导入 Anki 的 CSV 导出
- **登录与注册**：见下方“登录与注册”一节；角色只影响界面与附加功能入口，不影响题目阅读
- 深色模式和移动端窄屏适配

> 运行代码所需的浏览器内 Python 环境（Pyodide）已本地打包在 `web/static/pyodide/`，无需联网。为此页面 CSP 的 `script-src` 允许了 `'wasm-unsafe-eval'`（加载 WebAssembly）和 `'unsafe-eval'`（执行用户 JavaScript），页面本身的所有脚本仍然只允许来自本站。

## 测试

```powershell
$env:PYTHONPATH = "$pwd\scripts"
$env:PYTHONUTF8 = "1"

python -m unittest discover -s tests
```

## 登录与注册

服务启动时会在 `db/users.sqlite`（独立于题库的本地账号库，题库始终只读）中自动创建三个内置测试账号，并打印提示：

| 账号 | 密码 | 角色 | 界面差异 |
| --- | --- | --- | --- |
| `guest` | `guest123456` | 游客 | 顶栏显示“游客”徽章；高级专区锁定 |
| `user` | `user123456` | 普通用户 | 顶栏显示“普通用户”徽章；高级专区锁定 |
| `premium` | `premium123456` | 高级用户 | 顶栏显示“高级用户”徽章；可进入 `#/topics` 高级专区 |

页面行为：

- 未登录时顶栏显示“登录 / 注册”按钮；`#/login`、`#/register` 页面支持注册新账号并即时登录。
- **新注册的账号一律为普通用户**；“高级用户”角色只由内置测试账号提供（没有支付体系，也不提供自助升级）。
- 角色只控制界面与附加功能入口（如高级专区的会员题策展）。**所有题目对任何角色、包括未登录访客，都完整可读**——本项目的会员题只是标记，不做任何内容锁定。

安全实现（纯标准库，无新增依赖）：

- 密码使用 PBKDF2-HMAC-SHA256（每用户 16 字节随机盐，20 万次迭代）存储，校验用常数时间比较。
- 会话令牌 32 字节随机数，数据库中只保存 SHA-256 摘要；Cookie 为 `HttpOnly + SameSite=Strict`，有效期 7 天，退出登录即失效。
- 认证接口仅接受 JSON 请求体（1-10000 字节）；题库数据库仍以只读模式打开，账号数据全部写入独立的 `db/users.sqlite`。

## 测试

测试覆盖全部 API 契约、筛选与分页校验、错误响应（400/401/404/405/409）、安全响应头与路径穿越防护、数据库替换流程（`tests/test_update.py`）以及账号体系（`tests/test_auth.py` + `tests/test_web.py` 中的 `AuthApiTests`）。学习清单、SQL 引擎与代码运行器的纯逻辑测试分别在 `tests/test_study.mjs`、`tests/test_sql.mjs` 和 `tests/test_runner.mjs`，需要本机有 Node.js（没有时会自动跳过）。

## 更新数据

快照数据来自三份上游仓库，可以重新拉取并重建数据库（需要本机装有 `git`）：

```powershell
$env:PYTHONPATH = "$pwd\scripts"
$env:PYTHONUTF8 = "1"

python -m qb.cli update              # 拉取上游 → 重建 → 验收 → 备份并替换 db/question-bank.sqlite
python -m qb.cli update --fetch-only # 只拉取上游仓库
python -m qb.cli update --skip-fetch # 跳过拉取，用现有 raw/ 重建
```

说明：

- 三份上游仓库会克隆/快进到 `raw/<来源>/repo`（不进入本仓库的版本控制）；doocs 使用稀疏检出，只取 LICENSE、根 README 和题解目录里的 README Markdown，不下载题解实现。
- 流水线会先跑样例验收，验收不过就终止，现有数据库不受影响；新库通过验收后先备份旧库到 `backups/`，再原子替换。
- 更新前请停掉本地网页服务（服务持有数据库连接，Windows 上替换文件会失败）。
- 首次拉取需要下载较多内容（doocs 仓库较大），耗时取决于网络。

## 用命令查询

在仓库根目录执行。PowerShell 示例：

```powershell
$env:PYTHONPATH = "$pwd\scripts"
$env:PYTHONUTF8 = "1"

python -m qb.cli query --db db\question-bank.sqlite --slug two-sum --site leetcode.com --locale en
python -m qb.cli query --db db\question-bank.sqlite --display-id 1
python -m qb.cli query --db db\question-bank.sqlite --title 两数之和 --site leetcode.cn --locale zh-CN
python -m qb.cli query --db db\question-bank.sqlite --category database --difficulty easy --limit 10
python -m qb.cli query --db db\question-bank.sqlite --issues
```

macOS 或 Linux 把路径写成 `scripts` 和 `db/question-bank.sqlite` 即可。

这条命令返回题号、slug、标题、难度、类别、语言和题干长度，方便确认题目在不在。它不打印整篇题干。

可用筛选：

| 参数 | 含义 |
| --- | --- |
| `--slug` | 例如 `two-sum` |
| `--display-id` | 展示题号，例如 `1`。这不是平台内部 ID |
| `--title` | 标题，按包含关系匹配 |
| `--site` | `leetcode.com` 或 `leetcode.cn` |
| `--locale` | `en` 或 `zh-CN` |
| `--category` | `algorithm`、`database`、`shell`、`concurrency`、`javascript`、`pandas` |
| `--difficulty` | `easy`、`medium`、`hard` |
| `--limit` | 条数，默认 20 |
| `--issues` | 改看缺失、冲突和待核实问题的数量 |

## 查看完整题干、示例、提示和模板

`queries/examples.sql` 里有按题号、标签、正文、示例、提示、模板、来源和问题列表查询的语句。用 Python 执行其中一条即可，例如读英文 Two Sum 的题干开头：

```powershell
python -c "import sqlite3; c=sqlite3.connect(r'db/question-bank.sqlite'); print(c.execute(\"SELECT statement_markdown FROM problem_content ct JOIN problem_source_identity i ON i.id=ct.source_identity_id WHERE i.slug='two-sum' AND i.site='leetcode.com' AND ct.locale='en' AND ct.is_current=1\").fetchone()[0])"
```

查的时候加上 `is_current = 1`，得到的是当前选用的版本。历史版本仍留在 `problem_content` 里，`revision` 更大的不一定是当前版本，以 `is_current` 为准。

主要的表：

| 表 | 内容 |
| --- | --- |
| `problem` | 内部主键、类别、难度、是否会员 |
| `problem_source_identity` | 站点、内部 ID、展示题号、slug、链接 |
| `problem_content` | 某种语言的题干版本 |
| `problem_example` | 挂在某一版题干上的示例 |
| `problem_hint` | 挂在某一版题干上的提示 |
| `starter_code` | 各语言初始模板 |
| `tag`、`problem_tag` | 标签 |
| `source_record`、`content_provenance` | 来源文件、commit、提取位置 |
| `data_issue` | 缺失、冲突和待核实项 |

字段说明在 `schemas/data-dictionary.md`。建表语句在 `migrations/sqlite/001_init.sql`。同一套表的 PostgreSQL 写法在 `migrations/postgres/001_init.sql`，本库实际跑的是 SQLite。

## 数据从哪里来

三份公开快照，获取时间和 commit 记在 `manifests/snapshot.json`：

| 来源 | 用在这里的部分 |
| --- | --- |
| [neenza/leetcode-problems](https://github.com/neenza/leetcode-problems) | 英文题干、示例、约束、提示、初始模板 |
| [noworneverev/leetcode-api](https://github.com/noworneverev/leetcode-api) | leetcode.com 题目列表、HTML 题干、会员标志、模板 |
| [doocs/leetcode](https://github.com/doocs/leetcode) | 只取 README 里 `description:start` 到 `description:end` 之间的题干 |

这些仓库的许可证不自动覆盖 LeetCode 题目原文。neenza 仓库没有 LICENSE 文件。leetcode-api 仓库软件是 MIT。doocs 仓库是 CC BY-SA 4.0。题目文字的权利仍属于原权利人。本仓库只便于本地查阅从这些公开快照整理出的题目信息。

字段怎么对应，见 `schemas/source-field-mapping.md`。

## 使用时要注意

- 付费题在 leetcode-api 缓存里没有正文，这里没有再向 LeetCode 抓取会员内容。若 doocs 快照里已有题干，会作为 doocs 来源另存。
- 中文站和国际站没有合并。查英文用 `--site leetcode.com --locale en`，查中文用 `--site leetcode.cn --locale zh-CN`。
- 中文算法题如果没有可靠类别标签，`category` 为空。
- 这三份快照里没有 LCP、面试题这类非数字题号。
- 图片只保存原始 URL，没有把图片文件放进库里。
- 同一题不同来源的正文如果有差异，会各留一份，不会拼成一篇。当前展示哪一份由 `is_current` 决定。

## 这个仓库不包含什么

不包含三个来源仓库的原始克隆（它们在首次运行 `python -m qb.cli update` 时会自动拉取到 `raw/`，且不进入本仓库的版本控制）。克隆本仓库后可以直接查询；要重建数据库请看上面的"更新数据"一节。查询代码在 `scripts/qb/`。
