import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const source=readFileSync(process.env.QJ_CLIENT_MODULE,'utf8');
let context,page,edits=[],requests=[],responseMode='ready',hold,release;
const bucket=()=>({states:[],refs:[],effects:[],cursor:0,rc:0});
const react={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),
 useState(initial){const i=context.cursor++,owner=context;if(!(i in owner.states))owner.states[i]=initial;return [owner.states[i],v=>{owner.states[i]=typeof v==='function'?v(owner.states[i]):v;}];},
 useRef(value){const i=context.rc++;return context.refs[i]??(context.refs[i]={current:value});},useCallback:f=>f,useEffect:f=>context.effects.push(f)};
const q={id:'q',title:'配合跟进 示例项目 A 的不稳定测试情况',description:'优先级：P0\n跟进相机参数调整与晃动测试，对比 示例项目 A / 基准项目 的拍照效果，形成测试结论。',created_at:1,updated_at:1,priority:'P0',status:'open',archived_at:null,objectives:[{id:'o',title:'相机拍照效果对比',description:'从幅度、频率两个维度，对比静止拍照时的效果。',priority:'P1',status:'open',is_blocked:true,blocked_reason:'等待测试结果及报告',created_at:1,updated_at:2,steps:[{id:'s',objective_id:'o',title:'基准项目 晃动情况拍摄并对比',priority:'P1',status:'open',created_at:1,updated_at:2,attachments:[]}],attachments:[]}],attachments:[]};
let taskList=[{...q,sort_order:0},{...q,id:'q2',priority:'P1',created_at:3,updated_at:3,sort_order:1,title:'动作切换稳定性问题'},{...q,id:'q3',priority:'P2',created_at:2,updated_at:2,sort_order:2,title:'了解 示例项目 A 拉拽需求'}];
const plan={id:'plan-1',quest_id:'q',summary:'创建完成 PRD 及三个未完成子项',question:null,instruction:'我在优化 PRD，和 协作者 同步、确认指标、调研平台',changes:[{op:'add_objective'}],preview:[{op:'add_objective',node_type:'objective',title:'完成 PRD',change:{op:'add_objective',description:'正在优化 PRD'}}]};
const newTree={...q,id:'created-q',title:'完成 示例项目 A PRD',priority:'P0',description:'新建任务的测试预览',objectives:[{...q.objectives[0],id:'created-o',title:'完成 PRD',steps:['和 协作者 同步思路','找研发算法确认指标','调研了解仿真平台'].map((title,i)=>({...q.objectives[0].steps[0],id:'created-s'+i,title,objective_id:'created-o'}))}]};
const newPlan={id:'creation-plan',kind:'create',instruction:'完成 示例项目 A PRD',summary:'创建任务并拆解三个步骤',question:null,changes:[{op:'create_quest'},{op:'add_objective'},{op:'add_step'},{op:'add_step'},{op:'add_step'}],projected_quest:newTree};
const sandbox={AbortController,window:{crypto:{randomUUID},__ModuleLoader__:{load:({factory})=>{
 const plugin=factory(()=>react);plugin.apply({effect:f=>f(),locale:{register(){},bind:()=>k=>k},slots:{inject(name,f){const result=f();if(result?.next)result.next();},register(spec,component){if(spec.name==='main')page=component;}}});
}},addEventListener(){},removeEventListener(){}},fetch:async(path,options)=>{
 const body=options?.body?JSON.parse(options.body):null;requests.push({path,body,signal:options?.signal});
 if(path.endsWith('/command/new/preview')){
  if(responseMode==='error')return {ok:false,json:async()=>({error:'模型暂时不可用'})};
  if(responseMode==='question')return {ok:true,json:async()=>({...newPlan,instruction:body.instruction,question:'预期交付什么？',changes:[],projected_quest:null})};
  return {ok:true,json:async()=>({...newPlan,instruction:body.instruction})};
 }
 if(path.endsWith('/command/new/apply'))return {ok:true,json:async()=>({quest:newTree,results:[]})};
 if(path.endsWith('/command/preview')){
   if(responseMode==='pending')await hold;
   if(responseMode==='error')return {ok:false,json:async()=>({error:'模型暂时不可用'})};
   if(responseMode==='question')return {ok:true,json:async()=>({...plan,question:'是修改哪个 PRD 目标？',changes:[],preview:[],instruction:body.instruction})};
   return {ok:true,json:async()=>({...plan,instruction:body.instruction})};
 }
 if(path.endsWith('/command/apply'))return {ok:true,json:async()=>({results:[],quest:q})};
 if(body){edits.push(...body.changes);const results=[];
 for(const c of body.changes)if(c.op==='create_quest')results.push({op:c.op,node:{...q,id:'manual-q',title:c.title,description:c.description}});else if(c.op==='reorder_node'&&c.node_type==='quest'){
  const compare=(a,b)=>c.sort_mode==='priority'?a.priority.localeCompare(b.priority):c.sort_mode==='updated'?b.updated_at-a.updated_at:c.sort_mode==='created'?b.created_at-a.created_at:a.sort_order-b.sort_order;
  let list=[...taskList].sort((a,b)=>compare(a,b)||a.sort_order-b.sort_order),node=list.find(n=>n.id===c.node_id);list=list.filter(n=>n.id!==c.node_id);const i=c.position==='end'?list.length:list.findIndex(n=>n.id===c.target_id)+(c.position==='after'?1:0);list.splice(i,0,node);taskList=list.map((n,index)=>({...n,sort_order:index}));results.push({op:c.op,sort_mode:c.sort_mode==='manual'||!taskList.every((n,i)=>!i||compare(taskList[i-1],n)<=0)?'manual':c.sort_mode});
 }
 return {ok:true,json:async()=>({results})};}
 return {ok:true,json:async()=>path.includes('/state')?{quests:taskList}:path.includes('/quest?')?{quest:q}:{events:[]}};
}};
vm.runInNewContext(source,sandbox);
function mount(component,props){const b=bucket();return {render(){context=b;b.cursor=0;b.rc=0;b.effects=[];return component(props);},async effects(){return Promise.all(b.effects.map(f=>f()));},cleanup(){for(const f of b.effects){const cleanup=f();if(typeof cleanup==='function')cleanup();}}};}
const nodes=tree=>[tree,...(tree?.children??[]).flatMap(x=>typeof x==='object'&&x?nodes(x):[])];
const find=(tree,test)=>{const item=nodes(tree).find(test);assert.ok(item,'Expected UI element');return item;};
const button=(tree,text)=>find(tree,n=>n.type==='button'&&n.children.includes(text));
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const main=mount(page,{t:k=>k});let tree=main.render();await main.effects();await flush();tree=main.render();
find(tree,n=>n.props.className?.startsWith('qj-quest-item')).props.onClick();tree=main.render();await main.effects();await flush();tree=main.render();
assert.ok(nodes(tree).some(n=>n.props['aria-current']==='true'));
// Compact rows: actions live in a menu rather than filling every line.
assert.ok(!nodes(tree).some(n=>n.type==='button'&&n.children.includes('删除条目…')));
find(tree,n=>n.props['aria-label']==='更多操作：'+q.title).props.onClick();tree=main.render();button(tree,'标记阻塞').props.onClick();tree=main.render();
assert.ok(nodes(tree).some(n=>n.props.role==='dialog'));
find(tree,n=>n.type==='input'&&n.props.autoFocus).props.onChange({target:{value:'等待资料'}});tree=main.render();await find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
assert.equal(edits.at(-1).op,'set_blocked');assert.equal(edits.at(-1).blocked_reason,'等待资料');
// Inline add uses an actual title input, not another dialog.
tree=main.render();button(tree,'＋ 添加目标').props.onClick();tree=main.render();const inline=find(tree,n=>typeof n.type==='function'&&n.type.name==='InlineNew');const add=mount(inline.type,inline.props);let inlineTree=add.render();inlineTree.props.onChange({target:{value:'新目标'}});inlineTree=add.render();await inlineTree.props.onKeyDown({key:'Enter',preventDefault(){}});await flush();assert.equal(edits.at(-1).op,'add_objective');assert.equal(edits.at(-1).title,'新目标');
// Composer: generate never writes; apply uses the plan's quest and token.
let applied=0,lastPreview;tree=main.render();const component=find(tree,n=>typeof n.type==='function'&&n.type.name==='CommandComposer');
function composer(){return mount(component.type,{quest:q,onApplied:async()=>{applied++;},onPreviewChange:preview=>{lastPreview=preview;}});}
function inputText(instance,text){let t=instance.render();find(t,n=>n.type==='textarea').props.onChange({target:{value:text}});return instance.render();}
const compose=composer();let ct=inputText(compose,plan.instruction),before=edits.length;
await button(ct,'生成变更').props.onClick();ct=compose.render();assert.equal(edits.length,before);assert.equal(lastPreview.id,'plan-1');assert.ok(nodes(ct).some(n=>n.children.some(c=>typeof c==='string'&&c.includes('下方目标与进展'))));assert.ok(!nodes(ct).some(n=>n.type==='ol'));
await button(ct,'应用 1 项变更').props.onClick();assert.equal(applied,1);assert.equal(lastPreview,null);const confirm=requests.find(r=>r.path.endsWith('/command/apply'));assert.equal(confirm.body.quest_id,'q');assert.equal(confirm.body.plan_id,'plan-1');
// Failed generation retains input, retries reuse request identity.
responseMode='error';const retry=composer();ct=inputText(retry,'PRD 继续优化');await button(ct,'生成变更').props.onClick();ct=retry.render();assert.equal(find(ct,n=>n.type==='textarea').props.value,'PRD 继续优化');const id=requests.at(-1).body.request_id;
responseMode='ready';await button(ct,'重试生成').props.onClick();assert.equal(requests.at(-1).body.request_id,id);
// Clarification round includes the original instruction and question.
responseMode='question';const clarification=composer();ct=inputText(clarification,'完成测试');await button(ct,'生成变更').props.onClick();ct=inputText(clarification,'是相机测试');responseMode='ready';await button(ct,'生成变更').props.onClick();const last=requests.at(-1).body;assert.equal(last.history[0].user,'完成测试');assert.equal(last.history[0].reply,'是修改哪个 PRD 目标？');assert.equal(last.instruction,'是相机测试');
// Cancelling an in-flight generation ignores its eventual response.
responseMode='pending';hold=new Promise(r=>release=r);const cancel=composer();ct=inputText(cancel,'新增测试');const inFlight=button(ct,'生成变更').props.onClick();ct=cancel.render();button(ct,'取消生成').props.onClick();release();await inFlight;ct=cancel.render();assert.equal(find(ct,n=>n.type==='textarea').props.value,'新增测试');assert.ok(!nodes(ct).some(n=>n.type==='button'&&n.children.includes('应用 1 项变更')));
// Simulated tree is rendered in the actual outline, not a detached change list.
tree=main.render();let pageComposer=find(tree,n=>typeof n.type==='function'&&n.type.name==='CommandComposer');
const cloned=value=>JSON.parse(JSON.stringify(value));
const original=cloned(q), future=cloned(q);
future.objectives[0].title='相机拍照效果验证';future.objectives[0].status='completed';future.objectives[0].steps=[];
future.objectives.push({id:'future-prd',quest_id:q.id,title:'完成 PRD',priority:'P1',status:'open',created_at:3,updated_at:3,attachments:[],steps:['和 协作者 同步思路','找研发算法确认指标','调研了解仿真平台'].map((title,i)=>({id:'future-'+i,objective_id:'future-prd',title,priority:'P1',status:'open',created_at:3,updated_at:3,attachments:[]}))});
// Hide completed and collapse first: changed content must remain visible.
find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
find(tree,n=>n.props['aria-label']==='折叠目标').props.onClick();
pageComposer.props.onPreviewChange({...plan,base_quest:original,projected_quest:future});tree=main.render();
const marked=nodes(tree).filter(n=>n.props.className?.includes('qj-preview-node'));
assert.equal(marked.filter(n=>n.props.className.includes('qj-preview-added')).length,4);
assert.equal(marked.filter(n=>n.props.className.includes('qj-preview-changed')).length,1);
assert.equal(marked.filter(n=>n.props.className.includes('qj-preview-deleted')).length,1);
assert.ok(nodes(tree).some(n=>n.children.includes('将删除')));
assert.ok(nodes(tree).some(n=>n.children.some(c=>typeof c==='string'&&c.includes('未完成 → 已完成'))));
assert.ok(!nodes(tree).some(n=>n.type==='p'&&n.children.some(c=>typeof c==='string'&&c.includes('优先级：P0'))));
assert.ok(nodes(tree).some(n=>n.props.className==='qj-priority'&&n.children.includes('P0')));
assert.equal(JSON.stringify(q),JSON.stringify(original));
assert.ok(nodes(tree).filter(n=>n.props.className==='qj-check').every(n=>n.props.disabled));
// Moving a step shows it in the new hierarchy, with its old position noted.
const moved=cloned(q), child=moved.objectives[0].steps.pop();
child.quest_id=q.id;delete child.objective_id;child.steps=[];moved.objectives.push(child);
pageComposer.props.onPreviewChange({...plan,base_quest:original,projected_quest:moved});tree=main.render();
assert.equal(nodes(tree).filter(n=>n.props.className?.includes('qj-preview-moved')).length,1);
assert.ok(nodes(tree).some(n=>n.children.some(c=>typeof c==='string'&&c.includes('原位置：相机拍照效果对比'))));
// Cancelling restores the actual data and unblocks editing.
pageComposer.props.onPreviewChange(null);tree=main.render();assert.ok(!nodes(tree).some(n=>n.props.className?.includes('qj-preview-node')));
assert.equal(nodes(tree).filter(n=>n.props.className==='qj-check')[0].props.disabled,false);
assert.ok(!nodes(tree).some(n=>n.props.className==='qj-outline-banner'));
// Drag interactions: explicit before/after placement, no handles in details,
// persisted anchor operations and no write when cancelled or self-dropped.
q.objectives.push({id:'o2',quest_id:q.id,title:'空目标',priority:'P1',status:'open',created_at:1,updated_at:1,steps:[],attachments:[]});
let scrolls=0;
const dragEvent=(y=110,interactive=false)=>{
 const scroller={getBoundingClientRect:()=>({top:100,bottom:500}),scrollBy(){scrolls++;}};
 const element={getBoundingClientRect:()=>({top:100,height:80}),closest:()=>scroller};
 return {clientY:y,currentTarget:element,target:{closest:()=>interactive?{}:null},prevented:false,stopped:false,
  preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},dataTransfer:{setData(){},setDragImage(){}}};
};
const sortItem=(t,id)=>find(t,n=>n.props['data-sort-id']===id);
const header=(t,id)=>find(t,n=>n.props['data-drag-id']===id);
tree=main.render();
let grip=find(sortItem(tree,'q'),n=>n.props.className==='qj-drag');
grip.props.onDragStart(dragEvent());tree=main.render();assert.ok(sortItem(tree,'q').props.className.includes('qj-is-dragging'));
sortItem(tree,'q3').props.onDragOver(dragEvent(110));tree=main.render();
assert.ok(nodes(sortItem(tree,'q3')).some(n=>n.props.className==='qj-drop-indicator is-before'));
sortItem(tree,'q3').props.onDragOver(dragEvent(170));tree=main.render();
assert.ok(nodes(sortItem(tree,'q3')).some(n=>n.props.className==='qj-drop-indicator is-after'));
await sortItem(tree,'q3').props.onDrop(dragEvent(170));assert.equal(edits.at(-1).op,'reorder_node');assert.equal(edits.at(-1).position,'after');assert.equal(edits.at(-1).target_id,'q3');
assert.ok(scrolls>0);tree=main.render();assert.ok(!nodes(tree).some(n=>n.props.className?.startsWith('qj-drop-indicator')));
// Every sorting mode permits dragging; incompatible placement switches to －.
find(tree,n=>n.type==='select'&&n.props['aria-label']==='排序').props.onChange({target:{value:'priority'}});tree=main.render();assert.equal(find(sortItem(tree,'q'),n=>n.props.className==='qj-drag').props.draggable,true);
find(sortItem(tree,'q3'),n=>n.props.className==='qj-drag').props.onDragStart(dragEvent());tree=main.render();await sortItem(tree,'q2').props.onDrop(dragEvent(110));tree=main.render();
assert.equal(find(tree,n=>n.props['aria-label']==='排序').props.value,'manual');assert.equal(edits.at(-1).sort_mode,'priority');
assert.deepEqual(nodes(tree).filter(n=>n.props.className?.startsWith('qj-quest-item')).map(n=>n.props['data-sort-id']),['q','q3','q2']);
assert.ok(nodes(tree).some(n=>n.type==='option'&&n.props.value==='manual'&&n.children.includes('－')));
find(tree,n=>n.props['aria-label']==='排序').props.onChange({target:{value:'priority'}});tree=main.render();
find(sortItem(tree,'q3'),n=>n.props.className==='qj-drag').props.onDragStart(dragEvent());tree=main.render();await sortItem(tree,'q2').props.onDrop(dragEvent(170));tree=main.render();
assert.equal(find(tree,n=>n.props['aria-label']==='排序').props.value,'priority');
for(const mode of ['updated','created']){
 find(tree,n=>n.props['aria-label']==='排序').props.onChange({target:{value:mode}});tree=main.render();
 assert.equal(find(sortItem(tree,'q'),n=>n.props.className==='qj-drag').props.draggable,true);
 find(sortItem(tree,'q'),n=>n.props.className==='qj-drag').props.onDragStart(dragEvent());tree=main.render();await sortItem(tree,'q2').props.onDrop(dragEvent(110));tree=main.render();
 assert.equal(find(tree,n=>n.props['aria-label']==='排序').props.value,'manual');assert.equal(edits.at(-1).sort_mode,mode);
}
find(tree,n=>n.props['aria-label']==='排序').props.onChange({target:{value:'manual'}});
// Turn off hiding and unfold for detail drag tests.
tree=main.render();find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});
const unfold=nodes(tree).find(n=>n.props['aria-label']==='展开目标');if(unfold)unfold.props.onClick();tree=main.render();
assert.equal(header(tree,'o').props.draggable,true);assert.equal(nodes(sortItem(tree,'o')).filter(n=>n.props.className==='qj-drag').length,0);
header(tree,'o').props.onPointerDownCapture({target:{closest:()=>null}});header(tree,'o').props.onDragStart(dragEvent());tree=main.render();sortItem(tree,'o2').props.onDragOver(dragEvent(110));tree=main.render();
assert.ok(nodes(sortItem(tree,'o2')).some(n=>n.props.className==='qj-drop-indicator is-before'));
await sortItem(tree,'o2').props.onDrop(dragEvent(110));assert.equal(edits.at(-1).node_type,'objective');assert.equal(edits.at(-1).parent_id,'q');
// Drag the existing step onto an empty goal: preserve step level, change parent.
tree=main.render();header(tree,'s').props.onPointerDownCapture({target:{closest:()=>null}});header(tree,'s').props.onDragStart(dragEvent());tree=main.render();sortItem(tree,'o2').props.onDragOver(dragEvent());tree=main.render();
assert.ok(nodes(sortItem(tree,'o2')).some(n=>n.props.className==='qj-drop-indicator is-end'));
await sortItem(tree,'o2').props.onDrop(dragEvent());assert.equal(edits.at(-1).node_type,'step');assert.equal(edits.at(-1).parent_id,'o2');assert.equal(edits.at(-1).position,'end');
// Self hover must not bubble into the parent and accidentally append the step.
tree=main.render();header(tree,'s').props.onDragStart(dragEvent());tree=main.render();const self=dragEvent();sortItem(tree,'s').props.onDragOver(self);assert.ok(self.stopped);tree=main.render();assert.ok(!nodes(tree).some(n=>n.props.className?.startsWith('qj-drop-indicator')));
const count=edits.length;await sortItem(tree,'s').props.onDrop(dragEvent());assert.equal(edits.length,count);header(tree,'s').props.onDragEnd();
// Inputs and active text selections never initiate item moves.
tree=main.render();header(tree,'o').props.onPointerDownCapture({target:{closest:()=>({})}});const blocked=dragEvent();header(tree,'o').props.onDragStart(blocked);assert.ok(blocked.prevented);
header(tree,'o').props.onPointerDownCapture({altKey:true,target:{closest:()=>null}});const alt=dragEvent();header(tree,'o').props.onDragStart(alt);assert.ok(alt.prevented);header(tree,'o').props.onDragEnd();
// Cancelled drag clears the indicator and does not persist an order change.
tree=main.render();header(tree,'o').props.onPointerDownCapture({target:{closest:()=>null}});header(tree,'o').props.onDragStart(dragEvent());tree=main.render();sortItem(tree,'o2').props.onDragOver(dragEvent());tree=main.render();const cancelCount=edits.length;header(tree,'o').props.onDragEnd();tree=main.render();assert.equal(edits.length,cancelCount);assert.ok(!nodes(tree).some(n=>n.props.className?.startsWith('qj-drop-indicator')));
// Preview mode prohibits both sidebar and outline dragging.
pageComposer.props.onPreviewChange({...plan,base_quest:original,projected_quest:future});tree=main.render();assert.equal(header(tree,'o').props.draggable,false);assert.equal(find(sortItem(tree,'q'),n=>n.props.className==='qj-drag').props.draggable,false);pageComposer.props.onPreviewChange(null);
// New-task dialog supports both DSH generation and a plain manual create.
tree=main.render();button(tree,'+ 新建任务').props.onClick();tree=main.render();
const dialogElement=find(tree,n=>typeof n.type==='function'&&n.type.name==='NewQuestDialog');
let newCreated=null,closed=0;
const dialog=mount(dialogElement.type,{onClose:()=>closed++,onCreated:async q=>{newCreated=q;}});let dt=dialog.render();assert.equal(dt.props.role,'dialog');
const creatorElement=find(dt,n=>typeof n.type==='function'&&n.type.name==='CommandComposer');const creator=mount(creatorElement.type,creatorElement.props);
responseMode='ready';let createTree=inputText(creator,'完成 示例项目 A PRD，和 协作者 同步、确认指标、调研平台');
const taskWrites=edits.length;await button(createTree,'生成任务与拆解').props.onClick();createTree=creator.render();assert.equal(edits.length,taskWrites);assert.ok(requests.at(-1).path.endsWith('/command/new/preview'));assert.equal(requests.at(-1).body.quest_id,undefined);
assert.ok(nodes(createTree).some(n=>n.children.includes('完成 示例项目 A PRD')));assert.ok(nodes(createTree).some(n=>n.children.includes('和 协作者 同步思路')));
await button(createTree,'创建任务及拆解').props.onClick();assert.equal(newCreated.id,'created-q');assert.equal(requests.at(-1).body.plan_id,'creation-plan');assert.ok(requests.at(-1).path.endsWith('/command/new/apply'));
// Failed creation generation keeps the full intent, and clarification stays local.
responseMode='error';const failedCreator=mount(creatorElement.type,creatorElement.props);createTree=inputText(failedCreator,'我想完成新项目');await button(createTree,'生成任务与拆解').props.onClick();createTree=failedCreator.render();assert.equal(find(createTree,n=>n.type==='textarea').props.value,'我想完成新项目');
responseMode='question';await button(createTree,'重试生成').props.onClick();createTree=failedCreator.render();assert.ok(nodes(createTree).some(n=>n.children.includes('预期交付什么？')));assert.ok(!nodes(createTree).some(n=>n.type==='button'&&n.children.includes('创建任务及拆解')));
// Manual mode creates only the title/description with source=manual route.
dt=dialog.render();button(dt,'手动新建').props.onClick();dt=dialog.render();find(dt,n=>n.props['aria-label']==='新任务名称').props.onChange({target:{value:'手动任务'}});dt=dialog.render();find(dt,n=>n.props['aria-label']==='新任务描述').props.onChange({target:{value:'手动描述'}});dt=dialog.render();await find(dt,n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(newCreated.id,'manual-q');assert.equal(edits.at(-1).title,'手动任务');assert.equal(edits.at(-1).description,'手动描述');
// Closing the parent dialog is wired; a created task is selected and filters clear.
dt=dialog.render();find(dt,n=>n.props['aria-label']==='关闭新建任务').props.onClick();assert.equal(closed,1);
await dialogElement.props.onCreated(newTree);tree=main.render();assert.ok(!nodes(tree).some(n=>typeof n.type==='function'&&n.type.name==='NewQuestDialog'));assert.equal(find(tree,n=>n.props['aria-label']==='筛选').props.value,'all');
assert.ok(!source.includes('window.prompt('));
// Optional static screenshot input, generated from the actual component tree.
if(process.env.QJ_SCREENSHOT_HTML){
 function html(n){if(n==null||n===false)return '';if(typeof n!=='object')return String(n).replaceAll('&','&amp;').replaceAll('<','&lt;');if(typeof n.type==='function'){const m=mount(n.type,n.props);return html(m.render());}const attrs=Object.entries(n.props).filter(([k,v])=>!k.startsWith('on')&&!['children','key','style','ref','autoFocus'].includes(k)&&v!=null&&v!==false).map(([k,v])=>' '+(k==='className'?'class':k)+'="'+String(v===true?'':v).replaceAll('"','&quot;')+'"').join('');if(n.type==='style')return '<style>'+n.children.join('')+'</style>';return '<'+n.type+attrs+'>'+n.children.map(html).join('')+'</'+n.type+'>';}
 pageComposer.props.onPreviewChange({...plan,base_quest:original,projected_quest:future});tree=main.render();writeFileSync(process.env.QJ_SCREENSHOT_HTML,'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#171410;height:100%}body>div{height:100vh}</style>'+html(tree));
}
console.log('Client passed: compact menus, inline add, block form, command preview/apply, retry, clarification, cancellation, simulated outline, changed/deleted/moved highlights legacy metadata cleanup, drag placement/cancellation, goal reorder, step reparenting and drag/edit guards.');
