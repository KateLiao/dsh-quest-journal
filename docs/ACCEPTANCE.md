> 本文保留初版验收记录。当前 v0.3 的功能、使用与验证结果见 [v0.3 验收](V0.3.md)。

# 验收结果

验收状态图例：

- ✅ **已通过**（单元测试或交互预览验证）
- 🧪 **已实现，待 DSH 运行时验证**（代码完整，需在 DSH 中加载后确认）
- 🎨 **已实现**（交互/视觉逻辑就绪，由 preview 或 client.js 承载）

## AC01 — 任务结构 ✅

创建 Quest 后，可添加多个 Objective，每个 Objective 下可添加多个 Step；刷新/重启后数据仍存在。

- 单元测试 `AC01 — create quest, add objectives and steps` 通过。
- `trace persists across reopen` 验证 SQLite 文件重开后数据仍在（等价于 DSH 重启持久化）。

## AC02 — 节点操作 ✅

三个层级均支持独立完成、取消完成、设置阻塞和解除阻塞。

- 单元测试 `AC02 — complete / uncomplete on all three levels` 通过。
- 单元测试 `AC02 — block / unblock with reason` 通过。

## AC03 — 信息挂载 ✅

三个层级均可添加多条文本备注与文档链接，保存后能再次读取。

- 单元测试 `AC03 — attachments on all three levels` 通过（含更新、删除）。
- 单元测试 `link attachment must be http(s)` 通过（链接校验）。

## AC04 — 完成样式 🎨

任意节点完成后立即显示删除线和淡化样式，取消完成后恢复正常。

- `preview/index.html` 中 `.is-done` 使用 `text-decoration: line-through` + 降低对比度；取消完成后样式移除。
- `dsh-client-ui-quest-journal/lib/client.js` 中 `NodeRow` 组件对 `status === "completed"` 节点加 `is-done` 类，逻辑一致。

## AC05 — 归档 ✅

归档的 Quest 从活动列表移除，但能在 Archive 中完整查看并恢复。

- 单元测试 `AC05 — archive removes from active list, restore brings it back` 通过。
- 单元测试 `archived quest is read-only` 通过（归档后写操作被拒绝，恢复后恢复可编辑）。

## AC06 — Trace ✅

创建、编辑、完成、阻塞、归档等关键操作产生历史记录；能按时间顺序查看，含操作时间、来源和内容。

- 单元测试 `AC06 — trace records key operations in order` 通过（验证 `created/completed/blocked/archived` 事件序列、时间、来源、summary）。
- `source` 区分 `manual`（UI）与 `agent`（Agent 工具），单元测试 `applyChanges batch records agent source` 通过。

## AC07 — Agent 创建与更新 🛠（根因已修复，待重启复核）

用户用自然语言创建节点、标记完成、设置阻塞时，Agent 能正确调用工具并更新数据。

- `lib/tools.js` 注册了 `quest_list/get/get_trace/create/add_node/update_node/add_attachment/update_attachment/archive/restore/apply_changes` 共 11 个工具。
- 写操作返回 `{ ok, ... }` / `{ ok: false, error }` 明确结果；错误含稳定 `code`（如 `NOT_FOUND`、`QUEST_ARCHIVED`、`INVALID_*`）。
- **根因（2026-11-04）**：`tool-quest-journal` 条目从未激活，所以工具与提示段落都不出现。`apply()` 里用 `ctx.systemPrompt.getSectionOrder("TOOL_QUEST_JOURNAL")` 取段落顺序，但 `dsh-system-prompt` 只为仓库自有段落登记 order，未知名字返回 `undefined`；而 `systemPrompt.section()` 要求 order 必须是有限数字，直接抛 `TypeError: prompt section "tool:quest-journal" order must be a finite number`，整个条目 activation 失败。
- **修复**：`lib/tools.js` 保留 `getSectionOrder(...)` 查询，并用 `?? 3200` 兜底（内置工具段落 1000–3100、MCP 3100、Tools SDK 5000 之后），第三方段落拿到确定的有限 order。
- **验证**：用真实 `quest-core` + 一个按 `dsh-system-prompt` 语义校验 order 的 Context stub 跑离线 harness：`apply()` 不再抛错，注册 11 个工具；`quest_create / quest_list / quest_add_node / quest_update_node / quest_apply_changes / quest_get_trace` 全部通过（26 项断言）。
- 仍需重启 DSH 后在新会话确认 `quest_*` 出现在工具目录中（当前会话启动于修复之前）。

