import {randomUUID} from 'node:crypto';
import {validateDeadline} from './deadline.mjs';
import {nextTimestamp as now} from './quest-core.mjs';
const fail=(message,code='INVALID_TODO')=>{throw Object.assign(new Error(message),{code});};
const titleOf=value=>{if(typeof value!=='string'||!value.trim()||value.length>8000)fail('请输入 1–8000 字的事项标题。');return value.trim();};
const sourceOf=source=>{if(!['manual','agent'].includes(source))fail('Invalid source','INVALID_SOURCE');};
const decode=row=>row?{...row,request_data:undefined,conversion_snapshot:undefined}:null;

export class TodoJournal {
  constructor(journal) {
    this.journal=journal;this.db=journal.store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
      due_date TEXT, due_at INTEGER, deleted_at INTEGER, converted_at INTEGER,
      quest_id TEXT, target_type TEXT, target_id TEXT, conversion_snapshot TEXT,
      request_id TEXT NOT NULL UNIQUE, request_data TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS todo_events (
      id TEXT PRIMARY KEY, todo_id TEXT NOT NULL, event_type TEXT NOT NULL,
      snapshot TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_todos_created ON todos(created_at);`);
  }
  _row(id){return this.db.prepare('SELECT * FROM todos WHERE id = ?').get(id);}
  _require(id){const t=this._row(id);if(!t)fail('TODO 已不存在。','NOT_FOUND');return t;}
  _editable(t){if(t.deleted_at||t.converted_at)fail('此 TODO 已删除或转入，请刷新后重试。','TODO_UNAVAILABLE');}
  _event(id,type,source){this.db.prepare('INSERT INTO todo_events VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(),id,type,JSON.stringify(this._row(id)),source,now());}
  list(){return this.db.prepare('SELECT * FROM todos WHERE deleted_at IS NULL ORDER BY created_at DESC, id').all().map(decode);}
  create(input,source='manual') {
    sourceOf(source);const title=titleOf(input?.title),due={due_date:null,due_at:null,...validateDeadline(input)};
    if(typeof input.request_id!=='string'||! /^[\w-]{8,100}$/.test(input.request_id))fail('缺少有效的记录请求 ID。');
    const request=JSON.stringify({title,...due,quest_id:input.quest_id??null,objective_id:input.objective_id??null});
    return this.journal.store.transaction(()=>{
      const existing=this.db.prepare('SELECT * FROM todos WHERE request_id = ?').get(input.request_id);
      if(existing){if(existing.request_data!==request)fail('记录内容已改变，请重新提交。','TODO_CONFLICT');return decode(existing);}
      const id=randomUUID(),ts=now();
      this.db.prepare('INSERT INTO todos (id,title,created_at,updated_at,due_date,due_at,request_id,request_data) VALUES (?,?,?,?,?,?,?,?)').run(id,title,ts,ts,due.due_date,due.due_at,input.request_id,request);
      this._event(id,'created',source);
      if(input.quest_id||input.objective_id)this.convert(id,input,source);
      return decode(this._require(id));
    });
  }
  update(id,input,source='manual') {
    sourceOf(source);const due=validateDeadline(input);
    return this.journal.store.transaction(()=>{
      const t=this._require(id);this._editable(t);
      if(input.expected_updated_at!==undefined&&input.expected_updated_at!==t.updated_at)fail('TODO 已更新，请刷新后重试。','TODO_CONFLICT');
      const title=input.title===undefined?t.title:titleOf(input.title);
      if(input.completed!==undefined&&typeof input.completed!=='boolean')fail('完成状态必须是布尔值。');
      const status=input.completed===undefined?t.status:input.completed?'completed':'open';
      const ts=now(),completed=status==='open'?null:t.status==='completed'?t.completed_at:ts;
      this.db.prepare('UPDATE todos SET title=?, status=?, completed_at=?, due_date=?, due_at=?, updated_at=? WHERE id=?').run(title,status,completed,due.due_date===undefined?t.due_date:due.due_date,due.due_at===undefined?t.due_at:due.due_at,ts,id);
      this._event(id,'updated',source);return decode(this._require(id));
    });
  }
  _snapshot(type,id) {
    const n=this.journal.store.getNode(type,id);if(!n)fail('转入的事项已被移动或删除，无法撤销。','TODO_CONFLICT');
    return JSON.stringify({...n,attachments:this.journal.store.listAttachments(type,id),...(type==='objective'?{steps:this.journal.store.listSteps(id)}:{})});
  }
  convert(id,input,source='manual') {
    sourceOf(source);
    return this.journal.store.transaction(()=>{
      const t=this._require(id);
      if(t.converted_at){if(t.quest_id!==input.quest_id|| (t.target_type==='step'&&this.journal.store.getStep(t.target_id)?.objective_id!==input.objective_id)|| (t.target_type==='objective'&&input.objective_id))fail('TODO 已转入其他位置。','TODO_CONFLICT');return decode(t);}
      this._editable(t);
      if(input.expected_updated_at!==undefined&&input.expected_updated_at!==t.updated_at)fail('TODO 已更新，请重新确认。','TODO_CONFLICT');
      const q=this.journal._guardNotArchived(input.quest_id);
      const objective=input.objective_id?this.journal._requireNode('objective',input.objective_id):null;
      if(objective&&objective.quest_id!==q.id)fail('目标不属于所选 quest。','INVALID_PARENT');
      const type=objective?'step':'objective';
      const node=objective?this.journal.addStep(objective.id,{title:t.title},source):this.journal.addObjective(q.id,{title:t.title},source);
      const table=objective?'steps':'objectives',ts=now();
      this.db.prepare(`UPDATE ${table} SET created_at=?, status=?, completed_at=?, due_date=?, due_at=? WHERE id=?`).run(t.created_at,t.status,t.completed_at,t.due_date,t.due_at,node.id);
      this.journal._recordEvent({id:randomUUID(),quest_id:q.id,node_type:type,node_id:node.id,event_type:'todo_converted',previous_value:decode(t),new_value:this.journal.store.getNode(type,node.id),summary:`从快速 TODO 转入：${t.title}`,source,created_at:ts});
      this.db.prepare('UPDATE todos SET converted_at=?, updated_at=?, quest_id=?, target_type=?, target_id=?, conversion_snapshot=? WHERE id=?').run(ts,ts,q.id,type,node.id,this._snapshot(type,node.id),id);
      this._event(id,'converted',source);return decode(this._require(id));
    });
  }
  undoConversion(id,source='manual',targetId) {
    sourceOf(source);
    return this.journal.store.transaction(()=>{
      const t=this._require(id);if(!t.converted_at)return decode(t);
      if(targetId!==undefined&&targetId!==t.target_id)fail('此 TODO 已再次转入，原撤销操作已失效。','TODO_CONFLICT');
      this.journal._guardNotArchived(t.quest_id);
      if(this._snapshot(t.target_type,t.target_id)!==t.conversion_snapshot)fail('转入的事项已有后续修改，无法撤销；已保留当前内容。','TODO_CONFLICT');
      this.journal.deleteNode(t.target_type,t.target_id,source);
      this.journal._recordEvent({id:randomUUID(),quest_id:t.quest_id,node_type:t.target_type,node_id:t.target_id,event_type:'todo_conversion_undone',previous_value:{todo_id:id},new_value:null,summary:`撤销 TODO 转入：${t.title}`,source,created_at:now()});
      this.db.prepare('UPDATE todos SET converted_at=NULL, quest_id=NULL, target_type=NULL, target_id=NULL, conversion_snapshot=NULL, updated_at=? WHERE id=?').run(now(),id);
      this._event(id,'conversion_undone',source);return decode(this._require(id));
    });
  }
  remove(id,source='manual') {
    sourceOf(source);return this.journal.store.transaction(()=>{const t=this._require(id);if(t.deleted_at)return decode(t);this._editable(t);this.db.prepare('UPDATE todos SET deleted_at=?,updated_at=? WHERE id=?').run(now(),now(),id);this._event(id,'deleted',source);return decode(this._require(id));});
  }
  restore(id,source='manual') {
    sourceOf(source);return this.journal.store.transaction(()=>{const t=this._require(id);if(t.converted_at)fail('此事项已转入。','TODO_UNAVAILABLE');if(t.deleted_at){this.db.prepare('UPDATE todos SET deleted_at=NULL,updated_at=? WHERE id=?').run(now(),id);this._event(id,'restored',source);}return decode(this._require(id));});
  }
}
