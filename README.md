# Quest Journal — DeepSeek Harness 插件

基于 RPG Quest Journal 交互范式的个人工作任务追踪与进展记录插件。参考《博德之门 3》的任务日志界面，采用 **Quest → Objective → Step** 三级结构，用于追踪现实工作任务的执行情况。

深色双栏界面（左侧任务列表、右侧任务详情），支持完成/阻塞/归档、备注与文档链接、完整变更历史 Trace，以及 Agent 自然语言操作。

## 安装与更新

```bash
git clone https://github.com/KateLiao/dsh-quest-journal.git
cd dsh-quest-journal
bash scripts/install.sh --install
```

然后完全退出并重开 DSH。需要兼容的 DSH（已验证 0.2.1-rc.5）；无需构建，也无需先安装开发依赖。后续在克隆目录运行 `git pull --ff-only` 并重启 DSH 即可升级。

详见 [跨电脑安装与 GitHub 维护](docs/GITHUB.md)、[安装说明](docs/INSTALL.md) 和 [版本记录](CHANGELOG.md)。GitHub 只管理代码，不同步个人任务数据库。

## v0.4.0 更新

“新建任务”支持用 DSH 根据意图生成名称、目标与进展，完整大纲先预览再确认创建，并自动打开新任务；保留手动新建。复用 DSH 默认模型，支持澄清、重试、取消、原子创建与幂等。使用方法见 [新建任务与自动拆解](docs/NEW_TASK_GENERATION.md)。

## v0.3.3 更新

修复空白新增行与残留选区可能导致拖不动的问题，扩大拖拽柄命中范围。各排序模式均支持拖动：保持规则时保留模式，打乱规则时显示“－”，完整保存拖后的顺序。新增基于 DSH 自带 React 与隔离数据的真实浏览器原生拖拽回归测试。

## v0.3.2 更新

拖动时显示明确的前/后插入线、落点文字、源条目淡化及列表边缘滚动。详情内直接拖目标或进展的标题行，无额外拖拽柄；目标连同子项排序，进展可在当前 Quest 内跨目标移动（含空目标）。使用服务端锚点排序，原子保存并保留 Trace。操作边界和验收见 [拖拽验收](docs/DRAG_AND_DROP.md)。

## v0.3.1 更新

DSH 变更在“目标与进展”中直接模拟最终结构，新增、修改、移动和待删除条目以边框与文字标签高亮。受影响的折叠/已完成内容自动显示；预览只读，取消即恢复真实数据，确认后才落库。旧描述中独立的“优先级：P0”等手写元数据行不再展示，保留真实优先级 badge。

## v0.3 更新

采用精简双栏任务大纲：行内保留完成、展开、按需新增与更多菜单；日期、附件与历史按需展开。当前任务内新增 DSH 指令框，复用 DSH 默认模型，支持自然语言拆解、进展记录、完成/阻塞、优先级和多项变更；先预览后原子应用，支持澄清、重试、取消、冲突检测与幂等。

需求与边界见 [任务内自然语言编排设计](docs/NATURAL_LANGUAGE.md)，使用和验证见 [v0.3 验收](docs/V0.3.md)。重启 DSH 加载新版即可，无需新 API Key；默认模型必须已配置。独立 preview 仍为初版演示。

## v0.2 更新

已增加筛选排序、优先级、拖拽、标题编辑、删除和日期显示，并将原生弹窗替换为面板内表单。完整行为、层级边界和验证结果见 [v0.2 实施说明](docs/V0.2.md)。使用安装后的 DSH 面板体验新版；独立 preview 仍为初版演示。

## 功能一览

| 能力 | 说明 |
|---|---|
| 三级任务结构 | Quest → Objective → Step，可并行推进多个 Objective |
| 完成状态 | 三个层级均可独立完成/取消完成，已完成节点显示删除线与淡化 |
| 阻塞状态 | 三个层级均可标记阻塞（含原因）与解除阻塞，与完成状态独立 |
| 信息挂载 | 三个层级均可添加文本备注（Markdown）与文档链接 |
| 归档 | Quest 级别归档/恢复，归档后只读，可完整查看 |
| Trace | 创建/编辑/完成/阻塞/归档等操作产生可追溯历史，独立持久化 |
| Agent 工具 | `quest_*` 工具，在对话中用自然语言更新任务 |
| 持久化 | SQLite（`node:sqlite`），DSH 重启后数据保留 |

