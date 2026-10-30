import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {defaultState,migrateState} from '../model.js';
import {mondayFor,weekDates,validateAbsence,registeredConditions,weeklyTemporarySchedules,weeklyConditionsMatch,absenceAt} from '../weekly.js';
const st=defaultState();st.timetable.cycleWeeks=1;st.instruction.cycleWeeks=1;
const [teacherA,teacherB]=st.resources.teachers;
const classes=st.resources.classes;
const c1=classes[0];
const lessonA=st.lessons.find(l=>l.classIds.length===1&&l.classIds[0]===c1.id&&l.subject==='理科');
const lessonB=st.lessons.find(l=>l.classIds.length===1&&l.classIds[0]===c1.id&&l.subject==='数学');
assert(lessonA&&lessonB,'default class should have two subjects');
lessonA.teacherIds=[teacherA.id];lessonB.teacherIds=[teacherB.id];
const a={id:'pA',lessonId:lessonA.id,week:0,day:0,period:0,locked:false};
const b={id:'pB',lessonId:lessonB.id,week:0,day:1,period:0,locked:false};
const monday='2026-11-02',tuesday='2026-11-03';
assert.equal(mondayFor(tuesday),monday);assert.deepEqual(weekDates(monday),['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06']);
const condA={id:'a1',teacherId:teacherA.id,date:monday,segment:'FULL',week:0};
const condB={id:'a2',teacherId:teacherB.id,date:tuesday,segment:'FULL',week:0};
validateAbsence(st,condA);st.operations.absences.push(condA);
validateAbsence(st,condB);st.operations.absences.push(condB);
assert.equal(registeredConditions(st,monday).length,2);
assert.throws(()=>validateAbsence(st,condA),/登録済み/);
assert.throws(()=>validateAbsence(st,{teacherId:teacherA.id,date:tuesday,segment:'PM',week:1}),/サイクル/);
const m={
 cycleWeeks:1,periodsCount:6,
 classes:[{...c1,patterns:[[6,6,6,6,6]]}],
 teachers:[{...teacherA,maxDaily:6},{...teacherB,maxDaily:6}],
 facilities:st.resources.facilities,
 lessons:[{...lessonA,sessionsCycle:1},{...lessonB,sessionsCycle:1}],
 placements:[a,b],
 settings:{studentNoGaps:false,avoidSameSubjectTwice:false,avoidLastPE:false}
};
const messages=[];const self={postMessage:m=>messages.push(m)};
vm.runInNewContext(fs.readFileSync(new URL('../solver.worker.js',import.meta.url),'utf8'),{self,console,Math,Map,Set,Date,JSON,Array,Object,Number,String,Boolean},{filename:'solver.worker.js'});
function plan(model,conditions){
 const id=messages.length+1;
 self.onmessage({data:{id,action:'weeklyReplan',model,week:0,conditions:conditions.map(c=>({...c,day:c.date===monday?0:1}))}});
 const response=messages.at(-1);assert(response.ok,response.error);return response.result;
}
const solved=plan(m,[condA,condB]);
assert(solved.ok,'both teacher absences should be solved: '+JSON.stringify({unresolved:solved.unresolved,introduced:solved.introduced}));
assert.equal(solved.originalAffected,2);
assert.equal(solved.changes.length,2);
assert.equal(solved.placements.find(p=>p.id==='pA').day,1);
assert.equal(solved.placements.find(p=>p.id==='pB').day,0);
assert.deepEqual(m.placements,[a,b],'base timetable must be untouched');
const confirmed={id:'w1',weekStart:monday,week:0,absences:[condA,condB],placements:solved.placements,changes:solved.changes,confirmedAt:'2026-11-01T12:00:00.000Z'};
const snapshots=weeklyTemporarySchedules(confirmed);
assert.equal(snapshots.length,5);
assert.deepEqual(snapshots.map(x=>x.date),weekDates(monday));
assert(snapshots.every(x=>x.weeklyPlanId==='w1'));
const restored=migrateState({...st,operations:{...st.operations,weeklyPlans:[confirmed]}});
assert.equal(restored.operations.weeklyPlans[0].changes.length,2);
const blocked=plan({...m,placements:[{...a,locked:true},b]},[condA]);
assert(!blocked.ok&&blocked.unresolved.length>0,'locked lesson should remain unresolved');
assert(weeklyConditionsMatch(restored,confirmed)===true);
restored.operations.absences.push({id:'new',teacherId:teacherA.id,date:'2026-11-04',segment:'PM',week:0});
assert(weeklyConditionsMatch(restored,confirmed)===false,'post-confirmation condition changes must mark plan stale');
assert(!absenceAt({segment:'PM'},2)&&absenceAt({segment:'PM'},3));
assert(absenceAt({segment:'AM'},2)&&!absenceAt({segment:'AM'},3));
console.log('Weekly replan regression passed: concurrent absences, week snapshots, persistence and locked conflict');
