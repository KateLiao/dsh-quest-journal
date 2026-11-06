# 工具接口

Agent 通过以下 `quest_*` 工具操作任务日志。所有工具在进程内调用 `lib/journal.mjs` 提供的共享 journal 实例，写操作记录 `source: "agent"`，并返回明确的 `{ ok, ... }` / `{ ok: false, error }` 结果（PRD 5.4）。

## 读取工具

### `quest_list`

列出任务。用于定位任务或消歧名称。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `include_archived` | boolean | 否 | 是否包含已归档任务，默认 false |

返回：`Quest[]`（任务摘要数组）。

### `quest_get`

读取单个任务的完整树（目标、进展、挂载信息）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `quest_id` | string | 是 | 任务 ID（来自 `quest_list`） |

返回：`QuestTree | null`。

### `quest_get_trace`

按时间顺序读取单个任务的变更历史。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `quest_id` | string | 是 | 任务 ID |

返回：`QuestEvent[]`。

## 写入工具

### `quest_create`

创建任务。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 是 | 任务名称 |
| `description` | string | 否 | 任务说明 |

返回：`{ ok: true, quest }`。

### `quest_add_node`

添加节点：目标（`parent_type: "quest"`）或进展（`parent_type: "objective"`）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `parent_type` | `quest` \| `objective` | 是 | 父节点类型 |
| `parent_id` | string | 是 | 父节点 ID |
| `title` | string | 是 | 节点标题 |
| `description` | string | 否 | 节点说明/进展记录 |

返回：`{ ok: true, node }`。

### `quest_update_node`

更新任务/目标/进展：编辑标题/描述、完成/取消完成（`status`）、设置/解除阻塞（`is_blocked` + `blocked_reason`）。仅提供用户要求变更的字段。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `node_type` | `quest` \| `objective` \| `step` | 是 | 节点类型 |
| `node_id` | string | 是 | 节点 ID |
| `title` | string | 否 | 新标题 |
| `description` | string | 否 | 新描述 |
| `status` | `open` \| `completed` | 否 | 明确完成状态 |
| `is_blocked` | boolean | 否 | true 阻塞 / false 解除 |
| `blocked_reason` | string | 否 | 仅配合 `is_blocked: true` |

返回：`{ ok: true, node }`。

### `quest_add_attachment`

为任务/目标/进展挂载文本备注或文档链接。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `node_type` | `quest` \| `objective` \| `step` | 是 | |
| `node_id` | string | 是 | |
| `type` | `text` \| `link` | 是 | 文本或链接 |
| `title` | string | 否 | 标题 |
| `content` | string | 是 | 备注内容（Markdown）或 http(s) URL |

返回：`{ ok: true, attachment }`。

### `quest_update_attachment`

更新挂载信息。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `attachment_id` | string | 是 | |
| `type` | `text` \| `link` | 否 | |
| `title` | string | 否 | |
| `content` | string | 否 | |

返回：`{ ok: true, attachment }`。

### `quest_archive`

归档任务（只读，移出活动列表）。

| 参数 | 类型 | 必填 |
|---|---|---|
| `quest_id` | string | 是 |

返回：`{ ok: true, quest }`。

### `quest_restore`

恢复已归档任务。

| 参数 | 类型 | 必填 |
|---|---|---|
| `quest_id` | string | 是 |

返回：`{ ok: true, quest }`。

### `quest_apply_changes`

批量原子提交多项变更。`changes` 为操作对象数组，任一操作失败则整体回滚。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `changes` | array | 是 | `{ op, ... }` 数组 |

支持的 `op`：

| op | 必需字段 |
|---|---|
| `create_quest` | `title` |
| `add_objective` | `quest_id`, `title` |
| `add_step` | `objective_id`, `title` |
| `update_node` | `node_type`, `node_id` + 可选 `title`/`description` |
| `set_completed` | `node_type`, `node_id`, `completed` |
| `toggle_completed` | `node_type`, `node_id` |
| `set_blocked` | `node_type`, `node_id`, `blocked`, `blocked_reason?` |
| `add_attachment` | `node_type`, `node_id`, `type`, `content` |
| `update_attachment` | `attachment_id` + 可选字段 |
| `remove_attachment` | `attachment_id` |
| `archive_quest` | `quest_id` |
| `restore_quest` | `quest_id` |

返回：`{ ok: true, results }`。

## Agent 操作规则（PRD 5.3，已写入系统提示）

- 仅对用户明确要求的节点执行状态更新。
- 对含糊的任务名称，先用 `quest_list` / `quest_get` 查找候选节点。
- 匹配到多个同名节点时，不得任意选择。
- 用户明确说「完成」时才更新为 completed；仅提及「讨论过」「正在推进」「准备完成」时**不得**自动判定完成。
- 多项任务更新支持单次批量提交（`quest_apply_changes`）。
- 每次实际数据变更写入 Event。
- Agent 应在回复中简要说明成功修改了哪些节点。
- Agent 不得虚构文档链接、进展结果或完成时间。
- 归档操作应明确对应 Quest；名称有歧义时需确认。

## v0.3.2 锚点排序

`quest_apply_changes` 额外支持：

```json
{"op":"reorder_node","node_type":"step","node_id":"STEP_ID","parent_id":"DEST_OBJECTIVE_ID","target_id":"ANCHOR_STEP_ID","position":"before"}
```

`position` 为 `before` / `after` / `end`，`end` 时不传 `target_id`。Quest 的 `parent_id` 为 null；Objective 的父节点必须是所属 Quest；Step 可移动到同 Quest 内其他 Objective。节点身份、状态与附件保持不变，按最新同级列表原子重排；归档、跨 Quest、错误/失效锚点拒绝。自然语言计划的操作白名单暂未新增排序，面板拖拽及常规 Agent 批量工具可用。

Quest 的 `reorder_node` 可额外传 `sort_mode`（manual/priority/updated/created）；响应结果包含有效 `sort_mode`，排序规则被打乱时为 manual（UI 显示“－”），否则保留请求模式。服务端以该排序模式的完整活动列表作为移动基础。
