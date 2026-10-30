import {calendarStats,monthMatrix,weeklyTargetForGrade,dailyPattern} from './calendar.js';
import {subjectProgress} from './actuals.js';
import {classById,teacherById,facilityById,lessonById,DAYS,cycleSessionsForLesson,discretionaryLedger,discretionaryCaps,effectiveSubjectHours,effectiveInstructionHours} from './model.js';
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmtDate(s){if(!s)return '';const [y,m,d]=s.split('-');return `${Number(y)}年${Number(m)}月${Number(d)}日`}
function fiscalMonths(fy){const a=[];for(let i=0;i<12;i++){const m=(3+i)%12,y=fy+(m<3?1:0);a.push([y,m])}return a}
export function summaryReport(state){
  const stats=calendarStats(state),issues=[];const rows=state.hourPlans.map(p=>{const sum=p.subjects.reduce((a,s)=>a+Number(s.hours||0),0);const adjusted=effectiveInstructionHours(state,p.grade);return `<tr><td>${p.grade}年</td><td>${p.annualTarget}</td><td>${sum}</td><td>${adjusted}</td><td>${weeklyTargetForGrade(state,p.grade,stats).avg.toFixed(2)}</td></tr>`}).join('');
  return wrap(state,'教育課程編成概要',`<div class="report-meta"><span>${esc(state.school.name)}</span><span>${state.school.fiscalYear}年度</span></div>
  <h3>1 学校教育目標</h3><p>${esc(state.goals.educationGoal||'未入力')}</p>
  <h3>2 指導の重点</h3>${state.goals.focusItems.map(x=>`<p><strong>${esc(x.label)}</strong>　${esc(x.text||'')}</p>`).join('')}
  <h3>3 年間授業日数</h3><p>${stats.instructionDays}日（週換算 ${stats.weeks.toFixed(1)}週）</p>
  <h3>4 年間計画時数</h3><table class="report-table"><tr><th>学年</th><th>標準年間時数</th><th>標準内訳合計</th><th>調整後生徒時数</th><th>週平均</th></tr>${rows}</table>`)
}
export function hoursReport(state){
 const stats=calendarStats(state);let html='';
 for(const p of state.hourPlans){
  const ledger=discretionaryLedger(state,p.grade),caps=discretionaryCaps(state,p.grade);
  html+=`<h3>${p.grade}年｜調整授業時数・裁量の時間</h3><p>減じた時数 ${ledger.reductions}時間 / 再配分 ${ledger.allocated+ledger.legacyAdds}時間 / 残り ${ledger.remaining}時間 / 裁量的な時間 ${caps.total}/70（研究・研修等 ${caps.training}/35）</p>
  <table class="report-table"><tr><th>教科等</th><th>基準</th><th>減少・旧調整</th><th>裁量から上乗せ</th><th>最終配当</th></tr>
  ${p.subjects.map(x=>{const allocated=ledger.allocations.filter(a=>a.subject===x.name&&a.kind!=='training').reduce((sum,a)=>sum+Number(a.hours||0),0);return `<tr><td>${esc(x.name)}</td><td>${Number(x.hours||0)}</td><td>${Number(x.adjustment||0)}</td><td>${allocated}</td><td>${effectiveSubjectHours(state,p.grade,x.name)}</td></tr>`}).join('')}
  </table><h4>裁量の時間の配分先</h4><table class="report-table"><tr><th>使途</th><th>教科・枠</th><th>年間時数</th><th>内容</th></tr>
  ${ledger.allocations.map(x=>`<tr><td>${esc(({subject:'教科上乗せ',new_subject:'新設教科',learning:'学習枠',training:'研修枠'})[x.kind]||x.kind)}</td><td>${esc(x.subject||'教員研修')}</td><td>${Number(x.hours||0)}</td><td>${esc(x.note||'')}</td></tr>`).join('')}</table>
  <p>生徒の年間計画時数：${effectiveInstructionHours(state,p.grade)}単位 / 週平均：${weeklyTargetForGrade(state,p.grade,stats).avg.toFixed(2)}コマ。研修枠は生徒時間割に含めない。</p>`;
 }
 return wrap(state,'授業時数配当表・裁量時間収支',html);
}
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

export function actualsReport(state){
 const days=[...(state.operations.actualDays||[])].sort((a,b)=>a.date.localeCompare(b.date));
 let html='<h3>学級別・教科別の時数進捗</h3>';
 for(const cls of state.resources.classes){
  const p=subjectProgress(state,cls.grade,cls.id);
  html+=`<h4>${esc(cls.name)}</h4><table class="report-table"><tr><th>教科</th><th>年間計画</th><th>実施駒</th><th>実施分数</th><th>標準時数換算</th><th>残り</th></tr>
  ${p.map(x=>`<tr><td>${esc(x.subject)}</td><td>${x.target}</td><td>${x.periods}</td><td>${x.minutes}</td><td>${x.completed.toFixed(2)}</td><td>${x.remaining.toFixed(2)}</td></tr>`).join('')}</table>`;
 }
 html+='<h3>日別の実績履歴</h3><table class="report-table"><tr><th>実施日</th><th>学級</th><th>時限</th><th>教科</th><th>実施区分</th><th>分数</th><th>担当</th><th>備考</th></tr>';
 for(const d of days)for(const x of d.rows||[])html+=`<tr><td>${esc(d.date)}</td><td>${esc(x.className)}</td><td>${x.period+1}</td><td>${esc(x.subject)}</td><td>${x.status==='held'?'実施':'未実施'}</td><td>${x.status==='held'?x.minutes:0}</td><td>${esc((x.teacherNames||[]).join('・'))}</td><td>${esc(x.note||'')}</td></tr>`;
 html+='</table><p>出張や欠勤による変更は臨時時間割と分けて保存します。実施済みとして確定した授業のみ集計し、訂正前の内容は保存データに履歴を保持します。</p>';
 return wrap(state,'授業実績・年間時数進捗',html);
}

export function periodAssignmentsReport(state){
 let html='<p>基本時間割は1週間固定とし、日付範囲により実施分野・担当者・使用施設を切り替えます。分野別配当は親教科の内数です。</p>';
 html+='<table class="report-table"><tr><th>学級</th><th>基本教科</th><th>期間</th><th>分野・授業内容</th><th>担当教員</th><th>使用教室</th><th>年間配当</th></tr>';
 for(const x of state.periodAssignments||[]){
  html+=`<tr><td>${esc(classById(state,x.classId)?.name||x.classId)}</td><td>${esc(x.baseSubject)}</td><td>${esc(x.startDate)}〜${esc(x.endDate)}</td><td>${esc(x.label)}</td><td>${esc(teacherById(state,x.teacherId)?.name||'基本担当')}</td><td>${esc(facilityById(state,x.facilityId)?.name||'基本教室')}</td><td>${x.targetHours}</td></tr>`;
 }
 html+='</table>';
 return wrap(state,'期間別の授業・担当配当',html);
}
export function reportByType(state,type,opts={}){if(type==='actuals')return actualsReport(state);if(type==='periodAllocations')return periodAssignmentsReport(state);if(type==='calendar')return calendarReport(state);if(type==='hours')return hoursReport(state);if(type==='timetable')return timetableReport(state,opts.kind,opts.id);if(type==='teachers')return teacherScheduleReport(state);if(type==='facilities')return facilityScheduleReport(state);return summaryReport(state)}
function wrap(state,title,body){return `<div class="report-sheet"><div class="report-title">${esc(title)}</div><div class="report-meta"><span>${esc(state.school.name)}</span><span>${state.school.fiscalYear}年度</span></div>${body}</div>`}
