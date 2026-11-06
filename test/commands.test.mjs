import assert from 'node:assert/strict';
import {QuestJournalStore,QuestJournalService} from '../packages/dsh-quest-journal/lib/quest-core.mjs';
import {QuestCommandService,createDshPlanner,COMMAND_SYSTEM} from '../packages/dsh-quest-journal/lib/commands.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let passed=0,failed=0;
const stores=[];
async function test(name,fn){try{await fn();passed++;console.log('  ok    '+name);}catch(e){failed++;console.error('  FAIL  '+name,e);}}
function fresh(planner){const store=new QuestJournalStore(':memory:');stores.push(store);const journal=new QuestJournalService(store);const q=journal.createQuest({title:'配合跟进 示例项目 A 的不稳定测试情况'});const command=new QuestCommandService(journal,planner);return {store,journal,q,command};}
const input=(q,request_id='request-001')=>({quest_id:q.id,request_id,instruction:'现在我在优化PRD，下一步计划和 协作者 同步思路、找研发算法确认指标、调研了解仿真平台。'});
function prd(q){return {summary:'新建完成 PRD 目标及三个计划步骤，均未完成',question:null,changes:[{op:'add_objective',quest_id:q.id,title:'完成 PRD',description:'正在优化 PRD',ref:'prd'},...['和 协作者 同步思路','找研发算法确认指标','调研了解仿真平台'].map(title=>({op:'add_step',objective_id:'$prd',title}))]};}
const response=plan=>({plan,route:{provider:'test',model:'model'}});
await test('PRD example: preview is read-only, confirm atomically creates goal and 3 open steps',async()=>{
 const {q,journal,command}=fresh(async({quest})=>response(prd(quest)));
 const plan=await command.propose(input(q));assert.equal(plan.preview.length,4);
 assert.equal(plan.base_quest.objectives.length,0);
 assert.equal(plan.projected_quest.objectives[0].title,'完成 PRD');
 assert.equal(plan.projected_quest.objectives[0].steps.length,3);
 assert.equal(plan.projected_quest.objectives[0].steps[0].objective_id,plan.projected_quest.objectives[0].id);
 assert.equal(journal.getQuest(q.id).objectives.length,0);assert.equal(journal.getTrace(q.id).length,1);
 const done=command.confirm({quest_id:q.id,plan_id:plan.id});const objective=done.quest.objectives[0];
 assert.equal(objective.title,'完成 PRD');assert.equal(objective.description,'正在优化 PRD');assert.equal(objective.status,'open');
 assert.deepEqual(objective.steps.map(s=>s.title),['和 协作者 同步思路','找研发算法确认指标','调研了解仿真平台']);
 assert.ok(objective.steps.every(s=>s.status==='open'));
 assert.ok(journal.getTrace(q.id).slice(1).every(e=>e.source==='agent'));
 assert.equal(journal.getTrace(q.id).at(-1).new_value.instruction,input(q).instruction);
 const again=command.confirm({quest_id:q.id,plan_id:plan.id});assert.equal(again.results[0].node.id,done.results[0].node.id);assert.equal(journal.getQuest(q.id).objectives.length,1);
});
await test('temporary references work in ordinary Agent batches and failures roll back',()=>{
 const {q,journal}=fresh();const result=journal.applyChanges(prd(q).changes,'agent');assert.equal(result.length,4);
 assert.throws(()=>journal.applyChanges([{op:'add_objective',quest_id:q.id,title:'bad',ref:'x'},{op:'add_step',objective_id:'$missing',title:'missing'}]),e=>e.code==='INVALID_REF');
 assert.equal(journal.getQuest(q.id).objectives.length,1);
 assert.throws(()=>journal.applyChanges([{op:'add_objective',quest_id:q.id,title:'bad',ref:'x'},{op:'add_step',objective_id:'$x',title:'bad',ref:'x'}]),e=>e.code==='INVALID_REF');
});
await test('cross-quest ids, root deletion and unknown fields are rejected before writing',async()=>{
 let changes;const {q,journal,command}=fresh(async()=>response({summary:'x',question:null,changes}));
 const other=journal.createQuest({title:'Other'}), obj=journal.addObjective(other.id,{title:'private'});
 for(const [i,c] of [[{op:'set_completed',node_type:'objective',node_id:obj.id,completed:true}],[{op:'add_objective',quest_id:other.id,title:'wrong'}],[{op:'delete_node',node_type:'quest',node_id:q.id}],[{op:'update_node',node_type:'quest',node_id:q.id,status:'completed'}],[{op:'create_quest',title:'wrong'}]].entries()){
 changes=c;await assert.rejects(command.propose(input(q,'request-x'+i)));
 }assert.equal(journal.getQuest(other.id).objectives[0].status,'open');assert.equal(journal.getTrace(q.id).length,1);
});
await test('clarification preserves user context and causes no writes',async()=>{
 const {q,journal,command}=fresh(async({history})=>{assert.equal(history[0].reply,'是哪个测试目标？');return response({summary:'需要确认',question:'请给出目标全名',changes:[]});});
 const plan=await command.propose({...input(q),history:[{user:'测试完成了',reply:'是哪个测试目标？'}]});
 assert.ok(plan.question);assert.equal(journal.getTrace(q.id).length,1);
 assert.throws(()=>command.confirm({quest_id:q.id,plan_id:plan.id}));
});
await test('mixed completion, blocking, priority and notes apply independently',async()=>{
 let qid,oid,sid;const {q,journal,command}=fresh(async()=>response({summary:'更新状态和进展',question:null,changes:[{op:'set_completed',node_type:'step',node_id:sid,completed:true},{op:'set_blocked',node_type:'objective',node_id:oid,blocked:true,blocked_reason:'等算法数据'},{op:'update_node',node_type:'objective',node_id:oid,priority:'P0'},{op:'add_attachment',node_type:'quest',node_id:qid,type:'text',content:'PRD 改到第二版，仍在评审'}]}));
 qid=q.id;const o=journal.addObjective(q.id,{title:'完成 PRD'});oid=o.id;sid=journal.addStep(o.id,{title:'和 协作者 同步'}).id;
 const p=await command.propose(input(q));command.confirm({quest_id:q.id,plan_id:p.id});const tree=journal.getQuest(q.id);
 assert.equal(tree.status,'open');assert.equal(tree.objectives[0].status,'open');assert.equal(tree.objectives[0].steps[0].status,'completed');assert.equal(tree.objectives[0].is_blocked,true);assert.equal(tree.objectives[0].priority,'P0');assert.equal(tree.attachments.length,1);
});
await test('projected tree reflects edits, moves and deletions without saving them',async()=>{
 let changes;
 const {q,journal,command}=fresh(async()=>response({summary:'调整大纲',question:null,changes}));
 const a=journal.addObjective(q.id,{title:'A'}),b=journal.addObjective(q.id,{title:'B'}),step=journal.addStep(a.id,{title:'S'});
 changes=[{op:'move_node',node_type:'step',node_id:step.id,target_type:'objective',parent_id:q.id},{op:'delete_node',node_type:'objective',node_id:b.id},{op:'update_node',node_type:'objective',node_id:a.id,title:'A updated'}];
 const original=journal.getQuest(q.id),traceCount=journal.getTrace(q.id).length;
 const p=await command.propose(input(q));
 assert.deepEqual(p.base_quest,original);
 assert.deepEqual(p.projected_quest.objectives.map(o=>o.title),['A updated','S']);
 assert.equal(p.projected_quest.objectives[0].steps.length,0);
 assert.deepEqual(journal.getQuest(q.id),original);assert.equal(journal.getTrace(q.id).length,traceCount);
 const confirmed=command.confirm({quest_id:q.id,plan_id:p.id});
 assert.deepEqual(confirmed.quest.objectives.map(o=>o.title),p.projected_quest.objectives.map(o=>o.title));
});
await test('invalid operation inside model batch rolls all preview writes back',async()=>{
 const {q,journal,command}=fresh(async({quest})=>response({...prd(quest),changes:[...prd(quest).changes,{op:'add_attachment',node_type:'quest',node_id:quest.id,type:'link',content:'javascript:alert(1)'}]}));
 await assert.rejects(command.propose(input(q)));assert.equal(journal.getQuest(q.id).objectives.length,0);assert.equal(journal.getTrace(q.id).length,1);
});
await test('stale preview and change during generation reject with conflict',async()=>{
 const {q,journal,command}=fresh(async({quest})=>response(prd(quest)));const p=await command.propose(input(q));journal.addObjective(q.id,{title:'Concurrent update'});
 assert.throws(()=>command.confirm({quest_id:q.id,plan_id:p.id}),e=>e.code==='STALE_PLAN');
 const changing=new QuestCommandService(journal,async({quest})=>{journal.setBlocked('quest',q.id,true,'changed');return response(prd(quest));});
 await assert.rejects(changing.propose(input(q,'request-002')),e=>e.code==='STALE_PLAN');assert.equal(journal.getQuest(q.id).objectives.length,1);
});
await test('duplicate concurrent previews and retries reuse one model call',async()=>{
 let calls=0,release;const wait=new Promise(r=>release=r);
 const {q,command}=fresh(async({quest})=>{calls++;await wait;return response(prd(quest));});
 const a=command.propose(input(q)),b=command.propose(input(q));release();const [x,y]=await Promise.all([a,b]);assert.equal(x.id,y.id);assert.equal(calls,1);assert.equal((await command.propose(input(q))).id,x.id);assert.equal(calls,1);
 await assert.rejects(command.propose({...input(q),instruction:'other'}),e=>e.code==='REQUEST_CONFLICT');
});
await test('persisted confirmation is idempotent across service and database reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qj-command-')),path=join(dir,'test.db');let store=new QuestJournalStore(path),j=new QuestJournalService(store);const q=j.createQuest({title:'Q'});let c=new QuestCommandService(j,async({quest})=>response(prd(quest)));const p=await c.propose(input(q));const result=c.confirm({quest_id:q.id,plan_id:p.id});store.close();
 store=new QuestJournalStore(path);j=new QuestJournalService(store);c=new QuestCommandService(j,()=>{throw Error('must not call model');});assert.equal(c.confirm({quest_id:q.id,plan_id:p.id}).results[0].node.id,result.results[0].node.id);assert.equal(j.getQuest(q.id).objectives.length,1);store.close();rmSync(dir,{recursive:true});
});
await test('expired/archived plans and invalid inputs fail without mutation',async()=>{
 const {q,journal,command,store}=fresh(async({quest})=>response(prd(quest)));const p=await command.propose(input(q));
 store.db.prepare('UPDATE command_plans SET created_at = 0 WHERE id = ?').run(p.id);assert.throws(()=>command.confirm({quest_id:q.id,plan_id:p.id}),e=>e.code==='PLAN_EXPIRED');journal.archiveQuest(q.id);await assert.rejects(command.propose(input(q,'request-new')),e=>e.code==='QUEST_ARCHIVED');
 await assert.rejects(command.propose({...input(q),instruction:''}),e=>e.code==='INVALID_INPUT');
});
await test('malformed, excessive and question-plus-changes model plans reject',async()=>{
 let plan;const {q,command,journal}=fresh(async()=>response(plan));
 const cases=[null,{summary:'bad',question:'which?',changes:prd(q).changes},{summary:'bad',question:null,changes:Array(51).fill(prd(q).changes[0])},{summary:'bad',question:null,changes:[{op:'add_step',objective_id:'$forward',title:'invalid'}]}];
 for(const [i,p]of cases.entries()){plan=p;await assert.rejects(command.propose(input(q,'invalid-'+i)));}assert.equal(journal.getTrace(q.id).length,1);
});
function mockLlm(chunks,inspect=()=>{}){return {prepareCall:async(config,signal)=>{inspect(config);return {config,stream:async function*(options){assert.equal(options.system,COMMAND_SYSTEM);assert.equal(options.messages[0].role,'user');assert.ok(!options.tools);for(const chunk of chunks)yield chunk;}};}};}
await test('DSH protocol: default model, text deltas and final blocks form exactly one JSON response',async()=>{
 const plan={summary:'无更新',question:null,changes:[]},text=JSON.stringify(plan);
 const llm=mockLlm([{type:'text-delta',index:0,text:text.slice(0,10)},{type:'text-delta',index:0,text:text.slice(10)},{type:'block-end',index:0,block:{type:'text',text}},{type:'finish',reason:{kind:'stop'}}],config=>{assert.equal(config.provider,'dsh');assert.equal(config.model,'default');});
 const planner=createDshPlanner(()=>llm,()=>({provider:'dsh',model:'default'}));const result=await planner({quest:{id:'q'},instruction:'你好'});assert.deepEqual(result.plan,plan);
 assert.ok(COMMAND_SYSTEM.includes('完成 PRD'));assert.ok(COMMAND_SYSTEM.includes('never choose arbitrarily'));
});
await test('DSH protocol rejects truncation, malformed JSON and unavailable models',async()=>{
 const select=()=>({provider:'dsh',model:'default'});
 for(const chunks of [[{type:'text-delta',index:0,text:'{}'},{type:'finish',reason:{kind:'max-tokens'}}],[{type:'text-delta',index:0,text:'not json'},{type:'finish',reason:{kind:'stop'}}],[{type:'finish',reason:{kind:'error',failure:{message:'Quota'}}}]])await assert.rejects(createDshPlanner(()=>mockLlm(chunks),select)({quest:{},instruction:'test'}));
 await assert.rejects(createDshPlanner(()=>null,()=>null)({quest:{},instruction:'test'}),e=>e.code==='MODEL_UNAVAILABLE');
});
await test('cancellation/timeout finish promptly even if the model ignores AbortSignal',async()=>{
 const never={prepareCall:()=>new Promise(()=>{})},selection=()=>({provider:'dsh',model:'default'});
 const timed=createDshPlanner(()=>never,selection,{timeoutMs:10});await assert.rejects(timed({quest:{},instruction:'test'}),e=>e.code==='MODEL_TIMEOUT');
 const controller=new AbortController();const pending=createDshPlanner(()=>never,selection)({quest:{},instruction:'test',signal:controller.signal});controller.abort(new Error('Cancelled'));await assert.rejects(pending,/Cancelled/);
});
for(const s of stores)s.close();console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exit(1);
