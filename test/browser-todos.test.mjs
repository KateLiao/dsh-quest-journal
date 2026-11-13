// Actual UI + HTTP + SQLite, using only isolated synthetic data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {writeFileSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {QuestJournalStore,QuestJournalService} from '../packages/dsh-quest-journal/lib/quest-core.mjs';
const {createRoutes}=await import(process.env.QJ_WEB_MODULE);
const store=new QuestJournalStore(':memory:'),j=new QuestJournalService(store);
const q=j.createQuest({title:'示例项目 A 测试'}),o=j.addObjective(q.id,{title:'完成 PRD'});j.addStep(o.id,{title:'确认验收指标'});
const other=j.createQuest({title:'示例任务 B'});j.todos.create({title:'与协作者同步 PRD 思路',request_id:'browser-seed',due_date:'2026-11-20'});
let rejectNext=false,assetsRoot;
const routes=createRoutes({getService:()=>j,reject:()=>null});
const server=createServer(async(req,res)=>{if(['/index.html','/client.mjs','/harness.mjs','/runtime.mjs','/vendor.mjs'].includes(req.url)){res.setHeader('content-type',req.url.endsWith('.html')?'text/html':'application/javascript');res.end(readFileSync(join(assetsRoot,req.url.slice(1))));return;}res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','content-type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS'){res.end();return;}if(rejectNext&&req.method==='POST'){rejectNext=false;res.statusCode=503;res.end(JSON.stringify({error:'模拟暂时失败，请重试'}));return;}await routes(req,res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const pages=await(await fetch('http://127.0.0.1:'+process.env.QJ_BROWSER_PORT+'/json/list')).json();const page=pages.find(p=>p.type==='page');assetsRoot=dirname(fileURLToPath(page.url));const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression){for(let i=0;i<100;i++){if(await ev(expression))return;await wait(40);}throw Error('Timed out: '+expression+' / '+JSON.stringify(await ev('window.errors')));}
async function click(selector){const rect=await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('missing ${selector}');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:rect.x,y:rect.y,button:'left',clickCount:1});await wait(60);}
async function type(selector,text){await click(selector);await send('Input.insertText',{text});}
async function select(selector,value){await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(80);}
async function setDate(value){await ev(`(()=>{const e=document.querySelector('.qj-time-card input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(50);}
try{
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/index.html#'+server.address().port});await until('!!document.querySelector(".qj-quest-item")');
 await click(`[data-sort-id="${q.id}"]`);await until('!!document.querySelector(".qj-detail")');
 await click('.qj-todo-trigger');await until('!document.querySelector(".qj-todo-drawer").hidden');assert.equal(await ev('document.querySelector(".qj-todo-trigger").getAttribute("aria-pressed")'),'true');
 await type('.qj-todo-capture input','临时记录待办');rejectNext=true;await click('.qj-todo-capture button');await until('!!document.querySelector(".qj-todo-body .qj-error")');assert.equal(await ev('document.querySelector(".qj-todo-capture input").value'),'临时记录待办');await click('.qj-todo-capture button');await until('document.querySelector(".qj-todo-trigger .qj-todo-count").textContent==="2"');assert.equal(j.todos.list().length,2);console.log('PASS capture, failed save retains input and retry through real HTTP');

 assert.ok(await ev('document.activeElement===document.querySelector(".qj-todo-capture input")'),'continuous capture restores focus');
 await click('.qj-todo-item .qj-icon');await ev(`Array.from(document.querySelectorAll('.qj-todo-menu button')).find(e=>e.textContent==='编辑标题').click()`);
 await type('.qj-todo-item input','补充');await click('.qj-todo-item .qj-mini');await until('!document.querySelector(".qj-todo-item input")');assert.ok(j.todos.list().some(t=>t.title==='临时记录待办补充'));
 await click('.qj-todo-item .qj-icon');await ev(`Array.from(document.querySelectorAll('.qj-todo-menu button')).find(e=>e.textContent==='时间与截止日期').click()`);await until('!!document.querySelector(".qj-time-card")');await setDate('2026-12-01');await click('.qj-deadline-edit .qj-primary');await until('!document.querySelector(".qj-time-card")');assert.ok(j.todos.list().some(t=>t.due_date==='2026-12-01'));
 await click('.qj-todo-item .qj-icon');await ev(`Array.from(document.querySelectorAll('.qj-todo-menu button')).find(e=>e.textContent==='删除 TODO').click()`);await until('document.querySelector(".qj-todo-trigger .qj-todo-count").textContent==="1"');
 await click('.qj-todo-toast .qj-todo-link');await until('document.querySelector(".qj-todo-trigger .qj-todo-count").textContent==="2"');console.log('PASS continuous capture focus, TODO title editing, deadline, deletion and restore');
 const first=j.todos.list().find(t=>t.title==='与协作者同步 PRD 思路');
 await click('.qj-todo-item:last-of-type .qj-todo-link:not(.qj-muted)');await until('!!document.querySelector('+JSON.stringify('.qj-todo-dialog select[aria-label=放置位置] option[value="'+o.id+'"]')+')');
 await select('.qj-todo-dialog select[aria-label="放置位置"]',o.id);
 await send('Emulation.setDeviceMetricsOverride',{width:520,height:560,deviceScaleFactor:1,mobile:false});
 assert.ok(await ev('(()=>{const e=document.querySelector(".qj-todo-dialog-foot .qj-primary"),r=e.getBoundingClientRect();return !e.disabled&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()'));
 await click('.qj-todo-dialog-foot .qj-primary');await until('!document.querySelector(".qj-todo-dialog")');assert.ok(j.todos.list().find(t=>t.id===first.id).converted_at);assert.equal(store.listSteps(o.id).at(-1).title,first.title);assert.equal(store.listSteps(o.id).at(-1).created_at,first.created_at);console.log('PASS actual conversion into selected goal, dates retained, short viewport confirm visible');
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await click('.qj-todo-heading .qj-icon');await until('!!document.querySelector(".qj-todo-fresh")');assert.equal(await ev('document.querySelector(".qj-todo-trigger").getAttribute("aria-pressed")'),'false');
 await click('.qj-todo-toast button:nth-of-type(2)');await until('document.querySelector(".qj-todo-trigger .qj-todo-count").textContent==="2"');assert.equal(store.listSteps(o.id).length,1);console.log('PASS conversion undo restores todo and removes only the unchanged new node');
 await click(`[data-drag-id="${o.id}"] button[aria-label^="更多操作"]`);await ev(`Array.from(document.querySelectorAll('.qj-menu-item')).find(e=>e.textContent==='时间与截止日期').click()`);await until('!!document.querySelector(".qj-time-card")');await setDate('2026-11-25');await click('.qj-deadline-edit .qj-primary');await until('!document.querySelector(".qj-time-card")');assert.equal(store.getObjective(o.id).due_date,'2026-11-25');
 await click(`[data-drag-id="${o.id}"] .qj-deadline`);assert.ok((await ev('document.querySelector(".qj-time-card").textContent')).includes('尚未完成'));await select('.qj-time-card select','time');await setDate('2026-11-26T16:30');await click('.qj-deadline-edit .qj-primary');await until('!document.querySelector(".qj-time-card")');assert.ok(store.getObjective(o.id).due_at);assert.equal(store.getObjective(o.id).due_date,null);console.log('PASS date-only and timed deadline save from inline time card');
 await click('.qj-todo-trigger');await type('.qj-todo-capture input','直接作为目标');await select('.qj-todo-capture select[aria-label="关联 quest"]',q.id);await until('!document.querySelector(".qj-todo-capture button").disabled');await click('.qj-todo-capture button');await until('document.querySelector(".qj-todo-capture input").value===""');assert.ok(store.listObjectives(q.id).some(n=>n.title==='直接作为目标'));console.log('PASS one-step record and conversion');
 await click('.qj-todo-item button.qj-check');await until('document.querySelector(".qj-todo-trigger .qj-todo-count").textContent==="1"');assert.ok(j.todos.list().some(n=>n.status==='completed'));console.log('PASS completed TODO count and persistent state');

 await type('.qj-todo-capture input','另一个 quest 的目标');await select('.qj-todo-capture select[aria-label="关联 quest"]',other.id);await until('!document.querySelector(".qj-todo-capture button").disabled');await click('.qj-todo-capture button');await until('document.querySelector(".qj-todo-capture input").value===""');await click('.qj-todo-toast .qj-todo-link');await until('document.querySelector(".qj-quest-item[aria-current=true]").dataset.sortId==="'+other.id+'"');await until('document.querySelector(".qj-detail").textContent.includes("另一个 quest 的目标")');console.log('PASS conversion into another quest and explicit navigation to the actual target');
 await click('.qj-todo-trigger');await type('.qj-todo-capture input','保留未提交草稿');await click('.qj-todo-heading .qj-icon');await click('.qj-todo-trigger');assert.equal(await ev('document.querySelector(".qj-todo-capture input").value'),'保留未提交草稿');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await until('document.querySelector(".qj-todo-drawer").hidden');assert.ok(await ev('document.activeElement===document.querySelector(".qj-todo-trigger")'));console.log('PASS close/reopen keeps draft and Escape restores trigger focus');
 assert.deepEqual(await ev('window.errors'),[]);
 if(process.env.QJ_TODO_SCREENSHOT){await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(process.env.QJ_TODO_SCREENSHOT,Buffer.from(r.data,'base64')));}
 console.log('PASS no browser runtime errors; all data isolated from real profile');
}finally{ws.close();await new Promise(r=>server.close(r));store.close();}
