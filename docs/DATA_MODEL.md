# 数据模型

Quest Journal 的数据模型严格遵循 PRD 第 2 节。所有时间戳为 **epoch 毫秒**（整数），所有 ID 为 `node:crypto` 的 `randomUUID()`（稳定 ID，不依赖标题定位）。

## 实体

### Quest — 任务（顶层）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一标识（UUID） |
| `title` | string | 任务名称，必填 |
| `description` | string | 任务说明，可选（默认 `""`） |
| `status` | `open` \| `completed` | 完成状态 |
| `is_blocked` | boolean | 是否阻塞 |
| `blocked_reason` | string \| null | 阻塞原因 |
| `created_at` | number | 创建时间（ms） |
| `completed_at` | number \| null | 完成时间 |
| `archived_at` | number \| null | 归档时间 |
| `sort_order` | number | 展示顺序 |

### Objective — 目标节点

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一标识 |
| `quest_id` | string | 所属 Quest |
| `title` | string | 必填 |
| `description` | string | 可选 |
| `status` | `open` \| `completed` | |
| `is_blocked` | boolean | |
| `blocked_reason` | string \| null | |
| `created_at` | number | |
| `completed_at` | number \| null | |
| `sort_order` | number | |

### Step — 进展节点

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一标识 |
| `objective_id` | string | 所属 Objective |
| `title` | string | 必填 |
| `description` | string | 可选 |
| `status` | `open` \| `completed` | |
| `is_blocked` | boolean | |
| `blocked_reason` | string \| null | |
| `created_at` | number | |
| `completed_at` | number \| null | |
| `sort_order` | number | |

允许任意时刻向 Objective 追加 Step，不要求一次性创建所有步骤。

### Attachment — 节点挂载信息

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一标识 |
| `node_type` | `quest` \| `objective` \| `step` | 挂载节点类型 |
| `node_id` | string | 挂载节点 ID |
| `type` | `text` \| `link` | 文本备注或链接 |
| `title` | string | 可选标题 |
| `content` | string | 文本内容或 URL |
| `created_at` | number | |
| `updated_at` | number | |

- `type === "link"` 时 `content` 必须是 `http(s)://` URL（否则拒绝）。
- 文本备注支持基础 Markdown（MVP 不做解析，仅原样存储/展示）。
- 支持新增、编辑、删除。

### QuestEvent — 历史事件（Trace）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一标识 |
| `quest_id` | string | 所属 Quest |
| `node_type` | string | 事件节点类型 |
| `node_id` | string | 事件节点 ID |
| `event_type` | string | 事件类型（见下表） |
| `previous_value` | object \| null | 变更前数据 |
| `new_value` | object \| null | 变更后数据 |
| `summary` | string | 人类可读的事件说明 |
| `source` | `manual` \| `agent` | 操作来源 |
| `created_at` | number | 事件时间 |

### event_type 取值

| 值 | 含义 |
|---|---|
| `created` | 创建节点 |
| `updated` | 修改节点 |
| `completed` | 完成节点 |
| `uncompleted` | 取消完成 |
| `blocked` | 设置阻塞 |
| `unblocked` | 解除阻塞 |
| `attachment_added` | 新增挂载信息 |
| `attachment_updated` | 修改挂载信息 |
| `attachment_removed` | 删除挂载信息 |
| `archived` | 归档 Quest |
| `restored` | 恢复 Quest |

Trace 独立持久化于 SQLite `events` 表，不因归档或 DSH 重启丢失。

## 状态机规则

### 完成状态（status）

- 三个层级均支持 `open` / `completed`。
- 点击状态图标切换完成状态；已完成可重新标记为未完成。
- 完成时记录 `completed_at`；取消完成时置空。
- 完成状态变化写入 Trace。
- **不**根据子节点完成情况自动完成父节点；**不**根据父节点完成情况自动完成子节点。
- 父节点完成时，即使存在未完成子节点也允许保存（UI 展示提示）。

### 阻塞状态（is_blocked）

- 与完成状态采用独立字段，非同一枚举。
- 所有层级均可标记 Blocked；阻塞时可填原因；支持取消阻塞。
- 阻塞标记不自动传递给父节点。
- 阻塞变化写入 Trace。
- 已完成节点默认隐藏阻塞提示（历史记录保留）。

### 归档状态（archived_at）

- Quest 层级独立生命周期属性。
- 可手动归档；已完成 Quest 通过显式操作归档，完成不自动归档。
- 归档 ≠ 删除；归档后默认只读（所有写操作返回 `QUEST_ARCHIVED`）。
- 可在 Archive 页面查看全部节点、附件与 Trace。
- 可恢复归档任务，恢复后重新允许编辑。
- MVP 不实现永久删除。

## SQLite 表结构

`quests` / `objectives` / `steps` / `attachments` / `events` 五张表，外加 `objectives(quest_id, sort_order)`、`steps(objective_id, sort_order)`、`attachments(node_type, node_id)`、`events(quest_id, created_at)` 索引。

写操作全部通过可重入事务（外层 `BEGIN IMMEDIATE`，嵌套 `SAVEPOINT`）保证原子性——`applyChanges` 批量提交在任一操作失败时整体回滚。
