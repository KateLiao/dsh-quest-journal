import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QuestJournalStore,QuestJournalService} from '../packages/dsh-quest-journal/lib/quest-core.mjs';
import {QuestCommandService,createDshPlanner,CREATE_QUEST_SYSTEM} from '../packages/dsh-quest-journal/lib/commands.mjs';
let passed=0;const stores=[];
async function test(name,fn){await fn();passed++;console.log('  ok    '+name);}
const modelPlan=()=>({summary:'完成 示例项目 A PRD 并拆解下一步',question:null,quest:{title:'完成 示例项目 A PRD',description:'优化测试方案的需求文档',priority:'P0',objectives:[{title:'完成 PRD',description:'正在优化 PRD',steps:[{title:'和 协作者 同步思路'},{title:'找研发算法确认指标'},{title:'调研了解仿真平台'}]}]}});
const result=plan=>({plan,route:{provider:'default-provider',model:'default-model'}});
const input=(id='new-request-001')=>({request_id:id,instruction:'完成 示例项目 A 测试方案的 PRD，下一步和 协作者 同步思路、找算法确认指标、调研仿真平台'});
const fresh=planner=>{const store=new QuestJournalStore(':memory:');stores.push(store);const journal=new QuestJournalService(store);const seed=journal.createQuest({title:'Existing task'});const command=new QuestCommandService(journal,planner||(async({mode,quest})=>{assert.equal(mode,'create');assert.equal(quest,null);return result(modelPlan());}));return {store,journal,seed,command};};
await test('new task preview decomposes whole open tree without creating anything; confirm creates exactly once',async()=>{
 const {journal,seed,command}=fresh();const original=journal.getQuest(seed.id);const p=await command.proposeNew(input());
 assert.equal(p.projected_quest.title,'完成 示例项目 A PRD');assert.equal(p.projected_quest.priority,'P0');assert.equal(p.projected_quest.objectives[0].steps.length,3);assert.equal(journal.listQuests().length,1);assert.deepEqual(journal.getQuest(seed.id),original);
 const saved=command.confirmNew({plan_id:p.id});assert.equal(journal.listQuests().length,2);assert.equal(saved.quest.status,'open');assert.equal(saved.quest.objectives[0].status,'open');assert.ok(saved.quest.objectives[0].steps.every(s=>s.status==='open'));assert.equal(saved.quest.priority,'P0');
 assert.ok(journal.getTrace(saved.quest.id).every(e=>e.source==='agent'));assert.equal(journal.getTrace(saved.quest.id).at(-1).new_value.instruction,input().instruction);
 const again=command.confirmNew({plan_id:p.id});assert.equal(again.quest.id,saved.quest.id);assert.equal(journal.listQuests().length,2);
});
await test('new-task planner uses a creation-only prompt and the configured DSH model',async()=>{
 const plan=modelPlan();let called=false;
 const llm={async prepareCall(config){assert.equal(config.model,'configured-model');return {config,async *stream(options){called=true;assert.equal(options.system,CREATE_QUEST_SYSTEM);assert.equal(JSON.parse(options.messages[0].content[0].text).quest,null);assert.ok(!options.tools);yield {type:'text-delta',index:0,text:JSON.stringify(plan)};yield {type:'finish',reason:{kind:'stop'}};}};}};
 const planner=createDshPlanner(()=>llm,()=>({provider:'configured-provider',model:'configured-model'}));const response=await planner({mode:'create',quest:null,instruction:input().instruction});assert.deepEqual(response.plan,plan);assert.ok(called);
});
await test('creation rejects ids, statuses, arbitrary changes and malformed/oversized decompositions',async()=>{
 let current;const {journal,command}=fresh(async()=>result(current));const variants=[];
 let p=modelPlan();p.changes=[{op:'delete_node',node_type:'quest',node_id:'existing'}];variants.push(p);
 p=modelPlan();p.quest.id='existing';variants.push(p);
 p=modelPlan();p.quest.objectives[0].steps[0].status='completed';variants.push(p);
 p=modelPlan();p.quest.objectives=[];variants.push(p);
 p=modelPlan();p.quest.objectives[0].steps=[];variants.push(p);
 p=modelPlan();p.quest.priority='P9';variants.push(p);
 p=modelPlan();p.quest.objectives[0].steps=Array.from({length:41},()=>({title:'Too much'}));variants.push(p);
 p=modelPlan();p.quest.objectives[0].steps[0].title=' ';variants.push(p);
 for(const [i,v]of variants.entries()){current=v;await assert.rejects(command.proposeNew(input('invalid-new-'+i)));}
 assert.equal(journal.listQuests().length,1);
});
await test('clarification carries earlier intent but creates no draft task',async()=>{
 const {journal,command}=fresh(async({history})=>{assert.equal(history[0].user,'我要做一个项目');return result({summary:'需要补充交付物',question:'希望交付什么结果？',quest:null});});
 const p=await command.proposeNew({...input(),history:[{user:'我要做一个项目',reply:'是什么项目？'}]});assert.ok(p.question);assert.equal(p.projected_quest,null);assert.deepEqual(p.changes,[]);assert.equal(journal.listQuests().length,1);assert.throws(()=>command.confirmNew({plan_id:p.id}));
});
await test('concurrent new requests reuse one model call; new and update confirmation scopes cannot mix',async()=>{
 let calls=0,release;const wait=new Promise(r=>release=r);const {journal,command,seed}=fresh(async({mode,quest})=>{if(mode==='create'){calls++;await wait;return result(modelPlan());}return result({summary:'新增目标',question:null,changes:[{op:'add_objective',quest_id:quest.id,title:'O'}]});});
 const a=command.proposeNew(input()),b=command.proposeNew(input());release();const [x,y]=await Promise.all([a,b]);assert.equal(calls,1);assert.equal(x.id,y.id);assert.equal((await command.proposeNew(input())).id,x.id);
 await assert.rejects(command.proposeNew({...input(),instruction:'另一件事'}),e=>e.code==='REQUEST_CONFLICT');
 const update=await command.propose({quest_id:seed.id,...input('update-request')});assert.throws(()=>command.confirmNew({plan_id:update.id}),e=>e.code==='NOT_FOUND');assert.throws(()=>command.confirm({quest_id:seed.id,plan_id:x.id}),e=>e.code==='NOT_FOUND');assert.equal(journal.listQuests().length,1);
});
await test('failed confirmation rolls back the entire new tree and remains retryable',async()=>{
 const {journal,store,command}=fresh();const p=await command.proposeNew(input());const insert=store.insertEvent.bind(store);let events=0;
 store.insertEvent=event=>{if(++events===3)throw Error('write failed');insert(event);};
 assert.throws(()=>command.confirmNew({plan_id:p.id}),/write failed/);assert.equal(journal.listQuests().length,1);
 assert.equal(store.db.prepare('SELECT result FROM command_plans WHERE id = ?').get(p.id).result,null);
 store.insertEvent=insert;const saved=command.confirmNew({plan_id:p.id});assert.equal(saved.quest.objectives[0].steps.length,3);assert.equal(journal.listQuests().length,2);
});
await test('creation preview and idempotent result survive reopen; expired preview cannot create',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qj-create-')),path=join(dir,'journal.db');let store=new QuestJournalStore(path),journal=new QuestJournalService(store),command=new QuestCommandService(journal,async()=>result(modelPlan()));const p=await command.proposeNew(input());assert.equal(journal.listQuests().length,0);store.close();
 store=new QuestJournalStore(path);journal=new QuestJournalService(store);command=new QuestCommandService(journal,async()=>result(modelPlan()));const saved=command.confirmNew({plan_id:p.id});store.close();
 store=new QuestJournalStore(path);journal=new QuestJournalService(store);command=new QuestCommandService(journal,async()=>result(modelPlan()));assert.equal(command.confirmNew({plan_id:p.id}).quest.id,saved.quest.id);assert.equal(journal.listQuests().length,1);
 const expired=await command.proposeNew(input('expired-new-request'));store.db.prepare('UPDATE command_plans SET created_at = 0 WHERE id = ?').run(expired.id);assert.throws(()=>command.confirmNew({plan_id:expired.id}),e=>e.code==='PLAN_EXPIRED');assert.equal(journal.listQuests().length,1);store.close();rmSync(dir,{recursive:true});
});
await test('cancellation/model failure never creates a partial task',async()=>{
 let release;const wait=new Promise(r=>release=r);const {journal,command}=fresh(async()=>{await wait;return result(modelPlan());});const controller=new AbortController();const pending=command.proposeNew(input(),controller.signal);controller.abort(Error('cancelled'));release();await assert.rejects(pending,/cancelled/);assert.equal(journal.listQuests().length,1);
 await assert.rejects(command.proposeNew({...input(),instruction:''}),e=>e.code==='INVALID_INPUT');
});
for(const store of stores)store.close();console.log(`\n${passed} passed, 0 failed`);
