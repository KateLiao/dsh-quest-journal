import assert from 'node:assert/strict';
const port=process.env.QJ_BROWSER_PORT;
if(!port)throw Error('Run via python3 scripts/test-browser-drag.py');
const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map();let intercepted;
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}if(m.method==='Input.dragIntercepted')intercepted=m.params.data;});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.exceptionDetails.exception?.description);return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const rect=selector=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('missing '+${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,top:r.top,bottom:r.bottom}})()`);
const move=(x,y,buttons=0)=>send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,buttons,button:buttons?'left':'none'});
async function click(selector){const p=await rect(selector);await move(p.x,p.y);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,buttons:1,x:p.x,y:p.y});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:p.x,y:p.y});await wait(100);}
async function drag(source,target,where='after'){
 intercepted=null;const a=await rect(source),b=await rect(target);const y=where==='before'?b.top+3:b.bottom-3;
 await move(a.x,a.y);await wait(50);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:a.x,y:a.y});
 for(let i=1;i<=12;i++){await move(a.x+20*i/12,a.y+12*i/12,1);await wait(16);}await wait(120);await move(b.x,y,1);await wait(200);
 if(!intercepted)throw Error('Native drag did not start: '+JSON.stringify(await evaluate('window.events'))+' errors '+JSON.stringify(await evaluate('window.errors')));
 await send('Input.dispatchDragEvent',{type:'dragEnter',x:b.x,y,data:intercepted});await send('Input.dispatchDragEvent',{type:'dragOver',x:b.x,y,data:intercepted});await wait(100);
 assert.ok(await evaluate('!!document.querySelector(".qj-drop-indicator")'),'no visible insertion indicator');
 await send('Input.dispatchDragEvent',{type:'drop',x:b.x,y,data:intercepted});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',x:b.x,y});await wait(180);
}
try{
 await send('Runtime.enable');await evaluate(`for(const type of ['pointerdown','mousedown','mouseup'])document.addEventListener(type,e=>window.events.push({type,tag:e.target.tagName,x:e.clientX,y:e.clientY,prevented:e.defaultPrevented}),true)`);await send('Input.setInterceptDrags',{enabled:true});for(let i=0;i<100;i++){if(await evaluate(`!!document.querySelector('[data-sort-id="q2"]')`))break;await wait(50);}
 console.log('runtime',await evaluate('({errors:window.errors,items:document.querySelectorAll(".qj-quest-item").length})'));
 await click('[data-sort-id="q2"]');

 await drag('[data-drag-id="o1"] .qj-node-title','[data-sort-id="o2"]');
 assert.equal((await evaluate('window.calls.at(-1).changes[0]')).node_type,'objective');console.log('PASS native goal title drag');
 await click('.qj-add-bottom');
 assert.ok(await evaluate('!!document.querySelector(".qj-inline-new")'));
 await drag('[data-drag-id="o2"] .qj-node-title','[data-sort-id="o1"]','before');
 console.log('PASS native goal drag while empty add row closes');
 await evaluate(`(()=>{const el=document.querySelector('select[aria-label="排序"]');el.value='priority';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(100);
 await drag('[data-sort-id="q3"] .qj-drag','[data-sort-id="q2"]','before');
 assert.equal(await evaluate('document.querySelector("select[aria-label=排序]").value'),'manual');
 assert.equal((await evaluate('window.calls.at(-1).changes[0]')).sort_mode,'priority');
 console.log('PASS native priority drag: P2 before P1 => －');
 // Equal-priority placement keeps the selected sorting mode.
 await evaluate(`(()=>{const el=document.querySelector('select[aria-label="排序"]');el.value='priority';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(100);
 await drag('[data-sort-id="q4"] .qj-drag','[data-sort-id="q2"]','before');
 assert.equal(await evaluate('document.querySelector("select[aria-label=排序]").value'),'priority');
 console.log('PASS native equal-priority drag retains priority sort');
 for(const mode of ['updated','created']){
  await evaluate(`(()=>{const el=document.querySelector('select[aria-label="排序"]');el.value=${JSON.stringify(mode)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(100);
  await drag('[data-sort-id="q2"] .qj-drag','[data-sort-id="q4"]','before');
  assert.equal(await evaluate('document.querySelector("select[aria-label=排序]").value'),'manual');
  console.log('PASS native '+mode+' sort violation switches to －');
 }
 // New-task dialog: real React input, hierarchy preview, then auto-navigation.
 await click('.qj-new');
 await click('.qj-create-dialog textarea[aria-label="描述要创建的任务"]');
 await send('Input.insertText',{text:'创建 示例项目 A PRD，和 协作者 同步思路、确认指标、调研仿真平台'});
 await click('.qj-create-dialog .qj-command-actions .qj-primary');
 assert.equal(await evaluate('document.querySelectorAll(".qj-create-preview-node").length'),5);
 assert.ok(await evaluate('document.querySelector(".qj-create-preview").textContent.includes("调研了解仿真平台")'));
 console.log('PASS native new-task input and full decomposition preview');
 if(process.env.QJ_CREATE_SCREENSHOT){const {writeFileSync}=await import('node:fs');const screenshot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(process.env.QJ_CREATE_SCREENSHOT,Buffer.from(screenshot.data,'base64'));}
 await send('Emulation.setDeviceMetricsOverride',{width:520,height:560,deviceScaleFactor:1,mobile:false});
 await evaluate(`(() => {
   const scroll = document.querySelector('.qj-create-scroll');
   scroll.scrollTop = scroll.scrollHeight;
 })()`);
 assert.ok(await evaluate(`(() => {
   const scroll = document.querySelector('.qj-create-scroll');
   const button = document.querySelector('.qj-create-footer .qj-primary');
   const rect = button.getBoundingClientRect();
   return scroll.scrollTop > 0 && !button.disabled && rect.bottom <= innerHeight
     && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
 })()`), 'confirmation remains clickable after scrolling the preview in a short viewport');
 await click('.qj-create-footer .qj-primary');await wait(150);
 assert.ok(await evaluate('!document.querySelector(".qj-create-dialog")'));
 assert.equal(await evaluate('document.querySelector(".qj-quest-item[aria-current=true]").dataset.sortId'),'native-new-task');
 assert.ok(await evaluate('document.querySelector(".qj-detail").textContent.includes("完成 示例项目 A PRD")'));
 console.log('PASS native confirmation opens the newly created task');
 assert.deepEqual(await evaluate('window.errors'),[]);
 console.log('errors',await evaluate('window.errors'));await send('Browser.close');
}finally{ws.close();}
