import {actualComponentProgress} from './period-assignments.js';
// Daily teaching records are snapshots. Never derive confirmed teaching
// from the current repeating timetable once a day has been confirmed.
export function dateWeekday(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return -1;
 const t=new Date(date+'T12:00:00');
 if(Number.isNaN(t.getTime())||t.toISOString().slice(0,10)!==date)return -1;
 return (t.getDay()+6)%7;
}
export function standardMinuteUnit(state,grade){
 return state.school.type==='elementary'||Number(grade)<=0&&state.school.type==='elementary'?45:50;
}
export function actualDayRows(state,{date,week,placements}){
 const day=dateWeekday(date);if(day<0||day>4)throw new Error('月曜から金曜の有効な日付を指定してください');
 if(!Number.isInteger(Number(week))||Number(week)<0||Number(week)>=Number(state.timetable.cycleWeeks))throw new Error('時間割サイクル週を指定してください');
 const byClassSlot=new Map(),used=[];
 for(const p of placements||[]){
  if(Number(p.week)!==Number(week)||p.day!==day)continue;
  const l=state.lessons.find(x=>x.id===p.lessonId);if(!l)continue;
  for(const classId of l.classIds||[]){
   const c=state.resources.classes.find(x=>x.id===classId);if(!c)continue;
   const key=classId+'|'+p.period;
   if(byClassSlot.has(key))throw new Error(`${c.name}の${p.period+1}限に授業が複数あります。重複を解消してください`);
   const minutes=Number(state.school.lessonMinutes)||standardMinuteUnit(state,c.grade);
   const teachers=(p.teacherIdsOverride?.length?p.teacherIdsOverride:l.teacherIds)||[];
   const item={id:date+'|'+classId+'|'+p.period,classId,className:c.name,grade:Number(c.grade),period:Number(p.period),subject:p.subjectOverride||l.subject,baseSubject:l.subject,periodAssignmentId:p.periodAssignmentId||null,lessonId:l.id,teacherIds:[...teachers],teacherNames:teachers.map(id=>state.resources.teachers.find(t=>t.id===id)?.name||id),minutes,status:'held',note:''};
   byClassSlot.set(key,item);used.push(item);
  }
 }
 return used.sort((a,b)=>a.grade-b.grade||a.className.localeCompare(b.className,'ja')||a.period-b.period);
}
export function validateActualRows(state,rows){
 const seen=new Set();
 for(const x of rows){
  if(!state.resources.classes.some(c=>c.id===x.classId))throw new Error('存在しない学級が含まれています');
  if(x.status!=='held'&&x.status!=='cancelled')throw new Error('実施区分が不正です');
  if(!Number.isInteger(Number(x.period))||Number(x.period)<0||Number(x.period)>=state.instruction.maxPeriods)throw new Error('時限が範囲外です');
  if(x.status==='held'&&(!Number.isFinite(Number(x.minutes))||Number(x.minutes)<=0||Number(x.minutes)>120))throw new Error('実施時間は1〜120分で入力してください');
  const k=x.classId+'|'+x.period;if(seen.has(k))throw new Error('同じ学級・時限に複数の実績があります');seen.add(k);
 }
}
export function saveActualDay(state,{date,sourceId=null,sourceName='',week,rows,allowCorrection=false}){
 if(dateWeekday(date)<0||dateWeekday(date)>4)throw new Error('有効な平日の日付を指定してください');
 validateActualRows(state,rows);
 if(!Array.isArray(state.operations.actualDays))state.operations.actualDays=[];
 const old=state.operations.actualDays.find(x=>x.date===date);
 if(old&&!allowCorrection)throw new Error('この日付は実績確定済みです。修正する場合は訂正操作が必要です');
 const now=new Date().toISOString(),copy=JSON.parse(JSON.stringify(rows));
 if(old){
  old.history=Array.isArray(old.history)?old.history:[];
  old.history.push({at:old.updatedAt||old.createdAt,rows:JSON.parse(JSON.stringify(old.rows)),sourceId:old.sourceId,sourceName:old.sourceName});
  old.rows=copy;old.sourceId=sourceId;old.sourceName=sourceName;old.week=Number(week);old.updatedAt=now;
  return old;
 }
 const entry={id:'actual_'+date,date,week:Number(week),sourceId,sourceName,rows:copy,history:[],createdAt:now,updatedAt:now};
 state.operations.actualDays.push(entry);state.operations.actualDays.sort((a,b)=>a.date.localeCompare(b.date));
 return entry;
}
export function actualTotals(state,grade=null){
 const result=new Map();
 for(const d of state.operations?.actualDays||[])for(const x of d.rows||[]){
  if(x.status!=='held'||(grade!==null&&Number(x.grade)!==Number(grade)))continue;
  const key=x.classId+'|'+x.subject,prior=result.get(key)||{classId:x.classId,className:x.className,grade:x.grade,subject:x.subject,periods:0,minutes:0,standardUnits:0};
  const minutes=Number(x.minutes)||0;
  prior.periods++;prior.minutes+=minutes;prior.standardUnits+=minutes/standardMinuteUnit(state,x.grade);
  result.set(key,prior);
 }
 return [...result.values()].sort((a,b)=>a.grade-b.grade||a.className.localeCompare(b.className,'ja')||a.subject.localeCompare(b.subject,'ja'));
}
export function subjectProgress(state,grade,classId){
 const totals=actualTotals(state,grade).filter(x=>x.classId===classId);
 const have=new Map(totals.map(x=>[x.subject,x]));
 const plan=state.hourPlans.find(x=>Number(x.grade)===Number(grade));
 const subjects=new Set((plan?.subjects||[]).map(x=>x.name));
 for(const a of state.adjusted?.allocations||[])if(Number(a.grade)===Number(grade)&&a.kind!=='training'&&a.subject)subjects.add(a.subject);
 const allAssignments=(state.periodAssignments||[]).filter(x=>x.classId===classId);
 const componentNames=new Set(allAssignments.map(x=>x.label));
 for(const x of totals)if(!componentNames.has(x.subject))subjects.add(x.subject);
 const rows=[];
 for(const subject of subjects){
  const row=plan?.subjects?.find(x=>x.name===subject);
  const added=(state.adjusted?.allocations||[]).filter(x=>Number(x.grade)===Number(grade)&&x.kind!=='training'&&x.subject===subject).reduce((n,x)=>n+Math.max(0,Number(x.hours||0)),0);
  const target=Math.max(0,Number(row?.hours||0)+Number(row?.adjustment||0)+added);
  const components=actualComponentProgress(state,classId,subject);
  const direct=have.get(subject);
  const periods=(direct?.periods||0)+components.reduce((n,x)=>n+x.periods,0);
  const minutes=(direct?.minutes||0)+components.reduce((n,x)=>n+x.minutes,0);
  const completed=(direct?.standardUnits||0)+components.reduce((n,x)=>n+x.completed,0);
  if(target>0||periods>0)rows.push({subject:components.length?subject+'（合計）':subject,baseSubject:subject,target,periods,minutes,completed,remaining:Math.max(0,target-completed),isGroup:components.length>0});
  for(const c of components)rows.push({subject:'↳ '+c.label,baseSubject:subject,target:Number(c.targetHours||0),periods:c.periods,minutes:c.minutes,completed:c.completed,remaining:c.remaining,isComponent:true});
 }
 return rows;
}