## 目录结构

```
工作任务管理插件/
├── packages/
│   ├── dsh-quest-journal/              # 后端插件（服务 + Agent 工具）
│   │   ├── package.json                # bundle 清单（dsh.bundle.patch）
│   │   ├── cordis.patch.yml            # 组合条目（工具 / 路由两行）
│   │   ├── lib/
│   │   │   ├── index.js                # 插件入口（工具条目）
│   │   │   ├── journal.mjs             # 进程内共享的 SQLite store + 领域服务
│   │   │   ├── tools.js                # quest_* Agent 工具（零外部依赖）
│   │   │   ├── web-entry.js            # /quest-journal/* 路由条目
│   │   │   ├── web.js                  # 路由实现（鉴权 + JSON 接口）
│   │   │   └── quest-core.mjs          # 领域逻辑（数据模型/状态机/Trace/SQLite）
│   │   └── locale/{en,zh}.json
│   └── dsh-client-ui-quest-journal/    # Web 面板：Host 路由 + 浏览器半片
│       ├── package.json                # dsh.bundle.patch + dsh.client 清单
│       ├── cordis.patch.yml            # 面板 bundle 行（quest-journal-ui）
│       ├── lib/index.js                # 空 apply（仅为让 DSH 发现 client bundle）
│       ├── lib/client.js               # 浏览器半片（__ModuleLoader__ 工厂 + 内联样式）
│       └── locale/{en,zh}.json
├── preview/
│   ├── index.html                      # 独立交互预览（可载入真实数据快照）
│   └── quest-journal-export.json       # export-journal.mjs 生成的数据快照
├── test/
│   ├── core.test.mjs                   # 核心逻辑单元测试（15 项）
│   ├── preview-import.test.mjs         # 预览载入真实数据测试（25 项）
│   └── routes.test.mjs                 # 面板 Host 路由测试（18 项）
├── scripts/
│   ├── install.sh                      # 将插件接入 DSH profile
│   ├── diagnose.sh                     # 隔离组合 profile，报告被跳过的 bundle
│   ├── export-journal.mjs              # 把 SQLite 导出成预览可载入的 JSON 快照
│   └── run-tests.sh                    # 运行两套单元测试
└── docs/
    ├── DATA_MODEL.md                   # 数据模型
    ├── TOOLS.md                        # 工具接口
    ├── INSTALL.md                      # 安装与启动说明
    └── ACCEPTANCE.md                   # 验收结果
```

## 快速开始

**1. 在 DSH 里使用（推荐）**

按「安装到 DSH」装好并重启后，侧栏出现「任务日志」入口，点开就是双栏日志面板（左列表 / 右详情）。面板直接读写 `<DSH_HOME>/storages/quest-journal.db`，和 `quest_*` 工具共用同一份数据。

**2. 离线预览（无需安装）**

用浏览器打开 [`preview/index.html`](preview/index.html)，体验同样的双栏日志交互（数据存于浏览器 localStorage，刷新不丢失）。

想查看插件数据库里的真实任务时，先导出快照，再载入：

```bash
node scripts/export-journal.mjs     # 读 ~/.dsh/storages/quest-journal.db → preview/quest-journal-export.json
```

打开预览后点击左下角「⇩ 载入导出数据」，选择该 JSON 即可（用 http 方式打开预览时会自动载入；`file://` 下浏览器禁止 fetch 本地文件，只能手动选）。载入只替换浏览器本地快照，**不会写回 SQLite**。

**3. 运行单元测试**

```bash
bash scripts/run-tests.sh
```

**4. 安装到 DSH**

```bash
bash scripts/install.sh
```

安装脚本会把后端包和面板包都以 `link:` 方式接入当前 DSH 的 `desktop` profile，并加入 `dsh.profile.bundles`；重启 DSH 后生效。详见 [docs/INSTALL.md](docs/INSTALL.md)。

## 文档

