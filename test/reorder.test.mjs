import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QuestJournalService,QuestJournalStore} from '../packages/dsh-quest-journal/lib/quest-core.mjs';
let passed=0;const stores=[];
const fresh=()=>{const store=new QuestJournalStore(':memory:');stores.push(store);return new QuestJournalService(store);};
function test(name,fn){fn();passed++;console.log('  ok    '+name);}
const ids=nodes=>nodes.map(n=>n.id);
test('quest before/after/end uses current siblings and preserves archived quests',()=>{
 const j=fresh(),a=j.createQuest({title:'A'}),b=j.createQuest({title:'B'}),c=j.createQuest({title:'C'}),archive=j.createQuest({title:'Archive'});j.archiveQuest(archive.id);
 j.reorderNode('quest',c.id,null,a.id,'before');assert.deepEqual(ids(j.listQuests()),[c.id,a.id,b.id]);
 j.reorderNode('quest',c.id,null,b.id,'after');assert.deepEqual(ids(j.listQuests()),[a.id,b.id,c.id]);
 j.reorderNode('quest',a.id,null,null,'end');assert.deepEqual(ids(j.listQuests()),[b.id,c.id,a.id]);
 assert.ok(j.getQuest(archive.id).archived_at);assert.equal(j.store.getQuest(archive.id).sort_order,3);
});
test('objective reorder carries all steps and attachments unchanged',()=>{
 const j=fresh(),q=j.createQuest({title:'Q'}),a=j.addObjective(q.id,{title:'A'}),b=j.addObjective(q.id,{title:'B'}),s=j.addStep(a.id,{title:'Child'});
 j.addAttachment('step',s.id,{type:'text',content:'keep note'});j.setBlocked('objective',a.id,true,'waiting');
 j.reorderNode('objective',a.id,q.id,b.id,'after');const tree=j.getQuest(q.id);
 assert.deepEqual(ids(tree.objectives),[b.id,a.id]);assert.equal(tree.objectives[1].steps[0].attachments[0].content,'keep note');assert.equal(tree.objectives[1].is_blocked,true);
 const event=j.getTrace(q.id).at(-1);assert.equal(event.event_type,'reordered');assert.equal(event.source,'manual');
});
test('step reorder within and across objectives retains id, state, notes and normalizes both lists',()=>{
 const j=fresh(),q=j.createQuest({title:'Q'}),a=j.addObjective(q.id,{title:'A'}),b=j.addObjective(q.id,{title:'Empty'});
 const x=j.addStep(a.id,{title:'X'}),y=j.addStep(a.id,{title:'Y'}),z=j.addStep(a.id,{title:'Z'});j.setCompleted('step',y.id,true);j.addAttachment('step',y.id,{type:'link',content:'https://example.com'});
 j.reorderNode('step',z.id,a.id,x.id,'before');assert.deepEqual(ids(j.getQuest(q.id).objectives[0].steps),[z.id,x.id,y.id]);
 const before=j.getQuest(q.id).objectives[0].updated_at;
 j.reorderNode('step',y.id,b.id,null,'end');let tree=j.getQuest(q.id);
 assert.deepEqual(ids(tree.objectives[0].steps),[z.id,x.id]);assert.deepEqual(tree.objectives[0].steps.map(s=>s.sort_order),[0,1]);
 assert.equal(tree.objectives[1].steps[0].id,y.id);assert.equal(tree.objectives[1].steps[0].status,'completed');assert.equal(tree.objectives[1].steps[0].attachments.length,1);
 assert.ok(tree.objectives[0].updated_at>before);assert.equal(tree.objectives[1].steps[0].sort_order,0);
 j.reorderNode('step',x.id,b.id,y.id,'before');tree=j.getQuest(q.id);assert.deepEqual(ids(tree.objectives[1].steps),[x.id,y.id]);
});
test('self-drop and same-position retries are no-ops without duplicate trace',()=>{
 const j=fresh(),q=j.createQuest({title:'Q'}),a=j.addObjective(q.id,{title:'A'}),b=j.addObjective(q.id,{title:'B'}),before=j.getTrace(q.id).length;
 j.reorderNode('objective',a.id,q.id,a.id,'before');j.reorderNode('objective',a.id,q.id,b.id,'before');j.reorderNode('objective',b.id,q.id,null,'end');
 assert.equal(j.getTrace(q.id).length,before);
});
test('cross-quest, wrong anchors, invalid positions and archived writes reject atomically',()=>{
 const j=fresh(),q=j.createQuest({title:'Q'}),r=j.createQuest({title:'R'}),a=j.addObjective(q.id,{title:'A'}),b=j.addObjective(r.id,{title:'B'}),s=j.addStep(a.id,{title:'S'});
 assert.throws(()=>j.reorderNode('step',s.id,b.id,null,'end'),e=>e.code==='INVALID_MOVE');
 assert.throws(()=>j.reorderNode('objective',a.id,r.id,null,'end'),e=>e.code==='INVALID_MOVE');
 assert.throws(()=>j.reorderNode('step',s.id,a.id,b.id,'after'),e=>e.code==='INVALID_TARGET');
 assert.throws(()=>j.reorderNode('step',s.id,a.id,null,'inside'),e=>e.code==='INVALID_POSITION');
 assert.throws(()=>j.reorderNode('step',s.id,null,null,'end'),e=>e.code==='INVALID_PARENT');
 assert.throws(()=>j.applyChanges([{op:'reorder_node',node_type:'step',node_id:s.id,parent_id:a.id,position:'end'},{op:'invalid'}]));
 assert.equal(j.getQuest(q.id).objectives[0].steps[0].objective_id,a.id);
 j.archiveQuest(q.id);assert.throws(()=>j.reorderNode('step',s.id,a.id,null,'end'),e=>e.code==='QUEST_ARCHIVED');
});
test('anchor reordering preserves intervening additions and appends safely after deletions',()=>{
 const j=fresh(),q=j.createQuest({title:'Q'}),a=j.addObjective(q.id,{title:'A'}),b=j.addObjective(q.id,{title:'B'}),c=j.addObjective(q.id,{title:'Concurrent'});
 j.reorderNode('objective',a.id,q.id,b.id,'after');assert.deepEqual(ids(j.getQuest(q.id).objectives),[b.id,a.id,c.id]);
 j.deleteNode('objective',a.id);const d=j.addObjective(q.id,{title:'D'});assert.ok(d.sort_order>j.store.getObjective(c.id).sort_order);
});
test('reparenting and sort order survive database reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'qj-order-')),path=join(dir,'q.db');let store=new QuestJournalStore(path),j=new QuestJournalService(store);
 const q=j.createQuest({title:'Q'}),a=j.addObjective(q.id,{title:'A'}),b=j.addObjective(q.id,{title:'B'}),s=j.addStep(a.id,{title:'S'});
 j.reorderNode('objective',b.id,q.id,a.id,'before');j.reorderNode('step',s.id,b.id,null,'end');store.close();
 store=new QuestJournalStore(path);j=new QuestJournalService(store);const tree=j.getQuest(q.id);assert.deepEqual(ids(tree.objectives),[b.id,a.id]);assert.equal(tree.objectives[0].steps[0].id,s.id);assert.equal(j.getTrace(q.id).at(-1).event_type,'reordered');store.close();rmSync(dir,{recursive:true});
});
test('priority drag uses displayed sorted base and returns manual only on an inversion',()=>{
 const j=fresh(),b=j.createQuest({title:'B P1'}),a=j.createQuest({title:'A P0'}),c=j.createQuest({title:'C P2'}),d=j.createQuest({title:'D P1'});
 j.updateNode('quest',a.id,{priority:'P0'});j.updateNode('quest',c.id,{priority:'P2'});
 const op=(id,target,position='before')=>j.applyChanges([{op:'reorder_node',node_type:'quest',node_id:id,parent_id:null,target_id:target,position,sort_mode:'priority'}])[0];
 let result=op(c.id,b.id);assert.equal(result.sort_mode,'manual');assert.deepEqual(ids(j.listQuests()),[a.id,c.id,b.id,d.id]);
 result=op(d.id,b.id);assert.equal(result.sort_mode,'priority');assert.deepEqual(ids(j.listQuests()),[a.id,d.id,b.id,c.id]);
});
test('date-sorted drags retain or clear modes correctly without changing progress timestamps',()=>{
 const j=fresh(),a=j.createQuest({title:'A'}),b=j.createQuest({title:'B'}),c=j.createQuest({title:'C'});
 // Equal dates permit freely reordering within that date, using saved order as a tiebreak.
 j.store.db.prepare('UPDATE quests SET updated_at = ? WHERE id IN (?,?)').run(9999999999999,b.id,c.id);
 let result=j.applyChanges([{op:'reorder_node',node_type:'quest',node_id:b.id,parent_id:null,target_id:c.id,position:'after',sort_mode:'updated'}])[0];
 assert.equal(result.sort_mode,'updated');assert.deepEqual(ids(j.listQuests()),[c.id,b.id,a.id]);assert.equal(j.getQuest(b.id).updated_at,9999999999999);
 result=j.applyChanges([{op:'reorder_node',node_type:'quest',node_id:a.id,parent_id:null,target_id:c.id,position:'before',sort_mode:'updated'}])[0];assert.equal(result.sort_mode,'manual');
 const originalCreated=j.getQuest(a.id).created_at;
 result=j.applyChanges([{op:'reorder_node',node_type:'quest',node_id:a.id,parent_id:null,target_id:c.id,position:'before',sort_mode:'created'}])[0];assert.equal(result.sort_mode,'manual');assert.equal(j.getQuest(a.id).created_at,originalCreated);
});
test('invalid sort mode rejects and filtered anchors retain every active task',()=>{
 const j=fresh(),a=j.createQuest({title:'A'}),b=j.createQuest({title:'B'}),c=j.createQuest({title:'hidden from current search'});
 assert.throws(()=>j.reorderNode('quest',a.id,null,b.id,'after','manual','invalid'),e=>e.code==='INVALID_SORT_MODE');
 const result=j.applyChanges([{op:'reorder_node',node_type:'quest',node_id:a.id,parent_id:null,target_id:b.id,position:'after',sort_mode:'created'}])[0];
 assert.equal(j.listQuests().length,3);assert.ok(ids(j.listQuests()).includes(c.id));assert.ok(['manual','created'].includes(result.sort_mode));
});
for(const store of stores)store.close();console.log(`\n${passed} passed, 0 failed`);
