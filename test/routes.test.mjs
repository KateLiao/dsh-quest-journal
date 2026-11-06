// Host-route tests for the Web panel (`/quest-journal/*`).
//
// `lib/web.js` is a `.js` ESM file, and this workspace's file sandbox refuses to
// import `.js` from a Node child process. `scripts/run-tests.sh` therefore
// copies it to a temporary `.mjs` and passes that path in QJ_WEB_MODULE.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webModuleUrl = process.env.QJ_WEB_MODULE;
if (!webModuleUrl) {
  console.error("QJ_WEB_MODULE is not set; run this file through scripts/run-tests.sh");
  process.exit(2);
}

const { createRoutes, ROUTE_PREFIX } = await import(webModuleUrl);
const coreUrl = new URL("../packages/dsh-quest-journal/lib/quest-core.mjs", import.meta.url);
const { QuestJournalStore, QuestJournalService } = await import(coreUrl.href);
const { QuestCommandService } = await import(new URL("../packages/dsh-quest-journal/lib/commands.mjs", import.meta.url));

const dir = mkdtempSync(join(tmpdir(), "qj-routes-"));
const store = new QuestJournalStore(join(dir, "journal.db"));
const service = new QuestJournalService(store);

let rejection = null;
let available = true;
let commandsAvailable = true;
const commands = new QuestCommandService(service, async ({quest,mode}) => ({route:{provider:"test",model:"stub"},plan:mode==="create"?{summary:"生成新任务与拆解",question:null,quest:{title:"新建 PRD 任务",objectives:[{title:"完成 PRD",steps:[{title:"和 协作者 同步思路"}]}]}}:{summary:"新增 PRD 目标和步骤",question:null,changes:[{op:"add_objective",quest_id:quest.id,title:"完成 PRD",ref:"prd"},{op:"add_step",objective_id:"$prd",title:"和 协作者 同步思路"}]}}));
const routes = createRoutes({ getService: () => (available ? service : undefined), reject: () => rejection, getCommands:()=>commandsAvailable ? commands : undefined });

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    payload: "",
    ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    end(body) { this.payload = body ?? ""; this.ended = true; },
  };
}

function mockReq(method, path, { headers = {}, json } = {}) {
  const req = { method, url: ROUTE_PREFIX + path, headers };
  if (json !== undefined) {
    req[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(JSON.stringify(json));
    };
  }
  return req;
}

async function call(method, path, options) {
  const res = mockRes();
  await routes(mockReq(method, path, options), res);
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null, headers: res.headers };
}

let passed = 0;
const failed = [];
function check(ok, label) {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed.push(label); console.log(`  FAIL  ${label}`); }
}

// -- auth fence -------------------------------------------------------------
rejection = 401;
let res = await call("GET", "/state");
check(res.status === 401 && res.body.error === "unauthorized", "rejects an unauthenticated request");
rejection = null;

// -- reads ------------------------------------------------------------------
available = false;
res = await call("GET", "/state");
check(res.status === 503, "reports 503 while the journal service is not available");
available = true;

res = await call("GET", "/state");
check(res.status === 200 && Array.isArray(res.body.quests) && res.body.quests.length === 0, "GET /state starts empty");
check(String(res.headers["content-type"]).startsWith("application/json"), "responses are JSON");
check(res.headers["cache-control"] === "no-store", "responses are not cached");

// -- writes -----------------------------------------------------------------
res = await call("POST", "/ops", { json: { changes: [{ op: "create_quest", title: "面板创建的任务", description: "P0" }] } });
check(res.status === 200 && Array.isArray(res.body.results) && res.body.results.length === 1, "POST /ops creates a quest");
const questId = res.body.results[0].node.id;

res = await call("GET", "/state?archived=0");
check(res.body.quests.length === 1 && res.body.quests[0].title === "面板创建的任务", "GET /state returns the new quest");

res = await call("GET", `/quest?id=${encodeURIComponent(questId)}`);
check(res.status === 200 && res.body.quest.id === questId && Array.isArray(res.body.quest.objectives), "GET /quest returns the tree");

res = await call("POST", "/ops", { json: { changes: [{ op: "add_objective", quest_id: questId, title: "目标一" }] } });
check(res.status === 200, "POST /ops adds an objective");

res = await call("GET", `/trace?id=${encodeURIComponent(questId)}`);
check(res.status === 200 && res.body.events.length === 2, `GET /trace returns events (got ${res.body.events?.length})`);
check(res.body.events.every((event) => event.source === "manual"), "panel writes are attributed to manual");

// -- HEAD works for reads ---------------------------------------------------
const headRes = mockRes();
await routes(mockReq("HEAD", "/state"), headRes);
check(headRes.statusCode === 200, "HEAD /state is accepted");

// -- errors -----------------------------------------------------------------
res = await call("GET", "/quest?id=missing");
check(res.status === 404, "unknown quest id is 404");

