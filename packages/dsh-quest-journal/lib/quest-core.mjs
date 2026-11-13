// Quest Journal — core domain logic.
//
// Self-contained (no DSH imports) so it can be unit-tested under plain Node.
// It implements the PRD data model (Quest → Objective → Step, Attachment,
// QuestEvent), the completion / blocking / archiving state machine, and a
// SQLite persistence layer built on `node:sqlite` (available in the DSH
// Node runtime ≥ 24). Timestamps are epoch milliseconds.

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { validateDeadline } from "./deadline.mjs";
import { TodoJournal } from "./todo-core.mjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NODE_TYPES = ["quest", "objective", "step"];
export const STATUSES = ["open", "completed"];
export const ATTACHMENT_TYPES = ["text", "link"];
export const SOURCES = ["manual", "agent"];

export const EVENT_TYPES = [
  "created",
  "updated",
  "completed",
  "uncompleted",
  "blocked",
  "unblocked",
  "attachment_added",
  "attachment_updated",
  "attachment_removed",
  "archived",
  "restored",
  "deleted",
  "moved",
  "command_applied",
  "reordered",
  "todo_converted",
  "todo_conversion_undone",
];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class QuestJournalError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "QuestJournalError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new QuestJournalError(message, code);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// Monotonic wall-clock (epoch ms). `Date.now()` only has millisecond
// resolution, so several mutations issued within one millisecond would share a
// timestamp and make the trace order non-deterministic (the UUID tiebreak is
// random). Each call is guaranteed strictly greater than the previous one
// within this process, and it still tracks the system clock across restarts.
let lastTimestamp = 0;
function now() {
  let ts = Date.now();
  if (ts <= lastTimestamp) ts = lastTimestamp + 1;
  lastTimestamp = ts;
  return ts;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`, "INVALID_STRING");
  }
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") fail(`${field} must be a string`, "INVALID_STRING");
  return value;
}

function validateNodeType(value) {
  if (!NODE_TYPES.includes(value)) fail(`unknown node_type "${value}"`, "INVALID_NODE_TYPE");
  return value;
}

function validateStatus(value) {
  if (!STATUSES.includes(value)) fail(`unknown status "${value}"`, "INVALID_STATUS");
  return value;
}

function validateAttachmentType(value) {
  if (!ATTACHMENT_TYPES.includes(value)) fail(`unknown attachment type "${value}"`, "INVALID_ATTACHMENT_TYPE");
  return value;
}

function validateSource(value) {
  if (value !== "manual" && value !== "agent") fail(`unknown source "${value}"`, "INVALID_SOURCE");
  return value;
}

function validateBoolean(value, field) {
  if (typeof value !== "boolean") fail(`${field} must be a boolean`, "INVALID_BOOLEAN");
  return value;
}

// ---------------------------------------------------------------------------
// SQLite store
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  is_blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  archived_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  is_blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  is_blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  node_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  summary TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objectives_quest ON objectives(quest_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_steps_objective ON steps(objective_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_attachments_node ON attachments(node_type, node_id);
CREATE INDEX IF NOT EXISTS idx_events_quest ON events(quest_id, created_at);
`;

function rowToQuest(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    is_blocked: row.is_blocked === 1,
    blocked_reason: row.blocked_reason ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    priority: row.priority ?? "P1",
    completed_at: row.completed_at ?? null,
    due_date: row.due_date ?? null,
    due_at: row.due_at ?? null,
    archived_at: row.archived_at ?? null,
    sort_order: row.sort_order,
  };
}

function rowToObjective(row) {
  return {
    id: row.id,
    quest_id: row.quest_id,
    title: row.title,
    description: row.description,
    status: row.status,
    is_blocked: row.is_blocked === 1,
    blocked_reason: row.blocked_reason ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    priority: row.priority ?? "P1",
    completed_at: row.completed_at ?? null,
    due_date: row.due_date ?? null,
    due_at: row.due_at ?? null,
    sort_order: row.sort_order,
  };
}

function rowToStep(row) {
  return {
    id: row.id,
    objective_id: row.objective_id,
    title: row.title,
    description: row.description,
    status: row.status,
    is_blocked: row.is_blocked === 1,
    blocked_reason: row.blocked_reason ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    priority: row.priority ?? "P1",
    completed_at: row.completed_at ?? null,
    due_date: row.due_date ?? null,
    due_at: row.due_at ?? null,
    sort_order: row.sort_order,
  };
}

function rowToAttachment(row) {
  return {
    id: row.id,
    node_type: row.node_type,
    node_id: row.node_id,
    type: row.type,
    title: row.title,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    quest_id: row.quest_id,
    node_type: row.node_type,
    node_id: row.node_id,
    event_type: row.event_type,
    previous_value: row.previous_value ? JSON.parse(row.previous_value) : null,
    new_value: row.new_value ? JSON.parse(row.new_value) : null,
    summary: row.summary,
    source: row.source,
    created_at: row.created_at,
  };
}

