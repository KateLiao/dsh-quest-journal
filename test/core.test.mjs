import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QuestJournalStore,
  QuestJournalService,
  QuestJournalError,
} from "../packages/dsh-quest-journal/lib/quest-core.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error?.stack ?? error}`);
  }
}

function freshService() {
  const dir = mkdtempSync(join(tmpdir(), "qj-test-"));
  const dbPath = join(dir, "journal.db");
  const store = new QuestJournalStore(dbPath);
  const service = new QuestJournalService(store);
  return { dir, dbPath, store, service };
}

console.log("# Quest Journal core tests\n");

test("AC01 — create quest, add objectives and steps", () => {
  const { service } = freshService();
  const quest = service.createQuest({ title: "机器人说话人定位方案验证" });
  assert.equal(quest.status, "open");
  assert.equal(quest.archived_at, null);

  const o1 = service.addObjective(quest.id, { title: "技术方案确认" });
  const o2 = service.addObjective(quest.id, { title: "测试验收" });
  assert.equal(o1.quest_id, quest.id);
  assert.equal(o2.quest_id, quest.id);

  const s1 = service.addStep(o1.id, { title: "确认 UWB 方案" });
  const s2 = service.addStep(o2.id, { title: "收集定位误差数据" });
  assert.equal(s1.objective_id, o1.id);
  assert.equal(s2.objective_id, o2.id);

  const tree = service.getQuest(quest.id);
  assert.equal(tree.objectives.length, 2);
  assert.equal(tree.objectives[0].steps.length, 1);
  assert.equal(tree.objectives[1].steps.length, 1);
});

test("AC02 — complete / uncomplete on all three levels", () => {
  const { service } = freshService();
  const q = service.createQuest({ title: "Q" });
  const o = service.addObjective(q.id, { title: "O" });
  const s = service.addStep(o.id, { title: "S" });

  // step complete
  const sDone = service.setCompleted("step", s.id, true);
  assert.equal(sDone.status, "completed");
  assert.ok(sDone.completed_at > 0);

  // uncomplete
  const sUndo = service.setCompleted("step", s.id, false);
  assert.equal(sUndo.status, "open");
  assert.equal(sUndo.completed_at, null);

  // objective complete
  const oDone = service.setCompleted("objective", o.id, true);
  assert.equal(oDone.status, "completed");

  // quest complete (parent completes even though child step is open — allowed)
  const qDone = service.setCompleted("quest", q.id, true);
  assert.equal(qDone.status, "completed");

  // toggle works
  const qToggle = service.toggleCompleted("quest", q.id);
  assert.equal(qToggle.status, "open");
});

test("AC02 — block / unblock with reason", () => {
  const { service } = freshService();
  const q = service.createQuest({ title: "Q" });
  const o = service.addObjective(q.id, { title: "O" });

  const blocked = service.setBlocked("objective", o.id, true, "等算法提供定位误差数据");
  assert.equal(blocked.is_blocked, true);
  assert.equal(blocked.blocked_reason, "等算法提供定位误差数据");

  const unblocked = service.setBlocked("objective", o.id, false);
  assert.equal(unblocked.is_blocked, false);
  assert.equal(unblocked.blocked_reason, null);
});

test("AC03 — attachments on all three levels", () => {
  const { service } = freshService();
  const q = service.createQuest({ title: "Q" });
  const o = service.addObjective(q.id, { title: "O" });
  const s = service.addStep(o.id, { title: "S" });

  const link = service.addAttachment("quest", q.id, {
    type: "link",
    title: "飞书文档",
    content: "https://example.feishu.cn/doc/123",
  });
  assert.equal(link.type, "link");

  const note = service.addAttachment("objective", o.id, {
    type: "text",
    title: "备注",
    content: "# 一些 Markdown\n- 要点",
  });
  assert.equal(note.type, "text");

  const sNote = service.addAttachment("step", s.id, { type: "text", content: "进展记录" });
  assert.equal(sNote.type, "text");

  const tree = service.getQuest(q.id);
  assert.equal(tree.attachments.length, 1);
  assert.equal(tree.objectives[0].attachments.length, 1);
  assert.equal(tree.objectives[0].steps[0].attachments[0].id, sNote.id); // steps list attachments separately

  // update
  const updated = service.updateAttachment(note.id, { content: "改过的内容" });
  assert.equal(updated.content, "改过的内容");

  // remove
  const removed = service.removeAttachment(note.id);
  assert.equal(removed.removed, true);
});

test("link attachment must be http(s)", () => {
  const { service } = freshService();
  const q = service.createQuest({ title: "Q" });
  assert.throws(
    () => service.addAttachment("quest", q.id, { type: "link", content: "not-a-url" }),
    QuestJournalError,
  );
});