- [数据模型](docs/DATA_MODEL.md) — Quest/Objective/Step/Attachment/QuestEvent 字段与状态机规则。
- [工具接口](docs/TOOLS.md) — `quest_*` Agent 工具的入参、出参与操作规则。
- [安装与启动说明](docs/INSTALL.md) — 依赖、安装步骤、验证方式、UI 限制说明。
- [验收结果](docs/ACCEPTANCE.md) — AC01–AC10 逐项验收情况。

## 技术说明

本插件遵循 DSH 官方插件机制（Cordis 插件系统 + bundle 清单 + Agent 工具），未修改 Agent Loop 核心逻辑。

- **后端服务**：`lib/journal.mjs` 持有进程内单例（`QuestJournalStore` + `QuestJournalService`），工具条目与路由条目共用；面板写入走 `applyChanges(..., "manual")`。
- **Agent 工具**：`quest_*` 11 个工具，自然语言操作任务日志。
- **提示段落顺序**：`dsh-system-prompt` 只为仓库自有段落登记 order，`getSectionOrder()` 对第三方名字返回 `undefined`，而 `section()` 只接受有限数字（否则抛错、整条插件条目激活失败）。`lib/tools.js` 因此保留查询并用 `?? 3200` 兜底——这正是 2026-11-04 之前 `quest_*` 工具一直不出现的根因，详见 [ACCEPTANCE](docs/ACCEPTANCE.md#ac07--agent-创建与更新-根因已修复待重启复核)。
- **持久化**：`node:sqlite`（DSH 运行时内置 Node ≥ 24），默认数据库文件为 `<DSH_HOME>/storages/quest-journal.db`。
- **交互界面**：内置 Web 面板（`sidebar.panellist` 侧栏入口 + `main` 双栏页），数据走 `/quest-journal/*` HTTP 路由。
- **零外部依赖**：DSH 的 loader 用 Node 原生解析加载插件，第三方包目录里解析不到 `@deepseek-ai/*`（profile 里也没有），所以 Host 代码只用 Node 内建模块 + 包内相对导入；工具定义按 JSON Schema 直接注册，不再经过 `defineTool`。
- **版本门禁**：DSH 会按 `engines.dsh` 与运行版本做兼容性检查，不匹配时**静默跳过整个 bundle**（只在宿主 stderr 里打一行 `skipping profile bundle`）。这里写的是 `>=0.2.1-rc.5 <0.3.0`；改窄到具体版本会让服务、工具、面板路由一起消失。`bash scripts/diagnose.sh` 可以在隔离副本里 dump profile，直接看到有没有被跳过。

### 面板为什么不用 `remote.*` 服务

DSH 0.2.1-rc.5 的 Web 客户端把所有 `remote.*` RPC 命名空间**在构建期静态打包**进 `dsh-api-remotes/lib/client.js`，第三方插件无法在运行时注册 `remote.questJournal`——这正是 2026-11-04 之前面板激活失败的卡点（`pending (waiting for services: remote.questJournal, reflect)`）。

现在的做法与 DSH 官方 UI 插件机制一致：

- **Host 半片**（`lib/index.js` + `lib/web.js`）用 `ctx.webServer.register({ kind: "prefix", path: "/quest-journal" })` 暴露 JSON 接口，每个请求都过 `connection.requestRejection()`（Web 服务不替插件路由鉴权，拿不到鉴权服务即 403），POST 再校验 `sec-fetch-site`。
- **浏览器半片**（`lib/client.js`）由 `dsh.client` 清单加载，通过 `ctx.slots` 注册侧栏图标与 `main` 面板，用 `fetch("/quest-journal/...")` 读写；不再依赖 `remote`/`reflect` 服务。
- 面板与 `quest_*` 工具共用同一个 journal 单例与同一 SQLite 数据库，面板写入在 Trace 里记为 `manual`。
- `preview/index.html` 保留为离线/演示用界面，不再是唯一入口。

> 注：本工作区 DSH 文件沙箱禁止 shell 子进程读写 `.js` 文件，因此领域逻辑源码命名为 `quest-core.mjs`（`.mjs` 可被 Node 直接加载与测试），并在 `lib/index.js` 中 `import "./quest-core.mjs"`。这与 DSH 打包后的 `.js` 产物语义一致。
