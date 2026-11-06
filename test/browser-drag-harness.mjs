import './runtime.mjs';
const React=window.qjReact,Dom=window.qjReactDom;
let Page;window.errors=[];window.calls=[];window.events=[];
window.addEventListener('error',e=>window.errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.errors.push(String(e.reason)));
for(const type of ['dragstart','dragend','drop'])document.addEventListener(type,e=>window.events.push({type,id:e.target.dataset.dragId||e.target.closest?.('[data-sort-id]')?.dataset.sortId}),true);
let tasks=[{id:'q2',title:'P1 task first',priority:'P1',sort_order:0},{id:'q1',title:'P0 task',priority:'P0',sort_order:1},{id:'q3',title:'P2 task',priority:'P2',sort_order:2},{id:'q4',title:'P1 task second',priority:'P1',sort_order:3}].map(q=>({...q,status:'open',archived_at:null,created_at:1000+q.sort_order,updated_at:2000+q.sort_order}));
const objectives=[{id:'o1',quest_id:'q2',title:'First goal draggable title',priority:'P1',status:'open',created_at:1,updated_at:1,attachments:[],steps:[{id:'s1',objective_id:'o1',title:'First progress',priority:'P1',status:'open',created_at:1,updated_at:1,attachments:[]}]},{id:'o2',quest_id:'q2',title:'Second empty goal',priority:'P1',status:'open',created_at:1,updated_at:1,steps:[],attachments:[]}];
const creationTree={id:'native-new-task',title:'完成 示例项目 A PRD',description:'新任务生成测试',priority:'P0',status:'open',archived_at:null,created_at:1,updated_at:1,sort_order:4,attachments:[],objectives:[{id:'native-new-goal',quest_id:'native-new-task',title:'完成 PRD',description:'优化 PRD',priority:'P1',status:'open',created_at:1,updated_at:1,attachments:[],steps:['和 协作者 同步思路','找研发算法确认指标','调研了解仿真平台'].map((title,i)=>({id:'native-new-step'+i,objective_id:'native-new-goal',title,priority:'P1',status:'open',created_at:1,updated_at:1,attachments:[]}))}]};
const compare=(a,b,mode)=>mode==='priority'?a.priority.localeCompare(b.priority):mode==='updated'?b.updated_at-a.updated_at:mode==='created'?b.created_at-a.created_at:a.sort_order-b.sort_order;
window.fetch=async(path,options)=>{
 if(path.endsWith('/command/new/preview')){const input=JSON.parse(options.body);window.calls.push({newPreview:input});return {ok:true,json:async()=>({id:'native-create-plan',kind:'create',summary:'生成 PRD 任务及下一步',question:null,instruction:input.instruction,changes:Array(5).fill({op:'create'}),projected_quest:creationTree})};}
 if(path.endsWith('/command/new/apply')){window.calls.push({newApply:JSON.parse(options.body)});tasks.push(creationTree);return {ok:true,json:async()=>({quest:creationTree,results:[]})};}
 let data={};if(options?.body){const body=JSON.parse(options.body);window.calls.push(body);const results=[];for(const c of body.changes||[]){
  if(c.op==='reorder_node'){
   if(c.node_type==='quest'){
    let list=[...tasks].sort((a,b)=>compare(a,b,c.sort_mode)||a.sort_order-b.sort_order),node=list.find(t=>t.id===c.node_id);list=list.filter(t=>t.id!==c.node_id);const i=c.position==='end'?list.length:list.findIndex(t=>t.id===c.target_id)+(c.position==='after'?1:0);list.splice(i,0,node);tasks=list.map((t,index)=>({...t,sort_order:index}));results.push({op:c.op,node,sort_mode:tasks.every((t,i)=>i===0||compare(tasks[i-1],t,c.sort_mode)<=0)?c.sort_mode:'manual'});
   }else if(c.node_type==='objective'){const n=objectives.find(o=>o.id===c.node_id);objectives.splice(objectives.indexOf(n),1);const i=objectives.findIndex(o=>o.id===c.target_id)+(c.position==='after'?1:0);objectives.splice(i,0,n);results.push({op:c.op,node:n});}
   else results.push({op:c.op,node:{id:c.node_id}});
  }else results.push({op:c.op,node:{id:'new'}});
 }data={results};
 }else if(path.includes('/state'))data={quests:tasks};else if(path.includes('/quest?'))data={quest:new URL('http://local'+path).searchParams.get('id')==='native-new-task'?creationTree:{...tasks.find(t=>t.id===new URL('http://local'+path).searchParams.get('id')),objectives,attachments:[]}};else data={events:[]};
 return {ok:true,json:async()=>data};
};
window.__ModuleLoader__={load({factory}){const plugin=factory(()=>React);plugin.apply({effect:f=>f(),locale:{register(){},bind:()=>k=>k},slots:{inject(name,f){const it=f();it?.next?.();},register(spec,component){if(spec.name==='main')Page=component;}}});}};
await import('./client.mjs');Dom.createRoot(document.getElementById('root')).render(React.createElement(Page,{t:k=>k}));
