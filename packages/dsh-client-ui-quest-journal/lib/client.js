// Quest Journal — Web client surface.
//
// Loaded by the DSH client module loader via `exports["./client"]`. Registers
// a sidebar panel entry and a two-column journal page (left: quest list;
// right: quest detail with objectives/steps, attachments, and trace). All
// reads and writes go through this package's own `/quest-journal/*` Host
// routes (`lib/web.js`), not the Typert `remote.*` surface.

window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-quest-journal",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");
    let h = react.createElement;

    const NS = "questJournal";
    const PANEL_ID = "quests";

    // DSH packs `remote.*` namespaces at build time, so a third-party plugin
    // cannot expose `remote.questJournal`. The panel therefore talks to its own
    // Host routes (lib/web.js), which delegate to the same questJournal service
    // the `quest_*` tools use.
    const ENDPOINT = "/quest-journal";

    async function call(path, body, signal) {
      const res = await fetch(ENDPOINT + path, body === undefined ? { signal } : {
        signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || "HTTP " + res.status), { code: data.code });
      return data;
    }

    const api = {
      listQuests: async (options) => (await call("/state?archived=" + (options && options.includeArchived ? "1" : "0"))).quests,
      getQuest: async (id) => (await call("/quest?id=" + encodeURIComponent(id))).quest,
      getTrace: async (id) => (await call("/trace?id=" + encodeURIComponent(id))).events,
      applyChanges: async (changes) => (await call("/ops", { changes })).results,
    };

    const inject = ["slots", "locale"];

    // Panel styles. Scoped under .qj-page so they cannot leak into the host
    // shell; rendered as a <style> element by the page, so unmounting the panel
    // removes them.
    const CSS = `
.qj-page {
  --qj-bg:#16100e; --qj-panel:#1e1712; --qj-panel2:#241b14; --qj-border:#3a2e22;
  --qj-soft:#2c231b; --qj-text:#e8dcc8; --qj-dim:#9c8f7c; --qj-faint:#6b5f50;
  --qj-accent:#c9a227; --qj-accent-dim:#8a6f1a; --qj-danger:#c0392b; --qj-ok:#7ba05b;
  display: grid; grid-template-columns: 300px minmax(0, 1fr); height: 100%;
  min-height: 0; background: var(--qj-bg); color: var(--qj-text);
  font-size: 14px; line-height: 1.5;
  font-family: "PingFang SC", "Microsoft YaHei", -apple-system, "Segoe UI", sans-serif;
}
.qj-page * { box-sizing: border-box; }
.qj-page button { font-family: inherit; }
.qj-left { background: var(--qj-panel); border-right: 1px solid var(--qj-border);
  display: flex; flex-direction: column; min-height: 0; }
.qj-tabs { display: flex; border-bottom: 1px solid var(--qj-border); flex: none; }
.qj-tab { flex: 1; padding: 11px 8px; background: none; border: none;
  color: var(--qj-dim); cursor: pointer; font-size: 13px;
  border-bottom: 2px solid transparent; }
.qj-tab.is-on { color: var(--qj-accent); border-bottom-color: var(--qj-accent); }
.qj-list { flex: 1; overflow-y: auto; padding: 8px; }
.qj-quest-item { display: flex; align-items: center; gap: 8px; padding: 9px 10px;
  border-radius: 8px; cursor: pointer; border: 1px solid transparent; margin-bottom: 4px; }
.qj-quest-item:hover { background: var(--qj-panel2); }
.qj-quest-item.is-selected { border-color: var(--qj-accent-dim); background: var(--qj-panel2); }
.qj-quest-status { width: 16px; text-align: center; color: var(--qj-faint); flex: none; }
.qj-quest-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qj-quest-item.is-done .qj-quest-title { color: var(--qj-faint); text-decoration: line-through; }
.qj-new { margin: 10px; padding: 9px; background: none; border: 1px dashed var(--qj-accent-dim);
  color: var(--qj-accent); border-radius: 8px; cursor: pointer; font-size: 13px; }
.qj-new:hover { background: rgba(201,162,39,0.08); }
.qj-right { overflow-y: auto; padding: 24px clamp(16px, 3vw, 40px) 48px; min-height: 0; }
.qj-hint { color: var(--qj-faint); padding: 32px 0; text-align: center; }
.qj-error { color: #e6a8a0; background: rgba(192,57,43,0.12);
  border: 1px solid rgba(192,57,43,0.4); padding: 9px 12px; border-radius: 8px; margin-bottom: 14px; }
.qj-quest-head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; }
.qj-quest-name { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.3px; }
.qj-quest-name.is-done { color: #7a6f5e; text-decoration: line-through; }
.qj-quest-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.qj-quest-actions button, .qj-mini { background: none; border: 1px solid var(--qj-border);
  color: var(--qj-dim); border-radius: 6px; padding: 5px 9px; cursor: pointer; font-size: 12px; }
.qj-quest-actions button:hover, .qj-mini:hover { border-color: var(--qj-accent-dim); color: var(--qj-text); }
.qj-desc { color: var(--qj-dim); margin: 8px 0 0; white-space: pre-wrap; }
.qj-page h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px;
  color: var(--qj-faint); margin: 22px 0 8px; border-bottom: 1px solid var(--qj-soft); padding-bottom: 6px; }
.qj-objective { border-left: 2px solid var(--qj-soft); margin: 4px 0 4px 4px; padding-left: 8px; }
.qj-step { margin-left: 26px; border-left: 1px solid var(--qj-soft); padding-left: 8px; }
.qj-node-row { display: flex; align-items: center; gap: 8px; padding: 5px 2px; }
.qj-status { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--qj-border);
  background: none; color: transparent; cursor: pointer; flex: none; font-size: 12px;
  line-height: 16px; text-align: center; padding: 0; }
.qj-status:hover { border-color: var(--qj-accent); }
.qj-status.is-completed { border-color: var(--qj-ok); color: var(--qj-ok); background: rgba(123,160,91,0.12); }
.qj-status.is-blocked { border-color: var(--qj-danger); }
.qj-node-title { flex: 1; min-width: 0; overflow-wrap: anywhere; cursor: pointer; }
.qj-node.is-done .qj-node-title { color: var(--qj-faint); text-decoration: line-through; }
.qj-blocked { background: rgba(192,57,43,0.15); border: 1px solid rgba(192,57,43,0.5);
  color: #e8a39a; border-radius: 4px; padding: 1px 7px; font-size: 11px;
  white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.qj-attach { padding: 6px 2px; border-bottom: 1px dashed var(--qj-soft); }
.qj-attach a { color: var(--qj-accent); text-decoration: none; }
.qj-attach a:hover { text-decoration: underline; }
.qj-trace { list-style: none; padding: 0; margin: 0; }
.qj-trace li { padding: 6px 2px; border-bottom: 1px solid var(--qj-soft); font-size: 13px; }
.qj-trace-time { color: var(--qj-faint); margin-right: 8px; font-size: 12px; }
.qj-trace-source { color: var(--qj-accent-dim); margin-left: 8px; font-size: 11px; }
`;

    // ------------------------------------------------------------------
    // Locale dictionaries
    // ------------------------------------------------------------------
    const zh = {
      "panel": "任务日志",
      "tab.active": "进行中",
      "tab.archived": "已归档",
      "empty": "暂无任务，点击“新建任务”开始。",
      "newQuest": "新建任务",
      "questTitle": "任务名称",
      "description": "描述",
      "addObjective": "添加目标",
      "addStep": "添加进展",
      "addNote": "添加备注",
      "addLink": "添加链接",
      "blocked": "阻塞",
      "blockReason": "阻塞原因",
      "complete": "完成",
      "reopen": "取消完成",
      "archive": "归档",
      "restore": "恢复",
      "trace": "历史记录",
      "attachments": "备注与链接",
      "objectives": "目标",
      "steps": "进展",
      "loading": "加载中…",
      "saveError": "保存失败",
      "editTitle": "编辑标题",
      "noTrace": "暂无历史记录。",
      "cancel": "取消",
      "save": "保存",
    };
    const en = {
      "panel": "Quest Journal",
      "tab.active": "Active",
      "tab.archived": "Archived",
      "empty": "No quests yet. Click “New Quest” to start.",
      "newQuest": "New Quest",
      "questTitle": "Quest title",
      "description": "Description",
      "addObjective": "Add Objective",
      "addStep": "Add Step",
      "addNote": "Add Note",
      "addLink": "Add Link",
      "blocked": "Blocked",
      "blockReason": "Block reason",
      "complete": "Complete",
      "reopen": "Reopen",
      "archive": "Archive",
      "restore": "Restore",
      "trace": "History",
      "attachments": "Notes & Links",
      "objectives": "Objectives",
      "steps": "Steps",
      "loading": "Loading…",
      "saveError": "Save failed",
      "editTitle": "Edit title",
      "noTrace": "No history yet.",
      "cancel": "Cancel",
      "save": "Save",
    };

    // ------------------------------------------------------------------
    // Small building-block components
    // ------------------------------------------------------------------

    function StatusIcon({ completed, blocked, onToggle }) {
      return h("button", {
        className: "qj-status" + (completed ? " is-completed" : "") + (blocked ? " is-blocked" : ""),
        onClick: onToggle,
        title: completed ? "Reopen" : "Complete",
        "aria-label": completed ? "Reopen" : "Complete",
      }, completed ? "✓" : "○");
    }

    function BlockedBadge({ blocked, reason }) {
      if (!blocked) return null;
      return h("span", { className: "qj-blocked", title: reason ?? "" }, "⛔ " + (reason ?? "Blocked"));
    }

    function NodeRow({ node, nodeType, onToggle, onSelect, onAddAttachment, onEditTitle }) {
      const dimmed = node.status === "completed";
      return h("div", { className: "qj-node" + (dimmed ? " is-done" : "") },
        h(StatusIcon, { completed: dimmed, blocked: node.is_blocked, onToggle: () => onToggle(nodeType, node.id) }),
        h("span", { className: "qj-node-title", onClick: () => onSelect(nodeType, node.id) }, node.title),
        h(BlockedBadge, { blocked: node.is_blocked, reason: node.blocked_reason }),
      );
    }

    // ------------------------------------------------------------------
    // Main page component
    // ------------------------------------------------------------------

    const dateLabel = ts => new Date(ts).toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit"});
    function EditableTitle({node, type, readonly, save, sibling, move}) {
      const [editing, setEditing] = react.useState(false);
      const [value, setValue] = react.useState(node.title);
      const skip = react.useRef(false);
      const commit = async () => {
        if (skip.current) { skip.current = false; return; }
        if (value.trim() && value.trim() !== node.title && !await save(type,node.id,value.trim())) return;
        setEditing(false);
      };
      if (!editing || readonly) return h("span", {className:"qj-node-title", title:type==="quest"?"双击编辑标题":"拖动调整顺序；双击编辑；按住 Alt 可选择文字", onDoubleClick:() => {if (!readonly) {skip.current=false;setValue(node.title);setEditing(true);}}},node.title);
      return h("input", {autoFocus:true, value, "aria-label":"编辑标题", onChange:e=>setValue(e.target.value), onBlur:commit,
        onKeyDown:async e=>{
          if (e.nativeEvent?.isComposing || e.isComposing) return;
          if (e.key === "Escape") {skip.current=true;setEditing(false);return;}
          const promote = e.key === "Backspace" && e.target.selectionStart === 0 && e.target.selectionEnd === 0;
          if (e.key === "Enter" || e.key === "Tab" || promote) {
            e.preventDefault(); skip.current=true;
            const ok = !value.trim() || value.trim() === node.title || await save(type,node.id,value.trim());
            if (!ok) {skip.current=false;return;}
            setEditing(false);
            if (e.key === "Enter") sibling(type,node);
            else move(type,node,promote || e.shiftKey);
          }
        }});
    }

    // Legacy descriptions sometimes contain a hand-written priority line. The
    // structured badge is authoritative; omit only a whole metadata-only line.
    function visibleDescription(text) {
      return (text||'').split(/\r?\n/).filter(line=>!/^\s*(?:优先级|priority)\s*[:：]\s*P[012]\s*$/i.test(line)).join('\n').trim();
    }

    // The server generates the future tree in a rollback transaction. Here we
    // annotate differences and retain deletions as tombstones for review only.
    function outlinePreview(base,projected) {
      const clone=value=>JSON.parse(JSON.stringify(value));
      const tree=clone(projected), old=new Map(), next=new Map();
      const index=(q,map)=>{map.set(q.id,{node:q,type:'quest',parent:null});for(const o of q.objectives){map.set(o.id,{node:o,type:'objective',parent:q.id});for(const s of o.steps)map.set(s.id,{node:s,type:'step',parent:o.id});}};
      index(base,old);index(tree,next);
      for(const [id,current] of next){
        const previous=old.get(id), n=current.node;
        if(!previous){n._preview={kind:'added',label:'新增',details:[]};continue;}
        const p=previous.node, details=[];
        if(p.title!==n.title)details.push('原标题：'+p.title);
        if(p.description!==n.description)details.push('描述已更新');
        if(p.status!==n.status)details.push(p.status==='completed'?'已完成 → 未完成':'未完成 → 已完成');
        if(p.priority!==n.priority)details.push('优先级：'+p.priority+' → '+n.priority);
        if(p.is_blocked!==n.is_blocked||p.blocked_reason!==n.blocked_reason)details.push(n.is_blocked?'已设置阻塞':'已解除阻塞');
        if(JSON.stringify(p.attachments||[])!==JSON.stringify(n.attachments||[]))details.push('备注与链接已更新');
        const moved=current.type!==previous.type||current.parent!==previous.parent;
        if(moved)details.push('原位置：'+(old.get(previous.parent)?.node.title||'当前任务'));
        if(details.length)n._preview={kind:moved?'moved':'changed',label:moved?'移动':'修改',details};
      }
      const deleted=n=>{const result=clone(n);result._preview={kind:'deleted',label:'将删除',details:['确认后删除；取消预览可恢复']};if(result.steps)result.steps=result.steps.filter(s=>!next.has(s.id)).map(deleted);return result;};
      base.objectives.forEach((o,i)=>{
        if(!next.has(o.id)){tree.objectives.splice(Math.min(i,tree.objectives.length),0,deleted(o));return;}
        const destination=next.get(o.id);
        o.steps.forEach((s,j)=>{
          if(next.has(s.id))return;
          if(destination.type==='objective')destination.node.steps.splice(Math.min(j,destination.node.steps.length),0,deleted(s));
        });
      });
      return tree;
    }

    function CommandComposer({quest, onApplied, onPreviewChange = () => {}, creating = false, renderPreview, onPhaseChange = () => {}}) {
      const [text,setText]=react.useState(''), [plan,setPlan]=react.useState(null), [history,setHistory]=react.useState([]);
      const [phase,setPhase]=react.useState('idle'), [error,setError]=react.useState(null), [notice,setNotice]=react.useState('');
      const active=react.useRef(null), epoch=react.useRef(0), retry=react.useRef(null), mounted=react.useRef(true), gate=react.useRef(false);
      react.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;active.current?.abort();};},[]);
      const generate=async()=>{
        if(gate.current||!text.trim())return;
        gate.current=true;const token=++epoch.current;
        const controller=new AbortController();active.current=controller;
        const nextHistory=plan?[...history,{user:plan.instruction,reply:plan.question||plan.summary}].slice(-8):history;
        const payload={...(creating?{}:{quest_id:quest.id}),instruction:text.trim(),history:nextHistory};
        const fingerprint=JSON.stringify(payload);
        if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,id:window.crypto.randomUUID()};
        setPhase('generating');onPhaseChange('generating');setError(null);setNotice('');
        try{
          const next=await call(creating?'/command/new/preview':'/command/preview',{...payload,request_id:retry.current.id},controller.signal);
          if(!mounted.current||token!==epoch.current)return;
          setPlan(next);onPreviewChange(next.changes?.length&&!next.question?next:null);setHistory(nextHistory);setText('');retry.current=null;
        }catch(e){if(mounted.current&&token===epoch.current&&e.name!=='AbortError')setError(e.message);}
        finally{if(token===epoch.current&&mounted.current){setPhase('idle');onPhaseChange('idle');gate.current=false;}}
      };
      const confirm=async()=>{
        if(gate.current||!plan?.changes.length)return;
        gate.current=true;setPhase('applying');onPhaseChange('applying');setError(null);
        try{
          const result=await call(creating?'/command/new/apply':'/command/apply',{...(creating?{}:{quest_id:quest.id}),plan_id:plan.id});
          if(!mounted.current)return;
          await onApplied(result.quest);if(!mounted.current)return;onPreviewChange(null);setPlan(null);setHistory([]);setNotice('已应用变更，任务与历史记录已更新。');
        }catch(e){if(mounted.current){setError(e.message);if(['STALE_PLAN','PLAN_EXPIRED'].includes(e.code)){setText(plan.instruction);setPlan(null);onPreviewChange(null);setHistory([]);retry.current=null;}}}
        finally{gate.current=false;if(mounted.current){setPhase('idle');onPhaseChange('idle');}}
      };
      const cancel=()=>{epoch.current++;active.current?.abort();gate.current=false;setPhase('idle');onPhaseChange('idle');setNotice('已取消生成，输入内容已保留。');};
      const ready = !!plan?.changes?.length && !plan.question;
      const actions = ready ? h('div',{className:creating?'qj-command-actions qj-create-footer':'qj-command-actions'},h('button',{className:'qj-primary',disabled:phase!=='idle'||!!text.trim(),onClick:confirm},phase==='applying'?(creating?'正在创建…':'正在应用…'):creating?'创建任务及拆解':'应用 '+plan.changes.length+' 项变更'),h('button',{className:'qj-mini',disabled:phase!=='idle',onClick:()=>{setText(plan.instruction);setPlan(null);onPreviewChange(null);retry.current=null;}},'取消预览')) : null;
      const composer = h('section',{className:'qj-command','aria-label':creating?'DSH 新任务生成':'当前任务 DSH 指令'},
        h('div',{className:'qj-command-head'},h('strong',null,creating?'✧ 描述意图，生成任务与拆解':'✧ 用 DSH 整理任务'),h('span',null,creating?'确认前不创建任务':'仅作用于当前任务')),
        plan?h('div',{className:'qj-plan','aria-live':'polite'},h('p',null,plan.question||plan.summary),
          plan.question?h('small',null,'请在下方补充信息，任务尚未修改。'):null,
          plan.changes?.length?h('small',null,creating?'下方已生成任务、目标及进展预览，确认前不会保存。':'下方目标与进展已模拟应用后的结构，高亮部分尚未保存。'):null,
          !creating?actions:null):null,
        h('textarea',{autoFocus:creating,'aria-label':creating?'描述要创建的任务':'告诉 DSH 最新进展或下一步',placeholder:plan?'补充说明或回答上方问题…':creating?'描述你想完成的事情，例如：完成 示例项目 A 测试方案的 PRD，先与 协作者 同步思路，再找算法确认指标，最后调研仿真平台。':'告诉 DSH 最新进展或下一步，例如：我在优化 PRD，接下来和 协作者 同步、找算法确认指标、调研仿真平台。',value:text,disabled:phase!=='idle'||(!creating&&quest.archived_at!==null),rows:3,onChange:e=>{setText(e.target.value);setError(null);},onKeyDown:e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent?.isComposing){e.preventDefault();generate();}}}),
        h('div',{className:'qj-command-actions'},h('small',null,phase==='generating'?'DSH 正在理解当前任务…':'先预览，再应用 · ⌘ / Ctrl + Enter'),phase==='generating'?h('button',{className:'qj-mini',onClick:cancel},'取消生成'):h('button',{className:'qj-primary',disabled:phase!=='idle'||!text.trim()||(!creating&&quest.archived_at!==null),onClick:generate},error?'重试生成':creating?'生成任务与拆解':'生成变更')),
        error?h('div',{className:'qj-error',role:'alert'},error):null,notice?h('small',{role:'status'},notice):null);
      if (!creating) return composer;
      return h('div',{className:'qj-create-flow'},
        h('div',{className:'qj-create-scroll'},composer,ready?renderPreview(plan.projected_quest):null),
        actions);
    }

    function NewQuestDialog({onClose,onCreated}) {
      const [mode,setMode]=react.useState('dsh'),[phase,setPhase]=react.useState('idle');
      const [title,setTitle]=react.useState(''),[description,setDescription]=react.useState(''),[error,setError]=react.useState(null);
      const gate=react.useRef(false),alive=react.useRef(true);
      react.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
      const manualCreate=async e=>{
        e.preventDefault();if(gate.current||!title.trim())return;
        gate.current=true;setPhase('applying');setError(null);
        try{const results=await api.applyChanges([{op:'create_quest',title:title.trim(),description:description.trim()}]);if(alive.current)await onCreated(results[0].node);}
        catch(e){if(alive.current)setError(e.message);}finally{gate.current=false;if(alive.current)setPhase('idle');}
      };
      const node=(n,children)=>h('div',{className:'qj-create-preview-node'},h('div',null,h('span',{className:'qj-change-label'},'新增'),h('strong',null,n.title),h('span',{className:'qj-priority'},n.priority)),n.description?h('p',null,n.description):null,children);

      const renderPreview = tree => tree?h('section',{className:'qj-create-preview','aria-label':'新任务与拆解预览'},h('div',{className:'qj-outline-banner'},h('strong',null,'任务与拆解预览 · 尚未创建'),h('span',null,'确认后一次性创建任务、目标及进展；所有条目均为未完成。')),
          node(tree,h('div',{className:'qj-create-preview-children'},...tree.objectives.map(o=>h('div',{key:o.id},node(o,h('div',{className:'qj-create-preview-children'},...o.steps.map(s=>h('div',{key:s.id},node(s)))))))))):null;
      return h('div',{className:'qj-form qj-create-dialog',role:'dialog','aria-modal':true,'aria-label':'新建任务',onKeyDown:e=>{if(e.key==='Escape'&&phase!=='applying'){e.stopPropagation();onClose();}}},
        h('div',{className:'qj-create-heading'},h('h2',null,'新建任务'),h('button',{type:'button',className:'qj-icon','aria-label':'关闭新建任务',disabled:phase==='applying',onClick:onClose},'×')),
        h('div',{className:'qj-create-tabs'},...['dsh','manual'].map(value=>h('button',{key:value,type:'button','aria-pressed':mode===value,disabled:phase!=='idle',onClick:()=>{setMode(value);}},value==='dsh'?'✧ 用 DSH 生成':'手动新建'))),
        mode==='dsh'?h(CommandComposer,{creating:true,onPhaseChange:setPhase,onApplied:onCreated,renderPreview}):
          h('form',{onSubmit:manualCreate},h('label',null,'任务名称',h('input',{'aria-label':'新任务名称',value:title,autoFocus:true,required:true,disabled:phase!=='idle',onChange:e=>setTitle(e.target.value)})),h('label',null,'任务描述（可选）',h('textarea',{'aria-label':'新任务描述',value:description,rows:3,disabled:phase!=='idle',onChange:e=>setDescription(e.target.value)})),h('button',{type:'submit',disabled:phase!=='idle'||!title.trim()},phase==='applying'?'正在创建…':'创建任务'),error?h('p',{role:'alert'},error):null));
    }

    function InlineNew({type,parent,onSave,onCancel}) {
      const [value,setValue]=react.useState('');const saving=react.useRef(false);
      const commit=async repeat=>{if(saving.current)return;if(!value.trim()){onCancel();return;}saving.current=true;const ok=await onSave(type,parent,value.trim());saving.current=false;if(ok){setValue('');if(!repeat)onCancel();}};
      return h('input',{className:'qj-inline-new',autoFocus:true,'aria-label':'新条目标题',placeholder:'输入标题，Enter 保存并继续',value,onChange:e=>setValue(e.target.value),onBlur:()=>commit(false),onKeyDown:e=>{if(e.nativeEvent?.isComposing)return;if(e.key==='Escape'){e.preventDefault();onCancel();}if(e.key==='Enter'){e.preventDefault();commit(true);}}});
    }

    function QuestJournalPage({t}) {
      const [tab,setTab]=react.useState("active"), [quests,setQuests]=react.useState([]), [selected,setSelected]=react.useState(null);
      const [detail,setDetail]=react.useState(null), [trace,setTrace]=react.useState([]), [error,setError]=react.useState(null);
      const [search,setSearch]=react.useState(""), [filter,setFilter]=react.useState("all"), [sort,setSort]=react.useState("manual");
      const [form,setForm]=react.useState(null), [busy,setBusy]=react.useState(false);
      const [menu,setMenu]=react.useState(null),[info,setInfo]=react.useState({}),[collapsed,setCollapsed]=react.useState({}),[hideDone,setHideDone]=react.useState(false),[draft,setDraft]=react.useState(null),[commandPlan,setCommandPlan]=react.useState(null);
      const [dragging,setDragging]=react.useState(null),[dropMark,setDropMark]=react.useState(null),[newOpen,setNewOpen]=react.useState(false);
      const generation=react.useRef(0), drag=react.useRef(null), locked=react.useRef(false), selectedRef=react.useRef(selected),dropRef=react.useRef(null),dragBlocked=react.useRef(false),suppressClick=react.useRef(0);
      selectedRef.current=selected;
      const refresh=react.useCallback(async()=>{
        if(selectedRef.current!==selected)return;
        const token=++generation.current;
        try {
          const list=await api.listQuests({includeArchived:true});
          const exists=selected && list.some(q=>q.id===selected);
          const tree=exists ? await api.getQuest(selected):null;
          const events=tree ? await api.getTrace(selected):[];
          if (!exists && token===generation.current) setSelected(null);
          if (token===generation.current) {setQuests(list);setDetail(tree);setTrace(events);}
        } catch(e) {if(token===generation.current)setError(e.message);}
      },[selected]);
      react.useEffect(()=>{setDetail(null);refresh(); const focus=()=>refresh();window.addEventListener("focus",focus);return()=>{generation.current++;window.removeEventListener("focus",focus);};},[refresh]);
      const apply=async (changes,onSaved)=>{
        if(locked.current||commandPlan?.quest_id===selected)return false;
        locked.current=true;setBusy(true);setError(null);
        try {const results=await api.applyChanges(changes);onSaved?.(results);await refresh();return true;}catch(e){setError(e.message);return false;}finally{locked.current=false;setBusy(false);}
      };
      const ask=(label,build,initial="")=>setForm({label,build,value:initial});
      const save=(type,id,title)=>apply([{op:"update_node",node_type:type,node_id:id,title}]);
      const addQuest=()=>{endDrag();setNewOpen(true);};
      const createdQuest=async quest=>{setNewOpen(false);setCommandPlan(null);setTab("active");setSearch("");setFilter("all");setMenu(null);setDraft(null);setSelected(quest.id);setDetail(null);};
      const add=(type,parent)=>{if(type==="quest")addQuest(type,parent);else {if(type==="step")setCollapsed({...collapsed,[parent]:false});setDraft({type,parent});}};
      const saveNew=(type,parent,title)=>apply([{op:type==="objective"?"add_objective":"add_step",quest_id:parent,objective_id:parent,title}]);
      const newRow=(type,parent)=>draft?.type===type&&draft.parent===parent?h(InlineNew,{key:type+parent,type,parent,onSave:saveNew,onCancel:()=>setDraft(null)}):null;
      const sibling=(type,node)=>add(type,type==="objective"?detail.id:node.objective_id);
      const move=(type,node,up)=>{
        if(type==="step" && up)return apply([{op:"move_node",node_type:type,node_id:node.id,target_type:"objective",parent_id:detail.id}]);
        if(type==="objective" && !up){const i=detail.objectives.findIndex(o=>o.id===node.id);if(i>0)return apply([{op:"move_node",node_type:type,node_id:node.id,target_type:"step",parent_id:detail.objectives[i-1].id}]);}
        setError("已到层级边界；目标降级时需有前一个目标，且先移走其子条目。");
      };
      const previewing=!!(detail&&commandPlan?.quest_id===detail.id&&commandPlan.projected_quest&&commandPlan.base_quest);
      const display=previewing?outlinePreview(commandPlan.base_quest,commandPlan.projected_quest):detail;
      const archived=detail?.archived_at != null;
      const readOnly=archived||previewing;
      const changedTree=o=>!!o._preview||o.steps.some(s=>s._preview);
      const showNode=node=>!hideDone||node.status!=="completed"||!!node._preview;
      const metadata=node=>h("small",{className:"qj-dates"},"添加 "+dateLabel(node.created_at)+" · 更新 "+dateLabel(node.updated_at??node.created_at));
      const remove=(type,node)=>ask("删除“"+node.title+"”及其子条目？输入 删除 确认",value=>{if(value!=="删除")throw new Error("请输入 删除 确认");return [{op:"delete_node",node_type:type,node_id:node.id}];});
      const attachment=(type,id,kind)=>ask(kind==="link"?"添加链接（https://…）":"添加备注",value=>[{op:"add_attachment",node_type:type,node_id:id,type:kind,content:value}]);
      const block=(node,type)=>{
        setMenu(null);
        if(node.is_blocked)apply([{op:"set_blocked",node_type:type,node_id:node.id,blocked:false}]);
        else ask("阻塞原因",value=>[{op:"set_blocked",node_type:type,node_id:node.id,blocked:true,blocked_reason:value}]);
      };
      const menuButton=(label,fn,disabled=false)=>h("button",{className:"qj-menu-item",disabled:disabled||busy,onClick:()=>{setMenu(null);fn();}},label);
      const clearDrop=()=>{dropRef.current=null;setDropMark(null);};
      const endDrag=()=>{drag.current=null;dragBlocked.current=false;setDragging(null);clearDrop();};
      const canDrag=type=>!busy&&!form&&!newOpen&&!previewing&&(type==="quest"?tab==="active":!archived);
      const beginDrag=(e,type,node,parentId)=>{
        const interactive=e.target?.closest?.('button,input,textarea,select,a,[contenteditable="true"]');
        if(!canDrag(type)||dragBlocked.current||interactive){e.preventDefault();return;}
        e.stopPropagation();
        window.getSelection?.()?.removeAllRanges?.();
        const value={type,id:node.id,parentId,questId:type==="quest"?node.id:detail.id,title:node.title};
        drag.current=value;setDragging(value);setMenu(null);clearDrop();
        if(e.dataTransfer){e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",node.id);
          const image=type==="quest"?e.currentTarget.closest?.(".qj-quest-item"):e.currentTarget;
          if(image)e.dataTransfer.setDragImage?.(image,16,12);
        }
      };
      const hoverDrop=(e,type,parentId,targetId,title,end=false)=>{
        const source=drag.current;
        if(!source||source.type!==type||!canDrag(type))return false;
        if(!end&&source.id===targetId){e.stopPropagation();clearDrop();if(e.dataTransfer)e.dataTransfer.dropEffect="none";return false;}
        if(type!=="quest"&&source.questId!==detail?.id)return false;
        e.preventDefault();e.stopPropagation();if(e.dataTransfer)e.dataTransfer.dropEffect="move";
        const rect=e.currentTarget.getBoundingClientRect();
        const position=end?"end":e.clientY<rect.top+rect.height/2?"before":"after";
        const label=end?"移到“"+title+"”末尾":"放到“"+title+"”"+(position==="before"?"前":"后");
        const marker={type,parentId,targetId:targetId??null,position,label};
        if(JSON.stringify(dropRef.current)!==JSON.stringify(marker)){dropRef.current=marker;setDropMark(marker);}
        const scroller=e.currentTarget.closest?.(type==="quest"?".qj-list":".qj-right");
        if(scroller){const bounds=scroller.getBoundingClientRect();const delta=e.clientY<bounds.top+36?-16:e.clientY>bounds.bottom-36?16:0;if(delta)scroller.scrollBy?.({top:delta,behavior:"instant"});}
        return true;
      };
      const finishDrop=async(e,type,parentId,targetId,title,end=false)=>{
        if(!hoverDrop(e,type,parentId,targetId,title,end))return;
        const source=drag.current, destination=dropRef.current;
        suppressClick.current=Date.now()+300;endDrag();
        await apply([{op:"reorder_node",node_type:source.type,node_id:source.id,parent_id:destination.parentId,target_id:destination.targetId,position:destination.position,...(source.type==="quest"?{sort_mode:sort}:{})}], results=>{
          if(source.type==="quest")setSort(results[0]?.sort_mode||"manual");
        });
      };
      const targetProps=(type,parentId,id,title)=>({
        onDragOver:e=>hoverDrop(e,type,parentId,id,title),
        onDrop:e=>finishDrop(e,type,parentId,id,title),
      });
      const markerFor=(type,parentId,id)=>dropMark?.type===type&&dropMark.parentId===parentId&&dropMark.targetId===id?dropMark:null;
      const indicator=mark=>mark?h("div",{className:"qj-drop-indicator is-"+mark.position,"aria-hidden":true},h("span",null,mark.label)):null;
      const endZone=(type,parentId,title)=>dragging?.type===type?h("div",{
        className:"qj-end-zone"+(markerFor(type,parentId,null)?" is-drop-target":""),
        onDragOver:e=>hoverDrop(e,type,parentId,null,title,true),onDrop:e=>finishDrop(e,type,parentId,null,title,true),
      },indicator(markerFor(type,parentId,null)),"移到“"+title+"”末尾"):null;
      const objectiveDrop=(e,o,drop=false)=>{
        if(drag.current?.type==="step"){
          if(collapsed[o.id])setCollapsed({...collapsed,[o.id]:false});
          return drop?finishDrop(e,"step",o.id,null,o.title,true):hoverDrop(e,"step",o.id,null,o.title,true);
        }
        return drop?finishDrop(e,"objective",detail.id,o.id,o.title):hoverDrop(e,"objective",detail.id,o.id,o.title);
      };
      const row=(node,type)=>h("div",{className:"qj-node"+(node._preview?" qj-preview-node qj-preview-"+node._preview.kind:"")+(node.status==="completed"?" is-done":"")},
        h("div",{className:"qj-node-row"+(type!=="quest"&&canDrag(type)?" qj-grabbable":""),
          draggable:type!=="quest"&&canDrag(type),"data-drag-type":type,"data-drag-id":node.id,
          onPointerDownCapture:e=>{dragBlocked.current=!!e.altKey||!!e.target?.closest?.('button,input,textarea,select,a,[contenteditable="true"]');},
          onDragStart:e=>beginDrag(e,type,node,type==="step"?node.objective_id:type==="objective"?detail.id:null),onDragEnd:endDrag},
          type==="objective"?h("button",{className:"qj-icon",disabled:previewing,"aria-label":collapsed[node.id]?"展开目标":"折叠目标","aria-expanded":!collapsed[node.id]||(previewing&&changedTree(node)),onClick:()=>setCollapsed({...collapsed,[node.id]:!collapsed[node.id]})},collapsed[node.id]&&!(previewing&&changedTree(node))?"›":"⌄"):null,
          h("button",{className:"qj-check",disabled:readOnly||busy,"aria-label":node.status==="completed"?"取消完成":"完成",onClick:()=>apply([{op:"toggle_completed",node_type:type,node_id:node.id}])},node.status==="completed"?"✓":""),
          h(EditableTitle,{key:type+node.id,node,type,readonly:readOnly||busy,save,sibling,move}),
          node._preview?h("span",{className:"qj-change-label"},node._preview.label):null,
          (type==="quest"||node.priority!=="P1")?h("span",{className:"qj-priority"},node.priority):null,
          h("div",{className:"qj-row-actions"},
            type!=="step"?h("button",{className:"qj-icon qj-add-hover",disabled:readOnly||busy,"aria-label":type==="quest"?"添加目标":"添加进展",onClick:()=>add(type==="quest"?"objective":"step",node.id)},"＋"):null,
            h("button",{className:"qj-icon",disabled:previewing,"aria-label":"更多操作："+node.title,"aria-expanded":menu===node.id,onClick:()=>setMenu(menu===node.id?null:node.id)},"···")),
          !previewing&&menu===node.id?h("div",{className:"qj-menu",role:"group","aria-label":"条目操作",onKeyDown:e=>{if(e.key==="Escape")setMenu(null);}},
            menuButton(info[node.id]?"收起详情与日期":"详情与日期",()=>setInfo({...info,[node.id]:!info[node.id]})),
            menuButton("编辑标题",()=>ask("编辑标题",value=>[{op:"update_node",node_type:type,node_id:node.id,title:value}],node.title),readOnly),
            h("label",{className:"qj-menu-item"},"优先级",h("select",{"aria-label":"优先级",value:node.priority,disabled:readOnly||busy,onChange:e=>{setMenu(null);apply([{op:"update_node",node_type:type,node_id:node.id,priority:e.target.value}]);}},...["P0","P1","P2"].map(p=>h("option",{key:p},p)))),
            menuButton(node.is_blocked?"解除阻塞":"标记阻塞",()=>block(node,type),readOnly),
            menuButton("添加备注",()=>attachment(type,node.id,"text"),readOnly),
            menuButton("添加链接",()=>attachment(type,node.id,"link"),readOnly),
            type!=="quest"?menuButton(type==="step"?"升级为目标":"降级为进展",()=>move(type,node,type==="step"),readOnly):null,
            type==="quest"?menuButton(readOnly?"恢复任务":"归档任务",()=>apply([{op:readOnly?"restore_quest":"archive_quest",quest_id:node.id}])):null,
            menuButton("删除条目…",()=>remove(type,node),readOnly)):null),
        node.is_blocked?h("button",{className:"qj-block-line",disabled:readOnly||busy,onClick:()=>block(node,type)},"● 阻塞 · "+(node.blocked_reason||"未填写原因")):null,
        visibleDescription(node.description)?h("p",{className:"qj-desc"},visibleDescription(node.description)):null,
        node._preview?.details.length?h("div",{className:"qj-change-details"},node._preview.details.join(" · ")):null,
        !info[node.id]&&node.attachments?.length?h("button",{className:"qj-note-preview",onClick:()=>setInfo({...info,[node.id]:true})},"↳ "+(node.attachments.at(-1).title||node.attachments.at(-1).content)):null,
        info[node.id]?h("div",{className:"qj-node-info"},metadata(node),...(node.attachments??[]).map(a=>h("div",{key:a.id,className:"qj-attach"},a.type==="link"?h("a",{href:a.content,target:"_blank",rel:"noreferrer"},a.title||a.content):a.content))):null);
      let visible=quests.filter(q=>(tab==="archived"?q.archived_at!==null:q.archived_at===null)&&q.title.toLowerCase().includes(search.toLowerCase())&&(filter==="all"||filter===q.priority||filter===q.status||(filter==="blocked"&&q.is_blocked)));
      visible.sort((a,b)=>sort==="priority"?a.priority.localeCompare(b.priority)||a.sort_order-b.sort_order:sort==="updated"?b.updated_at-a.updated_at:sort==="created"?b.created_at-a.created_at:a.sort_order-b.sort_order);
      return h("div",{className:"qj-page"+(dragging?" qj-drag-active":""),onDragOver:()=>{if(dropRef.current)clearDrop();},onDragLeave:e=>{if(e.target===e.currentTarget)clearDrop();}},h("style",null,CSS+`
.qj-page{--qj-bg:#171410;--qj-panel:#1e1a15;--qj-panel2:#272118;--qj-border:#353026;--qj-soft:#30291c;--qj-text:#e8e1d4;--qj-dim:#a59b89;--qj-faint:#958975;--qj-accent:#d4b360;grid-template-columns:270px minmax(0,1fr);font-size:14px}
.qj-page button:focus-visible,.qj-page input:focus-visible,.qj-page select:focus-visible,.qj-page textarea:focus-visible{outline:2px solid var(--qj-accent);outline-offset:2px}
.qj-page input,.qj-page select,.qj-page textarea{background:var(--qj-panel2);color:var(--qj-text);border:1px solid var(--qj-border);border-radius:5px;padding:7px;min-width:0;font:inherit}
.qj-toolbar{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:16px 16px 8px}.qj-toolbar input{grid-column:1/-1;font-size:12px}.qj-toolbar select{border:0;background:none;font-size:11px;padding:3px;width:100%}
.qj-tabs{padding:8px 8px 0}.qj-tab{font-size:12px}.qj-list{padding:8px}.qj-quest-item{position:relative;align-items:flex-start;padding:13px 10px 13px 17px;gap:9px;border:0}.qj-quest-item.is-selected{background:var(--qj-soft);border:0}.qj-quest-item.is-selected:before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;background:var(--qj-accent);border-radius:3px}.qj-quest-title{white-space:normal;font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.8}.qj-priority{font:10px/1.5 ui-monospace,monospace;flex:none;background:#d4b36012;color:var(--qj-accent);border:0;border-radius:3px;padding:1px 5px;margin-top:3px}.qj-drag{position:absolute;left:0;top:10px;width:18px;height:30px;display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;opacity:0;cursor:grab;color:var(--qj-dim);font-size:11px}.qj-quest-item:hover .qj-drag,.qj-quest-item:focus-within .qj-drag{opacity:1}.qj-new{font-size:12px;border:0;text-align:left;color:var(--qj-accent);padding-left:16px}
.qj-right{padding:26px clamp(18px,3vw,42px) 45px}.qj-detail{max-width:1000px;margin:auto}.qj-breadcrumb{font-size:11px;color:var(--qj-dim);margin-bottom:20px}.qj-detail>.qj-node>.qj-node-row>.qj-node-title{font-size:23px;font-weight:550;line-height:1.6}.qj-detail-meta{font-size:11px;color:var(--qj-dim);margin:8px 0 22px 26px}.qj-detail>.qj-node .qj-desc{margin-top:12px;font-size:12px}.qj-node-row{position:relative;display:flex;flex-wrap:nowrap;align-items:flex-start;gap:9px;padding:5px 0}.qj-node-title{line-height:1.8;cursor:text;font-weight:450;flex:1}.qj-node-row>input{flex:1;width:0;padding:2px 6px}.qj-check{border:1px solid #81745c;background:none;color:var(--qj-ok);width:16px;height:16px;border-radius:50%;flex:none;padding:0;font-size:11px;margin-top:5px;line-height:14px}.qj-node.is-done .qj-node-title{color:#928979}.qj-icon{background:none;border:0;color:var(--qj-dim);width:26px;height:27px;flex:none;padding:0;border-radius:4px;font-size:16px}.qj-icon:hover{background:var(--qj-soft);color:var(--qj-accent)}.qj-row-actions{display:flex;opacity:.35;margin-left:auto;flex:none}.qj-add-hover{visibility:hidden}.qj-node-row:hover .qj-row-actions,.qj-node-row:focus-within .qj-row-actions{opacity:1}.qj-node-row:hover .qj-add-hover,.qj-node-row:focus-within .qj-add-hover{visibility:visible}
.qj-objective{border:0;padding:12px 0 14px;margin:0}.qj-children{margin:8px 0 0 34px;border-left:1px solid var(--qj-border);padding-left:17px}.qj-step{margin:0;padding:0;border:0}.qj-step+.qj-step{margin-top:7px}.qj-desc{font-size:12px;line-height:1.9;margin:2px 0 6px 51px}.qj-step .qj-desc{margin-left:25px}.qj-block-line{display:block;background:none;border:0;padding:0;margin:2px 0 6px 51px;color:#e09d87;font-size:11px;text-align:left;overflow-wrap:anywhere}.qj-step .qj-block-line{margin-left:25px}.qj-note-preview{display:block;background:none;border:0;padding:0;margin:2px 0 5px 51px;color:var(--qj-dim);font-size:11px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 51px)}.qj-step .qj-note-preview{margin-left:25px}.qj-node-info{background:var(--qj-panel);border-left:2px solid var(--qj-accent-dim);padding:12px 15px;margin:8px 0 8px 25px}.qj-dates{color:var(--qj-dim);display:block;font-size:10px;margin:2px 0 8px}.qj-section-header{display:flex;gap:9px;align-items:center;border-bottom:1px solid var(--qj-border);padding-bottom:12px;margin-top:28px;font-size:13px}.qj-section-header small{color:var(--qj-dim);font-size:10px}.qj-section-header label{margin-left:auto;font-size:11px;color:var(--qj-dim);display:flex;gap:5px;align-items:center}.qj-page input[type=checkbox]{accent-color:var(--qj-accent)}.qj-add-bottom{color:var(--qj-dim);border:0;background:none;font-size:12px;margin:7px 0 24px 48px}.qj-add-bottom:hover{color:var(--qj-accent)}.qj-inline-new{width:calc(100% - 30px);margin:7px 0 10px 25px}.qj-history{border-top:1px solid var(--qj-border);padding:15px 0;color:var(--qj-dim);font-size:12px}.qj-history summary{cursor:pointer}.qj-keyboard{font-size:10px;color:var(--qj-dim);margin-top:20px;opacity:.75}
.qj-menu{position:absolute;right:0;top:34px;z-index:20;background:#2b251d;border:1px solid #4b4030;border-radius:7px;padding:6px;box-shadow:0 12px 30px #0007;width:195px}.qj-menu-item{display:flex;width:100%;align-items:center;justify-content:space-between;text-align:left;padding:7px 10px;color:var(--qj-text);background:none;border:0;border-radius:4px;font-size:12px}.qj-menu-item:hover{background:#ffffff09}.qj-menu-item:last-child{color:#e09d87}.qj-menu-item select{font-size:11px;padding:2px}.qj-form{position:fixed;inset:20% max(15%,16px) auto;z-index:1000;background:var(--qj-panel);border:1px solid var(--qj-accent);padding:24px;border-radius:8px;box-shadow:0 0 0 100vmax #0009;max-height:65vh;overflow:auto}.qj-form input{width:100%;margin:12px 0}.qj-form button{background:none;border:1px solid var(--qj-border);color:var(--qj-text);padding:6px 15px;margin-right:8px;border-radius:5px}.qj-page button:disabled{opacity:.4;cursor:default}
.qj-command{border:1px solid var(--qj-border);border-radius:8px;background:var(--qj-panel);padding:14px 16px;margin:8px 0 24px}.qj-command-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:10px}.qj-command-head strong{color:var(--qj-accent);font-weight:500}.qj-command-head span{color:var(--qj-dim);font-size:10px}.qj-command textarea{display:block;width:100%;background:var(--qj-bg);resize:vertical;font-size:12px;line-height:1.8;min-height:76px;border:1px solid var(--qj-border)}.qj-command-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.qj-command-actions small{font-size:10px;color:var(--qj-dim);margin-right:auto}.qj-primary{border:1px solid #d4b36040;background:var(--qj-soft);color:var(--qj-accent);padding:6px 12px;border-radius:5px;font-size:11px}.qj-plan{padding-bottom:14px;font-size:12px}.qj-plan p{line-height:1.8;margin:2px 0 12px}.qj-plan ol{list-style:none;padding:0;margin:0}.qj-plan li{border-left:1px solid var(--qj-border);padding:5px 10px;margin:6px 0}.qj-plan li.qj-plan-step{margin-left:20px}.qj-plan li small{color:var(--qj-accent);font-size:10px;margin-right:10px}.qj-plan li strong{font-size:12px;font-weight:450}.qj-plan li div{font-size:11px;color:var(--qj-dim);white-space:pre-wrap;overflow-wrap:anywhere}.qj-command .qj-error{font-size:12px;margin:12px 0 0}.qj-command>small{display:block;margin-top:9px;color:var(--qj-accent);font-size:11px}
.qj-outline-banner{display:flex;flex-direction:column;gap:4px;border:1px solid #d4b36066;border-radius:6px;padding:12px 15px;background:#d4b3600a;margin:12px 0;color:var(--qj-accent);font-size:12px}.qj-outline-banner span{font-size:11px;color:var(--qj-dim)}.qj-preview-node{border:1px solid #d4b36070;border-radius:6px;padding:8px 10px;margin:5px 0;background:#d4b3600b}.qj-preview-changed{border-color:#83abc675;background:#83abc60b}.qj-preview-moved{border-color:#b09cd375;background:#b09cd30b}.qj-preview-deleted{border:1px dashed #e09d8775;background:#e09d8709}.qj-preview-deleted .qj-node-title{text-decoration:line-through}.qj-change-label{font-size:10px;white-space:nowrap;color:var(--qj-accent);padding:2px 5px;border-radius:3px;background:#d4b36015;margin-top:2px}.qj-preview-changed .qj-change-label{color:#9fc5e0;background:#83abc615}.qj-preview-moved .qj-change-label{color:#c4afe5;background:#b09cd315}.qj-preview-deleted .qj-change-label{color:#e09d87;background:#e09d8715}.qj-change-details{font-size:11px;line-height:1.8;color:var(--qj-dim);margin:3px 0 5px 25px;overflow-wrap:anywhere}.qj-preview-node .qj-row-actions{display:none}.qj-page .qj-preview-node .qj-block-line:disabled{opacity:1}
.qj-objective,.qj-step,.qj-end-zone{position:relative}.qj-grabbable{cursor:grab}.qj-grabbable .qj-node-title{cursor:grab}.qj-drag-active .qj-grabbable .qj-node-title{cursor:grabbing}.qj-grabbable input,.qj-grabbable textarea,.qj-grabbable [contenteditable=true]{cursor:text}.qj-drag-active .qj-grabbable,.qj-drag-active .qj-drag{cursor:grabbing}.qj-is-dragging{opacity:.35}.qj-drop-indicator{position:absolute;left:0;right:0;height:2px;background:var(--qj-accent);z-index:25;pointer-events:none;box-shadow:0 0 5px #d4b36050}.qj-drop-indicator.is-before{top:-3px}.qj-drop-indicator.is-after{bottom:-3px}.qj-drop-indicator.is-end{top:0}.qj-drop-indicator:before{content:'';position:absolute;left:0;top:-2px;width:6px;height:6px;border-radius:50%;background:var(--qj-accent)}.qj-drop-indicator>span{position:absolute;right:0;bottom:4px;background:var(--qj-soft);border:1px solid var(--qj-accent-dim);color:var(--qj-accent);padding:2px 6px;border-radius:4px;font-size:10px;line-height:1.6;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qj-end-zone{padding:10px 8px;margin:6px 0;color:var(--qj-dim);font-size:11px;border:1px dashed var(--qj-border);border-radius:4px;min-height:36px}.qj-end-zone.is-drop-target{background:#d4b3600b;color:var(--qj-accent)}.qj-drag-announcement{font-size:11px;color:var(--qj-accent);padding:8px 12px;overflow-wrap:anywhere}
.qj-create-dialog{inset:5vh max(10vw,16px) auto;max-height:90vh;max-width:1000px;margin:0 auto;display:flex;flex-direction:column;overflow:hidden}.qj-create-flow{display:flex;flex-direction:column;min-height:0}.qj-create-scroll{overflow:auto;min-height:0}.qj-create-footer{flex:none;border-top:1px solid var(--qj-border);padding-top:12px}.qj-create-dialog>form{overflow:auto;min-height:0}.qj-create-footer .qj-primary{background:var(--qj-soft);color:var(--qj-accent);border-color:var(--qj-accent-dim)}.qj-create-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}.qj-create-heading h2{font-size:20px;margin:0;font-weight:500}.qj-create-tabs{display:flex;gap:8px;margin-bottom:18px}.qj-create-tabs button[aria-pressed=true]{color:var(--qj-accent);border-color:var(--qj-accent-dim);background:var(--qj-soft)}.qj-create-dialog .qj-command{margin-bottom:12px}.qj-create-dialog textarea{width:100%;display:block;margin:8px 0 14px;background:var(--qj-bg);resize:vertical;font:inherit;padding:10px;color:var(--qj-text);border:1px solid var(--qj-border);border-radius:5px}.qj-create-dialog .qj-command-actions button{margin:0}.qj-create-preview-node{border:1px solid #d4b36055;border-radius:6px;padding:10px 12px;margin:8px 0;background:#d4b36007}.qj-create-preview-node>div:first-child{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.qj-create-preview-node strong{font-weight:450}.qj-create-preview-node p{font-size:12px;color:var(--qj-dim);white-space:pre-wrap;margin:7px 0}.qj-create-preview-children{margin:8px 0 0 18px}.qj-create-dialog .qj-priority{margin-left:auto}
@media(max-width:850px){.qj-page{grid-template-columns:220px minmax(0,1fr)}.qj-right{padding:22px 18px}.qj-detail>.qj-node>.qj-node-row>.qj-node-title{font-size:20px}.qj-keyboard{line-height:2}}
@media(max-width:580px){.qj-page{display:flex;flex-direction:column;height:auto;min-height:100%}.qj-left{max-height:260px;border-right:0;border-bottom:1px solid var(--qj-border);flex:none}.qj-new{margin:2px 10px}.qj-right{overflow:visible}.qj-command-head{flex-wrap:wrap}.qj-form{inset:12% 16px auto}.qj-create-dialog{inset:5vh 16px auto;padding:14px}.qj-children{margin-left:18px;padding-left:12px}.qj-row-actions{opacity:1}.qj-add-hover{visibility:visible}.qj-drag{opacity:1}}
@media(pointer:coarse){.qj-icon{min-width:36px;min-height:40px}.qj-row-actions{opacity:1}.qj-add-hover{visibility:visible}.qj-command textarea,.qj-page input{font-size:16px}}
`),
        h("div",{className:"qj-left"},h("div",{className:"qj-tabs"},...["active","archived"].map(v=>h("button",{key:v,className:"qj-tab"+(tab===v?" is-on":""),onClick:()=>{endDrag();setTab(v);setSelected(null);setDetail(null);setCommandPlan(null);}},v==="active"?"进行中":"已归档"))),
          h("div",{className:"qj-toolbar"},h("input",{placeholder:"搜索任务",value:search,onChange:e=>{endDrag();setSearch(e.target.value);}}),
            h("select",{value:filter,"aria-label":"筛选",onChange:e=>{endDrag();setFilter(e.target.value);}},...[["all","全部"],["open","未完成"],["completed","已完成"],["blocked","阻塞"],["P0","P0"],["P1","P1"],["P2","P2"]].map(([value,label])=>h("option",{key:value,value},label))),
            h("select",{value:sort,"aria-label":"排序",onChange:e=>{endDrag();setSort(e.target.value);}},...[["manual","－"],["priority","优先级"],["updated","最近更新"],["created","添加日期"]].map(([value,label])=>h("option",{key:value,value},label)))),
          h("div",{className:"qj-list",onDragOver:e=>{if(e.target===e.currentTarget)hoverDrop(e,"quest",null,null,"任务列表",true);},onDrop:e=>{if(e.target===e.currentTarget)finishDrop(e,"quest",null,null,"任务列表",true);}},
            ...visible.map(q=>h("div",{key:q.id,className:"qj-quest-item"+(q.id===selected?" is-selected":"")+(q.status==="completed"?" is-done":"")+(dragging?.type==="quest"&&dragging.id===q.id?" qj-is-dragging":""),"data-sort-id":q.id,"aria-current":q.id===selected?"true":undefined,
              onClick:()=>{if(Date.now()<suppressClick.current)return;if(selected!==q.id){endDrag();setDetail(null);setSelected(q.id);setMenu(null);setDraft(null);setCommandPlan(null);}},...targetProps("quest",null,q.id,q.title)},
              indicator(markerFor("quest",null,q.id)),
              h("span",{className:"qj-drag",draggable:canDrag("quest"),title:"拖动排序；打乱当前规则后切换为－",onPointerDownCapture:()=>{dragBlocked.current=false;},onDragStart:e=>beginDrag(e,"quest",q,null),onDragEnd:endDrag},"⠿"),
              h("span",{className:"qj-priority"},q.priority),h("span",{className:"qj-quest-title"},q.title))),
            endZone("quest",null,"任务列表")),
          dragging?.type==="quest"?h("div",{className:"qj-drag-announcement",role:"status"},dropMark?.label||"拖动到插入线处松开；Esc 取消"):null,
          h("button",{className:"qj-new",disabled:busy,onClick:()=>add("quest")},"+ 新建任务")),
        h("div",{className:"qj-right"},error?h("div",{className:"qj-error",role:"alert"},error):null,
          detail?h("div",{className:"qj-detail"},
            h("div",{className:"qj-breadcrumb"},(archived?"已归档":"进行中")+" / 任务详情"),row(display,"quest"),
            h("div",{className:"qj-detail-meta"},archived?"已归档 · 只读":"进行中", " · 更新于 "+dateLabel(detail.updated_at??detail.created_at)),
            !archived?h(CommandComposer,{key:detail.id,quest:detail,onApplied:refresh,onPreviewChange:plan=>{endDrag();setCommandPlan(plan);setMenu(null);setDraft(null);}}):null,
            previewing?h("div",{className:"qj-outline-banner",role:"status"},h("strong",null,"变更预览 · 尚未保存"),h("span",null,"新增 / 修改 / 移动已标出；删除项保留对照。确认或取消后退出预览。")):null,
            h("div",{className:"qj-section-header"},h("span",null,"目标与进展"),h("small",null,display.objectives.filter(o=>o.status==="completed"&&o._preview?.kind!=="deleted").length+" / "+display.objectives.filter(o=>o._preview?.kind!=="deleted").length),h("label",null,h("input",{type:"checkbox",checked:hideDone,onChange:e=>{endDrag();setHideDone(e.target.checked);}}),"隐藏已完成")),
            ...display.objectives.filter(o=>showNode(o)||(previewing&&changedTree(o))).map(o=>h("div",{
              key:o.id,className:"qj-objective"+(dragging?.type==="objective"&&dragging.id===o.id?" qj-is-dragging":""),"data-sort-id":o.id,
              onDragOver:e=>objectiveDrop(e,o),onDrop:e=>objectiveDrop(e,o,true)},
              indicator(markerFor("objective",detail.id,o.id)),row(o,"objective"),
              (!collapsed[o.id]||(previewing&&changedTree(o)))?h("div",{className:"qj-children"},
                ...o.steps.filter(showNode).map(step=>h("div",{key:step.id,className:"qj-step"+(dragging?.type==="step"&&dragging.id===step.id?" qj-is-dragging":""),"data-sort-id":step.id,...targetProps("step",o.id,step.id,step.title)},indicator(markerFor("step",o.id,step.id)),row(step,"step"))),
                endZone("step",o.id,o.title),!previewing?newRow("step",o.id):null):null)),
            dragging?h("div",{className:"qj-drag-announcement",role:"status","aria-live":"polite"},dropMark?.label||"拖动到插入线处松开；Esc 取消"):null,
            !previewing?newRow("objective",detail.id):null,
            !readOnly?h("button",{className:"qj-add-bottom",disabled:busy,onClick:()=>add("objective",detail.id)},"＋ 添加目标"):null,
            h("details",{className:"qj-history"},h("summary",null,"历史记录 · "+trace.length),h("ul",{className:"qj-trace"},...trace.map(e=>h("li",{key:e.id},dateLabel(e.created_at)+" · "+e.summary+" ["+e.source+"]")))),
            h("div",{className:"qj-keyboard"},"双击标题编辑 · Enter 新增同级 · Tab 缩进 · Shift+Tab 升级")):h("div",{className:"qj-hint"},selected?"加载中…":"请选择任务")),
        newOpen?h(NewQuestDialog,{onClose:()=>setNewOpen(false),onCreated:createdQuest}):null,
        form?h("form",{className:"qj-form",role:"dialog","aria-modal":true,"aria-label":form.label,onSubmit:async e=>{e.preventDefault();try {const changes=form.build(form.value.trim());if(!form.value.trim()){setError("内容不能为空");return;}if(await apply(changes))setForm(null);}catch(err){setError(err.message);}}},h("label",null,form.label),h("input",{autoFocus:true,value:form.value,onChange:e=>setForm({...form,value:e.target.value}),onKeyDown:e=>{if(e.key==="Escape")setForm(null);}}),h("button",{type:"submit",disabled:busy},"保存"),h("button",{type:"button",disabled:busy,onClick:()=>setForm(null)},"取消"),error?h("div",{role:"alert"},error):null):null);
    }

    // ------------------------------------------------------------------
    // Plugin body
    // ------------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-quest-journal: dictionaries");
      const t = ctx.locale.bind(NS);

      ctx.slots.inject("main", function* () {
        yield ctx.slots.register({
          name: "main",
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t }),
        }, QuestJournalPage);
      });

      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 40,
        label: () => t("panel"),
        locale: NS,
      }, () => h("span", null, "❖")));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
