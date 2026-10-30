import {dateWeekday} from './actuals.js';
const pad=n=>String(n).padStart(2,'0');
export function mondayFor(date){
 if(dateWeekday(date)<0)throw new Error('有効な日付を指定してください');
 const d=new Date(date+'T12:00:00');const offset=dateWeekday(date);
 d.setDate(d.getDate()-offset);
 return [d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
}
export function weekDates(monday){
 if(dateWeekday(monday)!==0)throw new Error('週の開始日は月曜日で指定してください');
 const dates=[];
 for(let n=0;n<5;n++){const d=new Date(monday+'T12:00:00');d.setDate(d.getDate()+n);dates.push([d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-'))}
 return dates;
}
export function registeredConditions(state,weekStart){
 const dates=new Set(weekDates(weekStart));
 return (state.operations.absences||[]).filter(a=>dates.has(a.date)).map(a=>({...a,day:dateWeekday(a.date)}));
}
export function validateAbsence(state,{teacherId,date,segment,week}){
 if(!state.resources.teachers.some(t=>t.id===teacherId))throw new Error('教員を選択してください');
 if(dateWeekday(date)<0||dateWeekday(date)>4)throw new Error('平日の不在日を指定してください');
 if(!['FULL','AM','PM'].includes(segment))throw new Error('不在区分を選択してください');
 if(!Number.isInteger(Number(week))||Number(week)<0||Number(week)>=Number(state.timetable.cycleWeeks))throw new Error('サイクル週を確認してください');
 const group=registeredConditions(state,mondayFor(date));
 if(group.length&&group.some(a=>Number(a.week)!==Number(week)))throw new Error('同じ週のサイクル週は統一してください');
 if(group.some(a=>a.teacherId===teacherId&&a.date===date&&(a.segment===segment||a.segment==='FULL'||segment==='FULL')))throw new Error('同一の不在条件が登録済みです');
}
export function absenceAt(condition,period){
 if(condition.segment==='FULL')return true;
 if(condition.segment==='AM')return Number(period)<=2;
 if(condition.segment==='PM')return Number(period)>=3;
 return false;
}
export function weekHasActuals(state,start){
 const dates=new Set(weekDates(start));
 return (state.operations.actualDays||[]).some(a=>dates.has(a.date));
}
export function weeklyTemporarySchedules(plan){
 return weekDates(plan.weekStart).map((date,i)=>({
   id:'week_'+plan.id+'_'+i,date,week:plan.week,day:i,
   label:'週次変更｜'+plan.weekStart,
   source:'weekly-replan',weeklyPlanId:plan.id,
   placements:JSON.parse(JSON.stringify(plan.placements)),
   changes:plan.changes.filter(c=>c.fromDay===i||c.toDay===i).map(c=>({type:'weekly-replan',text:c.text})),
   createdAt:plan.confirmedAt
 }));
}
