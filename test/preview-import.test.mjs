// Tests for the preview's “载入导出数据” path (preview/index.html).
//
// The preview is a single HTML file with an inline script, so these tests run
// that script against a minimal DOM mock and then feed it a JSON snapshot in
// the same shape `scripts/export-journal.mjs` writes.

import { readFileSync } from "node:fs";
import vm from "node:vm";

const rootUrl = new URL("../", import.meta.url);
const html = readFileSync(new URL("preview/index.html", rootUrl), "utf8");
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!inline) {
  console.error("FAIL preview/index.html has no inline script");
  process.exit(1);
}

// --- DOM mock ---------------------------------------------------------------
function makeElement(id) {
  return {
    id,
    innerHTML: "",
    textContent: "",
    files: [],
    dataset: {},
    clicked: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    click() { this.clicked += 1; },
  };
}

const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  },
  querySelectorAll: () => [],
  addEventListener() {},
};

const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
};

const context = vm.createContext({
  document,
  localStorage,
  location: { protocol: "file:" },
  crypto: globalThis.crypto,
  setTimeout,
  clearTimeout,
  console,
  JSON,
  Date,
  Math,
  fetch: () => Promise.reject(new Error("not available in tests")),
  confirm: () => true,
  prompt: () => null,
});

vm.runInContext(inline, context, { filename: "preview-inline.js" });
await new Promise((resolve) => setTimeout(resolve, 20));

// --- assertions ------------------------------------------------------------
let passed = 0;
const failures = [];
function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

const byTitle = (list, title) => list.find((node) => node.title === title);

console.log("# Quest Journal preview import tests");

// first run without any snapshot still shows the demo quest
check(
  document.getElementById("detail").innerHTML.includes("机器人说话人定位方案验证"),
  "file:// first run falls back to the demo quest",
);

// -- normalizeImport: shape, mapping, orphan handling -------------------------
const fixture = {
  format: "quest-journal-export/v1",
  quests: [
    { id: "q1", title: "Quest One", description: "优先级：P0", status: "open", is_blocked: 0,
      blocked_reason: null, created_at: 1000, completed_at: null, archived_at: null, sort_order: 0 },
    { id: "q2", title: "Quest Two", description: "", status: "completed", is_blocked: 0,
      blocked_reason: null, created_at: 2000, completed_at: 3000, archived_at: null, sort_order: 1 },
  ],
  objectives: [
    { id: "o1", quest_id: "q1", title: "Objective Blocked", description: "等待测试结果及报告",
      status: "open", is_blocked: 1, blocked_reason: "等待测试结果及报告", created_at: 1100,
      completed_at: null, sort_order: 0 },
    { id: "o2", quest_id: "q1", title: "Objective Done", description: "", status: "completed",
      is_blocked: 0, blocked_reason: null, created_at: 1200, completed_at: 1250, sort_order: 1 },
    { id: "o3", quest_id: "missing", title: "Orphan Objective", description: "", status: "open",
      is_blocked: 0, blocked_reason: null, created_at: 1300, completed_at: null, sort_order: 2 },
  ],
  steps: [
    { id: "s1", objective_id: "o1", title: "Step One", description: "", status: "completed",
      is_blocked: 0, blocked_reason: null, created_at: 1400, completed_at: 1450, sort_order: 0 },
    { id: "s2", objective_id: "missing", title: "Orphan Step", description: "", status: "open",
      is_blocked: 0, blocked_reason: null, created_at: 1500, completed_at: null, sort_order: 1 },
  ],
  attachments: [
    { id: "a1", node_type: "quest", node_id: "q1", type: "link", title: "方案",
      content: "https://example.feishu.cn/doc/x", created_at: 1600, updated_at: 1600 },
    { id: "a2", node_type: "objective", node_id: "missing", type: "text", title: "",
      content: "orphan note", created_at: 1700, updated_at: 1700 },
  ],
  events: [
    { id: "e1", quest_id: "q1", node_type: "quest", node_id: "q1", event_type: "created",
      previous_value: null, new_value: null, summary: "Quest created", source: "agent", created_at: 1000 },
    { id: "e2", quest_id: "missing", node_type: "quest", node_id: "missing", event_type: "created",
      previous_value: null, new_value: null, summary: "Orphan event", source: "agent", created_at: 1000 },
  ],
};

const normalized = context.normalizeImport(fixture);
check(normalized.data.quests.length === 2, "keeps both quests");
check(normalized.data.objectives.length === 2, "drops objective whose quest is missing");
check(normalized.data.steps.length === 1, "drops step whose objective is missing");
check(normalized.data.attachments.length === 1, "drops attachment whose node is missing");
check(normalized.data.events.length === 1, "drops trace whose quest is missing");
check(normalized.dropped === 4, `counts every dropped record (got ${normalized.dropped})`);
check(byTitle(normalized.data.objectives, "Objective Blocked")?.is_blocked === true, "maps is_blocked 1 to true");
check(byTitle(normalized.data.objectives, "Objective Blocked")?.blocked_reason === "等待测试结果及报告", "keeps blocked reason");
check(normalized.data.quests[1].status === "completed", "maps completed status");
check(normalized.data.quests[1].completed_at === 3000, "keeps completed_at");
check(normalized.data.quests[0].description === "优先级：P0", "keeps quest description");
check(normalized.data.steps[0].completed_at === 1450, "keeps step completed_at");

// -- applyImport: replaces the snapshot and renders ---------------------------
context.applyImport(normalized, "fixture.json");

const saved = JSON.parse(storage.get("quest-journal-preview-v1"));
check(saved.quests.length === 2, "imported snapshot is persisted to localStorage");

const list = document.getElementById("list").innerHTML;
check(list.includes("Quest One") && list.includes("Quest Two"), "list renders imported quests");

const detail = document.getElementById("detail").innerHTML;
check(detail.includes("Objective Blocked"), "detail renders imported objective");
check(detail.includes("等待测试结果及报告"), "detail renders imported blocked reason");
check(detail.includes("Step One"), "detail renders imported step");
check(detail.includes("[agent]"), "trace keeps the imported source");
check(document.getElementById("toast").textContent.includes("已载入 2 个任务"), "toast summarises the import");

// -- rejection and stability -------------------------------------------------
let rejected = false;
try { context.normalizeImport({ quests: "not-an-array" }); } catch { rejected = true; }
check(rejected, "rejects a file without a quests array");

let rejectedEmpty = false;
try { context.normalizeImport(null); } catch { rejectedEmpty = true; }
check(rejectedEmpty, "rejects a null payload");

const again = context.normalizeImport(fixture);
check(
  JSON.stringify(again.data.quests.map((q) => q.id)) === JSON.stringify(normalized.data.quests.map((q) => q.id)),
  "normalization is deterministic",
);

// -- a synthetic snapshot matching scripts/export-journal.mjs ---------------
try {
  const real = JSON.parse(readFileSync(new URL("test/fixtures/quest-journal-export.json", rootUrl), "utf8"));
  const parsed = context.normalizeImport(real);
  check(parsed.dropped === 0, "sample export has no orphan records");
  check(parsed.data.quests.length > 0, "sample export contains at least one quest");
} catch (error) {
  check(false, `sample export is loadable (${error.message})`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
