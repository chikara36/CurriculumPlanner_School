import {calendarStats,monthMatrix,weeklyTargetForGrade,dailyPattern} from './calendar.js';
import {classById,teacherById,facilityById,lessonById,DAYS,cycleSessionsForLesson} from './model.js';
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmtDate(s){if(!s)return '';const [y,m,d]=s.split('-');return `${Number(y)}年${Number(m)}月${Number(d)}日`}
function fiscalMonths(fy){const a=[];for(let i=0;i<12;i++){const m=(3+i)%12,y=fy+(m<3?1:0);a.push([y,m])}return a}
export function summaryReport(state){
  const stats=calendarStats(state),issues=[];const rows=state.hourPlans.map(p=>{const sum=p.subjects.reduce((a,s)=>a+Number(s.hours||0),0);return `<tr><td>${p.grade}年</td><td>${p.annualTarget}</td><td>${sum}</td><td>${weeklyTargetForGrade(state,p.grade,stats).avg.toFixed(2)}</td></tr>`}).join('');
  return wrap(state,'教育課程編成概要',`<div class="report-meta"><span>${esc(state.school.name)}</span><span>${state.school.fiscalYear}年度</span></div>
  <h3>1 学校教育目標</h3><p>${esc(state.goals.educationGoal||'未入力')}</p>
  <h3>2 指導の重点</h3>${state.goals.focusItems.map(x=>`<p><strong>${esc(x.label)}</strong>　${esc(x.text||'')}</p>`).join('')}
  <h3>3 年間授業日数</h3><p>${stats.instructionDays}日（週換算 ${stats.weeks.toFixed(1)}週）</p>
  <h3>4 年間計画時数</h3><table class="report-table"><tr><th>学年</th><th>年間計画</th><th>内訳合計</th><th>週平均</th></tr>${rows}</table>`)
}
export function hoursReport(state){const stats=calendarStats(state);let html='';for(const p of state.hourPlans){html+=`<h3>${p.grade}年</h3><table class="report-table"><tr><th>教科等</th><th>年間時数</th><th>調整</th><th>調整後</th></tr>${p.subjects.map(s=>`<tr><td>${esc(s.name)}</td><td>${Number(s.hours||0)}</td><td>${Number(s.adjustment||0)}</td><td>${Number(s.hours||0)+Number(s.adjustment||0)}</td></tr>`).join('')}</table><p>週平均：${weeklyTargetForGrade(state,p.grade,stats).avg.toFixed(2)}コマ</p>`}return wrap(state,'授業時数配当表',html)}
export function calendarReport(state){
  const stats=calendarStats(state),fy=Number(state.school.fiscalYear);let html='';
  for(const [y,m] of fiscalMonths(fy)){const mat=monthMatrix(y,m);html+=`<div style="break-inside:avoid;margin-bottom:10px"><h3>${y}年${m+1}月</h3><table class="report-table"><tr>${['月','火','水','木','金','土','日'].map(x=>`<th>${x}</th>`).join('')}</tr>`;for(let r=0;r<6;r++){html+='<tr>';for(let c=0;c<7;c++){const item=mat[r*7+c],k=`${item.date.getFullYear()}-${String(item.date.getMonth()+1).padStart(2,'0')}-${String(item.date.getDate()).padStart(2,'0')}`,x=stats.byDate[k];let note='';if(item.inMonth&&x){if(x.holiday)note=x.holiday;else if(x.exception)note=x.exception.label||x.exception.type;else if(x.instruction)note='授業日'}html+=`<td style="height:19mm;vertical-align:top;${!item.inMonth?'color:#aaa':''}"><strong>${item.date.getDate()}</strong><br><span style="font-size:8px">${esc(note)}</span></td>`}html+='</tr>'}html+='</table></div>'}
  return wrap(state,'年間カレンダー',`<p>年間授業日数：${stats.instructionDays}日</p>${html}`)
}
function viewName(state,kind,id){if(kind==='class')return classById(state,id)?.name||id;if(kind==='teacher')return teacherById(state,id)?.name||id;return facilityById(state,id)?.name||id}
function placementsForView(state,kind,id,week){return (state.timetable.placements||[]).filter(p=>{if(p.week!==week)return false;const l=lessonById(state,p.lessonId);if(!l)return false;if(kind==='class')return l.classIds?.includes(id);if(kind==='teacher')return (p.teacherIdsOverride?.length?p.teacherIdsOverride:l.teacherIds||[]).includes(id);return (p.facilityIdOverride!==undefined?p.facilityIdOverride:l.facilityId)===id})}
export function timetableReport(state,kind='class',id=null){
  if(!id){id=kind==='class'?state.resources.classes[0]?.id:kind==='teacher'?state.resources.teachers[0]?.id:state.resources.facilities[0]?.id}
  let html='';for(let w=0;w<state.timetable.cycleWeeks;w++){const ps=placementsForView(state,kind,id,w);html+=`<h3>${w+1}週目　${esc(viewName(state,kind,id))}</h3><table class="report-table"><tr><th>時限</th>${DAYS.map(d=>`<th>${d}</th>`).join('')}</tr>`;for(let p=0;p<state.periods.length;p++){html+=`<tr><th>${esc(state.periods[p].name)}</th>`;for(let d=0;d<5;d++){const items=ps.filter(x=>x.day===d&&x.period===p).map(x=>lessonById(state,x.lessonId)).filter(Boolean);html+=`<td>${items.map(l=>`${esc(l.subject)}<br><small>${esc((l.classIds||[]).map(c=>classById(state,c)?.name||c).join('・'))}</small>`).join('<hr>')}</td>`}html+='</tr>'}html+='</table>'}
  return wrap(state,'週時間割表',html)
}
export function teacherScheduleReport(state){let html='';for(const t of state.resources.teachers){html+=timetableReportBody(state,'teacher',t.id)}return wrap(state,'教員時間割一覧',html)}
export function facilityScheduleReport(state){let html='';for(const f of state.resources.facilities.filter(x=>x.kind==='facility')){html+=timetableReportBody(state,'facility',f.id)}return wrap(state,'施設時間割一覧',html)}
function timetableReportBody(state,kind,id){let html=`<h2>${esc(viewName(state,kind,id))}</h2>`;for(let w=0;w<state.timetable.cycleWeeks;w++){const ps=placementsForView(state,kind,id,w);html+=`<h3>${w+1}週目</h3><table class="report-table"><tr><th>時限</th>${DAYS.map(d=>`<th>${d}</th>`).join('')}</tr>`;for(let p=0;p<state.periods.length;p++){html+=`<tr><th>${esc(state.periods[p].name)}</th>`;for(let d=0;d<5;d++){const items=ps.filter(x=>x.day===d&&x.period===p).map(x=>lessonById(state,x.lessonId)).filter(Boolean);html+=`<td>${items.map(l=>esc(l.subject)).join('<br>')}</td>`}html+='</tr>'}html+='</table>'}return `<div class="page-break">${html}</div>`}
export function reportByType(state,type,opts={}){if(type==='calendar')return calendarReport(state);if(type==='hours')return hoursReport(state);if(type==='timetable')return timetableReport(state,opts.kind,opts.id);if(type==='teachers')return teacherScheduleReport(state);if(type==='facilities')return facilityScheduleReport(state);return summaryReport(state)}
function wrap(state,title,body){return `<div class="report-sheet"><div class="report-title">${esc(title)}</div><div class="report-meta"><span>${esc(state.school.name)}</span><span>${state.school.fiscalYear}年度</span></div>${body}</div>`}