## AC08 — 同步 🛠（面板已接入，待重启复核）

Agent 更新节点后 Web UI 重新读取看到正确状态；UI 更新后 Agent 读取到一致数据。

- 两侧读写同一 journal 实例与同一 SQLite 数据库：面板不再走 `remote.questJournal`（DSH 构建期静态打包，第三方注册不了），改为 `fetch("/quest-journal/*")` → `lib/web.js` → `lib/journal.mjs` 的共享实例。
- 面板写入在 Trace 中记为 `source: "manual"`，Agent 写入记为 `"agent"`，可区分。
- 面板在窗口获得焦点 / 页面重新可见时重新拉取，能读到 Agent 刚写入的状态（无轮询、无事件总线）。
- **离线验证**：用真实 `quest-core` 跑路由 harness，覆盖 `GET /state`、`GET /quest`、`GET /trace`、`POST /ops`、鉴权 401、跨站 403、未知路由 404、非法 op 400、方法 405 共 18 项断言，全部通过。
- 待重启 DSH 后在面板里点一次完成/阻塞，确认页面即时更新。

## AC09 — 安全更新 ✅（部分）/ 🧪

遇到同名任务或语义不明确的更新指令时，Agent 不会静默修改错误节点。

- 工具描述与系统提示明确要求：含糊名称先用 `quest_list`/`quest_get` 查找候选；多个同名时不得任意选择。
- 服务对不存在的节点/任务返回 `NOT_FOUND` 错误（而非静默创建或误改）。
- 单元测试 `unknown node type rejected`、`validation rejects empty title` 验证校验失败会抛出明确错误。
- 「已完成」仅当用户明确说完成时才更新——已写入系统提示 `tool:quest-journal` 规则。

## AC10 — 插件独立性 🧪

Quest Journal 插件能独立加载和卸载，不破坏原有 DSH 会话及内置工具功能。

- 插件为独立 bundle（`dsh.bundle.patch`）+ 独立客户端包，未修改 Agent Loop 核心逻辑。
- 卸载仅移除 bundle 引用与 `link:` 依赖，数据库文件保留。
- 待 DSH 运行时验证加载/卸载不影响内置工具。

---

## 测试汇总

`bash scripts/run-tests.sh` 一次跑三套，全部通过：

| 套件 | 覆盖 | 结果 |
|---|---|---|
| `test/core.test.mjs` | 领域逻辑、状态机、Trace、归档 | 15 项通过 |
| `test/preview-import.test.mjs` | 预览载入 SQLite 导出快照 | 25 项通过 |
| `test/routes.test.mjs` | 面板 `/quest-journal/*` 路由（鉴权、跨站、CRUD、错误码） | 18 项通过 |

```
# Quest Journal core tests
  ok    AC01 — create quest, add objectives and steps
  ok    AC02 — complete / uncomplete on all three levels
  ok    AC02 — block / unblock with reason
  ok    AC03 — attachments on all three levels
  ok    link attachment must be http(s)
  ok    AC05 — archive removes from active list, restore brings it back
  ok    archived quest is read-only
  ok    AC06 — trace records key operations in order
  ok    trace persists across reopen
  ok    applyChanges batch is atomic
  ok    applyChanges batch records agent source
  ok    validation rejects empty title
  ok    unknown node type rejected
  ok    AC09 — missing nodes fail loudly instead of silently mis-updating
  ok    blocking a completed node still records history
```

交互预览 `preview/index.html` 已通过语法检查与运行时冒烟测试（DOM mock 下无异常，种子数据 1 Quest / 2 Objective / 2 Step / 1 Attachment / 8 Event）。

## 已知限制（与 PRD 一致）

- 未实现文件上传、文档内容解析、任务依赖图谱、多人协作、日历排期、经验值系统等（PRD 第 7 节「MVP 不包含」）。
- 不根据子节点自动完成父节点、不根据父节点自动完成子节点（PRD 3.1）。
- 归档不等于删除；MVP 不提供永久删除交互（PRD 3.3）。
