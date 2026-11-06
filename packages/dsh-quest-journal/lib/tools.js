// Quest Journal — Agent tools (`quest_*`).
//
// Registered in-process against the shared journal service. Every write records
// `source: "agent"` so the Trace distinguishes agent changes from panel edits.
//
// This file must not import `@deepseek-ai/*`: the loader resolves plugin
// modules with plain Node resolution from the profile, where DSH's own packages
// are not visible. Tool definitions are therefore declared with the raw JSON
// Schema that `defineTool` would have produced, and registered directly.

import { getJournal } from "./journal.mjs";

const name = "tool-quest-journal";
const inject = ["tools", "systemPrompt"];

// Fallback prompt-section order: after the built-in tool sections and the MCP
// server list, before the tools SDK guide. `dsh-system-prompt` only allocates
// orders for repository-owned sections, so a third-party name resolves to
// `undefined` and `section()` rejects a non-finite order.
const QUEST_JOURNAL_SECTION_ORDER = 3200;

const NODE_TYPE_ENUM = ["quest", "objective", "step"];
const PARENT_TYPE_ENUM = ["quest", "objective"];
const STATUS_ENUM = ["open", "completed"];
const ATTACHMENT_TYPE_ENUM = ["text", "link"];

function ok(value) {
  return { ok: true, ...value };
}

function failOf(error) {
  const code = typeof error?.code === "string" ? error.code : "QUEST_JOURNAL_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code, message } };
}

function guard(fn) {
  try {
    return fn();
  } catch (error) {
    return failOf(error);
  }
}

const JSON_OUTPUT = {
  // `{}` is the supported "any JSON value" schema; tool results are objects.
  schema: {},
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

function present(title, kind) {
  return { card: "generic", title, kind };
}

/**
 * Convert the compact parameter DSL into the JSON Schema subset the tool
 * registry accepts (type/oneOf/properties/required/items/enum/const +
 * description/title). `required: true` is hoisted to the object's `required`.
 */
function toJsonSchema(parameters) {
  const properties = {};
  const required = [];
  for (const [key, spec] of Object.entries(parameters)) {
    const { required: isRequired, ...rest } = spec;
    properties[key] = rest.type === "json" ? {} : rest;
    if (isRequired === true) required.push(key);
  }
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

/** Normalize a tool declaration the way `defineTool` did, without its imports. */
function defineTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: toJsonSchema(options.parameters ?? {}),
    output: options.output,
    execute: options.execute,
    ...(options.presentCall ? { presentCall: options.presentCall } : {}),
  };
}

/**
 * Register the prompt section and the 11 `quest_*` tools.
 * @param {object} ctx - plugin context (with `tools` and `systemPrompt`).
 * @param {object} journal - the shared `QuestJournalService`.
 */