res = await call("GET", "/trace?id=missing");
check(res.status === 404, "trace for an unknown quest is 404");

res = await call("GET", "/nope");
check(res.status === 404, "unknown route is 404");

res = await call("POST", "/ops", { json: { changes: [{ op: "not_an_op" }] } });
check(res.status === 400 && typeof res.body.error === "string", "invalid op is a 400 with a message");

res = await call("POST", "/ops", { headers: { "sec-fetch-site": "cross-site" }, json: { changes: [] } });
check(res.status === 403, "cross-site POST is rejected");

res = await call("DELETE", "/state");
check(res.status === 405, "unsupported method is 405");

// -- the tree the panel renders --------------------------------------------
res = await call("GET", `/quest?id=${encodeURIComponent(questId)}`);
check(res.body.quest.objectives.length === 1, "tree contains the added objective");

// -- scoped model preview and confirmation ---------------------------------
res = await call("POST", "/command/preview", {json:{quest_id:questId,request_id:"route-preview-1",instruction:"优化 PRD，下一步和 协作者 同步思路"}});
check(res.status===200 && res.body.preview.length===2, "command preview validates model plan through HTTP");
const planId=res.body.id;
check(service.getQuest(questId).objectives.length===1, "command preview leaves task unchanged");
res = await call("POST", "/command/apply", {json:{quest_id:questId,plan_id:planId}});
check(res.status===200 && res.body.quest.objectives.length===2, "command apply saves goal and referenced child");
res = await call("POST", "/command/apply", {json:{quest_id:questId,plan_id:planId}});
check(res.status===200 && service.getQuest(questId).objectives.length===2, "repeated confirmation is idempotent through HTTP");
check(service.getTrace(questId).at(-1).source==="agent", "command writes are attributed to agent");
res = await call("POST", "/command/preview", {headers:{"sec-fetch-site":"cross-site"},json:{quest_id:questId,request_id:"route-preview-2",instruction:"test"}});
check(res.status===403, "cross-site command generation is rejected");
rejection=401;
res = await call("POST", "/command/apply", {json:{quest_id:questId,plan_id:planId}});
check(res.status===401, "command confirmation requires authentication");rejection=null;
commandsAvailable=false;
res=await call("POST", "/command/preview", {json:{quest_id:questId,request_id:"route-preview-2",instruction:"test"}});
check(res.status===503, "command service absence reports 503");commandsAvailable=true;
res=await call("POST", "/command/preview", {json:{quest_id:questId,request_id:"route-preview-2",instruction:""}});
check(res.status===400 && res.body.code==="INVALID_INPUT", "command validation returns stable error code");
res=await call("POST", "/ops", {json:{changes:"wrong"}});
check(res.status===400, "invalid changes shape is rejected");

// -- anchor-based drag persistence ------------------------------------------
const dragTree=service.getQuest(questId), first=dragTree.objectives[0], second=dragTree.objectives[1];
res=await call("POST", "/ops", {json:{changes:[{op:"reorder_node",node_type:"objective",node_id:first.id,parent_id:questId,target_id:second.id,position:"after"}]}});
check(res.status===200 && res.body.results[0].op==="reorder_node", "drag reorder is accepted through panel route");
check(service.getQuest(questId).objectives[1].id===first.id, "drag anchor order is persisted");
res=await call("POST", "/ops", {json:{changes:[{op:"reorder_node",node_type:"objective",node_id:first.id,parent_id:questId,target_id:"removed-target",position:"before"}]}});
check(res.status===400 && res.body.code==="INVALID_TARGET", "disappeared drop target fails with stable code");

// -- new-task generation is separate from selected-task editing ---------------
const questsBeforeNew=service.listQuests().length;
res=await call("POST", "/command/new/preview", {json:{request_id:"new-route-request",instruction:"创建 PRD 项目并拆解"}});
check(res.status===200 && res.body.projected_quest.objectives[0].steps.length===1 && service.listQuests().length===questsBeforeNew, "new-task HTTP preview decomposes without creating");
const newPlan=res.body.id;
res=await call("POST", "/command/new/apply", {json:{plan_id:newPlan}});
check(res.status===200 && res.body.quest.title==="新建 PRD 任务" && service.listQuests().length===questsBeforeNew+1, "new-task HTTP confirmation creates the complete tree");
const newQuestId=res.body.quest.id;
res=await call("POST", "/command/new/apply", {json:{plan_id:newPlan}});
check(res.status===200 && res.body.quest.id===newQuestId && service.listQuests().length===questsBeforeNew+1, "new-task confirmation retry is idempotent");
res=await call("POST", "/command/new/preview", {headers:{"sec-fetch-site":"cross-site"},json:{request_id:"new-route-request2",instruction:"create"}});
check(res.status===403, "cross-site new-task model calls are rejected");

store.close();
console.log(`\n${passed} passed, ${failed.length} failed`);
process.exit(failed.length > 0 ? 1 : 0);