test("AC05 — archive removes from active list, restore brings it back", () => {
  const { service } = freshService();
  const q = service.createQuest({ title: "Q" });

  service.archiveQuest(q.id);
  assert.equal(service.listQuests().length, 0);
  assert.equal(service.listQuests({ includeArchived: true }).length, 1);

  const tree = service.getQuest(q.id);
  assert.ok(tree.archived_at > 0);

  service.restoreQuest(q.id);
  assert.equal(service.listQuests().length, 1);
  assert.equal(service.getQuest(q.id).archived_at, null);
});

test("archived quest is read-only", () => {
  const { service } = freshService();
  const q = service.createQuest({ title: "Q" });
  const o = service.addObjective(q.id, { title: "O" });
  service.archiveQuest(q.id);

  assert.throws(() => service.addObjective(q.id, { title: "O2" }), QuestJournalError);
  assert.throws(() => service.setCompleted("objective", o.id, true), QuestJournalError);
  assert.throws(() => service.addAttachment("quest", q.id, { type: "text", content: "x" }), QuestJournalError);

  // restore still works
  service.restoreQuest(q.id);
  service.addObjective(q.id, { title: "O2" });
});

test("AC06 — trace records key operations in order", () => {
  const { service } = freshService();
  const q = service.createQuest({ title: "Q" });
  const o = service.addObjective(q.id, { title: "O" });
  service.setCompleted("objective", o.id, true);
  service.setBlocked("quest", q.id, true, "阻塞原因");
  service.archiveQuest(q.id);

  const trace = service.getTrace(q.id);
  const types = trace.map((e) => e.event_type);
  assert.deepEqual(types, ["created", "created", "completed", "blocked", "archived"]);
  assert.ok(trace.every((e) => e.created_at > 0));
  assert.ok(trace.every((e) => e.summary.length > 0));
  assert.ok(trace.every((e) => e.source === "manual"));
});

test("trace persists across reopen", () => {
  const { dbPath, service } = freshService();
  const q = service.createQuest({ title: "Q" });
  service.store.close();

  const store2 = new QuestJournalStore(dbPath);
  const service2 = new QuestJournalService(store2);
  const trace = service2.getTrace(q.id);
  assert.equal(trace.length, 1);
  assert.equal(trace[0].event_type, "created");
  assert.equal(service2.getQuest(q.id).title, "Q");
});

test("applyChanges batch is atomic", () => {
  const { service } = freshService();
  assert.throws(
    () =>
      service.applyChanges(
        [
          { op: "create_quest", title: "批量任务" },
          { op: "add_objective", quest_id: "PLACEHOLDER", title: "O" },
        ],
        "agent",
      ),
    QuestJournalError,
  );
  // the whole batch rolled back: no quest remains
  assert.equal(service.listQuests().length, 0);
});

test("applyChanges batch records agent source", () => {
  const { service } = freshService();
  const results = service.applyChanges([{ op: "create_quest", title: "批量任务" }], "agent");
  assert.equal(results.length, 1);
  assert.equal(results[0].node.title, "批量任务");

  const trace = service.getTrace(results[0].node.id);
  assert.equal(trace[0].source, "agent");
});

test("validation rejects empty title", () => {
  const { service } = freshService();
  assert.throws(() => service.createQuest({ title: "  " }), QuestJournalError);
});

test("unknown node type rejected", () => {
  const { service } = freshService();
  assert.throws(() => service.updateNode("bogus", "x", { title: "y" }), QuestJournalError);
});

test("AC09 — missing nodes fail loudly instead of silently mis-updating", () => {
  const { service } = freshService();
  // getQuest on a missing id returns null (caller can tell it does not exist)
  assert.equal(service.getQuest("no-such-id"), null);

  // mutations on missing nodes throw NOT_FOUND with a stable code
  assert.throws(() => service.updateNode("step", "no-such-step", { title: "x" }), (e) => e.code === "NOT_FOUND");
  assert.throws(() => service.setCompleted("objective", "no-such-obj", true), (e) => e.code === "NOT_FOUND");
  assert.throws(() => service.addStep("no-such-obj", { title: "x" }), (e) => e.code === "NOT_FOUND");
  assert.throws(() => service.getTrace("no-such-quest"), (e) => e.code === "NOT_FOUND");
  assert.throws(() => service.archiveQuest("no-such-quest"), (e) => e.code === "NOT_FOUND");
});

