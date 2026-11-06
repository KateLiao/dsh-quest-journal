// Real plugin activation with Cordis/DSH service protocol doubles.
import assert from 'node:assert/strict';
const entry=await import(process.env.QJ_ENTRY_MODULE);
const toolEntry=await import(process.env.QJ_TOOLS_MODULE);
let handler,modelCalls=0,selectionCalls=0;
const tools=new Map();let prompt;
const ctx={get(name){return {
 connection:{requestRejection:()=>null},
 agentDefaultModel:{currentSelection(){selectionCalls++;return {provider:'configured-provider',model:'configured-model'};}},
 llm:{async prepareCall(config){assert.equal(config.provider,'configured-provider');assert.equal(config.model,'configured-model');return {config,async *stream(options){modelCalls++;const {quest,instruction}=JSON.parse(options.messages[0].content[0].text);assert.ok(instruction.includes('PRD'));const plan={summary:'创建 PRD 目标与下一步',question:null,changes:[{op:'add_objective',quest_id:quest.id,title:'完成 PRD',ref:'prd'},{op:'add_step',objective_id:'$prd',title:'和 协作者 同步思路'}]};yield {type:'text-delta',index:0,text:JSON.stringify(plan)};yield {type:'finish',reason:{kind:'stop'}};}};}},
 }[name];},webServer:{register(route){handler=route.handler;return ()=>{};}},effect(fn){fn();},tools:{register(tool){tools.set(tool.name,tool);}},systemPrompt:{getSectionOrder:()=>undefined,section(value){prompt=value;}}};
entry.apply(ctx,{dbPath:':memory:'});toolEntry.apply(ctx,{dbPath:':memory:'});
assert.equal(typeof handler,'function');assert.equal(tools.size,11);assert.equal(prompt.order,3200);assert.ok(prompt.text.includes('$prd'));
const created=tools.get('quest_create').execute({title:'Integration task'});const id=created.quest.id;
async function route(path,json){const req={url:'/quest-journal/'+path,method:'POST',headers:{'sec-fetch-site':'same-origin'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(json));}};const res={statusCode:0,setHeader(){},end(text){this.body=JSON.parse(text);}};await handler(req,res);assert.equal(res.statusCode,200,JSON.stringify(res.body));return res.body;}
const p=await route('command/preview',{quest_id:id,request_id:'entry-request',instruction:'正在优化 PRD，下一步和 协作者 同步'});assert.equal(modelCalls,1);assert.equal(selectionCalls,1);
let tree=tools.get('quest_get').execute({quest_id:id});assert.equal(tree.objectives.length,0);
await route('command/apply',{quest_id:id,plan_id:p.id});tree=tools.get('quest_get').execute({quest_id:id});assert.equal(tree.objectives[0].title,'完成 PRD');assert.equal(tree.objectives[0].steps[0].title,'和 协作者 同步思路');
const update=tools.get('quest_update_node').execute({node_type:'objective',node_id:tree.objectives[0].id,priority:'P0'});assert.equal(update.node.priority,'P0');
assert.equal(tools.get('quest_apply_changes').execute({changes:'invalid'}).ok,false);
console.log('Plugin integration passed: actual activation, default model selection, HTTP preview/apply, shared Agent tools and priority.');
