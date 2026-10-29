import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
 defaultState, validateState, reconcileCurriculumLessons,
 discretionaryCaps, cycleSessionsForLesson
} from '../model.js';
import {buildSolverModel} from '../solver-client.js';

const state=defaultState();
const before=state.lessons.length;
const science=state.lessons.find(l=>l.subject==='理科'&&l.classIds.includes('c11'));
const scienceTeacher=science.teacherIds.join('|');
state.resources.classes.push({id:'c13',grade:1,name:'1年3組'});
const changed=reconcileCurriculumLessons(state,1);
assert(changed.created>0,'new class should receive lessons');
assert(state.lessons.some(l=>l.subject==='理科'&&l.classIds.includes('c13')),'new class should have science');
assert.equal(science.teacherIds.join('|'),scienceTeacher,'existing teacher assignment must survive');
assert.equal(state.lessons.length,before+changed.created);
const again=reconcileCurriculumLessons(state,1);
assert.equal(again.created,0,'reconciliation must be idempotent');
assert(!validateState(state,{instructionDays:200}).some(x=>x.code==='CURRICULUM-MISSING-LESSON'));
const missing=state.lessons.findIndex(l=>l.classIds.includes('c13')&&l.subject==='理科');
state.lessons.splice(missing,1);
assert(validateState(state,{instructionDays:200}).some(x=>x.code==='CURRICULUM-MISSING-LESSON'));
reconcileCurriculumLessons(state,1);

state.adjusted.allocations=[{id:'learning',grade:1,kind:'learning',subject:'学習枠',hours:36},{id:'training',grade:1,kind:'training',subject:'',hours:35}];
assert.equal(discretionaryCaps(state,1).total,71);
assert(validateState(state,{instructionDays:200}).some(x=>x.code==='DISCRETIONARY-70-OVER'));
state.adjusted.allocations[1].hours=36;
assert(validateState(state,{instructionDays:200}).some(x=>x.code==='TRAINING-35-OVER'));

// Exercise the actual classic worker with its postMessage interface in a VM.
const out=[];
const self={postMessage(message){out.push(message)}};
vm.runInNewContext(fs.readFileSync(new URL('../solver.worker.js',import.meta.url),'utf8'),{
 self,console,Math,Map,Set,Date,JSON,Array,Object,Number,String,Boolean
},{filename:'solver.worker.js'});
const model=buildSolverModel(defaultState());
const lesson={...model.lessons[0],sessionsCycle:1,blockSize:1};
model.lessons=[lesson];
const make=(id,period,blockId)=>({id,lessonId:lesson.id,week:0,day:0,period,locked:false,...(blockId?{blockId}:{})});
model.placements=[make('p1',0),make('p2',1)];
self.onmessage({data:{id:1,action:'metrics',model}});
assert(out.at(-1).ok,out.at(-1).error);
assert.equal(out.at(-1).result.overplaced,1,'surplus should be measured');
assert(out.at(-1).result.hard.some(x=>x.type==='overplaced'));
model.placements=[make('p1',0,'block1'),make('p2',2,'block1')];
self.onmessage({data:{id:2,action:'metrics',model}});
assert(out.at(-1).result.hard.some(x=>x.type==='broken-block'),'split 2-period block must be rejected');
const blockModel=buildSolverModel(defaultState());
blockModel.lessons=[{...blockModel.lessons[0],teacherIds:[],allowTeacherTBD:true,sessionsCycle:2,blockSize:2}];
blockModel.placements=[];
self.onmessage({data:{id:3,action:'place',model:blockModel,lessonId:blockModel.lessons[0].id,target:{week:0,day:0,period:0}}});
const placed=out.at(-1);assert(placed.ok,placed.error);
assert(placed.result.ok,JSON.stringify(placed.result.conflicts||[]));
assert.equal(placed.result.placements.length,2);
assert.equal(placed.result.placements[0].blockId,placed.result.placements[1].blockId);
blockModel.placements=placed.result.placements;
self.onmessage({data:{id:4,action:'move',model:blockModel,placementId:blockModel.placements[1].id,target:{week:0,day:1,period:1}}});
const moved=out.at(-1);assert(moved.ok,moved.error);
assert(moved.result.ok,JSON.stringify(moved.result.conflicts||[]));
assert(moved.result.placements.every(p=>p.day===1),'block move must preserve both periods');
assert.deepEqual(moved.result.placements.map(p=>p.period).sort(),[0,1]);
console.log('Curriculum, policy caps, consecutive blocks and worker consistency tests passed');