export function registerTools(ctx, journal) {
  ctx.systemPrompt.section({
    name: "tool:quest-journal",
    order: ctx.systemPrompt.getSectionOrder("TOOL_QUEST_JOURNAL") ?? QUEST_JOURNAL_SECTION_ORDER,
    text: [
      "Quest Journal tools update the user's task journal (Quest → Objective → Step).",
      "Rules:",
      "- Only update nodes the user explicitly asked to change; do not infer completion from \"discussed\", \"in progress\", or \"about to finish\".",
      "- Only explicit \"完成/complete\" wording may mark a node completed.",
      "- When a quest or node name is ambiguous, use quest_list/quest_get to find candidates; never silently pick among multiple matches.",
      "- Never invent document links, progress details, or completion times.",
      "- Archive requires an unambiguous quest; confirm when a name is ambiguous.",
      "- Prefer quest_apply_changes to submit several related updates in one batch. New create_quest/add_objective/add_step changes may define a unique ref (e.g. prd); later id fields may reference $prd.",
      "- When organizing plans, goal titles such as 完成 PRD describe intended outcomes, not achieved completion. Preserve ongoing progress in descriptions or notes; planned steps remain open.",
      "- Reuse an unambiguous existing objective, avoid duplicate steps; ask when several nodes match. Mentioning 协作者 or another person never authorizes sending messages or scheduling meetings.",
    ].join("\n"),
  });

  ctx.tools.register(defineTool({
    name: "quest_list",
    description: "List quests in the task journal, optionally including archived ones. Use this to locate a quest (or resolve a name ambiguity) before updating it.",
    parameters: {
      include_archived: { type: "boolean", description: "Include archived quests. Defaults to false." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return journal.listQuests({ includeArchived: args.include_archived === true });
    },
    presentCall: () => present("List quests", "read"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_get",
    description: "Read the full tree of one quest: its objectives, their steps, and all attachments.",
    parameters: {
      quest_id: { type: "string", required: true, description: "Exact quest id from quest_list." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return journal.getQuest(args.quest_id);
    },
    presentCall: () => present("Read quest", "read"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_get_trace",
    description: "Read the change history (trace) of one quest in chronological order.",
    parameters: {
      quest_id: { type: "string", required: true, description: "Exact quest id." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return journal.getTrace(args.quest_id);
    },
    presentCall: () => present("Read quest trace", "read"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_create",
    description: "Create a new top-level quest (task).",
    parameters: {
      title: { type: "string", required: true, description: "Quest title, e.g. \"机器人说话人定位方案验证\"." },
      description: { type: "string", description: "Optional longer description." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return guard(() => ok({ quest: journal.createQuest({ title: args.title, description: args.description }, "agent") }));
    },
    presentCall: () => present("Create quest", "other"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_add_node",
    description: "Add a node to the journal: an Objective under a Quest (parent_type \"quest\"), or a Step under an Objective (parent_type \"objective\").",
    parameters: {
      parent_type: { type: "string", required: true, enum: PARENT_TYPE_ENUM, description: "\"quest\" to add an objective, \"objective\" to add a step." },
      parent_id: { type: "string", required: true, description: "Id of the parent quest or objective." },
      title: { type: "string", required: true, description: "Node title." },
      description: { type: "string", description: "Optional longer description or progress note." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return guard(() => {
        const node = args.parent_type === "quest"
          ? journal.addObjective(args.parent_id, { title: args.title, description: args.description }, "agent")
          : journal.addStep(args.parent_id, { title: args.title, description: args.description }, "agent");
        return ok({ node });
      });
    },
    presentCall: (args) => present(args.parent_type === "quest" ? "Add objective" : "Add step", "other"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_update_node",
    description: "Update a quest, objective, or step: edit title/description, mark completed/uncompleted (status), or set/clear a block (is_blocked + blocked_reason). Only fields the user asked to change should be provided.",
    parameters: {
      node_type: { type: "string", required: true, enum: NODE_TYPE_ENUM, description: "quest | objective | step." },
      node_id: { type: "string", required: true, description: "Exact node id." },
      title: { type: "string", description: "Replacement title." },
      description: { type: "string", description: "Replacement description." },
      priority: { type: "string", enum: ["P0", "P1", "P2"], description: "Task priority." },
      status: { type: "string", enum: STATUS_ENUM, description: "Explicit completion state; \"completed\" only when the user said it is done." },
      is_blocked: { type: "boolean", description: "True to block, false to unblock." },
      blocked_reason: { type: "string", description: "Reason; only meaningful together with is_blocked: true." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return guard(() => {
        let node;
        if (args.title !== undefined || args.description !== undefined || args.priority !== undefined) {
          node = journal.updateNode(args.node_type, args.node_id, {
            ...(args.priority !== undefined ? { priority: args.priority } : {}),
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.description !== undefined ? { description: args.description } : {}),
          }, "agent");
        }
        if (args.status !== undefined) {
          node = journal.setCompleted(args.node_type, args.node_id, args.status === "completed", "agent");
        }
        if (args.is_blocked !== undefined) {
          node = journal.setBlocked(args.node_type, args.node_id, args.is_blocked, args.blocked_reason, "agent");
        }
        return ok({ node });
      });
    },
    presentCall: () => present("Update node", "other"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_add_attachment",
    description: "Attach a text note (basic Markdown) or a document link to a quest, objective, or step.",
    parameters: {
      node_type: { type: "string", required: true, enum: NODE_TYPE_ENUM },
      node_id: { type: "string", required: true },
      type: { type: "string", required: true, enum: ATTACHMENT_TYPE_ENUM, description: "\"text\" for a note, \"link\" for a URL." },
      title: { type: "string", description: "Optional short title." },
      content: { type: "string", required: true, description: "Note text (Markdown) or http(s) URL." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return guard(() => ok({ attachment: journal.addAttachment(args.node_type, args.node_id, { type: args.type, title: args.title, content: args.content }, "agent") }));
    },
    presentCall: () => present("Add attachment", "other"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_update_attachment",
    description: "Update an existing attachment's type, title, or content.",
    parameters: {
      attachment_id: { type: "string", required: true },
      type: { type: "string", enum: ATTACHMENT_TYPE_ENUM },
      title: { type: "string" },
      content: { type: "string" },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return guard(() => ok({ attachment: journal.updateAttachment(args.attachment_id, {
        ...(args.type !== undefined ? { type: args.type } : {}),
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.content !== undefined ? { content: args.content } : {}),
      }, "agent") }));
    },
    presentCall: () => present("Update attachment", "other"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_archive",
    description: "Archive a quest. Archiving makes it read-only and moves it out of the active list; it can be restored later.",
    parameters: {
      quest_id: { type: "string", required: true, description: "Exact quest id. Confirm when the name is ambiguous." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return guard(() => ok({ quest: journal.archiveQuest(args.quest_id, "agent") }));
    },
    presentCall: () => present("Archive quest", "other"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_restore",
    description: "Restore an archived quest so it can be edited again.",
    parameters: {
      quest_id: { type: "string", required: true },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return guard(() => ok({ quest: journal.restoreQuest(args.quest_id, "agent") }));
    },
    presentCall: () => present("Restore quest", "other"),
  }));

  ctx.tools.register(defineTool({
    name: "quest_apply_changes",
    description: "Apply a batch of journal changes atomically. Each change is { op, ... }. Supported ops: create_quest, add_objective, add_step, update_node, set_completed, toggle_completed, set_blocked, add_attachment, update_attachment, remove_attachment, archive_quest, restore_quest, delete_node, move_node, reorder_node. reorder_node uses node_type/node_id/parent_id/target_id/position(before|after|end); end requires no target_id, quests have null parent_id, steps may move to another objective within the same quest. delete_node uses node_type/node_id and deletes descendants; move_node uses node_type/node_id/target_type/parent_id (objective ↔ step within the same quest). update_node accepts priority (P0/P1/P2) and sort_order.",
    parameters: {
      changes: { type: "json", required: true, description: "Array of change objects, applied atomically in order. New nodes may define ref (e.g. prd); later quest_id/objective_id/node_id/parent_id may use $prd." },
    },
    output: JSON_OUTPUT,
    execute(args) {
      return guard(() => ok({ results: journal.applyChanges(args.changes, "agent") }));
    },
    presentCall: () => present("Apply quest changes", "other"),
  }));
}

/** Plugin body: tools only (the web panel is the sibling `./web` entry). */
export function apply(ctx, config) {
  registerTools(ctx, getJournal(config?.dbPath).service);
}

export { name, inject };
