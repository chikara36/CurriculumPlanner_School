import {calendarStats,gradePatterns} from './calendar.js';
import {cycleSessionsForLesson} from './model.js';

let worker=null,seq=1;const pending=new Map();
function getWorker(){
  if(worker)return worker;worker=new Worker('./solver.worker.js',{type:'classic'});worker.onmessage=e=>{const {id,ok,result,error}=e.data||{};const p=pending.get(id);if(!p)return;pending.delete(id);ok?p.resolve(result):p.reject(new Error(error||'solver error'))};worker.onerror=e=>{for(const p of pending.values())p.reject(e.error||new Error(e.message));pending.clear()};return worker;
}
function call(action,payload){const id=seq++;const w=getWorker();return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});w.postMessage({id,action,...payload})})}

export function buildSolverModel(state){
  const stats=calendarStats(state),patterns=gradePatterns(state,stats);const cycle=Math.max(1,Math.min(3,Number(state.timetable.cycleWeeks||state.instruction.cycleWeeks||1)));
  const classes=state.resources.classes.map(c=>({...c,patterns:Array.from({length:cycle},(_,w)=>patterns[c.grade]?.[w]||[6,6,6,6,6])}));
  const lessons=state.lessons.map(l=>({...l,sessionsCycle:cycleSessionsForLesson(state,l,stats.instructionDays)}));
  return {
    cycleWeeks:cycle,periodsCount:Math.min(Number(state.instruction.maxPeriods||state.periods.length||6),state.periods.length||6),
    classes,teachers:state.resources.teachers,facilities:state.resources.facilities,lessons,placements:state.timetable.placements||[],
    settings:{studentNoGaps:state.timetable.settings.studentNoGaps!==false,avoidSameSubjectTwice:state.timetable.settings.avoidSameSubjectTwice!==false,avoidLastPE:state.timetable.settings.avoidLastPE!==false,restarts:Number(state.timetable.settings.restarts||100),repairDepth:Number(state.timetable.settings.repairDepth||2)}
  };
}
export async function solveSchedule(state,mode='rebuild'){return call('solve',{model:buildSolverModel(state),mode})}
export async function scheduleMetrics(state){return call('metrics',{model:buildSolverModel(state)})}
export async function movePlacement(state,placementId,target){return call('move',{model:buildSolverModel(state),placementId,target})}
export async function placeLesson(state,lessonId,target){return call('place',{model:buildSolverModel(state),lessonId,target})}
export async function absenceProposals(state,teacherId,week,day){return call('absence',{model:buildSolverModel(state),teacherId,week,day})}