test("blocking a completed node still records history", () => {
  const { service } = freshService();
  const q = service.createQuest({ title: "Q" });
  const o = service.addObjective(q.id, { title: "O" });
  service.setCompleted("objective", o.id, true);
  service.setBlocked("objective", o.id, true, "历史阻塞");
  const trace = service.getTrace(q.id).map((e) => e.event_type);
  assert.deepEqual(trace, ["created", "created", "completed", "blocked"]);
  // blocked state persists alongside completed status (independent fields)
  assert.equal(service.getQuest(q.id).objectives[0].is_blocked, true);
  assert.equal(service.getQuest(q.id).objectives[0].status, "completed");
});

test("v0.2 metadata, priority, ordering survive reopen", () => {
  const {service,dbPath,store}=freshService();
  const q=service.createQuest({title:"Q"});
  service.updateNode("quest",q.id,{priority:"P0",sort_order:5});
  const before=service.getQuest(q.id).updated_at;
  const o=service.addObjective(q.id,{title:"O"});
  const step=service.addStep(o.id,{title:"S"});
  service.updateNode("step",step.id,{title:"Changed"});
  assert.ok(service.getQuest(q.id).updated_at>before);
  store.close();
  const reopened=new QuestJournalStore(dbPath);
  const tree=new QuestJournalService(reopened).getQuest(q.id);
  assert.equal(tree.priority,"P0");assert.equal(tree.sort_order,5);
  assert.ok(tree.objectives[0].updated_at>o.created_at);
  reopened.close();
});
test("v0.2 move preserves identity, attachments, completion and history",()=>{
  const {service}=freshService();const q=service.createQuest({title:"Q"});
  const a=service.addObjective(q.id,{title:"A"}), b=service.addObjective(q.id,{title:"B"});
  const note=service.addAttachment("objective",b.id,{type:"text",content:"keep"});
  service.setCompleted("objective",b.id,true);
  service.moveNode("objective",b.id,"step",a.id);
  let tree=service.getQuest(q.id);assert.equal(tree.objectives.length,1);
  assert.equal(tree.objectives[0].steps[0].attachments[0].id,note.id);
  assert.equal(tree.objectives[0].steps[0].status,"completed");
  service.moveNode("step",b.id,"objective",q.id);
  assert.equal(service.getQuest(q.id).objectives.length,2);
  service.addStep(a.id,{title:"Child"});
  assert.throws(()=>service.moveNode("objective",a.id,"step",b.id),e=>e.code==="INVALID_MOVE");
  service.archiveQuest(q.id);
  assert.throws(()=>service.deleteNode("objective",a.id),e=>e.code==="QUEST_ARCHIVED");
});
test("v0.2 cascading delete is atomic and retains trace",()=>{
  const {service}=freshService();const q=service.createQuest({title:"Q"});
  const o=service.addObjective(q.id,{title:"O"}), step=service.addStep(o.id,{title:"S"});
  service.addAttachment("step",step.id,{type:"text",content:"note"});
  assert.throws(()=>service.applyChanges([{op:"delete_node",node_type:"objective",node_id:o.id},{op:"invalid"}]));
  assert.equal(service.getQuest(q.id).objectives.length,1);
  service.deleteNode("objective",o.id);
  assert.equal(service.getQuest(q.id).objectives.length,0);
  assert.equal(service.store.listAttachments("step",step.id).length,0);
  assert.equal(service.getTrace(q.id).at(-1).event_type,"deleted");
});
test("link edits and block reason changes validate and persist",()=>{
  const {service}=freshService();const q=service.createQuest({title:"Q"});
  const a=service.addAttachment("quest",q.id,{type:"link",content:"https://example.com"});
  assert.throws(()=>service.updateAttachment(a.id,{content:"javascript:alert(1)"}),e=>e.code==="INVALID_LINK");
  service.setBlocked("quest",q.id,true,"first");service.setBlocked("quest",q.id,true,"second");
  assert.equal(service.getQuest(q.id).blocked_reason,"second");
  assert.throws(()=>service.updateNode("quest",q.id,{priority:"P3"}),e=>e.code==="INVALID_PRIORITY");
});
test("v0.1 database migration preserves existing rows",()=>{
  const {store,dbPath,service}=freshService();const q=service.createQuest({title:"Old"});
  for(const table of ["quests","objectives","steps"]){store.db.exec(`ALTER TABLE ${table} DROP COLUMN priority`);store.db.exec(`ALTER TABLE ${table} DROP COLUMN updated_at`);store.db.exec(`ALTER TABLE ${table} DROP COLUMN due_date`);store.db.exec(`ALTER TABLE ${table} DROP COLUMN due_at`);}
  store.close();const migrated=new QuestJournalStore(dbPath);
  const old=migrated.getQuest(q.id);assert.equal(old.title,"Old");assert.equal(old.priority,"P1");assert.equal(old.updated_at,old.created_at);assert.equal(old.due_date,null);assert.equal(old.due_at,null);migrated.close();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