export class QuestJournalStore {
  constructor(path) {
    // `path` may be ":memory:" for tests.
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    for (const table of ["quests", "objectives", "steps"]) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!columns.includes("updated_at")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN updated_at INTEGER`);
      if (!columns.includes("due_date")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN due_date TEXT`);
      if (!columns.includes("due_at")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN due_at INTEGER`);
      if (!columns.includes("priority")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN priority TEXT NOT NULL DEFAULT 'P1'`);
      this.db.exec(`UPDATE ${table} SET updated_at = created_at WHERE updated_at IS NULL`);
    }
  }

  close() {
    this.db.close();
  }

  // -- transactions ---------------------------------------------------------
  // Reentrant: the outermost call opens a real transaction; nested calls
  // (e.g. applyChanges wrapping a createQuest) use SAVEPOINTs so a batch stays
  // atomic without breaking the inner helpers.

  _depth = 0;

  transaction(fn) {
    if (this._depth > 0) {
      this._depth += 1;
      const savepoint = `sp_${this._depth}`;
      this.db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = fn();
        this.db.exec(`RELEASE ${savepoint}`);
        this._depth -= 1;
        return result;
      } catch (error) {
        try {
          this.db.exec(`ROLLBACK TO ${savepoint}`);
          this.db.exec(`RELEASE ${savepoint}`);
        } catch {
          /* ignore */
        }
        this._depth -= 1;
        throw error;
      }
    }
    this._depth = 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      this._depth = 0;
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      this._depth = 0;
      throw error;
    }
  }

  // -- quests ----------------------------------------------------------------

  insertQuest(quest) {
    this.db
      .prepare(
        `INSERT INTO quests (id, title, description, status, is_blocked, blocked_reason, created_at, completed_at, archived_at, sort_order, due_date, due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        quest.id,
        quest.title,
        quest.description,
        quest.status,
        quest.is_blocked ? 1 : 0,
        quest.blocked_reason,
        quest.created_at,
        quest.completed_at,
        quest.archived_at,
        quest.sort_order,
        quest.due_date ?? null, quest.due_at ?? null,
      );
  }

  getQuest(id) {
    const row = this.db.prepare("SELECT * FROM quests WHERE id = ?").get(id);
    return row ? rowToQuest(row) : null;
  }

  listQuests() {
    return this.db
      .prepare("SELECT * FROM quests ORDER BY sort_order ASC, created_at ASC")
      .all()
      .map(rowToQuest);
  }

  updateQuest(id, patch) {
    const current = this.getQuest(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE quests SET title = ?, description = ?, status = ?, is_blocked = ?, blocked_reason = ?, completed_at = ?, archived_at = ?, sort_order = ?, due_date = ?, due_at = ? WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.status,
        next.is_blocked ? 1 : 0,
        next.blocked_reason,
        next.completed_at,
        next.archived_at,
        next.sort_order,
        next.due_date, next.due_at,
        id,
      );
    return next;
  }

  // -- objectives -------------------------------------------------------------

  insertObjective(objective) {
    this.db
      .prepare(
        `INSERT INTO objectives (id, quest_id, title, description, status, is_blocked, blocked_reason, created_at, completed_at, sort_order, due_date, due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        objective.id,
        objective.quest_id,
        objective.title,
        objective.description,
        objective.status,
        objective.is_blocked ? 1 : 0,
        objective.blocked_reason,
        objective.created_at,
        objective.completed_at,
        objective.sort_order,
        objective.due_date ?? null, objective.due_at ?? null,
      );
  }

  getObjective(id) {
    const row = this.db.prepare("SELECT * FROM objectives WHERE id = ?").get(id);
    return row ? rowToObjective(row) : null;
  }

  listObjectives(questId) {
    return this.db
      .prepare("SELECT * FROM objectives WHERE quest_id = ? ORDER BY sort_order ASC, created_at ASC")
      .all(questId)
      .map(rowToObjective);
  }

  updateObjective(id, patch) {
    const current = this.getObjective(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE objectives SET title = ?, description = ?, status = ?, is_blocked = ?, blocked_reason = ?, completed_at = ?, sort_order = ?, due_date = ?, due_at = ? WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.status,
        next.is_blocked ? 1 : 0,
        next.blocked_reason,
        next.completed_at,
        next.sort_order,
        next.due_date, next.due_at,
        id,
      );
    return next;
  }

  // -- steps -------------------------------------------------------------

  insertStep(step) {
    this.db
      .prepare(
        `INSERT INTO steps (id, objective_id, title, description, status, is_blocked, blocked_reason, created_at, completed_at, sort_order, due_date, due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        step.id,
        step.objective_id,
        step.title,
        step.description,
        step.status,
        step.is_blocked ? 1 : 0,
        step.blocked_reason,
        step.created_at,
        step.completed_at,
        step.sort_order,
        step.due_date ?? null, step.due_at ?? null,
      );
  }

  getStep(id) {
    const row = this.db.prepare("SELECT * FROM steps WHERE id = ?").get(id);
    return row ? rowToStep(row) : null;
  }

  listSteps(objectiveId) {
    return this.db
      .prepare("SELECT * FROM steps WHERE objective_id = ? ORDER BY sort_order ASC, created_at ASC")
      .all(objectiveId)
      .map(rowToStep);
  }

  updateStep(id, patch) {
    const current = this.getStep(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE steps SET title = ?, description = ?, status = ?, is_blocked = ?, blocked_reason = ?, completed_at = ?, sort_order = ?, due_date = ?, due_at = ? WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.status,
        next.is_blocked ? 1 : 0,
        next.blocked_reason,
        next.completed_at,
        next.sort_order,
        next.due_date, next.due_at,
        id,
      );
    return next;
  }

  // -- generic node access -----------------------------------------------------

  getNode(nodeType, nodeId) {
    if (nodeType === "quest") return this.getQuest(nodeId);
    if (nodeType === "objective") return this.getObjective(nodeId);
    if (nodeType === "step") return this.getStep(nodeId);
    return null;
  }

  // -- attachments -------------------------------------------------------------

  insertAttachment(attachment) {
    this.db
      .prepare(
        `INSERT INTO attachments (id, node_type, node_id, type, title, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attachment.id,
        attachment.node_type,
        attachment.node_id,
        attachment.type,
        attachment.title,
        attachment.content,
        attachment.created_at,
        attachment.updated_at,
      );
  }

  getAttachment(id) {
    const row = this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id);
    return row ? rowToAttachment(row) : null;
  }

  listAttachments(nodeType, nodeId) {
    return this.db
      .prepare("SELECT * FROM attachments WHERE node_type = ? AND node_id = ? ORDER BY created_at ASC")
      .all(nodeType, nodeId)
      .map(rowToAttachment);
  }

  updateAttachment(id, patch) {
    const current = this.getAttachment(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE attachments SET type = ?, title = ?, content = ?, updated_at = ? WHERE id = ?`,
      )
      .run(next.type, next.title, next.content, next.updated_at, id);
    return next;
  }

  deleteAttachment(id) {
    const info = this.db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    return info.changes > 0;
  }

  // -- events -------------------------------------------------------------------

  insertEvent(event) {
    this.db
      .prepare(
        `INSERT INTO events (id, quest_id, node_type, node_id, event_type, previous_value, new_value, summary, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.quest_id,
        event.node_type,
        event.node_id,
        event.event_type,
        event.previous_value === null || event.previous_value === undefined ? null : JSON.stringify(event.previous_value),
        event.new_value === null || event.new_value === undefined ? null : JSON.stringify(event.new_value),
        event.summary,
        event.source,
        event.created_at,
      );
  }

  listEvents(questId) {
    return this.db
      .prepare("SELECT * FROM events WHERE quest_id = ? ORDER BY created_at ASC, id ASC")
      .all(questId)
      .map(rowToEvent);
  }
}

// ---------------------------------------------------------------------------
// Service — business rules, state transitions, and trace recording.
// ---------------------------------------------------------------------------

export class QuestJournalService {
  constructor(store) {
    this.store = store;
    this.todos = new TodoJournal(this);
  }

  // -- helpers -----------------------------------------------------------------

  _nextSortOrder(nodeType, parentId) {
    const siblings = nodeType === "quest" ? this.store.listQuests() : nodeType === "objective" ? this.store.listObjectives(parentId) : nodeType === "step" ? this.store.listSteps(parentId) : [];
    return siblings.reduce((max, node) => Math.max(max, node.sort_order + 1), 0);
  }

  _recordEvent(event, touch = true) {
    this.store.insertEvent(event);
    if (!touch) return;
    const ts = event.created_at;
    this.store.db.prepare("UPDATE quests SET updated_at = ? WHERE id = ?").run(ts, event.quest_id);
    const table = {quest: "quests", objective: "objectives", step: "steps"}[event.node_type];
    if (table) this.store.db.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(ts, event.node_id);
    if (event.node_type === "step") this.store.db.prepare("UPDATE objectives SET updated_at = ? WHERE id = (SELECT objective_id FROM steps WHERE id = ?)").run(ts, event.node_id);
  }

  _summarize(kind, nodeType, title) {
    const labels = { quest: "Quest", objective: "Objective", step: "Step" };
    const label = labels[nodeType] ?? nodeType;
    return `${label} "${title}" ${kind}`;
  }

  // Resolve the owning quest id for a node (for trace attribution + archive guard).
  _questIdOf(nodeType, nodeId) {
    if (nodeType === "quest") return nodeId;
    if (nodeType === "objective") {
      const objective = this.store.getObjective(nodeId);
      if (!objective) fail(`objective "${nodeId}" not found`, "NOT_FOUND");
      return objective.quest_id;
    }
    if (nodeType === "step") {
      const step = this.store.getStep(nodeId);
      if (!step) fail(`step "${nodeId}" not found`, "NOT_FOUND");
      const objective = this.store.getObjective(step.objective_id);
      if (!objective) fail(`objective "${step.objective_id}" not found`, "NOT_FOUND");
      return objective.quest_id;
    }
    fail(`unknown node_type "${nodeType}"`, "INVALID_NODE_TYPE");
  }

  // Throw when the owning quest is archived (read-only), except for the restore op.
  _guardNotArchived(questId) {
    const quest = this.store.getQuest(questId);
    if (!quest) fail(`quest "${questId}" not found`, "NOT_FOUND");
    if (quest.archived_at !== null) {
      fail(`quest "${questId}" is archived and read-only`, "QUEST_ARCHIVED");
    }
    return quest;
  }

  _requireNode(nodeType, nodeId) {
    validateNodeType(nodeType);
    const node = this.store.getNode(nodeType, nodeId);
    if (!node) fail(`${nodeType} "${nodeId}" not found`, "NOT_FOUND");
    return node;
  }

  // -- reads --------------------------------------------------------------------

  listQuests(options = {}) {
    const includeArchived = options.includeArchived === true;
    return this.store.listQuests().filter((q) => includeArchived || q.archived_at === null);
  }

  getQuest(questId) {
    const quest = this.store.getQuest(questId);
    if (!quest) return null;
    const objectives = this.store.listObjectives(questId).map((objective) => {
      const steps = this.store.listSteps(objective.id).map(step => ({ ...step, attachments: this.store.listAttachments("step", step.id) }));
      const attachments = this.store.listAttachments("objective", objective.id);
      return { ...objective, steps, attachments };
    });
    const attachments = this.store.listAttachments("quest", questId);
    return { ...quest, objectives, attachments };
  }

  getTrace(questId) {
    const quest = this.store.getQuest(questId);
    if (!quest) fail(`quest "${questId}" not found`, "NOT_FOUND");
    return this.store.listEvents(questId);
  }

  // -- quest creation -------------------------------------------------------------

  createQuest(input, source = "manual") {
    validateSource(source);
    const title = requireNonEmptyString(input?.title, "title");
    const description = optionalString(input?.description, "description");
    const quest = {
      id: randomUUID(),
      title,
      description,
      status: "open",
      is_blocked: false,
      blocked_reason: null,
      created_at: now(),
      completed_at: null,
      due_date: null, due_at: null, ...validateDeadline(input),
      archived_at: null,
      sort_order: this._nextSortOrder("quest"),
    };
    this.store.transaction(() => {
      this.store.insertQuest(quest);
      this._recordEvent({
        id: randomUUID(),
        quest_id: quest.id,
        node_type: "quest",
        node_id: quest.id,
        event_type: "created",
        previous_value: null,
        new_value: quest,
        summary: `Quest "${quest.title}" created`,
        source,
        created_at: quest.created_at,
      });
    });
    return quest;
  }

  // -- objective / step creation ----------------------------------------------------

  addObjective(questId, input, source = "manual") {
    validateSource(source);
    this._guardNotArchived(questId);
    const title = requireNonEmptyString(input?.title, "title");
    const description = optionalString(input?.description, "description");
    const objective = {
      id: randomUUID(),
      quest_id: questId,
      title,
      description,
      status: "open",
      is_blocked: false,
      blocked_reason: null,
      created_at: now(),
      completed_at: null,
      due_date: null, due_at: null, ...validateDeadline(input),
      sort_order: this._nextSortOrder("objective", questId),
    };
    this.store.transaction(() => {
      this.store.insertObjective(objective);
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: "objective",
        node_id: objective.id,
        event_type: "created",
        previous_value: null,
        new_value: objective,
        summary: `Objective "${objective.title}" created`,
        source,
        created_at: objective.created_at,
      });
    });
    return objective;
  }

  addStep(objectiveId, input, source = "manual") {
    validateSource(source);
    const objective = this._requireNode("objective", objectiveId);
    this._guardNotArchived(objective.quest_id);
    const title = requireNonEmptyString(input?.title, "title");
    const description = optionalString(input?.description, "description");
    const step = {
      id: randomUUID(),
      objective_id: objectiveId,
      title,
      description,
      status: "open",
      is_blocked: false,
      blocked_reason: null,
      created_at: now(),
      completed_at: null,
      due_date: null, due_at: null, ...validateDeadline(input),
      sort_order: this._nextSortOrder("step", objectiveId),
    };
    this.store.transaction(() => {
      this.store.insertStep(step);
      this._recordEvent({
        id: randomUUID(),
        quest_id: objective.quest_id,
        node_type: "step",
        node_id: step.id,
        event_type: "created",
        previous_value: null,
        new_value: step,
        summary: `Step "${step.title}" created`,
        source,
        created_at: step.created_at,
      });
    });
    return step;
  }

  // -- node update (title/description) -------------------------------------------

  updateNode(nodeType, nodeId, input, source = "manual") {
    validateSource(source);
    const node = this._requireNode(nodeType, nodeId);
    const questId = this._questIdOf(nodeType, nodeId);
    this._guardNotArchived(questId);

    if (!isRecord(input)) fail("input must be an object", "INVALID_INPUT");
    const patch = validateDeadline(input);
    if (input.priority !== undefined && !["P0", "P1", "P2"].includes(input.priority)) fail("Invalid priority", "INVALID_PRIORITY");
    if (input.sort_order !== undefined) {
      if (!Number.isSafeInteger(input.sort_order) || input.sort_order < 0) fail("Invalid sort order", "INVALID_SORT_ORDER");
      patch.sort_order = input.sort_order;
    }
    if (input.title !== undefined) patch.title = requireNonEmptyString(input.title, "title");
    if (input.description !== undefined) patch.description = optionalString(input.description, "description");

    let updated;
    this.store.transaction(() => {
      updated = this._applyNodePatch(nodeType, nodeId, patch);
      if (input.priority !== undefined) {
        this.store.db.prepare(`UPDATE ${{quest:"quests",objective:"objectives",step:"steps"}[nodeType]} SET priority = ? WHERE id = ?`).run(input.priority,nodeId);
        updated.priority = input.priority;
      }
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: nodeType,
        node_id: nodeId,
        event_type: "updated",
        previous_value: node,
        new_value: updated,
        summary: `${this._summarize("updated", nodeType, updated.title)}`,
        source,
        created_at: now(),
      });
    });
    return updated;
  }

  _applyNodePatch(nodeType, nodeId, patch) {
    if (nodeType === "quest") return this.store.updateQuest(nodeId, patch);
    if (nodeType === "objective") return this.store.updateObjective(nodeId, patch);
    if (nodeType === "step") return this.store.updateStep(nodeId, patch);
    fail(`unknown node_type "${nodeType}"`, "INVALID_NODE_TYPE");
  }

  // -- completion state ------------------------------------------------------------

  setCompleted(nodeType, nodeId, completed, source = "manual") {
    validateSource(source);
    validateBoolean(completed, "completed");
    const node = this._requireNode(nodeType, nodeId);
    const questId = this._questIdOf(nodeType, nodeId);
    this._guardNotArchived(questId);

    const targetStatus = completed ? "completed" : "open";
    if (node.status === targetStatus) {
      // Idempotent — no trace written, mirroring "already in that state".
      return node;
    }

    const patch = completed
      ? { status: "completed", completed_at: now() }
      : { status: "open", completed_at: null };

    let updated;
    this.store.transaction(() => {
      updated = this._applyNodePatch(nodeType, nodeId, patch);
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: nodeType,
        node_id: nodeId,
        event_type: completed ? "completed" : "uncompleted",
        previous_value: node,
        new_value: updated,
        summary: `${this._summarize(completed ? "completed" : "uncompleted", nodeType, updated.title)}`,
        source,
        created_at: updated.completed_at ?? now(),
      });
    });
    return updated;
  }

  toggleCompleted(nodeType, nodeId, source = "manual") {
    const node = this._requireNode(nodeType, nodeId);
    return this.setCompleted(nodeType, nodeId, node.status !== "completed", source);
  }

  // -- blocking state --------------------------------------------------------------

  setBlocked(nodeType, nodeId, blocked, reason, source = "manual") {
    validateSource(source);
    validateBoolean(blocked, "blocked");
    const node = this._requireNode(nodeType, nodeId);
    const questId = this._questIdOf(nodeType, nodeId);
    this._guardNotArchived(questId);

    reason = optionalString(reason, "blocked_reason").trim();
    if (blocked && node.is_blocked && node.blocked_reason === (reason || null)) return node;
    if (!blocked && !node.is_blocked) return node;

    const patch = blocked
      ? { is_blocked: true, blocked_reason: reason?.trim() ? reason.trim() : null }
      : { is_blocked: false, blocked_reason: null };

    let updated;
    this.store.transaction(() => {
      updated = this._applyNodePatch(nodeType, nodeId, patch);
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: nodeType,
        node_id: nodeId,
        event_type: blocked ? "blocked" : "unblocked",
        previous_value: node,
        new_value: updated,
        summary: `${this._summarize(blocked ? "blocked" : "unblocked", nodeType, updated.title)}${blocked && reason?.trim() ? `: ${reason.trim()}` : ""}`,
        source,
        created_at: now(),
      });
    });
    return updated;
  }

  // -- attachments -------------------------------------------------------------------

  addAttachment(nodeType, nodeId, input, source = "manual") {
    validateSource(source);
    const node = this._requireNode(nodeType, nodeId);
    const questId = this._questIdOf(nodeType, nodeId);
    this._guardNotArchived(questId);

    const type = validateAttachmentType(input?.type);
    const title = optionalString(input?.title, "title");
    const content = requireNonEmptyString(input?.content, "content");
    if (type === "link" && !/^https?:\/\//i.test(content)) {
      fail("link attachment content must be an http(s) URL", "INVALID_LINK");
    }

    const attachment = {
      id: randomUUID(),
      node_type: nodeType,
      node_id: nodeId,
      type,
      title,
      content,
      created_at: now(),
      updated_at: now(),
    };
    this.store.transaction(() => {
      this.store.insertAttachment(attachment);
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: nodeType,
        node_id: nodeId,
        event_type: "attachment_added",
        previous_value: null,
        new_value: attachment,
        summary: `Attachment added to ${nodeType} "${node.title}"`,
        source,
        created_at: attachment.created_at,
      });
    });
    return attachment;
  }

  updateAttachment(attachmentId, input, source = "manual") {
    validateSource(source);
    const attachment = this.store.getAttachment(attachmentId);
    if (!attachment) fail(`attachment "${attachmentId}" not found`, "NOT_FOUND");
    const questId = this._questIdOf(attachment.node_type, attachment.node_id);
    this._guardNotArchived(questId);

    const patch = { updated_at: now() };
    if (input.type !== undefined) patch.type = validateAttachmentType(input.type);
    if (input.title !== undefined) patch.title = optionalString(input.title, "title");
    if (input.content !== undefined) patch.content = requireNonEmptyString(input.content, "content");
    if ((patch.type ?? attachment.type) === "link" && !/^https?:\/\//i.test(patch.content ?? attachment.content)) {
      fail("link attachment content must be an http(s) URL", "INVALID_LINK");
    }

    let updated;
    this.store.transaction(() => {
      updated = this.store.updateAttachment(attachmentId, patch);
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: attachment.node_type,
        node_id: attachment.node_id,
        event_type: "attachment_updated",
        previous_value: attachment,
        new_value: updated,
        summary: `Attachment updated on ${attachment.node_type}`,
        source,
        created_at: updated.updated_at,
      });
    });
    return updated;
  }

  removeAttachment(attachmentId, source = "manual") {
    validateSource(source);
    const attachment = this.store.getAttachment(attachmentId);
    if (!attachment) fail(`attachment "${attachmentId}" not found`, "NOT_FOUND");
    const questId = this._questIdOf(attachment.node_type, attachment.node_id);
    this._guardNotArchived(questId);

    this.store.transaction(() => {
      this.store.deleteAttachment(attachmentId);
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: attachment.node_type,
        node_id: attachment.node_id,
        event_type: "attachment_removed",
        previous_value: attachment,
        new_value: null,
        summary: `Attachment removed from ${attachment.node_type}`,
        source,
        created_at: now(),
      });
    });
    return { removed: true, id: attachmentId };
  }

  // -- archive / restore ------------------------------------------------------------

  archiveQuest(questId, source = "manual") {
    validateSource(source);
    const quest = this._requireNode("quest", questId);
    if (quest.archived_at !== null) return quest;
    const patch = { archived_at: now() };
    let updated;
    this.store.transaction(() => {
      updated = this.store.updateQuest(questId, patch);
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: "quest",
        node_id: questId,
        event_type: "archived",
        previous_value: quest,
        new_value: updated,
        summary: `Quest "${updated.title}" archived`,
        source,
        created_at: updated.archived_at,
      });
    });
    return updated;
  }

  restoreQuest(questId, source = "manual") {
    validateSource(source);
    const quest = this._requireNode("quest", questId);
    if (quest.archived_at === null) return quest;
    const patch = { archived_at: null };
    let updated;
    this.store.transaction(() => {
      updated = this.store.updateQuest(questId, patch);
      this._recordEvent({
        id: randomUUID(),
        quest_id: questId,
        node_type: "quest",
        node_id: questId,
        event_type: "restored",
        previous_value: quest,
        new_value: updated,
        summary: `Quest "${updated.title}" restored`,
        source,
        created_at: now(),
      });
    });
    return updated;
  }

  deleteNode(nodeType, nodeId, source = "manual") {
    validateSource(source);
    const node = this._requireNode(nodeType, nodeId);
    const questId = this._questIdOf(nodeType, nodeId);
    this._guardNotArchived(questId);
    this.store.transaction(() => {
      const remove = (type, id) => {
        if (type === "quest") for (const o of this.store.listObjectives(id)) remove("objective", o.id);
        if (type === "objective") for (const s of this.store.listSteps(id)) remove("step", s.id);
        this.store.db.prepare("DELETE FROM attachments WHERE node_type = ? AND node_id = ?").run(type, id);
        this.store.db.prepare(`DELETE FROM ${{quest:"quests",objective:"objectives",step:"steps"}[type]} WHERE id = ?`).run(id);
      };
      const snapshot = nodeType === "quest" ? this.getQuest(nodeId) : nodeType === "objective" ? {...node, steps: this.store.listSteps(nodeId), attachments: this.store.listAttachments(nodeType, nodeId)} : {...node, attachments: this.store.listAttachments(nodeType, nodeId)};
      remove(nodeType, nodeId);
      this._recordEvent({id:randomUUID(), quest_id:questId, node_type:nodeType, node_id:nodeId, event_type:"deleted", previous_value:snapshot, new_value:null, summary:`Deleted ${node.title}`, source, created_at:now()});
    });
    return {removed:true, id:nodeId};
  }

  moveNode(nodeType, nodeId, targetType, parentId, source = "manual") {
    validateSource(source);
    const node = this._requireNode(nodeType, nodeId);
    const questId = this._questIdOf(nodeType, nodeId);
    this._guardNotArchived(questId);
    if (!((nodeType === "step" && targetType === "objective") || (nodeType === "objective" && targetType === "step"))) fail("Only objective/step level changes are supported", "INVALID_MOVE");
    if (nodeType === "objective" && this.store.listSteps(nodeId).length) fail("Move child steps first", "INVALID_MOVE");
    if (targetType === "objective" && parentId !== questId) fail("Parent must be the owning quest", "INVALID_MOVE");
    if (targetType === "step" && (parentId === nodeId || this._requireNode("objective", parentId).quest_id !== questId)) fail("Invalid parent", "INVALID_MOVE");
    return this.store.transaction(() => {
      const next = {...node, sort_order:this._nextSortOrder(targetType,parentId)};
      if (targetType === "objective") { delete next.objective_id; next.quest_id = parentId; this.store.insertObjective(next); }
      else { delete next.quest_id; next.objective_id = parentId; this.store.insertStep(next); }
      this.store.db.prepare(`UPDATE ${targetType === "step" ? "steps" : "objectives"} SET priority = ? WHERE id = ?`).run(node.priority,nodeId);
      this.store.db.prepare(`DELETE FROM ${nodeType === "step" ? "steps" : "objectives"} WHERE id = ?`).run(nodeId);
      this.store.db.prepare("UPDATE attachments SET node_type = ? WHERE node_type = ? AND node_id = ?").run(targetType,nodeType,nodeId);
      this._recordEvent({id:randomUUID(),quest_id:questId,node_type:targetType,node_id:nodeId,event_type:"moved",previous_value:node,new_value:next,summary:`Moved ${node.title}`,source,created_at:now()});
      return this._requireNode(targetType,nodeId);
    });
  }

  _questSortCompare(a, b, mode) {
    if (mode === "priority") return a.priority.localeCompare(b.priority);
    if (mode === "updated") return b.updated_at - a.updated_at;
    if (mode === "created") return b.created_at - a.created_at;
    return a.sort_order - b.sort_order;
  }

  _compatibleQuestSort(mode) {
    if (mode === "manual") return "manual";
    const nodes = this.listQuests();
    return nodes.every((node, i) => i === 0 || this._questSortCompare(nodes[i - 1], node, mode) <= 0) ? mode : "manual";
  }

  // Anchor-based reorder: resolve the latest siblings inside one transaction,
  // rather than accepting a client snapshot that could erase concurrent edits.
  reorderNode(nodeType, nodeId, parentId, targetId, position, source = "manual", sortMode = "manual") {
    validateSource(source);
    if (!["manual", "priority", "updated", "created"].includes(sortMode) || (nodeType !== "quest" && sortMode !== "manual")) fail("Invalid sort mode", "INVALID_SORT_MODE");
    if (!["before", "after", "end"].includes(position)) fail("Invalid drop position", "INVALID_POSITION");
    return this.store.transaction(() => {
      const node = this._requireNode(nodeType, nodeId);
      const questId = this._questIdOf(nodeType, nodeId);
      this._guardNotArchived(questId);
      const previousParent = nodeType === "step" ? node.objective_id : nodeType === "objective" ? node.quest_id : null;
      if (nodeType === "quest" && parentId != null) fail("Quest has no parent", "INVALID_PARENT");
      if (nodeType === "objective" && parentId !== questId) fail("Cannot move an objective to another quest", "INVALID_MOVE");
      if (nodeType === "step") {
        if (typeof parentId !== "string" || !parentId) fail("Step requires a destination objective", "INVALID_PARENT");
        const objective = this._requireNode("objective", parentId);
        if (objective.quest_id !== questId) fail("Cannot move a step to another quest", "INVALID_MOVE");
      }
      const siblings = parent => nodeType === "quest"
        ? this.listQuests()
        : nodeType === "objective" ? this.store.listObjectives(parent) : this.store.listSteps(parent);
      const oldList = siblings(previousParent);
      const destination = siblings(parentId);
      if (nodeType === "quest") destination.sort((a,b) => this._questSortCompare(a,b,sortMode) || a.sort_order-b.sort_order);
      if (position !== "end") {
        if (typeof targetId !== "string" || !destination.some(n => n.id === targetId)) fail("Drop target is no longer in this list", "INVALID_TARGET");
        if (targetId === nodeId) return node;
      } else if (targetId != null) fail("End position must not specify a target", "INVALID_TARGET");
      const ordered = destination.filter(n => n.id !== nodeId);
      const index = position === "end" ? ordered.length : ordered.findIndex(n => n.id === targetId) + (position === "after" ? 1 : 0);
      ordered.splice(index, 0, node);
      if (previousParent === parentId && ordered.every((n, i) => n.id === oldList[i]?.id)) return node;
      if (nodeType === "step" && parentId !== previousParent) {
        this.store.db.prepare("UPDATE steps SET objective_id = ? WHERE id = ?").run(parentId, nodeId);
        oldList.filter(n => n.id !== nodeId).forEach((n, i) => {
          if (n.sort_order !== i) this._applyNodePatch(nodeType, n.id, { sort_order: i });
        });
      }
      ordered.forEach((n, i) => {
        if (n.sort_order !== i) this._applyNodePatch(nodeType, n.id, { sort_order: i });
      });
      const updated = this._requireNode(nodeType, nodeId), timestamp = now();
      if (nodeType === "step" && previousParent !== parentId) this.store.db.prepare("UPDATE objectives SET updated_at = ? WHERE id = ?").run(timestamp, previousParent);
      this._recordEvent({id:randomUUID(),quest_id:questId,node_type:nodeType,node_id:nodeId,event_type:"reordered",
        previous_value:{node,parent_id:previousParent,order:oldList.map(n=>n.id)},
        new_value:{node:updated,parent_id:parentId,order:ordered.map(n=>n.id)},
        summary:previousParent === parentId ? `Reordered ${node.title}` : `Moved step ${node.title} to ${this.store.getObjective(parentId).title}`,
        source,created_at:timestamp}, nodeType !== "quest");
      return this._requireNode(nodeType, nodeId);
    });
  }

  // -- batch apply ---------------------------------------------------------------------

  // Accepts a list of operations, each `{ op, ...args }`, applied atomically.
  applyChanges(changes, source = "manual") {
    validateSource(source);
    if (!Array.isArray(changes)) fail("changes must be an array", "INVALID_CHANGES");
    const results = [];
    const refs = new Map();
    this.store.transaction(() => {
      for (const raw of changes) {
        let change = raw;
        if (!isRecord(change) || typeof change.op !== "string") {
          fail("each change must be an object with a string `op`", "INVALID_CHANGES");
        }
        change = { ...change };
        if (change.ref !== undefined && (typeof change.ref !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(change.ref) || refs.has(change.ref) || !["create_quest", "add_objective", "add_step"].includes(change.op))) fail("Invalid or duplicate ref", "INVALID_REF");
        for (const key of ["quest_id", "objective_id", "node_id", "parent_id", "target_id"]) {
          if (typeof change[key] === "string" && change[key].startsWith("$")) {
            const id = refs.get(change[key].slice(1));
            if (!id) fail(`Unknown reference ${change[key]}`, "INVALID_REF");
            change[key] = id;
          }
        }
        const result = this._applyOne(change, source);
        if (change.ref) refs.set(change.ref, result.node.id);
        results.push(result);
      }
    });
    return results;
  }

  _applyOne(change, source) {
    switch (change.op) {
      case "create_todo": return {op:change.op, node:this.todos.create(change,source)};
      case "update_todo": return {op:change.op, node:this.todos.update(change.todo_id,change,source)};
      case "convert_todo": return {op:change.op, node:this.todos.convert(change.todo_id,change,source)};
      case "undo_todo_conversion": return {op:change.op, node:this.todos.undoConversion(change.todo_id,source,change.target_id)};
      case "delete_todo": return {op:change.op, node:this.todos.remove(change.todo_id,source)};
      case "restore_todo": return {op:change.op, node:this.todos.restore(change.todo_id,source)};
      case "reorder_node": {
        const mode = change.sort_mode ?? "manual";
        const node = this.reorderNode(change.node_type,change.node_id,change.parent_id ?? null,change.target_id ?? null,change.position,source,mode);
        return {op:change.op, node, ...(change.node_type === "quest" ? {sort_mode:this._compatibleQuestSort(mode)} : {})};
      }
      case "delete_node": return {op:change.op, node:this.deleteNode(change.node_type,change.node_id,source)};
      case "move_node": return {op:change.op, node:this.moveNode(change.node_type,change.node_id,change.target_type,change.parent_id,source)};
      case "create_quest":
        return { op: change.op, node: this.createQuest(change, source) };
      case "add_objective":
        return { op: change.op, node: this.addObjective(change.quest_id, change, source) };
      case "add_step":
        return { op: change.op, node: this.addStep(change.objective_id, change, source) };
      case "update_node":
        return { op: change.op, node: this.updateNode(change.node_type, change.node_id, change, source) };
      case "set_completed":
        return { op: change.op, node: this.setCompleted(change.node_type, change.node_id, change.completed, source) };
      case "toggle_completed":
        return { op: change.op, node: this.toggleCompleted(change.node_type, change.node_id, source) };
      case "set_blocked":
        return { op: change.op, node: this.setBlocked(change.node_type, change.node_id, change.blocked, change.blocked_reason, source) };
      case "add_attachment":
        return { op: change.op, node: this.addAttachment(change.node_type, change.node_id, change, source) };
      case "update_attachment":
        return { op: change.op, node: this.updateAttachment(change.attachment_id, change, source) };
      case "remove_attachment":
        return { op: change.op, node: this.removeAttachment(change.attachment_id, source) };
      case "archive_quest":
        return { op: change.op, node: this.archiveQuest(change.quest_id, source) };
      case "restore_quest":
        return { op: change.op, node: this.restoreQuest(change.quest_id, source) };
      default:
        fail(`unknown op "${change.op}"`, "INVALID_OP");
    }
  }
}

export { now as nextTimestamp };
