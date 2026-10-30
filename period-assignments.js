// Period-specific curriculum and teacher assignments without mutating the common weekly timetable.
export function dateInRange(date,start,end){return /^\d{4}-\d{2}-\d{2}$/.test(String(date||''))&&date>=start&&date<=end;}
export function periodAssignmentIssues(state,entry,ignoreId=null){
 const issues=[],cl=state.resources.classes.find(x=>x.id===entry.classId);
 if(!cl)issues.push('学級が見つかりません');
 const hp=state.hourPlans.find(p=>Number(p.grade)===Number(cl?.grade));
 if(!hp?.subjects?.some(s=>s.name===entry.baseSubject))issues.push('この学級の教科等が見つかりません');
 if(!String(entry.label||'').trim())issues.push('期間中の授業名を入力してください');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.startDate||''))||!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.endDate||''))||entry.endDate<entry.startDate)issues.push('開始日・終了日の範囲が不正です');
 const hours=Number(entry.targetHours);
 if(!Number.isFinite(hours)||hours<0)issues.push('配当時数は0以上の数値で指定してください');
 for(const x of state.periodAssignments||[]){
  if(x.id===ignoreId||x.classId!==entry.classId||x.baseSubject!==entry.baseSubject)continue;
  if(x.startDate<=entry.endDate&&entry.startDate<=x.endDate)issues.push('同じ学級・教科の期間が重複しています');
 }
 if(entry.teacherId&&!state.resources.teachers.some(t=>t.id===entry.teacherId))issues.push('担当教員が見つかりません');
 if(entry.facilityId&&!state.resources.facilities.some(f=>f.id===entry.facilityId))issues.push('使用教室が見つかりません');
 const other=(state.periodAssignments||[]).filter(x=>x.id!==ignoreId&&x.classId===entry.classId&&x.baseSubject===entry.baseSubject);
 const total=other.reduce((n,x)=>n+Number(x.targetHours||0),0)+(Number.isFinite(hours)?hours:0);
 const base=hp?.subjects?.find(x=>x.name===entry.baseSubject);
 const allocated=Number(base?.hours||0)+Number(base?.adjustment||0)+(state.adjusted?.allocations||[]).filter(x=>Number(x.grade)===Number(cl?.grade)&&x.subject===entry.baseSubject&&x.kind!=='training').reduce((n,x)=>n+Number(x.hours||0),0);
 if(total>allocated+1e-9)issues.push(`期間別配当${total}が教科の年間計画${allocated}を超えています`);
 return issues;
}
export function periodAllocationSummary(state,classId,baseSubject){
 const c=state.resources.classes.find(c=>c.id===classId),hp=state.hourPlans.find(p=>Number(p.grade)===Number(c?.grade));
 const row=hp?.subjects?.find(s=>s.name===baseSubject);
 const extra=(state.adjusted?.allocations||[]).filter(x=>Number(x.grade)===Number(c?.grade)&&x.subject===baseSubject&&x.kind!=='training').reduce((n,x)=>n+Number(x.hours||0),0);
 const target=Math.max(0,Number(row?.hours||0)+Number(row?.adjustment||0)+extra);
 const entries=(state.periodAssignments||[]).filter(x=>x.classId===classId&&x.baseSubject===baseSubject);
 const allocated=entries.reduce((n,x)=>n+Number(x.targetHours||0),0);
 return {target,allocated,remaining:target-allocated,entries};
}
export function resolvePeriodPlacement(state,date,placement){
 const lesson=state.lessons.find(l=>l.id===placement.lessonId);
 if(!lesson||lesson.classIds?.length!==1)return {...placement};
 const period=(state.periodAssignments||[]).find(x=>x.classId===lesson.classIds[0]&&x.baseSubject===lesson.subject&&dateInRange(date,x.startDate,x.endDate));
 if(!period)return {...placement};
 const p={...placement,periodAssignmentId:period.id,subjectOverride:period.label};
 if(period.teacherId)p.teacherIdsOverride=[period.teacherId];else delete p.teacherIdsOverride;
 if(period.facilityId)p.facilityIdOverride=period.facilityId;
 return p;
}
export function resolveDatedPlacements(state,date,placements){
 const day=(new Date(date+'T12:00:00').getDay()+6)%7;
 return (placements||[]).map(p=>p.day===day?resolvePeriodPlacement(state,date,p):{...p});
}
export function resolveWeekPlacements(state,weekStart,week,placements){
 const d=new Date(weekStart+'T12:00:00');
 const dates=Array.from({length:5},(_,i)=>{const x=new Date(d);x.setDate(d.getDate()+i);return [x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-')});
 return (placements||[]).map(p=>Number(p.week)===Number(week)&&p.day>=0&&p.day<5?resolvePeriodPlacement(state,dates[p.day],p):{...p});
}
export function actualComponentProgress(state,classId,subject){
 const rows=(state.operations?.actualDays||[]).flatMap(d=>d.rows||[]).filter(r=>r.classId===classId&&r.status==='held');
 const targets=(state.periodAssignments||[]).filter(x=>x.classId===classId&&x.baseSubject===subject);
 return targets.map(t=>{
  const matched=rows.filter(r=>r.periodAssignmentId===t.id||(r.subject===t.label&&!r.periodAssignmentId));
  const c=state.resources.classes.find(c=>c.id===classId);
  const divisor=state.school.type==='elementary'?45:50;
  const minutes=matched.reduce((n,r)=>n+Number(r.minutes||0),0),completed=minutes/divisor;
  return {...t,periods:matched.length,minutes,completed,remaining:Math.max(0,Number(t.targetHours||0)-completed)};
 });
}

export function weeklyPeriodOverrides(state,weekStart,week){
 const d=new Date(weekStart+'T12:00:00'),results=[];
 for(let day=0;day<5;day++){
  const x=new Date(d);x.setDate(d.getDate()+day);
  const date=[x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-');
  for(const l of state.lessons||[]){
   if(l.classIds?.length!==1)continue;
   const match=(state.periodAssignments||[]).find(t=>t.classId===l.classIds[0]&&t.baseSubject===l.subject&&dateInRange(date,t.startDate,t.endDate));
   if(match)results.push({lessonId:l.id,day,week:Number(week),periodAssignmentId:match.id,subjectOverride:match.label,teacherIdsOverride:match.teacherId?[match.teacherId]:[...(l.teacherIds||[])],facilityIdOverride:match.facilityId||l.facilityId});
  }
 }
 return results;
}

/**
 * Estimate scheduled baseline periods in a calendar date range.
 * Not a legal/actual-hours guarantee: events and emergency schedules may replace lessons.
 * Only one-week repeating timetables can be expanded without a week-cycle anchor date.
 */
export function estimatePeriodSchedule(state,entry,byDate={}){
 if(Number(state.timetable.cycleWeeks)!==1)return null;
 const cls=state.resources.classes.find(c=>c.id===entry.classId);
 if(!cls)return null;
 const related=new Set((state.lessons||[]).filter(l=>l.subject===entry.baseSubject&&(l.classIds||[]).length===1&&l.classIds[0]===cls.id).map(l=>l.id));
 const slots=[0,0,0,0,0];
 for(const p of state.timetable.placements||[]){
  if(Number(p.week)!==0||!related.has(p.lessonId)||!Number.isInteger(Number(p.day))||p.day<0||p.day>4)continue;
  slots[p.day]++;
 }
 let date=new Date(entry.startDate+'T12:00:00'),end=new Date(entry.endDate+'T12:00:00');
 if(Number.isNaN(date.getTime())||Number.isNaN(end.getTime())||date>end)return null;
 let periods=0,days=0,steps=0;
 for(;date<=end&&steps<400;date.setDate(date.getDate()+1),steps++){
  const key=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  if(!byDate[key]?.instruction)continue;
  const day=(date.getDay()+6)%7;
  if(day<5){days++;periods+=slots[day]}
 }
 if(steps>=400)return null;
 const unit=state.school.type==='elementary'?45:50;
 const standardUnits=periods*Number(state.school.lessonMinutes||unit)/unit;
 return {instructionDays:days,periods,standardUnits,difference:Number(entry.targetHours||0)-standardUnits};
}
