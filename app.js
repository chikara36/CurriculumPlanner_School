import {APP_VERSION,SCHEMA_VERSION,defaultState,migrateState,deepClone,uid,DAYS,classById,teacherById,facilityById,lessonById,cycleSessionsForLesson,validateState,normalizeResources,applySchoolTypeDefaults,standardUnitMinutesForSchool,implementationPeriodsForStandardUnits,implementationExactPeriods,discretionaryLedger,discretionaryCaps,effectiveSubjectHours,maxSubjectReduction,subjectReductionPercent,reconcileCurriculumLessons} from './model.js';
import {loadState,saveState,downloadText,readFile} from './storage.js';
import {calendarStats,weeklyTargetForGrade,dailyPattern,gradePatterns,monthMatrix,typeLabel,isoDate} from './calendar.js';
import {solveSchedule,scheduleMetrics,movePlacement,placeLesson,absenceProposals,buildSolverModel,replanTeacherWeek} from './solver-client.js';
import {saveToDrive,loadFromDrive} from './drive.js';
import {reportByType} from './reports.js';
import {dateWeekday,actualDayRows,saveActualDay,subjectProgress} from './actuals.js';
import {mondayFor,weekDates,registeredConditions,validateAbsence,absenceAt,weekHasActuals,weeklyTemporarySchedules,weeklyConditionsMatch} from './weekly.js';
import {periodAssignmentIssues,periodAllocationSummary,resolveDatedPlacements,actualComponentProgress} from './period-assignments.js';

const NAV=[
  ['basic','01','基本情報'],['goals','02','教育目標・重点'],['calendar','03','年間カレンダー'],['days','04','授業日数・週時数'],
  ['hours','05','授業時数'],['integrated','06','総合・特別活動'],['periods','07','校時表'],['resources','08','時間割データ'],
  ['timetable','09','時間割編成'],['operations','10','臨時変更・実績'],['checks','11','最終チェック'],['reports','12','帳票・保存']
];
let state=null,saveTimer=null,busy=false,metricsCache=null,absenceCache=null,deferredPrompt=null,mutationRevision=0,weeklyPreview=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const attr=s=>esc(s).replace(/`/g,'&#96;');
function toast(msg,type=''){const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=msg;$('#toasts').appendChild(el);setTimeout(()=>el.remove(),3300)}
function fmtTime(iso){if(!iso)return '未同期';try{return new Date(iso).toLocaleString('ja-JP')}catch{return iso}}
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function setByPath(obj,path,val){const parts=path.split('.');let cur=obj;for(let i=0;i<parts.length-1;i++){const k=/^\d+$/.test(parts[i])?Number(parts[i]):parts[i];cur=cur[k]}const k=/^\d+$/.test(parts.at(-1))?Number(parts.at(-1)):parts.at(-1);cur[k]=val}
function getByPath(obj,path){return path.split('.').reduce((a,k)=>a?.[/^\d+$/.test(k)?Number(k):k],obj)}
function input(path,value,type='text',extra=''){return `<input type="${type}" value="${attr(value??'')}" data-bind="${path}" ${extra}>`}
function select(path,value,options,extra=''){return `<select data-bind="${path}" ${extra}>${options.map(([v,l])=>`<option value="${attr(v)}" ${String(value)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select>`}
function checkbox(path,val,label,extra=''){return `<label class="inline"><input type="checkbox" data-bind="${path}" ${val?'checked':''} ${extra}> <span>${esc(label)}</span></label>`}
function pageHead(title,desc,meta=''){return `<div class="page-head"><div><h2>${esc(title)}</h2><p>${desc}</p></div><div class="page-meta">${meta}</div></div>`}
function field(label,control,span='span4',help=''){return `<div class="field ${span}"><label>${esc(label)}</label>${control}${help?`<div class="help">${help}</div>`:''}</div>`}
function card(title,body,sub=''){return `<div class="card"><h3>${esc(title)}</h3>${sub?`<div class="sub">${sub}</div>`:''}${body}</div>`}
function metric(label,value,unit='',note=''){return `<div class="card metric"><div class="label">${esc(label)}</div><div class="value">${esc(value)}<span class="unit">${esc(unit)}</span></div>${note?`<div class="note">${note}</div>`:''}</div>`}
function navState(page){if(page==='timetable'&&metricsCache){if(metricsCache.hard?.length)return 'err';if(metricsCache.unplaced)return 'warn';return 'ok'}if(page==='checks'){const issues=validateState(state,calendarStats(state));if(issues.some(x=>x.level==='ERROR'))return 'err';if(issues.some(x=>x.level==='WARNING'))return 'warn';return 'ok'}return 'ok'}

async function init(){
  const raw=await loadState().catch(()=>null);state=migrateState(raw||defaultState());normalizeResources(state);state.timetable.cycleWeeks=n(state.timetable.cycleWeeks||state.instruction.cycleWeeks,2);state.instruction.cycleWeeks=state.timetable.cycleWeeks;
  bindGlobal();render();window.dispatchEvent(new Event('curriculum-ready'));refreshMetrics();
  if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(e=>console.warn(e))}
}
function bindGlobal(){
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').hidden=false});
  $('#installBtn').addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#installBtn').hidden=true});
  window.addEventListener('online',updateTop);window.addEventListener('offline',updateTop);
  document.body.addEventListener('click',handleClick);document.body.addEventListener('input',handleBind);document.body.addEventListener('change',handleChange);
  document.body.addEventListener('dragstart',handleDragStart);document.body.addEventListener('dragover',e=>{if(e.target.closest('[data-drop]')){e.preventDefault();e.target.closest('[data-drop]').classList.add('drop-target')}});document.body.addEventListener('dragleave',e=>e.target.closest('[data-drop]')?.classList.remove('drop-target'));document.body.addEventListener('drop',handleDrop);
}
function handleBind(e){const path=e.target.dataset.bind;if(!path)return;if(path==='school.type'||path==='timetable.cycleWeeks'||/^resources\.classes\.\d+\.grade$/.test(path))return;let v=e.target.type==='checkbox'?e.target.checked:e.target.value;if(e.target.dataset.number!==undefined)v=n(v);if(e.target.dataset.boolean!==undefined)v=String(v)==='true';setByPath(state,path,v);if(path==='goals.featureTagsText')state.goals.featureTags=String(v).split(/[、,]/).map(x=>x.trim()).filter(Boolean);const sm=path.match(/^resources\.teachers\.(\d+)\.subjectsText$/);if(sm)state.resources.teachers[Number(sm[1])].subjects=String(v).split(/[、,]/).map(x=>x.trim()).filter(Boolean);if(path==='timetable.cycleWeeks'){state.instruction.cycleWeeks=n(v,1);state.timetable.view.week=Math.min(state.timetable.view.week,n(v,1)-1)}state.updatedAt=new Date().toISOString();scheduleSave();if(e.target.dataset.live==='top')updateTop()}
function scheduleSave(){mutationRevision++;metricsCache=null;clearTimeout(saveTimer);$('#saveChip').textContent='保存中…';saveTimer=setTimeout(async()=>{try{await saveState(state);$('#saveChip').textContent='端末に保存済み'}catch(e){$('#saveChip').textContent='保存失敗';toast(e.message,'err')}},450)}
function render(){renderNav();updateTop();const c=$('#content');const fn={basic:renderBasic,goals:renderGoals,calendar:renderCalendar,days:renderDays,hours:renderHours,integrated:renderIntegrated,periods:renderPeriods,resources:renderResources,timetable:renderTimetable,operations:renderOperations,checks:renderChecks,reports:renderReports}[state.ui.page]||renderBasic;c.innerHTML=fn();afterRender()}
function renderNav(){$('#nav').innerHTML=`<div class="nav-title">学校で作成</div>`+NAV.map(([id,num,label])=>`<div class="nav-item ${state.ui.page===id?'active':''}" data-nav="${id}"><span class="num">${num}</span><span class="label">${label}</span><span class="state ${navState(id)}">●</span></div>`).join('')}
function updateTop(){$('#topSchool').textContent=state.school.name||'学校未設定';$('#topMeta').textContent=`${state.school.fiscalYear}年度｜School v${APP_VERSION}`;const ch=$('#onlineChip');ch.className=`chip ${navigator.onLine?'ok':'warn'}`;ch.textContent=navigator.onLine?'● オンライン / オフライン対応':'● オフラインで作業中'}
function afterRender(){if(state.ui.page==='reports')renderReportPreview();}
async function refreshMetrics(){const revision=mutationRevision;try{const next=await scheduleMetrics(state);if(revision!==mutationRevision)return;metricsCache=next;if(state.ui.page==='timetable'||state.ui.page==='checks')render();else renderNav()}catch(e){console.warn(e)}}
function pushUndo(){state.timetable.undo=state.timetable.undo||[];state.timetable.undo.push(deepClone(state.timetable.placements));if(state.timetable.undo.length>30)state.timetable.undo.shift();state.timetable.redo=[]}
function applyPlacements(ps){pushUndo();state.timetable.placements=ps;state.updatedAt=new Date().toISOString();scheduleSave();refreshMetrics();render()}

function renderBasic(){
  const stdMin=standardUnitMinutesForSchool(state.school.type);const actualMin=Number(state.school.lessonMinutes||stdMin);const sampleStd=state.school.type==='junior_high'?1015:(state.hourPlans[0]?.annualTarget||0);const sampleImpl=implementationPeriodsForStandardUnits(state,sampleStd);const exactImpl=implementationExactPeriods(state,sampleStd);
  return pageHead('01 基本情報','学校・年度・校種など、教育課程編成の基礎情報を設定します。',`<span class="chip info">スキーマ v${SCHEMA_VERSION}</span>`)+
  `<div class="grid cols2">${card('学校情報',`<div class="form-grid">
    ${field('学校名',input('school.name',state.school.name,'text','data-live="top"'),'span8')}
    ${field('学校コード',input('school.code',state.school.code),'span4')}
    ${field('校種',select('school.type',state.school.type,[['elementary','小学校'],['junior_high','中学校']],'data-rerender'),'span4','校種を変更すると、教科・標準時数・時間割基礎データを校種別に切り替えます。')}
    ${field('校長名',input('school.principal',state.school.principal),'span4')}
    ${field('年度',input('school.fiscalYear',state.school.fiscalYear,'number','data-number data-rerender'),'span4','年度変更後は年間カレンダーの期間も確認してください。')}
    ${field('実施1コマ（分）',input('school.lessonMinutes',state.school.lessonMinutes,'number','data-number data-rerender'),'span3',`標準1単位時間：${stdMin}分`)}
    ${field('学期制',select('school.termSystem',state.school.termSystem,[[2,'2学期制'],[3,'3学期制']],'data-number'),'span3')}
    ${field('備考',`<textarea data-bind="school.notes">${esc(state.school.notes)}</textarea>`,'span12')}
  </div><div class="notice info" style="margin-top:10px"><strong>${state.school.type==='elementary'?'小学校':'中学校'}：</strong>標準1単位時間は${stdMin}分です。実施1コマを${actualMin}分にすると、標準時数は授業分数で自動換算します。${actualMin!==stdMin?` 例：標準${sampleStd}単位 → ${sampleStd}×${stdMin}÷${actualMin}=${exactImpl.toFixed(2)} → <strong>${sampleImpl}コマ以上</strong>必要。`:''}</div>`) }
  ${card('この学校版の保存方式',`<div class="notice ok">入力内容はChromebook/PCのIndexedDBへ自動保存します。Google Drive同期は任意で、ネットワークがない状態でも教育課程・時間割の編集を続けられます。</div>
  <div class="kpi-line"><span>最終更新</span><strong>${fmtTime(state.updatedAt)}</strong></div>
  <div class="kpi-line"><span>Drive最終同期</span><strong>${fmtTime(state.drive.lastSyncAt)}</strong></div>
  <div class="inline" style="margin-top:10px"><button class="btn" data-action="openDrive">Drive設定</button><button class="btn" data-action="exportJson">JSONバックアップ</button><button class="btn" data-action="importJson">JSON復元</button></div>`)}
  </div>`;
}

function renderGoals(){
  return pageHead('02 教育目標・指導の重点','学校教育目標と、今年度の重点・特色を学校自身で記述します。')+
  `${card('学校教育目標',`<div class="field"><textarea data-bind="goals.educationGoal" placeholder="学校教育目標を入力">${esc(state.goals.educationGoal)}</textarea></div>`) }
  <div style="height:12px"></div>
  ${card('指導の重点',`<div class="grid cols2">${state.goals.focusItems.map((x,i)=>`<div class="card flat"><div class="inline"><strong style="color:var(--navy)">${esc(x.label)}</strong><button class="btn small danger right" data-action="removeFocus" data-index="${i}">削除</button></div><div class="field" style="margin-top:7px"><input data-bind="goals.focusItems.${i}.label" value="${attr(x.label)}" placeholder="項目名"><textarea data-bind="goals.focusItems.${i}.text" placeholder="重点内容">${esc(x.text||'')}</textarea></div></div>`).join('')}</div><div style="margin-top:10px"><button class="btn" data-action="addFocus">＋ 項目を追加</button></div>`)}
  <div style="height:12px"></div>
  ${card('今年度の特色',`<div class="form-grid">${field('特色の要約',`<textarea data-bind="goals.featureSummary" placeholder="今年度、特に力を入れる教育課程上の工夫を記述">${esc(state.goals.featureSummary||'')}</textarea>`,'span8')}${field('特色タグ',input('goals.featureTagsText',(state.goals.featureTags||[]).join('、')),'span4','読点「、」区切り。例：探究、地域連携、情報教育')}</div>`,'将来、市教委版へ提出する場合は学校特色ダッシュボードに利用できます。')}`;
}

function renderCalendar(){
  const stats=calendarStats(state),fy=Number(state.school.fiscalYear),months=[];for(let i=0;i<12;i++){const m=(3+i)%12,y=fy+(m<3?1:0);months.push(renderMiniMonth(y,m,stats))}
  return pageHead('03 年間カレンダー','法定祝日を自動反映し、学校独自休業日・振替休業日・土曜授業日・特別授業日を追加できます。',`<span class="chip info">祝日ルール ${esc(state.calendar.holidayRuleVersion)}</span>`)+
  `<div class="grid cols2">${card('学期・授業日計算範囲',`<div class="table-wrap"><table class="table"><thead><tr><th>学期</th><th>開始</th><th>終了</th></tr></thead><tbody>${state.calendar.terms.map((t,i)=>`<tr><td>${input(`calendar.terms.${i}.name`,t.name)}</td><td>${input(`calendar.terms.${i}.start`,t.start,'date','data-rerender')}</td><td>${input(`calendar.terms.${i}.end`,t.end,'date','data-rerender')}</td></tr>`).join('')}</tbody></table></div><div class="help" style="margin-top:7px">始業式・終業式等を授業日に数える場合は、その日を計算範囲に含め、必要に応じ行事を登録してください。</div>`) }
  ${card('学校カレンダー例外',`<div class="inline"><button class="btn primary" data-action="addCalendarException">＋ 休業・土曜授業を追加</button><button class="btn" data-action="addEvent">＋ 学校行事を追加</button></div><div class="table-wrap" style="margin-top:10px;max-height:270px"><table class="table"><thead><tr><th>日付</th><th>区分</th><th>名称</th><th></th></tr></thead><tbody>${(state.calendar.exceptions||[]).sort((a,b)=>a.date.localeCompare(b.date)).map((x,i)=>`<tr><td>${esc(x.date)}</td><td>${esc(typeLabel(x.type))}</td><td>${esc(x.label||'')}</td><td><button class="btn small danger" data-action="removeException" data-id="${x.id}">削除</button></td></tr>`).join('')||'<tr><td colspan="4" class="muted">学校独自の例外日は未登録です。</td></tr>'}</tbody></table></div>`)}
  </div><div style="height:12px"></div>
  ${card('年度カレンダー',`<div class="calendar-grid">${months.join('')}</div>`,'緑：授業日、赤：国民の祝日、黄：学校休業、青枠：土曜・特別授業、点：学校行事')}`;
}
function renderMiniMonth(y,m,stats){const mat=monthMatrix(y,m);return `<div class="month-card"><h4>${y}年${m+1}月</h4><div class="month-body"><div class="month-kpi"><span>授業日</span><strong>${stats.byMonth[`${y}-${String(m+1).padStart(2,'0')}`]||0}日</strong></div><div class="mini-cal">${['月','火','水','木','金','土','日'].map(x=>`<div class="dow">${x}</div>`).join('')}${mat.map(({date,inMonth})=>{const k=isoDate(date),x=stats.byDate[k],ev=(state.calendar.events||[]).some(e=>e.date===k);let cls='day';if(!inMonth)cls+=' out';else if(x?.exception&&['saturday_instruction','special_instruction','national_override_on'].includes(x.exception.type))cls+=' instruction special';else if(x?.exception&&!x.instruction)cls+=' schooloff';else if(x?.holiday&&!x.instruction)cls+=' holiday';else if(x?.instruction)cls+=' instruction';else if(date.getDay()===0||date.getDay()===6)cls+=' weekend';if(ev)cls+=' event';return `<div class="${cls}" title="${attr(x?.holiday||x?.exception?.label||x?.reason||'')}">${date.getDate()}</div>`}).join('')}</div></div></div>`}

function renderDays(){
  const stats=calendarStats(state),patterns=gradePatterns(state,stats),stdMin=standardUnitMinutesForSchool(state.school.type),actualMin=Number(state.school.lessonMinutes||stdMin);
  return pageHead('04 授業日数・週コマ数','年間授業日数から授業週数を求め、年間計画時数を割って基準週コマ数を自動算出します。')+
  `<div class="grid cols4">${metric('年間授業日数',stats.instructionDays,'日','学期範囲・祝日・学校例外を反映')}${metric('授業週換算',stats.weeks.toFixed(1),'週','授業日数 ÷ 5')}${metric('標準1単位時間',stdMin,'分',state.school.type==='elementary'?'小学校基準':'中学校基準')}${metric('実施1コマ',actualMin,'分',actualMin===stdMin?'標準どおり':'時数を分数換算')}</div><div style="height:12px"></div><div class="notice ${actualMin===stdMin?'ok':'warn'}">標準授業時数は「単位時間」で管理します。実施時間が標準と異なる場合、必要コマ数 = 標準時数 × ${stdMin} ÷ ${actualMin} を切り上げて時間割へ反映します。</div><div style="height:12px"></div>
  <div class="notice info" style="margin-bottom:12px"><strong>基本時間割は原則1週間固定。</strong> 技術・家庭科の技術分野・家庭分野のような0.5コマ相当の配当は、基本時間割を週替わりにせず、年間の期間配当や日別変更・授業実績で管理します。2週・3週交替は特別な運用が必要な学校向けです。</div>
  ${card('週コマ数の設定',`<div class="form-grid">${field('計算方式',select('instruction.manualWeeklyTarget',state.instruction.manualWeeklyTarget?'true':'false',[['false','年間時数から自動計算'],['true','学校で週コマ数を指定']],'data-boolean data-rerender'),'span4')}${field('手動週コマ数',input('instruction.weeklyTargetOverride',state.instruction.weeklyTargetOverride??'','number','data-number data-rerender'),'span3')}${field('基本時間割の運用',select('timetable.cycleWeeks',state.timetable.cycleWeeks,[[1,'毎週同じ（推奨）'],[2,'2週交替（特別運用）'],[3,'3週交替（特別運用）']],'data-number data-rerender'),'span3')}${field('1日最大時限',select('instruction.maxPeriods',state.instruction.maxPeriods,[[5,'5限'],[6,'6限'],[7,'7限']],'data-number data-rerender'),'span2')}</div>${state.timetable.cycleWeeks>1?'<div class="inline" style="margin-top:10px"><button class="btn blue" data-action="switchToSingleWeek">週1固定に統一する</button><span class="help">既存の基本時間割がある場合は、確認後に配置を解除して再編成します。過去の実績は保持します。</span></div>':''}`)}
  <div style="height:12px"></div>
  ${card('学年別の自動計算',`<div class="table-wrap"><table class="table"><thead><tr><th>学年</th><th>標準年間時数</th><th>実施必要コマ</th><th>週平均</th><th>基準週</th><th>サイクル別</th><th>曜日配当</th></tr></thead><tbody>${state.hourPlans.map(p=>{const w=weeklyTargetForGrade(state,p.grade,stats);return `<tr><td>${p.grade}年</td><td class="num">${w.standardAnnual}</td><td class="num"><strong>${w.annual}</strong></td><td class="num">${w.avg.toFixed(2)}</td><td class="num"><strong>${w.base}</strong></td><td>${state.timetable.cycleWeeks===1?`${w.targets[0]}コマ（毎週共通）`:w.targets.map((x,i)=>`${i+1}週:${x}`).join(' / ')}</td><td>${(patterns[p.grade]?.[0]||[]).map((x,i)=>`${DAYS[i]}${x}`).join('・')}</td></tr>`}).join('')}</tbody></table></div><div class="notice info" style="margin-top:10px">生徒の時間割は中抜けを作らず、例えば5コマの日は1〜5限に授業を入れ、6限を空きにします。</div>`)} `;
}

function syncSubjectLessons(grade,subject){return reconcileCurriculumLessons(state,grade)}
function discardLessonIds(ids){
 if(!ids.size)return;
 state.lessons=state.lessons.filter(l=>!ids.has(l.id));
 state.timetable.placements=state.timetable.placements.filter(p=>!ids.has(p.lessonId));
 for(const temporary of state.operations?.temporarySchedules||[])temporary.placements=(temporary.placements||[]).filter(p=>!ids.has(p.lessonId));
 state.timetable.undo=[];state.timetable.redo=[];state.timetable.selectedPlacementId=null;
 state.timetable.lastResult=null;
}

function updateHourAdjustment(pi,si,value){
  const hp=state.hourPlans[pi],subj=hp?.subjects?.[si];if(!subj)return;
  const minimum=-maxSubjectReduction(subj.hours),requested=Math.round(n(value));
  if(requested<minimum)toast(`減少できるのは基準時数の15％まで（${-minimum}コマ）です`,'warn');
  subj.adjustment=Math.min(0,Math.max(minimum,requested));
  syncSubjectLessons(hp.grade,subj.name);state.updatedAt=new Date().toISOString();metricsCache=null;absenceCache=null;scheduleSave();render();refreshMetrics();
}

function renderHours(){
 const stats=calendarStats(state);
 return pageHead('05 裁量時数・配当','①教科時数を減ずる → ②裁量の時間として確保 → ③学習・教科上乗せ・新設教科・研修へ配分 → ④時間割へ反映します。')+
 `<div class="notice info" style="margin-bottom:12px">本画面は制度検討・学校計画のための配当支援です。各教科の減少は基準時数の最大15％（整数コマは切り捨て）かつ減少後35コマ以上で制限します。制度上の他の要件、対象教科、研修枠への充当条件は別途確認が必要です。研修枠は生徒の授業時数に加算しません。</div>
 <div class="grid">${state.hourPlans.map((p,pi)=>{const w=weeklyTargetForGrade(state,p.grade,stats),ledger=discretionaryLedger(state,p.grade),caps=discretionaryCaps(state,p.grade),base=p.subjects.reduce((a,x)=>a+n(x.hours),0);
 return card(`${p.grade}年｜裁量時間の収支`,`
 <div class="inline" style="margin-bottom:10px"><span class="chip info">減じた時数 ${ledger.reductions}時間</span><span class="chip neutral">配分済 ${ledger.allocated+ledger.legacyAdds}時間</span><span class="chip ${ledger.remaining<0?'err':ledger.remaining>0?'warn':'ok'}">残り ${ledger.remaining}時間</span><span class="chip neutral">生徒の年間 ${w.standardAnnual}単位 / 週平均 ${w.avg.toFixed(2)}コマ</span><span class="chip ${caps.total>70||caps.training>35?'err':'ok'}">裁量的な時間 ${caps.total}/70 ・研修 ${caps.training}/35</span></div>
 <h4>① 各教科から減ずる時数</h4>
 <div class="table-wrap hours-table-wrap"><table class="table hours-adjust-table"><colgroup><col style="width:23%"><col style="width:10%"><col style="width:29%"><col style="width:13%"><col style="width:13%"><col style="width:12%"></colgroup><thead><tr><th>教科等</th><th>基準</th><th>減ずる時数</th><th>減少量</th><th>減少率</th><th>調整後</th></tr></thead><tbody>${p.subjects.filter(x=>n(x.hours)>0).map(x=>{const si=p.subjects.indexOf(x),v=Math.min(0,n(x.adjustment)),hours=n(x.hours),limit=maxSubjectReduction(hours),percent=subjectReductionPercent(hours,v),over=-v>limit;return `<tr><td>${esc(x.name)}</td><td class="num">${hours}</td><td class="hours-slider-cell"><input type="range" min="-${limit}" max="0" step="1" value="${Math.max(-limit,v)}" data-hours-adjust="${pi}-${si}" aria-label="${attr(x.name)}から減ずる時数（上限15％）" ${limit===0?'disabled':''}><div class="help">最大 ${limit}コマ（15％以内）</div></td><td class="hours-input-cell"><input type="number" min="-${limit}" max="0" value="${v}" data-hours-number="${pi}-${si}" ${limit===0?'disabled':''}></td><td class="num hours-percent-cell"><strong>${percent.toFixed(1)}％</strong>${over?'<span class="hours-overlimit" title="15％上限超過">!</span>':''}</td><td class="num">${hours+v}</td></tr>`}).join('')}</tbody></table></div>
 <h4 style="margin-top:14px">② 裁量の時間を配分する</h4>
 <div class="table-wrap"><table class="table"><thead><tr><th>使途</th><th>教科・枠</th><th>年間時数</th><th>備考</th><th></th></tr></thead><tbody>
 ${ledger.allocations.map(a=>`<tr><td>${esc(({subject:'既存教科へ上乗せ',new_subject:'新設教科',learning:'学習枠',training:'研修枠'})[a.kind]||a.kind)}</td><td>${esc(a.subject||'教員研修')}</td><td class="num">${n(a.hours)}</td><td>${esc(a.note||'')}</td><td><button class="btn small danger" data-action="removeDiscretionary" data-id="${a.id}">削除</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">まだ配分していません。</td></tr>'}</tbody></table></div>
 <div class="form-grid" style="margin-top:10px">
 ${field('使途',`<select id="allocKind_${p.grade}" data-action="allocKind" data-grade="${p.grade}"><option value="subject">既存教科へ上乗せ</option><option value="new_subject">新設教科</option><option value="learning">学習枠</option><option value="training">研修枠</option></select>`,'span3')}
 ${field('教科・新設教科',`<select id="allocSubject_${p.grade}">${(state.masters.subjects||[]).map(x=>`<option value="${attr(x.name)}">${esc(x.name)}</option>`).join('')}</select><input id="allocNewSubject_${p.grade}" placeholder="新設教科名（新設教科を選択時）" style="margin-top:5px">`,'span4')}
 ${field('時数',`<input type="number" min="1" step="1" id="allocHours_${p.grade}" value="${Math.max(1,ledger.remaining)}">`,'span2')}
 ${field('使途の説明',`<input id="allocNote_${p.grade}" placeholder="例：探究的な学習・校内研修">`,'span3')}
 </div><div class="inline" style="margin-top:9px"><button class="btn primary" data-action="addDiscretionary" data-grade="${p.grade}">＋ 裁量時間から配分</button></div>
 <div class="notice ${ledger.remaining<0?'warn':ledger.remaining===0?'ok':'info'}" style="margin-top:10px">基準時数 ${base} → 減少 ${ledger.reductions} → 生徒への再配分 ${ledger.instructional} / 研修 ${ledger.allocations.filter(x=>x.kind==='training').reduce((sum,x)=>sum+n(x.hours),0)}。裁量残高は ${ledger.remaining} 時間。時間割に入れるのは教科・新設教科・学習枠のみです。</div>`)}).join('')}</div>`;
}

function renderIntegrated(){
  const events=state.calendar.events||[];
  return pageHead('06 総合・特別活動','総合的な学習の時間と学校行事の関連を記録し、年間カレンダーと照合します。')+
  `${card('総合的な学習の時間',`<div class="table-wrap"><table class="table"><thead><tr><th>学年</th><th>テーマ</th><th>計画時数</th><th>関連行事</th><th></th></tr></thead><tbody>${state.integrated.plans.map((p,i)=>`<tr><td>${select(`integrated.plans.${i}.grade`,p.grade,[[1,'1年'],[2,'2年'],[3,'3年']],'data-number')}</td><td>${input(`integrated.plans.${i}.title`,p.title)}</td><td>${input(`integrated.plans.${i}.hours`,p.hours,'number','data-number')}</td><td>${esc((p.linkedEventIds||[]).map(id=>events.find(e=>e.id===id)?.name).filter(Boolean).join('、')||'未設定')}</td><td><button class="btn small" data-action="editIntegrated" data-index="${i}">関連付け</button> <button class="btn small danger" data-action="removeIntegrated" data-index="${i}">削除</button></td></tr>`).join('')}</tbody></table></div><div style="margin-top:9px"><button class="btn" data-action="addIntegrated">＋ 計画を追加</button></div>`)}
  <div style="height:12px"></div>
  ${card('学校行事',`<div class="table-wrap"><table class="table"><thead><tr><th>日付</th><th>行事名</th><th>区分</th><th>授業日扱い</th><th></th></tr></thead><tbody>${events.map(e=>`<tr><td>${esc(e.date)}</td><td>${esc(e.name)}</td><td>${esc(e.category||'')}</td><td>${e.countsAsInstruction?'○':'-'}</td><td><button class="btn small danger" data-action="removeEvent" data-id="${e.id}">削除</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">行事未登録</td></tr>'}</tbody></table></div>`)}`;
}

function renderPeriods(){
  return pageHead('07 校時表','授業時限と開始・終了時刻を設定します。時間割編成の最大時限はSTEP04で設定します。')+
  `${card('校時表',`<div class="table-wrap"><table class="table"><thead><tr><th>時限名</th><th>開始</th><th>終了</th><th></th></tr></thead><tbody>${state.periods.map((p,i)=>`<tr><td>${input(`periods.${i}.name`,p.name)}</td><td>${input(`periods.${i}.start`,p.start,'time')}</td><td>${input(`periods.${i}.end`,p.end,'time')}</td><td><button class="btn small danger" data-action="removePeriod" data-index="${i}">削除</button></td></tr>`).join('')}</tbody></table></div><div style="margin-top:9px"><button class="btn" data-action="addPeriod">＋ 時限を追加</button></div>`)} `;
}

function renderResources(){
  const tab=state.ui.resourceTab||'classes';
  const tabs=[['classes','学級'],['teachers','教員'],['assignments','担当割当'],['masters','教科・役割マスタ'],['facilities','教室・施設'],['lessons','授業設定'],['periods','期間別配当']];
  let body='';
  if(tab==='classes')body=renderClasses();if(tab==='teachers')body=renderTeachers();if(tab==='assignments')body=renderAssignments();if(tab==='masters')body=renderMasters();if(tab==='facilities')body=renderFacilities();if(tab==='lessons')body=renderLessons();if(tab==='periods')body=renderPeriodAssignments();
  return pageHead('08 時間割データ','学級・教員・担当クラス・教科マスタ・校務分掌マスタ・施設・授業を設定します。複数教科・複数役割にも対応します。')+
  `<div class="inline" style="margin-bottom:10px"><button class="btn blue" data-action="syncCurriculumLessons">学級・教科と授業を同期</button><span class="help">不足している学級別授業を生成し、現在の時数に合わせます。担当教員と既存の配置は保持します。</span></div><div class="tabs">${tabs.map(([id,l])=>`<button class="${tab===id?'active':''}" data-action="resourceTab" data-tab="${id}">${l}</button>`).join('')}</div>${body}`;
}
function renderClasses(){return card('学級',`<div class="table-wrap"><table class="table"><thead><tr><th>学年</th><th>学級名</th><th>ID</th><th></th></tr></thead><tbody>${state.resources.classes.map((c,i)=>`<tr><td>${input(`resources.classes.${i}.grade`,c.grade,'number','data-number data-rerender')}</td><td>${input(`resources.classes.${i}.name`,c.name)}</td><td class="mono">${esc(c.id)}</td><td><button class="btn small danger" data-action="removeClass" data-id="${c.id}">削除</button></td></tr>`).join('')}</tbody></table></div><div style="margin-top:9px"><button class="btn" data-action="addClass">＋ 学級を追加</button></div>`)}
function teacherAssignmentsText(id){const rows=[];for(const l of state.lessons)if((l.teacherIds||[]).includes(id))for(const cid of l.classIds||[])rows.push(`${classById(state,cid)?.name||cid} ${l.subject}`);return [...new Set(rows)].join('、')||'未割当'}
function renderTeachers(){return card('教員',`<div class="notice info">担当可能教科と校務分掌は複数選択できます。「教科・役割」からカードで選択し、実際の担当学級は「担当割当」タブで設定します。</div><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>氏名</th><th>校務分掌・役割</th><th>担当可能教科</th><th>現在の担当</th><th>1日上限</th><th>連続上限</th><th>設定</th><th></th></tr></thead><tbody>${state.resources.teachers.map((t,i)=>`<tr><td>${input(`resources.teachers.${i}.name`,t.name)}</td><td style="min-width:180px">${(t.roles||[]).map(x=>`<span class="badge info" style="margin:2px">${esc(x)}</span>`).join('')||'<span class="muted">未設定</span>'}</td><td style="min-width:220px">${(t.subjects||[]).map(x=>`<span class="badge neutral" style="margin:2px">${esc(x)}</span>`).join('')||'<span class="muted">未設定</span>'}</td><td style="min-width:220px">${esc(teacherAssignmentsText(t.id))}</td><td>${input(`resources.teachers.${i}.maxDaily`,t.maxDaily,'number','data-number')}</td><td>${input(`resources.teachers.${i}.maxConsecutive`,t.maxConsecutive,'number','data-number')}</td><td><div class="inline"><button class="btn small" data-action="teacherMaster" data-id="${t.id}">教科・役割</button><button class="btn small" data-action="teacherConstraints" data-id="${t.id}">勤務条件</button></div></td><td><button class="btn small danger" data-action="removeTeacher" data-id="${t.id}">削除</button></td></tr>`).join('')}</tbody></table></div><div style="margin-top:9px"><button class="btn" data-action="addTeacher">＋ 教員を追加</button></div>`,'理科＋技術など複数教科を選べます。役割も、学年主任＋学級担任＋教科主任のように複数設定できます。')}
function renderAssignments(){const rows=[];for(const c of [...state.resources.classes].sort((a,b)=>Number(a.grade)-Number(b.grade)||String(a.name).localeCompare(String(b.name),'ja'))){for(const l of state.lessons.filter(x=>(x.classIds||[]).includes(c.id)).sort((a,b)=>String(a.subject).localeCompare(String(b.subject),'ja'))){rows.push({c,l})}}return card('教科・学級ごとの担当割当',`<div class="notice info">同じ教科でも学級ごとに別の教員を設定できます。例：理科 1年1組・1年2組＝A先生、1年3組＝B先生。●は担当可能教科に登録済みの教員です。</div><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>学級</th><th>教科・授業</th><th>主担当</th><th>連続コマ</th><th>年間標準時数</th><th></th></tr></thead><tbody>${rows.map(({c,l})=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(l.subject)}</td><td><select data-action="assignmentTeacher" data-lesson-id="${l.id}"><option value="">未定</option>${state.resources.teachers.map(t=>`<option value="${t.id}" ${(l.teacherIds||[])[0]===t.id?'selected':''}>${(t.subjects||[]).includes(l.subject)?'●':'△'} ${esc(t.name)}</option>`).join('')}</select>${(l.teacherIds||[]).length>1?'<div class="help">TT等の複数教員は「詳細」で設定</div>':''}</td><td><select data-action="assignmentBlock" data-lesson-id="${l.id}">${[[1,'1コマ'],[2,'2コマ連続'],[3,'3コマ連続']].map(([v,label])=>`<option value="${v}" ${Number(l.blockSize||1)===v?'selected':''}>${label}</option>`).join('')}</select></td><td class="num">${n(l.annualHours)}</td><td><button class="btn small" data-action="editLesson" data-id="${l.id}">詳細</button></td></tr>`).join('')||'<tr><td colspan="6" class="muted">授業設定がありません。</td></tr>'}</tbody></table></div>`,'教員マスターで担当可能教科を登録し、ここで実担当クラスを割り当てます。合同授業・TT・同時展開は「詳細」で複数教員・複数学級を設定できます。')}
function renderMasters(){
  const subjects=(state.masters?.subjects||[]).filter(x=>x.active!==false),roles=(state.masters?.roles||[]).filter(x=>x.active!==false);
  return `<div class="grid cols2">${card('教科マスタ',`<div class="notice info">標準教科に加え、調整授業時数制度等で学校独自の新設教科・領域を追加できます。追加した教科はSTEP05の各学年授業時数表にも0時数で追加されます。</div><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>教科・領域名</th><th>区分</th><th>種別</th><th></th></tr></thead><tbody>${subjects.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.category||'教科')}</td><td>${x.custom?'<span class="badge warn">学校設定</span>':'<span class="badge neutral">標準</span>'}</td><td>${x.custom?`<button class="btn small danger" data-action="removeSubjectMaster" data-id="${x.id}">削除</button>`:''}</td></tr>`).join('')}</tbody></table></div><div class="form-grid" style="margin-top:10px">${field('新設教科・領域名','<input id="newSubjectName" placeholder="例：未来創造科">','span7')}${field('区分','<select id="newSubjectCategory"><option>学校設定教科</option><option>領域等</option><option>教科</option></select>','span3')}<div class="field span2"><label>&nbsp;</label><button class="btn primary" data-action="addSubjectMaster">追加</button></div></div>`,'教員の担当可能教科、授業設定、授業時数表で共通利用する学校内マスタです。')}
  ${card('校務分掌・役割マスタ',`<div class="notice info">初期値として、教科主任・学年主任・学級担任・生徒指導・教務などを登録しています。学校独自の分掌も追加できます。</div><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>役割名</th><th>種別</th><th></th></tr></thead><tbody>${roles.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${x.custom?'<span class="badge warn">学校設定</span>':'<span class="badge neutral">標準</span>'}</td><td>${x.custom?`<button class="btn small danger" data-action="removeRoleMaster" data-id="${x.id}">削除</button>`:''}</td></tr>`).join('')}</tbody></table></div><div class="form-grid" style="margin-top:10px">${field('新しい校務分掌・役割','<input id="newRoleName" placeholder="例：ICT推進">','span9')}<div class="field span3"><label>&nbsp;</label><button class="btn primary" data-action="addRoleMaster">追加</button></div></div>`,'役割は教員ごとに複数選択できます。')}</div>`;
}
function renderFacilities(){return card('教室・施設',`<div class="table-wrap"><table class="table"><thead><tr><th>名称</th><th>種別</th><th>同時利用上限</th><th>利用不可</th><th></th></tr></thead><tbody>${state.resources.facilities.map((f,i)=>`<tr><td>${input(`resources.facilities.${i}.name`,f.name)}</td><td>${select(`resources.facilities.${i}.kind`,f.kind,[['room','教室'],['facility','共有施設']])}</td><td>${input(`resources.facilities.${i}.capacity`,f.capacity,'number','data-number')}</td><td><button class="btn small" data-action="facilityConstraints" data-id="${f.id}">設定 ${(f.unavailable||[]).length}件</button></td><td><button class="btn small danger" data-action="removeFacility" data-id="${f.id}">削除</button></td></tr>`).join('')}</tbody></table></div><div style="margin-top:9px"><button class="btn" data-action="addFacility">＋ 施設を追加</button></div>`,'体育館等を「同時利用上限1」にすると、学年・学級をまたいだ重複をHARD制約で防ぎます。')}
function renderLessons(){
  const stats=calendarStats(state);return card('授業設定',`<div class="toolbar"><button class="btn primary" data-action="addLesson">＋ 授業を追加</button><button class="btn" data-action="exportLessonCsv">CSV出力</button><button class="btn" data-action="importLessonCsv">CSV読込</button><span class="muted">年間時数からサイクル必要コマ数を自動算出</span></div><div class="table-wrap"><table class="table"><thead><tr><th>授業</th><th>学級</th><th>担当</th><th>施設</th><th>形態</th><th>連続</th><th>年間</th><th>${state.timetable.cycleWeeks}週必要</th><th>同時展開</th><th></th></tr></thead><tbody>${state.lessons.map(l=>`<tr><td><strong>${esc(l.subject)}</strong></td><td>${esc((l.classIds||[]).map(id=>classById(state,id)?.name||id).join('・'))}</td><td>${esc((l.teacherIds||[]).filter(Boolean).map(id=>teacherById(state,id)?.name||id).join('・')||'未定')}</td><td>${esc(facilityById(state,l.facilityId)?.name||l.facilityId||'未定')}</td><td>${esc(l.type)}</td><td>${Number(l.blockSize||1)>1?`<span class="badge info">${Number(l.blockSize)}コマ連続</span>`:'1コマ'}</td><td class="num">${n(l.annualHours)}</td><td class="num"><strong>${cycleSessionsForLesson(state,l,stats.instructionDays)}</strong></td><td>${esc(l.syncGroup||'-')}</td><td><button class="btn small" data-action="editLesson" data-id="${l.id}">編集</button> <button class="btn small danger" data-action="removeLesson" data-id="${l.id}">削除</button></td></tr>`).join('')}</tbody></table></div>`,'通常授業のほか、TT・合同・選択・展開・通級等を複数教員／複数学級／同時展開グループで表現できます。')
}


function renderPeriodAssignments(){
 const cls=classById(state,state.ui.periodClassId)||state.resources.classes[0];
 const all=(state.periodAssignments||[]).filter(x=>x.classId===cls?.id).slice().sort((a,b)=>a.startDate.localeCompare(b.startDate));
 const bases=[...new Set(all.map(x=>x.baseSubject))];
 const distinct=[...new Set(bases.concat('技術・家庭'))].filter(name=>state.hourPlans.find(h=>Number(h.grade)===Number(cls?.grade))?.subjects?.some(s=>s.name===name));
 const rows=distinct.map(name=>{
  const summary=periodAllocationSummary(state,cls.id,name);if(!summary.entries.length)return '';
  return `<div class="inline"><strong>${esc(name)}</strong><span class="chip ${Math.abs(summary.remaining)<0.001?'ok':'warn'}">内訳配当 ${summary.allocated} / 年間 ${summary.target} 単位時間</span></div>`;
 }).join('');
 return card('期間別の授業・担当教員',`
  <div class="notice info"><strong>基本時間割は毎週同じ枠を使用します。</strong> 例えば技術・家庭を毎週1コマとし、4月〜9月を「技術分野・A先生」、10月〜3月を「家庭分野・B先生」に切り替えられます。年間35コマの内訳を18・17など学校で設定してください。技術・家庭という親教科の年間時数は増えません。</div>
  <div class="inline" style="margin-top:12px;align-items:center"><strong>設定学級</strong><select data-action="periodClassSelector" id="periodClassSelector">${state.resources.classes.map(c=>`<option value="${c.id}" ${c.id===cls?.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select><button class="btn primary" data-action="addPeriodAssignment">＋ 期間別配当を追加</button></div>
  <div style="margin-top:12px">${rows}</div>
  <div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>基本教科</th><th>実施期間</th><th>実施内容</th><th>担当</th><th>教室</th><th>年間配当</th><th>実績</th><th>操作</th></tr></thead><tbody>${all.map(x=>{
    const used=actualComponentProgress(state,x.classId,x.baseSubject).find(a=>a.id===x.id);
    return `<tr><td>${esc(x.baseSubject)}</td><td style="white-space:nowrap">${esc(x.startDate)}〜<wbr>${esc(x.endDate)}</td><td><strong>${esc(x.label)}</strong></td><td>${esc(teacherById(state,x.teacherId)?.name||'基本担当')}</td><td>${esc(facilityById(state,x.facilityId)?.name||'基本教室')}</td><td class="num">${Number(x.targetHours||0)}</td><td class="num">${(used?.completed||0).toFixed(2)}</td><td><button class="btn small" data-action="editPeriodAssignment" data-id="${x.id}">編集</button> <button class="btn small danger" data-action="removePeriodAssignment" data-id="${x.id}">削除</button></td></tr>`;
   }).join('')||'<tr><td colspan="8">期間別配当はありません。年間通じて基本の教科・担当で授業を行います。</td></tr>'}</tbody></table></div>
  <div class="help" style="margin-top:8px">同一学級・基本教科の期間は重複登録できません。分野の配当合計が基本教科の年間時数を超える場合は保存できません。過去に確定した実績は変更されません。</div>
 `);
}
function showPeriodAssignmentModal(id=null){
 const existing=(state.periodAssignments||[]).find(x=>x.id===id);
 const cl=classById(state,existing?.classId||state.ui.periodClassId)||state.resources.classes[0];
 if(!cl)return toast('先に学級を登録してください','warn');
 const plan=state.hourPlans.find(p=>Number(p.grade)===Number(cl.grade));
 const subjects=(plan?.subjects||[]).filter(x=>Number(x.hours||0)>0);
 const subject=existing?.baseSubject|| (subjects.some(x=>x.name==='技術・家庭')?'技術・家庭':subjects[0]?.name||'');
 const fiscal=Number(state.school.fiscalYear||new Date().getFullYear());
 const terms=state.calendar.terms||[];
 const start=terms[0]?.start||fiscal+'-04-01',end=terms.at(-1)?.end||(fiscal+1)+'-03-31';
 const x=existing||{id:'',classId:cl.id,baseSubject:subject,label:subject==='技術・家庭'?'技術分野':'',teacherId:'',facilityId:'',targetHours:0,startDate:start,endDate:end};
 const opts=(arr,selected)=>arr.map(([key,label])=>`<option value="${attr(key)}" ${key===selected?'selected':''}>${esc(label)}</option>`).join('');
 openModal(existing?'期間別配当を編集':'期間別配当を追加',`<div class="form-grid">
 ${field('学級',`<input value="${attr(cl.name)}" disabled>`,'span3')}
 ${field('基本教科',`<select id="periodBaseSubject">${opts(subjects.map(s=>[s.name,s.name]),x.baseSubject)}</select>`,'span3')}
 ${field('実施内容・分野名',`<input id="periodLabel" value="${attr(x.label)}" placeholder="技術分野・家庭分野など">`,'span3')}
 ${field('年間配当（標準単位時間）',`<input id="periodTarget" type="number" min="0" max="140" step="0.5" value="${Number(x.targetHours||0)}">`,'span3')}
 ${field('開始日',`<input id="periodStart" type="date" value="${attr(x.startDate)}">`,'span3')}
 ${field('終了日',`<input id="periodEnd" type="date" value="${attr(x.endDate)}">`,'span3')}
 ${field('期間中の担当教員',`<select id="periodTeacher">${opts([['','基本担当を使用'],...state.resources.teachers.map(t=>[t.id,t.name])],x.teacherId)}</select>`,'span3')}
 ${field('期間中の教室',`<select id="periodFacility">${opts([['','基本教室を使用'],...state.resources.facilities.map(f=>[f.id,f.name])],x.facilityId)}</select>`,'span3')}
 </div><div class="notice info" style="margin-top:10px">期間の指定で授業の中身・担当・教室を変えます。期間別の配当時数は年間の目標であり、期間中の授業を自動的に追加・削除しません。実際の授業時数はSTEP10で確定した実績から計算します。</div>`,
 `<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="savePeriodAssignment" data-id="${attr(x.id)}" data-class-id="${attr(cl.id)}">保存</button>`);
}
function renderTimetable(){
  const model=buildSolverModel(state),view=state.timetable.view||{kind:'class',id:state.resources.classes[0]?.id,week:0};
  if(view.week>=state.timetable.cycleWeeks)view.week=0;
  const opts=view.kind==='class'?state.resources.classes:view.kind==='teacher'?state.resources.teachers:state.resources.facilities;
  if(!opts.some(x=>x.id===view.id))view.id=opts[0]?.id||'';
  const counts=new Map();for(const p of state.timetable.placements||[])counts.set(p.lessonId,(counts.get(p.lessonId)||0)+1);
  const remaining=state.lessons.map(l=>({l,req:model.lessons.find(x=>x.id===l.id)?.sessionsCycle||0,left:Math.max(0,(model.lessons.find(x=>x.id===l.id)?.sessionsCycle||0)-(counts.get(l.id)||0))})).filter(x=>x.left>0);
  const met=metricsCache||{score:'-',hard:[],unplaced:remaining.reduce((a,x)=>a+x.left,0),soft:0};
  const selected=state.timetable.selectedPlacementId?(state.timetable.placements||[]).find(x=>x.id===state.timetable.selectedPlacementId):null;
  return pageHead('09 時間割編成','入れにくい授業から優先して配置し、HARD制約を守りながら複数回探索します。手動ドラッグ、固定、Undo/Redoにも対応します。',`<span class="chip ${met.hard?.length?'err':met.unplaced?'warn':'ok'}">HARD ${met.hard?.length||0}</span><span class="chip info">未配置 ${met.unplaced||0}</span>`)+
  `<div class="toolbar no-print"><button class="btn primary" data-action="autoSchedule" data-mode="rebuild" ${busy?'disabled':''}>${busy?'編成中…':'スマート編成'}</button><button class="btn blue" data-action="autoSchedule" data-mode="fill" ${busy?'disabled':''}>未配置を補完</button><button class="btn" data-action="undoSchedule" ${!(state.timetable.undo||[]).length?'disabled':''}>↶ Undo</button><button class="btn" data-action="redoSchedule" ${!(state.timetable.redo||[]).length?'disabled':''}>↷ Redo</button><div class="spacer"></div>
  <div class="segmented">${[['class','学級'],['teacher','教員'],['facility','施設']].map(([k,l])=>`<button data-action="scheduleViewKind" data-kind="${k}" class="${view.kind===k?'active':''}">${l}</button>`).join('')}</div>
  <select data-action="scheduleViewId">${opts.map(x=>`<option value="${x.id}" ${x.id===view.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
  ${state.timetable.cycleWeeks===1?'<span class="chip info">毎週共通</span>':`<div class="segmented">${Array.from({length:state.timetable.cycleWeeks},(_,w)=>`<button data-action="scheduleWeek" data-week="${w}" class="${view.week===w?'active':''}">${w+1}週</button>`).join('')}</div>`}</div>
  <div class="timetable-shell">
    <div class="panel"><div class="panel-head"><h3>未配置授業</h3><span class="badge warn right">${remaining.reduce((a,x)=>a+x.left,0)}駒</span></div><div class="panel-body"><div class="remaining-list">${remaining.map(x=>`<div class="lesson-card" draggable="true" data-drag-lesson="${x.l.id}"><span class="count">×${x.left}</span><div class="title">${esc(x.l.subject)}</div><div class="meta">${esc((x.l.classIds||[]).map(id=>classById(state,id)?.name||id).join('・'))}<br>${esc((x.l.teacherIds||[]).filter(Boolean).map(id=>teacherById(state,id)?.name||id).join('・')||'担当未定')} / ${esc(facilityById(state,x.l.facilityId)?.name||'施設未定')}</div></div>`).join('')||'<div class="notice ok">必要駒はすべて配置されています。</div>'}</div></div></div>
    <div class="panel"><div class="panel-head"><h3>${esc(viewDisplayName(view))}｜${view.week+1}週目</h3><span class="muted right">ドラッグ＆ドロップで配置・移動</span></div><div class="panel-body">${renderTimetableBoard(model,view)}</div></div>
    <div class="panel"><div class="panel-head"><h3>編成状態</h3></div><div class="panel-body"><div class="score"><span class="n">${met.score??'-'}</span><span class="unit">/ 100</span></div><div class="kpi-line"><span>HARD違反</span><strong>${met.hard?.length||0}</strong></div><div class="kpi-line"><span>未配置</span><strong>${met.unplaced||0}</strong></div><div class="kpi-line"><span>SOFTコスト</span><strong>${Math.round(met.soft||0)}</strong></div>
      <div style="height:10px"></div>${selected?renderSelectedPlacement(selected):'<div class="notice info">時間割上の授業をクリックすると、固定・解除・駒外しができます。</div>'}
      <div style="height:10px"></div><h4>主要制約</h4><div class="constraint-list"><div class="constraint"><span class="badge hard">HARD</span> 生徒の中抜け禁止<div class="meta">空きコマは日末側へ</div></div><div class="constraint"><span class="badge hard">HARD</span> 教員・学級・施設重複<div class="meta">休暇・禁制・連続上限を含む</div></div><div class="constraint"><span class="badge soft">SOFT</span> 教科分散・休憩確保<div class="meta">設定に応じて評価</div></div></div>
    </div>
  </div>`;
}
function viewDisplayName(v){if(v.kind==='class')return classById(state,v.id)?.name||v.id;if(v.kind==='teacher')return teacherById(state,v.id)?.name||v.id;return facilityById(state,v.id)?.name||v.id}
function renderTimetableBoard(model,view){
  const max=Math.min(state.periods.length,state.instruction.maxPeriods);let h='<div class="timetable"><div class="tt-head"></div>'+DAYS.map(x=>`<div class="tt-head">${x}</div>`).join('');
  const cmodel=model.classes.find(x=>x.id===view.id);
  for(let p=0;p<max;p++){h+=`<div class="tt-period">${esc(state.periods[p]?.name||`${p+1}限`)}</div>`;for(let d=0;d<5;d++){let allowed=true;if(view.kind==='class')allowed=p<Number(cmodel?.patterns?.[view.week]?.[d]??max);const ps=placementsForViewCell(view,view.week,d,p);h+=`<div class="tt-cell ${allowed?'allowed':'trailing'}" data-drop="1" data-week="${view.week}" data-day="${d}" data-period="${p}">${ps.map(x=>renderPlacementItem(x)).join('')}</div>`} }return h+'</div>';
}
function placementsForViewCell(view,w,d,p){return (state.timetable.placements||[]).filter(x=>{if(x.week!==w||x.day!==d||x.period!==p)return false;const l=lessonById(state,x.lessonId);if(!l)return false;if(view.kind==='class')return l.classIds?.includes(view.id);if(view.kind==='teacher')return (x.teacherIdsOverride?.length?x.teacherIdsOverride:l.teacherIds||[]).includes(view.id);return (x.facilityIdOverride!==undefined?x.facilityIdOverride:l.facilityId)===view.id})}
function renderPlacementItem(p){const l=lessonById(state,p.lessonId);if(!l)return '';const cls=(l.classIds||[]).map(id=>classById(state,id)?.name||id).join('・'),teachers=(p.teacherIdsOverride?.length?p.teacherIdsOverride:l.teacherIds||[]).filter(Boolean).map(id=>teacherById(state,id)?.name||id).join('・');return `<div class="tt-item ${p.locked?'locked':''} ${state.timetable.selectedPlacementId===p.id?'selected':''}" draggable="true" data-drag-placement="${p.id}" data-action="selectPlacement" data-id="${p.id}"><div class="subj">${esc(l.subject)}</div><div class="meta">${esc(cls)}${teachers?` / ${esc(teachers)}`:''}</div><div class="flags">${p.locked?'<span class="badge hard">固定</span>':''}${Number(l.blockSize||1)>1?`<span class="badge info">${Number(l.blockSize)}連続</span>`:''}${l.syncGroup?'<span class="badge info">同時展開</span>':''}${p.teacherIdsOverride?.length?'<span class="badge warn">代替</span>':''}</div></div>`}
function renderSelectedPlacement(p){const l=lessonById(state,p.lessonId);return `<div class="card flat"><h4>選択中：${esc(l?.subject||'')}</h4><div class="sub">${DAYS[p.day]}曜 ${p.period+1}限 / ${p.week+1}週${Number(l?.blockSize||1)>1?` / ${Number(l.blockSize)}コマ連続`:''}</div><div class="inline"><button class="btn small" data-action="toggleLock" data-id="${p.id}">${p.locked?'固定解除':'固定'}</button><button class="btn small danger" data-action="removePlacement" data-id="${p.id}">駒を外す</button></div></div>`}

function weeklyFingerprint(start){
 return JSON.stringify({
  conditions:registeredConditions(state,start),
  placements:state.timetable.placements,
  classes:state.resources.classes,
  teachers:state.resources.teachers,
  lessons:state.lessons,
  cycleWeeks:state.timetable.cycleWeeks,
  periods:state.periods,
  settings:state.timetable.settings
 });
}
function renderWeeklyPanel(){
 const all=(state.operations.absences||[]).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.teacherId.localeCompare(b.teacherId));
 const starts=[...new Set(all.map(a=>mondayFor(a.date)))].sort();
 const selected=starts.includes(state.ui.weeklyStart)?state.ui.weeklyStart:starts[0]||'';
 const conditions=selected?registeredConditions(state,selected):[];
 const prev=weeklyPreview?.weekStart===selected?weeklyPreview:null;
 const finalized=(state.operations.weeklyPlans||[]).slice().sort((a,b)=>b.weekStart.localeCompare(a.weekStart));
 const label=t=>teacherById(state,t)?.name||t;
 const seg=a=>({FULL:'終日',AM:'午前（1〜3限）',PM:'午後（4限以降）'})[a]||a;
 return `<div class="card"><h3>① 出張・欠勤などの不在条件をまとめて登録</h3>
 <div class="notice info">先にA先生・B先生など複数の不在を登録してください。日付ごとに終日・午前・午後を指定できます。週全体の授業を入れ替える際は、もとの担当教員の授業が別日に移ることを優先します。基本時間割は変更しません。</div>
 <div class="form-grid" style="margin-top:12px">
 ${field('教員',`<select id="weeklyTeacher">${state.resources.teachers.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>`,'span3')}
 ${field('不在日','<input type="date" id="weeklyDate">','span3')}
 ${field('不在時間帯','<select id="weeklySegment"><option value="FULL">終日</option><option value="AM">午前（1〜3限）</option><option value="PM">午後（4限以降）</option></select>','span3')}
 ${field('参照する基本時間割',`<select id="weeklyCycle">${Array.from({length:state.timetable.cycleWeeks},(_,i)=>`<option value="${i}">${state.timetable.cycleWeeks===1?'毎週同じ':`${i+1}週目`}</option>`).join('')}</select>`,'span3')}
 </div>
 <div class="inline" style="margin-top:10px"><button class="btn primary" data-action="addWeeklyAbsence">＋ 不在条件を登録</button><span class="help">週内の登録は同じサイクル週として扱います。</span></div>
 <div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th>不在日</th><th>教員</th><th>時間帯</th><th>時間割サイクル</th><th></th></tr></thead><tbody>
 ${all.map(a=>`<tr><td>${esc(a.date)}</td><td><strong>${esc(label(a.teacherId))}</strong></td><td>${seg(a.segment)}</td><td>${Number(a.week)+1}週</td><td><button class="btn small danger" data-action="removeWeeklyAbsence" data-id="${a.id}">削除</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">登録した不在条件はまだありません。</td></tr>'}</tbody></table></div>
 </div>
 <div style="height:12px"></div>
 <div class="card"><h3>② 対象週の授業を一括再編成</h3>
 <div class="form-grid">${field('対象週（月曜日始まり）',`<select id="weeklyTarget" data-action="weeklyTarget">${starts.map(d=>`<option value="${d}" ${selected===d?'selected':''}>${d} 〜 ${weekDates(d)[4]}（${registeredConditions(state,d).length}条件）</option>`).join('')}</select>`,'span7')}
 <div class="field span5"><label>すべての不在を考慮</label><button class="btn primary" data-action="generateWeeklyPlan" ${busy||!selected?'disabled':''}>週の変更案を作成</button></div></div>
 <div class="help" style="margin-top:8px">同じ学級の授業を別日と交換し、教員・教室の重複、不在時間帯、連続授業条件をチェックします。交換できなかった授業は未解決として表示し、確定できません。</div>
 ${prev?`<div class="notice ${prev.result.ok?'ok':'warn'}" style="margin-top:12px"><strong>${prev.result.ok?'確定可能な変更案':'未解決の授業があります'}</strong>：対象授業${prev.result.originalAffected}コマ、移動${prev.result.changes.length}件、未解決${prev.result.unresolved.length}件、追加制約違反${prev.result.introduced.length}件。</div>
 <div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>教員・教科</th><th>学級</th><th>変更前</th><th>変更後</th></tr></thead><tbody>${prev.result.changes.map(c=>`<tr><td>${esc(c.teacherNames.join('・'))}<div class="help">${esc(c.subject)}</div></td><td>${esc(c.className)}</td><td>${DAYS[c.fromDay]}${c.fromPeriod+1}限</td><td><strong>${DAYS[c.toDay]}${c.toPeriod+1}限</strong></td></tr>`).join('')||'<tr><td colspan="4">自動変更された授業はありません。</td></tr>'}</tbody></table></div>
 ${prev.result.unresolved.concat(prev.result.introduced).map(x=>`<div class="notice warn" style="margin-top:6px">${esc(x.text)}</div>`).join('')}
 <div class="inline" style="margin-top:12px"><button class="btn primary" data-action="confirmWeeklyPlan" ${!prev.result.ok?'disabled':''}>この週の時間割を確定・保存</button><span class="help">確定すると、月〜金の臨時時間割を日付付きで保存します。授業実績は実施後に別途確定します。</span></div>`:''}
 </div>
 <div style="height:12px"></div>
 ${card('③ 確定した週の時間割',`<div class="table-wrap"><table class="table"><thead><tr><th>対象週</th><th>登録条件</th><th>移動件数</th><th>確定日時</th><th></th></tr></thead><tbody>${finalized.map(p=>`<tr><td>${p.weekStart}〜${weekDates(p.weekStart)[4]}</td><td>${p.absences.length}件</td><td>${p.changes.length}件</td><td>${fmtTime(p.confirmedAt)} ${weeklyConditionsMatch(state,p)?'<span class="badge ok">確定済</span>':'<span class="badge warn">条件変更・再編成必要</span>'}</td><td><button class="btn small" data-action="viewWeeklyPlan" data-id="${p.id}">内容を見る</button></td></tr>`).join('')||'<tr><td colspan="5">まだ確定していません。</td></tr>'}</tbody></table></div>`,'確定時の条件・変更内容・週の授業配置を保管します。確認済みの授業実績は変更しません。')}
 `;
}

async function generateWeeklyPlan(){
 const start=$('#weeklyTarget')?.value||state.ui.weeklyStart;
 if(!start)return toast('不在条件を登録して対象週を選択してください','warn');
 state.ui.weeklyStart=start;
 if(!(state.timetable.placements||[]).length)return toast('STEP09で基本時間割を編成してから実施してください','warn');
 const conditions=registeredConditions(state,start);
 if(!conditions.length)return toast('この週の不在条件がありません','warn');
 if(weekHasActuals(state,start))return toast('この週には確定済み授業実績があります。実績を保持するため再編成はできません','warn');
 const week=Number(conditions[0].week),signature=weeklyFingerprint(start);
 busy=true;render();
 try{
  const result=await replanTeacherWeek(state,week,conditions);
  if(signature!==weeklyFingerprint(start)){weeklyPreview=null;toast('計算中に条件が変わったため案を破棄しました','warn');return}
  weeklyPreview={weekStart:start,week,conditions:deepClone(conditions),result,signature,generatedAt:new Date().toISOString()};
  render();
  toast(result.ok?'週次の組み替え案を作成しました':`未解決${result.unresolved.length}件。条件の調整が必要です`,result.ok?'ok':'warn');
 }catch(err){console.error(err);toast(err.message||'週次再編成に失敗しました','err')}
 finally{busy=false;render()}
}
function confirmWeeklyPlan(){
 const prev=weeklyPreview;if(!prev||!prev.result.ok)return toast('未解決のない組み替え案を作成してください','warn');
 if(prev.signature!==weeklyFingerprint(prev.weekStart))return toast('条件または基本時間割が変更されました。変更案を再作成してください','warn');
 if(weekHasActuals(state,prev.weekStart))return toast('確定済みの授業実績があるため、週次時間割を上書きできません','warn');
 const dates=new Set(weekDates(prev.weekStart));
 const conflicts=(state.operations.temporarySchedules||[]).filter(t=>dates.has(t.date)&&t.source!=='weekly-replan');
 if(conflicts.length)return toast('対象週に手動の臨時時間割があります。内容を整理してから週次案を確定してください','warn');
 const old=(state.operations.weeklyPlans||[]).find(p=>p.weekStart===prev.weekStart);
 if(!confirm(`${prev.weekStart}からの週の授業配置を${old?'再':'新規'}確定します。出張等の不在${prev.conditions.length}件、授業移動${prev.result.changes.length}件。確定しますか？`))return;
 const now=new Date().toISOString();
 const plan={id:old?.id||uid('week'),weekStart:prev.weekStart,week:prev.week,absences:deepClone(prev.conditions),placements:deepClone(prev.result.placements),changes:deepClone(prev.result.changes),confirmedAt:now,history:old?.history||[]};
 if(old){plan.history.push({confirmedAt:old.confirmedAt,absences:deepClone(old.absences),placements:deepClone(old.placements),changes:deepClone(old.changes)});state.operations.weeklyPlans=state.operations.weeklyPlans.filter(x=>x.id!==old.id)}
 state.operations.weeklyPlans.push(plan);
 state.operations.temporarySchedules=(state.operations.temporarySchedules||[]).filter(t=>t.weeklyPlanId!==plan.id);
 state.operations.temporarySchedules.push(...weeklyTemporarySchedules(plan));
 weeklyPreview=null;scheduleSave();render();toast('週次時間割と月〜金の日付別予定を確定しました','ok');
}
function showWeeklyPlan(id){
 const p=(state.operations.weeklyPlans||[]).find(x=>x.id===id);if(!p)return;
 const rows=p.changes.map(c=>`<tr><td>${esc(c.className)}</td><td>${esc(c.subject)}</td><td>${esc(c.teacherNames.join('・'))}</td><td>${DAYS[c.fromDay]}${c.fromPeriod+1}限</td><td>${DAYS[c.toDay]}${c.toPeriod+1}限</td></tr>`).join('');
 openModal('確定済みの週次時間割',`<div class="notice info">${p.weekStart}〜${weekDates(p.weekStart)[4]}｜サイクル${p.week+1}週｜${p.absences.length}件の不在条件｜${p.changes.length}件の授業移動</div><div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th>学級</th><th>教科</th><th>担当教員</th><th>変更前</th><th>変更後</th></tr></thead><tbody>${rows||'<tr><td colspan="5">変更なし</td></tr>'}</tbody></table></div><div class="help">この週の実績入力はSTEP10の日別時間割から行ってください。確定した授業実績は再計算では書き換えません。</div>`,`<button class="btn" data-action="closeModal">閉じる</button>`);
}
function showWeeklyDayDetail(id){
 const x=state.operations.temporarySchedules.find(t=>t.id===id);if(!x)return;
 const plan=(state.operations.weeklyPlans||[]).find(p=>p.id===x.weeklyPlanId);
 const day=dateWeekday(x.date),stale=!weeklyConditionsMatch(state,plan);
 const rows=(x.placements||[]).filter(p=>p.week===x.week&&p.day===day).map(p=>{
  const l=lessonById(state,p.lessonId);
  return l?{p,l,teacherNames:(p.teacherIdsOverride?.length?p.teacherIdsOverride:l.teacherIds||[]).map(id=>teacherById(state,id)?.name||id)}:null;
 }).filter(Boolean);
 openModal('確定済みの日別時間割',`<div class="notice ${stale?'warn':'info'}">${stale?'不在条件が変更されています。週次時間割の再編成が必要です。':''}${x.date}｜${esc(x.label)}。この日は週次一括編成で確定したため、ここでは個別編集しません。再編成は週単位で行います。</div><div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th>時限</th><th>学級</th><th>教科</th><th>担当</th></tr></thead><tbody>${rows.sort((a,b)=>a.p.period-b.p.period).map(({p,l,teacherNames})=>`<tr><td>${p.period+1}限</td><td>${(l.classIds||[]).map(c=>esc(classById(state,c)?.name||c)).join('・')}</td><td>${esc(l.subject)}</td><td>${esc(teacherNames.join('・'))}</td></tr>`).join('')}</tbody></table></div><div class="help">週の確定日：${fmtTime(plan?.confirmedAt)}。実績は当日実施後に「実績入力」から確定してください。</div>`,`<button class="btn" data-action="closeModal">閉じる</button>`);
}
function renderOperations(){
 return pageHead('10 出張・欠勤と週次時間割','複数教員の不在条件を登録し、週の時間割をまとめて組み替えます。確定後、日別の授業実績に連動します。')+
 renderWeeklyPanel()+
 `<div style="height:12px"></div>`+
 card('日別の臨時時間割',`<div class="inline"><button class="btn" data-action="createTemporary">＋ 手動で臨時時間割を作成</button></div>
 <div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>日付</th><th>内容</th><th>変更</th><th>操作</th></tr></thead><tbody>${(state.operations.temporarySchedules||[]).slice().sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.label)}</td><td>${esc((x.changes||[]).map(c=>c.text).slice(0,2).join(' / '))}</td><td><button class="btn small" data-action="viewTemporary" data-id="${x.id}">確認・変更</button> <button class="btn small blue" data-action="recordActual" data-id="${x.id}">実績入力</button>${x.source==='weekly-replan'?'':` <button class="btn small danger" data-action="removeTemporary" data-id="${x.id}">削除</button>`}</td></tr>`).join('')||'<tr><td colspan="4">臨時時間割は未作成です。</td></tr>'}</tbody></table></div>`)+renderActualDashboard();
}

function renderActualDashboard(){
 const cls=classById(state,state.ui.actualClassId)||state.resources.classes[0];
 const progress=cls?subjectProgress(state,cls.grade,cls.id):[];
 const days=[...(state.operations.actualDays||[])].sort((a,b)=>b.date.localeCompare(a.date));
 return `<div style="height:14px"></div>
 ${card('日別の授業実績を確定',`<div class="notice info">授業の入替・代替・休止は臨時時間割で管理し、実施後に実績を確定してください。予定の変更だけでは実績に加算しません。</div>
 <div class="form-grid" style="margin-top:10px">
 ${field('実施日','<input type="date" id="actualBaseDate">','span4')}
 ${field('サイクル週',`<select id="actualBaseWeek">${Array.from({length:state.timetable.cycleWeeks},(_,i)=>`<option value="${i}">${i+1}週</option>`).join('')}</select>`,'span3')}
 <div class="field span5"><label>基本時間割から記録</label><button class="btn primary" data-action="recordBaseActual">実績入力を開く</button></div></div>
 <div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>日付</th><th>記録元</th><th>実施コマ</th><th>記録</th></tr></thead><tbody>
 ${days.map(d=>`<tr><td>${esc(d.date)}</td><td>${esc(d.sourceName||'基本時間割')}</td><td class="num">${d.rows.filter(r=>r.status==='held').length}</td><td><button class="btn small" data-action="reviseActual" data-date="${d.date}">内容確認・訂正</button> ${d.history?.length?`<span class="badge warn">訂正${d.history.length}回</span>`:''}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">まだ確定した授業実績はありません。</td></tr>'}</tbody></table></div>`)}
 <div style="height:12px"></div>
 ${card('学級別の年間授業時数｜計画と実績',`<div class="inline" style="margin-bottom:10px"><strong>学級</strong><select id="actualClassSelector" data-action="actualClassSelector">${state.resources.classes.map(c=>`<option value="${c.id}" ${cls?.id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select><span class="chip info">確定した授業のみ計上</span></div>
 <div class="table-wrap"><table class="table"><thead><tr><th>教科</th><th>年間計画</th><th>実施コマ</th><th>実施分数</th><th>標準時数換算</th><th>残り</th></tr></thead><tbody>${progress.map(p=>`<tr><td>${esc(p.subject)}</td><td class="num">${p.target}</td><td class="num">${p.periods}</td><td class="num">${p.minutes}</td><td class="num">${p.completed.toFixed(2)}</td><td class="num"><strong>${p.remaining.toFixed(2)}</strong></td></tr>`).join('')||'<tr><td colspan="6">授業設定がありません。</td></tr>'}</tbody></table></div>`,'小学校45分・中学校50分を標準1単位時間として換算します。中学校45分授業は1コマ＝0.90単位時間です。')}
 `;
}
function renderAbsenceResults(cache){
  if(!cache.affected?.length)return card('欠勤影響','<div class="notice ok">指定した教員はこの曜日に授業がありません。</div>');
  return card('変更案',`<div class="notice info">影響する授業：${cache.affected.length}件。案を採用すると「臨時時間割」として保存され、基本時間割はそのまま残ります。</div><div class="grid cols2" style="margin-top:10px">${cache.proposals.map((p,i)=>`<div class="card flat"><div class="inline"><h4>${esc(p.title)}</h4><span class="badge ${p.ok?'ok':'warn'} right">${p.ok?'成立':'要手動調整'}</span></div>${p.changes.map(c=>`<div class="constraint"><strong>${esc(c.type)}</strong><div class="meta">${esc(c.text)}</div></div>`).join('')}<div class="kpi-line"><span>HARD</span><strong>${p.metrics.hard.length}</strong></div><button class="btn ${p.ok?'green':'warn'}" data-action="applyAbsenceProposal" data-index="${i}" ${p.ok?'':'disabled'}>この案を臨時時間割に保存</button></div>`).join('')}</div>`);
}

function renderChecks(){
  const stats=calendarStats(state),issues=[...validateState(state,stats)];if(metricsCache){for(const h of metricsCache.hard||[])issues.push({level:'ERROR',code:'TT-HARD',title:'時間割HARD制約',desc:h.text});if(metricsCache.unplaced)issues.push({level:'ERROR',code:'TT-UNPLACED',title:'未配置授業があります',desc:`残り${metricsCache.unplaced}駒を配置してください。`});if((metricsCache.soft||0)>40)issues.push({level:'WARNING',code:'TT-SOFT',title:'時間割の配慮条件が多く残っています',desc:`SOFTコスト ${Math.round(metricsCache.soft)}。配置を確認してください。`})}
  const ec={ERROR:issues.filter(x=>x.level==='ERROR').length,WARNING:issues.filter(x=>x.level==='WARNING').length,INFO:issues.filter(x=>x.level==='INFO').length};
  return pageHead('11 最終チェック','制度・入力整合・時間割成立性をまとめて確認します。ERRORは校内確定前に解消する想定です。',`<span class="chip ${ec.ERROR?'err':'ok'}">ERROR ${ec.ERROR}</span><span class="chip ${ec.WARNING?'warn':'ok'}">WARNING ${ec.WARNING}</span>`)+
  `<div class="grid cols3">${metric('ERROR',ec.ERROR,'件')}${metric('WARNING',ec.WARNING,'件')}${metric('時間割スコア',metricsCache?.score??'-','/100')}</div><div style="height:12px"></div>${card('確認事項',`<div class="issue-list">${issues.map(x=>`<div class="issue"><span class="badge ${x.level==='ERROR'?'err':x.level==='WARNING'?'warn':'info'}">${x.level}</span><div><div class="title">${esc(x.title)}</div><div class="desc">${esc(x.desc)}</div></div><div class="code mono">${esc(x.code)}</div></div>`).join('')||'<div class="notice ok">現在、確認事項はありません。</div>'}</div>`)}`;
}

function renderReports(){
  const type=state.ui.reportType||'summary';return pageHead('12 帳票・保存','教育課程概要、年間カレンダー、授業時数、時間割を印刷/PDF保存できます。端末・Driveへのバックアップもここで管理します。')+
  `<div class="grid cols3"><div class="card"><h3>帳票</h3><div class="field"><label>帳票種類</label><select id="reportType" data-action="reportType">${[['summary','教育課程編成概要'],['calendar','年間カレンダー'],['hours','授業時数配当表'],['actuals','授業実績・残時数'],['timetable','時間割表'],['teachers','教員時間割一覧'],['facilities','施設時間割一覧']].map(([v,l])=>`<option value="${v}" ${type===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="inline" style="margin-top:10px"><button class="btn primary" data-action="printReport">印刷 / PDF</button><button class="btn" data-action="exportJson">JSON</button></div></div>
  <div class="card"><h3>Google Drive</h3><div class="kpi-line"><span>最終同期</span><strong>${fmtTime(state.drive.lastSyncAt)}</strong></div><div class="inline" style="margin-top:10px"><button class="btn" data-action="openDrive">Drive設定・同期</button></div></div>
  <div class="card"><h3>ローカルデータ</h3><div class="kpi-line"><span>自動保存</span><strong>IndexedDB</strong></div><div class="inline" style="margin-top:10px"><button class="btn" data-action="importJson">バックアップを復元</button><button class="btn danger" data-action="resetAll">初期化</button></div></div></div>
  <div style="height:12px"></div><div class="card"><div class="toolbar"><strong>プレビュー</strong><span class="muted">ブラウザの印刷からPDF保存できます。</span></div><div id="reportPreview" style="overflow:auto"></div></div>`;
}
function renderReportPreview(){const el=$('#reportPreview');if(!el)return;const type=state.ui.reportType||'summary';let opts={};if(type==='timetable')opts={kind:state.timetable.view.kind,id:state.timetable.view.id};el.innerHTML=reportByType(state,type,opts)}

function openModal(title,body,buttons=''){const root=$('#modalRoot');root.innerHTML=`<div class="modal-backdrop" data-action="closeModal"><div class="modal"><div class="modal-head"><h3>${esc(title)}</h3><button class="btn icon" data-action="closeModal">×</button></div><div class="modal-body">${body}</div>${buttons?`<div class="modal-foot">${buttons}</div>`:''}</div></div>`}
function closeModal(){$('#modalRoot').innerHTML=''}
function selectedValues(name){return $$(`[name="${name}"]:checked`).map(x=>x.value)}
function gridUnavailable(values=[],prefix='u'){const max=Math.min(state.periods.length,state.instruction.maxPeriods);return `<div class="table-wrap"><table class="table"><thead><tr><th>時限</th>${DAYS.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>${Array.from({length:max},(_,p)=>`<tr><th>${p+1}限</th>${DAYS.map((d,day)=>{const k=`${day}-${p}`;return `<td class="center"><input type="checkbox" name="${prefix}" value="${k}" ${values.includes(k)?'checked':''}></td>`}).join('')}</tr>`).join('')}</tbody></table></div>`}

async function handleClick(e){
  const nav=e.target.closest('[data-nav]');if(nav){state.ui.page=nav.dataset.nav;scheduleSave();render();return}
  const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;
  try{
    if(a==='closeModal'){if(b.classList.contains('modal-backdrop')&&e.target!==b)return;closeModal();return}
    if(a==='openDrive'){showDriveModal();return}
    if(a==='exportJson'){const name=`${(state.school.name||'school').replace(/\s/g,'_')}_${state.school.fiscalYear}_curriculum.json`;downloadText(name,JSON.stringify(state,null,2));toast('JSONバックアップを保存しました','ok');return}
    if(a==='importJson'){importJsonDialog();return}
    if(a==='addFocus'){state.goals.focusItems.push({id:uid('focus'),label:'新しい重点',text:''});scheduleSave();render();return}
    if(a==='removeFocus'){state.goals.focusItems.splice(Number(b.dataset.index),1);scheduleSave();render();return}
    if(a==='addCalendarException'){showCalendarExceptionModal();return}
    if(a==='removeException'){state.calendar.exceptions=state.calendar.exceptions.filter(x=>x.id!==b.dataset.id);scheduleSave();render();return}
    if(a==='addEvent'){showEventModal();return}
    if(a==='removeEvent'){state.calendar.events=state.calendar.events.filter(x=>x.id!==b.dataset.id);for(const p of state.integrated.plans)p.linkedEventIds=(p.linkedEventIds||[]).filter(id=>id!==b.dataset.id);scheduleSave();render();return}
    if(a==='addIntegrated'){state.integrated.plans.push({id:uid('int'),grade:1,title:'',hours:50,linkedEventIds:[]});scheduleSave();render();return}
    if(a==='removeIntegrated'){state.integrated.plans.splice(Number(b.dataset.index),1);scheduleSave();render();return}
    if(a==='editIntegrated'){showIntegratedModal(Number(b.dataset.index));return}
    if(a==='addPeriod'){state.periods.push({id:uid('p'),name:`${state.periods.length+1}限`,start:'',end:''});state.instruction.maxPeriods=Math.min(state.periods.length,7);scheduleSave();render();return}
    if(a==='removePeriod'){if(state.periods.length<=1)return toast('時限は1つ以上必要です','warn');state.periods.splice(Number(b.dataset.index),1);state.instruction.maxPeriods=Math.min(state.instruction.maxPeriods,state.periods.length);scheduleSave();render();return}
    if(a==='resourceTab'){state.ui.resourceTab=b.dataset.tab;scheduleSave();render();return}
    if(a==='addClass'){const grade=state.hourPlans[0]?.grade||1;const names=new Set(state.resources.classes.map(c=>c.name));let i=1;while(names.has(`${grade}年${i}組`))i++;const c={id:uid('c'),grade,name:`${grade}年${i}組`};state.resources.classes.push(c);const result=reconcileCurriculumLessons(state,grade);state.timetable.lastResult=null;scheduleSave();render();refreshMetrics();toast(`${c.name}を追加し、${result.created}件の授業を作成しました。担当教員を設定してください`,'ok');return}
    if(a==='syncCurriculumLessons'){const result=reconcileCurriculumLessons(state);state.timetable.lastResult=null;scheduleSave();render();refreshMetrics();toast(`不足授業${result.created}件を生成・既存${result.updated}件の時数を更新しました。既存配置は保持しています`,'ok');return}
    if(a==='removeClass'){const id=b.dataset.id,c=classById(state,id);if(!c)return;const impacted=state.lessons.filter(l=>l.classIds?.includes(id));if(impacted.length&&!confirm(`${c.name}に紐づく授業${impacted.length}件と配置を整理して学級を削除します。バックアップ後に実行してください。続けますか？`))return;const only=new Set(impacted.filter(l=>l.classIds.length===1).map(l=>l.id));for(const l of impacted)if(l.classIds.length>1)l.classIds=l.classIds.filter(cid=>cid!==id);discardLessonIds(only);state.resources.classes=state.resources.classes.filter(x=>x.id!==id);state.timetable.lastResult=null;scheduleSave();render();refreshMetrics();return}
    if(a==='addTeacher'){state.resources.teachers.push({id:uid('t'),name:'新規教員',role:'',roles:[],subjects:[],unavailable:[],leaves:[],maxDaily:5,maxConsecutive:3,consecutiveHard:false,substituteEligible:true,breakRule:{enabled:false,startPeriod:3,endPeriod:4,minFreeSlots:1,hard:false}});scheduleSave();render();return}
    if(a==='removeTeacher'){const id=b.dataset.id;if(state.lessons.some(l=>l.teacherIds?.includes(id)))return toast('授業設定で使用中の教員は削除できません','warn');state.resources.teachers=state.resources.teachers.filter(x=>x.id!==id);scheduleSave();render();return}
    if(a==='teacherMaster'){showTeacherMasterModal(b.dataset.id);return}
    if(a==='teacherConstraints'){showTeacherConstraints(b.dataset.id);return}
    if(a==='saveTeacherMaster'){const t=teacherById(state,b.dataset.id);if(t){t.subjects=selectedValues('teacherMasterSubjects');t.roles=selectedValues('teacherMasterRoles');closeModal();scheduleSave();render();refreshMetrics()}return}
    if(a==='addDiscretionary'){
      const grade=Number(b.dataset.grade),kind=$('#allocKind_'+grade)?.value,hours=Math.round(n($('#allocHours_'+grade)?.value)),note=$('#allocNote_'+grade)?.value.trim()||'',ledger=discretionaryLedger(state,grade);
      if(!(hours>0))return toast('配分時数を1時間以上で指定してください','warn');
      if(hours>ledger.remaining)return toast(`裁量時間の残高は${ledger.remaining}時間です。超過配分できません`,'warn');
      const caps=discretionaryCaps(state,grade);
      if(kind==='learning'&&caps.total+hours>70)return toast('学習枠・研修枠の合計は70コマまでです','warn');
      if(kind==='training'&&(caps.total+hours>70||caps.training+hours>35))return toast('裁量的な時間は合計70コマ、研究・研修等枠は35コマまでです','warn');
      let subject='';
      if(kind==='subject')subject=$('#allocSubject_'+grade)?.value||'';
      if(kind==='new_subject'){subject=$('#allocNewSubject_'+grade)?.value.trim();if(!subject)return toast('新設教科名を入力してください','warn')}
      if(kind==='learning')subject='学習枠';
      if(kind==='training')subject='';
      if(kind!=='training'&&!subject)return toast('教科・枠を指定してください','warn');
      if(subject&&!(state.masters.subjects||[]).some(x=>x.name===subject)){const id=uid('sub');state.masters.subjects.push({id,name:subject,category:kind==='learning'?'学習枠':'学校設定教科',custom:true,active:true})}
      if(subject){const hp=state.hourPlans.find(x=>Number(x.grade)===grade);if(hp&&!hp.subjects.some(x=>x.name===subject))hp.subjects.push({id:uid('sub'),name:subject,hours:0,adjustment:0})}
      state.adjusted.allocations.push({id:uid('alloc'),grade,kind,subject,hours,note});
      if(subject)syncSubjectLessons(grade,subject);
      metricsCache=null;absenceCache=null;scheduleSave();render();refreshMetrics();return;
    }
    if(a==='removeDiscretionary'){
      const a0=state.adjusted.allocations.find(x=>x.id===b.dataset.id);if(!a0)return;
      state.adjusted.allocations=state.adjusted.allocations.filter(x=>x.id!==a0.id);
      if(a0.subject)syncSubjectLessons(a0.grade,a0.subject);
      metricsCache=null;absenceCache=null;scheduleSave();render();refreshMetrics();return;
    }
    if(a==='addSubjectMaster'){const name=$('#newSubjectName')?.value.trim(),category=$('#newSubjectCategory')?.value||'学校設定教科';if(!name)return toast('教科・領域名を入力してください','warn');if((state.masters.subjects||[]).some(x=>x.name===name))return toast('同名の教科・領域が登録済みです','warn');const id=uid('sub');state.masters.subjects.push({id,name,category,custom:true,active:true});for(const hp of state.hourPlans)if(!(hp.subjects||[]).some(x=>x.name===name))hp.subjects.push({id,name,hours:0,adjustment:0});scheduleSave();render();toast(`${name}を教科マスタと授業時数表に追加しました。STEP05で時数を指定すると授業設定も生成します`,'ok');return}
    if(a==='removeSubjectMaster'){const x=(state.masters.subjects||[]).find(y=>y.id===b.dataset.id);if(!x||!x.custom)return;const usedLesson=state.lessons.some(l=>l.subject===x.name),usedTeacher=state.resources.teachers.some(t=>(t.subjects||[]).includes(x.name)),usedHours=state.hourPlans.some(hp=>(hp.subjects||[]).some(q=>q.name===x.name&&(n(q.hours)||n(q.adjustment))));if(usedLesson||usedTeacher||usedHours)return toast('授業・教員・授業時数で使用中のため削除できません','warn');state.masters.subjects=state.masters.subjects.filter(y=>y.id!==x.id);for(const hp of state.hourPlans)hp.subjects=(hp.subjects||[]).filter(q=>q.name!==x.name);scheduleSave();render();return}
    if(a==='addRoleMaster'){const name=$('#newRoleName')?.value.trim();if(!name)return toast('役割名を入力してください','warn');if((state.masters.roles||[]).some(x=>x.name===name))return toast('同名の役割が登録済みです','warn');state.masters.roles.push({id:uid('role'),name,custom:true,active:true});scheduleSave();render();toast(`${name}を役割マスタに追加しました`,'ok');return}
    if(a==='removeRoleMaster'){const x=(state.masters.roles||[]).find(y=>y.id===b.dataset.id);if(!x||!x.custom)return;if(state.resources.teachers.some(t=>(t.roles||[]).includes(x.name)))return toast('教員に割り当て済みのため削除できません','warn');state.masters.roles=state.masters.roles.filter(y=>y.id!==x.id);scheduleSave();render();return}
    if(a==='addFacility'){state.resources.facilities.push({id:uid('f'),name:'新規施設',kind:'facility',capacity:1,unavailable:[]});scheduleSave();render();return}
    if(a==='removeFacility'){const id=b.dataset.id;if(state.lessons.some(l=>l.facilityId===id))return toast('授業設定で使用中の施設は削除できません','warn');state.resources.facilities=state.resources.facilities.filter(x=>x.id!==id);scheduleSave();render();return}
    if(a==='facilityConstraints'){showFacilityConstraints(b.dataset.id);return}
    if(a==='addLesson'){showLessonModal(null);return}
    if(a==='editLesson'){showLessonModal(b.dataset.id);return}
    if(a==='removeLesson'){const id=b.dataset.id;state.lessons=state.lessons.filter(x=>x.id!==id);state.timetable.placements=state.timetable.placements.filter(x=>x.lessonId!==id);scheduleSave();render();refreshMetrics();return}
    if(a==='exportLessonCsv'){exportLessonCsv();return}
    if(a==='importLessonCsv'){importLessonCsvDialog();return}
    if(a==='scheduleViewKind'){state.timetable.view.kind=b.dataset.kind;const opts=b.dataset.kind==='class'?state.resources.classes:b.dataset.kind==='teacher'?state.resources.teachers:state.resources.facilities;state.timetable.view.id=opts[0]?.id||'';scheduleSave();render();return}
    if(a==='scheduleWeek'){state.timetable.view.week=Number(b.dataset.week);scheduleSave();render();return}
    if(a==='selectPlacement'){state.timetable.selectedPlacementId=b.dataset.id;render();return}
    if(a==='autoSchedule'){await runAutoSchedule(b.dataset.mode||'rebuild');return}
    if(a==='toggleLock'){const p=state.timetable.placements.find(x=>x.id===b.dataset.id);if(p){const next=!p.locked;for(const q of state.timetable.placements)if((p.blockId&&q.blockId===p.blockId)||(!p.blockId&&q.id===p.id))q.locked=next;scheduleSave();render()}return}
    if(a==='removePlacement'){removePlacementGroup(b.dataset.id);return}
    if(a==='undoSchedule'){undoSchedule();return}
    if(a==='redoSchedule'){redoSchedule();return}
    if(a==='generateAbsence'){await generateAbsence();return}
    if(a==='applyAbsenceProposal'){applyAbsenceProposal(Number(b.dataset.index));return}
    if(a==='createTemporary'){showTemporaryModal();return}
    if(a==='viewTemporary'){const x=state.operations.temporarySchedules.find(t=>t.id===b.dataset.id);if(x?.source==='weekly-replan')showWeeklyDayDetail(b.dataset.id);else showTemporaryDetail(b.dataset.id);return}
    if(a==='switchToSingleWeek'){
      if(Number(state.timetable.cycleWeeks)===1)return;
      if((state.operations.weeklyPlans||[]).length||(state.operations.absences||[]).length||(state.operations.temporarySchedules||[]).length)return toast('日付別変更予定・登録済み不在があるため切替できません。週次記録を整理してください','warn');
      if((state.lessons||[]).some(l=>l.cycleSessionsOverride!==null&&l.cycleSessionsOverride!==undefined&&l.cycleSessionsOverride!==''))return toast('授業ごとのサイクルコマ数上書きを解除してから統一してください','warn');
      if(!confirm('基本時間割の配置を解除して毎週共通の1週間時間割に変更します。実施済みの授業実績は残します。必要であれば先にSTEP12でJSONバックアップを保存してください。続けますか？'))return;
      state.timetable.cycleWeeks=1;state.instruction.cycleWeeks=1;
      state.timetable.placements=[];state.timetable.view.week=0;state.timetable.undo=[];state.timetable.redo=[];state.timetable.lastResult=null;state.timetable.selectedPlacementId=null;
      weeklyPreview=null;metricsCache=null;scheduleSave();render();refreshMetrics();
      toast('1週間固定に統一しました。STEP09で基本時間割を再編成してください','ok');return;
    }
    if(a==='addWeeklyAbsence'){
      const item={id:uid('absence'),teacherId:$('#weeklyTeacher')?.value,date:$('#weeklyDate')?.value,segment:$('#weeklySegment')?.value,week:Number($('#weeklyCycle')?.value)};
      validateAbsence(state,item);
      state.operations.absences.push(item);state.ui.weeklyStart=mondayFor(item.date);weeklyPreview=null;scheduleSave();render();toast('不在条件を登録しました','ok');return;
    }
    if(a==='removeWeeklyAbsence'){
      const item=(state.operations.absences||[]).find(x=>x.id===b.dataset.id);if(!item)return;
      if((state.operations.weeklyPlans||[]).some(p=>p.weekStart===mondayFor(item.date))&&!confirm('この週には確定済みの変更案があります。条件を変更したら週全体を再編成してください。削除しますか？'))return;
      state.operations.absences=state.operations.absences.filter(x=>x.id!==item.id);
      weeklyPreview=null;scheduleSave();render();return;
    }
    if(a==='generateWeeklyPlan'){await generateWeeklyPlan();return}
    if(a==='confirmWeeklyPlan'){confirmWeeklyPlan();return}
    if(a==='viewWeeklyPlan'){showWeeklyPlan(b.dataset.id);return}
    if(a==='recordActual'){
      const x=state.operations.temporarySchedules.find(y=>y.id===b.dataset.id);if(!x)return;
      if(x.source==='weekly-replan'){const p=(state.operations.weeklyPlans||[]).find(p=>p.id===x.weeklyPlanId);if(!weeklyConditionsMatch(state,p))return toast('不在条件が確定時から変更されています。週次時間割を再編成してから実績を入力してください','warn')}
      showActualModal({date:x.date,week:x.week,placements:x.placements,sourceId:x.id,sourceName:x.label});return;
    }
    if(a==='recordBaseActual'){showActualModal({date:$('#actualBaseDate')?.value,week:Number($('#actualBaseWeek')?.value||0),placements:state.timetable.placements});return}
    if(a==='reviseActual'){const x=(state.operations.actualDays||[]).find(d=>d.date===b.dataset.date);if(x)showActualModal({date:x.date,week:x.week,sourceId:x.sourceId,sourceName:x.sourceName,correction:true});return}
    if(a==='removeTemporary'){state.operations.temporarySchedules=state.operations.temporarySchedules.filter(x=>x.id!==b.dataset.id);scheduleSave();render();return}
    if(a==='printReport'){printCurrentReport();return}
    if(a==='resetAll'){if(confirm('端末内データを初期化します。先にJSONバックアップを保存することをおすすめします。')){mutationRevision++;state=defaultState();await saveState(state);metricsCache=null;absenceCache=null;render();refreshMetrics()}return}
    if(a==='saveDrive'){await doSaveDrive();return}
    if(a==='loadDrive'){await doLoadDrive();return}
  }catch(err){console.error(err);toast(err.message||String(err),'err')}
}
function handleChange(e){
  const path=e.target.dataset.bind;
  if(e.target.dataset.hoursAdjust){const [pi,si]=e.target.dataset.hoursAdjust.split('-').map(Number);updateHourAdjustment(pi,si,e.target.value);return}
  if(e.target.dataset.hoursNumber){const [pi,si]=e.target.dataset.hoursNumber.split('-').map(Number);updateHourAdjustment(pi,si,e.target.value);return}
  if(path==='timetable.cycleWeeks'){
    const next=Number(e.target.value),prior=Number(state.timetable.cycleWeeks||1);
    if(next===prior)return;
    const hasPlans=(state.operations.weeklyPlans||[]).length||(state.operations.absences||[]).length||(state.operations.temporarySchedules||[]).length;
    const hasPlacements=(state.timetable.placements||[]).length>0;
    const hasOverride=(state.lessons||[]).some(l=>l.cycleSessionsOverride!==null&&l.cycleSessionsOverride!==undefined&&l.cycleSessionsOverride!=='');
    if(hasPlans||hasPlacements||hasOverride){
      toast('配置済み時間割・週次予定・授業コマ上書きがあるため、サイクルを直接変更できません','warn');
      e.target.value=String(prior);return;
    }
    state.timetable.cycleWeeks=next;state.instruction.cycleWeeks=next;
    state.timetable.view.week=0;state.timetable.undo=[];state.timetable.redo=[];state.timetable.lastResult=null;
    weeklyPreview=null;scheduleSave();render();refreshMetrics();
    toast(next===1?'毎週共通の時間割に切り替えました':'特別運用の時間割サイクルへ切り替えました','ok');return;
  }
  const gradeChange=path?.match(/^resources\.classes\.(\d+)\.grade$/);
  if(gradeChange){
    const index=Number(gradeChange[1]),cls=state.resources.classes[index],next=Math.round(Number(e.target.value)),old=Number(cls?.grade),max=state.school.type==='elementary'?6:3;
    if(!cls)return;
    if(!Number.isInteger(next)||next<1||next>max){toast('学年が校種の範囲外です','warn');e.target.value=old;return}
    if(next===old)return;
    if(!confirm('学年を変更すると、この学級の授業定義と配置を解除して新学年の授業を生成します。JSONバックアップを保存してから実施してください。続けますか？')){e.target.value=old;return}
    const affected=state.lessons.filter(l=>(l.classIds||[]).includes(cls.id));
    const removedIds=new Set(affected.filter(l=>l.classIds.length===1).map(l=>l.id));
    for(const l of affected)if(l.classIds.length>1)l.classIds=l.classIds.filter(id=>id!==cls.id);
    discardLessonIds(removedIds);
    cls.grade=next;
    const result=reconcileCurriculumLessons(state,next);
    state.timetable.undo=[];state.timetable.redo=[];state.timetable.lastResult=null;
    scheduleSave();render();refreshMetrics();toast(`${result.created}件の新学年授業を追加しました`,'ok');return;
  }
  if(path==='school.type'){
    const next=e.target.value;
    if(!confirm('校種を変更すると、既存の教員・授業・時間割・学校独自マスタが初期化されます。先にJSONバックアップを保存してください。変更しますか？')){e.target.value=state.school.type;return}
    applySchoolTypeDefaults(state,next);state.adjusted.allocations=[];
    metricsCache=null;absenceCache=null;
    scheduleSave();render();refreshMetrics();
    toast(next==='elementary'?'小学校の教科・標準時数・45分基準へ切り替えました':'中学校の教科・標準時数・50分基準へ切り替えました','ok');
    return;
  }
  if(path&&e.target.dataset.rerender!==undefined){const hm=path.match(/^hourPlans\\.(\\d+)\\.subjects\\.(\\d+)\\.hours$/);if(hm){const hp=state.hourPlans[Number(hm[1])],subj=hp?.subjects[Number(hm[2])];if(subj){subj.adjustment=Math.max(-n(subj.hours),n(subj.adjustment));syncSubjectLessons(hp.grade,subj.name)}}state.updatedAt=new Date().toISOString();scheduleSave();render();if(['resources','timetable','days','hours','basic'].includes(state.ui.page))refreshMetrics()}
  const a=e.target.dataset.action;
  if(a==='scheduleViewId'){state.timetable.view.id=e.target.value;scheduleSave();render()}
  if(a==='reportType'){state.ui.reportType=e.target.value;scheduleSave();renderReportPreview()}
  if(a==='weeklyTarget'){state.ui.weeklyStart=e.target.value;weeklyPreview=null;scheduleSave();render();return}
  if(a==='actualClassSelector'){state.ui.actualClassId=e.target.value;scheduleSave();render()}
  if(a==='allocKind'){const g=Number(e.target.dataset.grade),el=$('#allocNewSubject_'+g);if(el)el.placeholder=e.target.value==='new_subject'?'新設教科の名称を入力':'新設教科を選択するときだけ入力';}
  if(a==='assignmentTeacher'){const l=lessonById(state,e.target.dataset.lessonId);if(l){const tid=e.target.value;l.teacherIds=tid?[tid]:[];metricsCache=null;absenceCache=null;state.timetable.lastResult=null;scheduleSave();refreshMetrics();render();toast('担当教員を更新しました。既存の時間割は保持し、制約を再確認します','ok')}}
  if(a==='assignmentBlock'){const l=lessonById(state,e.target.dataset.lessonId);if(l){const oldBlock=l.blockSize||1;l.blockSize=Math.max(1,Math.min(3,Number(e.target.value||1)));const affected=state.timetable.placements.filter(p=>p.lessonId===l.id);if(affected.length&&!confirm('この授業の配置済みコマだけ解除して連続ブロックを再編成します。続けますか？')){l.blockSize=oldBlock;render();return}pushUndo();const groupIds=new Set(affected.map(p=>p.blockId).filter(Boolean));state.timetable.placements=state.timetable.placements.filter(p=>p.lessonId!==l.id&&!groupIds.has(p.blockId));metricsCache=null;scheduleSave();refreshMetrics();render()}}
}
function handleDragStart(e){const l=e.target.closest('[data-drag-lesson]'),p=e.target.closest('[data-drag-placement]');if(l)e.dataTransfer.setData('application/json',JSON.stringify({type:'lesson',id:l.dataset.dragLesson}));if(p)e.dataTransfer.setData('application/json',JSON.stringify({type:'placement',id:p.dataset.dragPlacement}))}
async function handleDrop(e){const cell=e.target.closest('[data-drop]');if(!cell||busy)return;e.preventDefault();cell.classList.remove('drop-target');let data;try{data=JSON.parse(e.dataTransfer.getData('application/json'))}catch{return}const target={week:Number(cell.dataset.week),day:Number(cell.dataset.day),period:Number(cell.dataset.period)};const startedRevision=mutationRevision;busy=true;
 try{
  let r;
  if(data.type==='lesson')r=await placeLesson(state,data.id,target);
  else if(data.type==='placement')r=await movePlacement(state,data.id,target);
  else return;
  if(startedRevision!==mutationRevision)return toast('操作中に設定が変わったため、古い時間割変更を破棄しました','warn');
  if(!r.ok)return toast((r.conflicts||[]).map(x=>x.text).join(' / '),'warn');
  applyPlacements(r.placements);
 }finally{busy=false}}

async function runAutoSchedule(mode){
 if(busy)return;
 const problems=validateState(state,calendarStats(state)).filter(x=>x.level==='ERROR');
 if(problems.length){state.ui.page='checks';scheduleSave();render();toast(`入力・時数のエラーが${problems.length}件あります。STEP11で確認してください`,'warn');return}
 const startedRevision=mutationRevision;busy=true;render();
 try{const r=await solveSchedule(state,mode);if(startedRevision!==mutationRevision){toast('編成中に設定が変更されたため古い結果を破棄しました','warn');return}pushUndo();state.timetable.placements=r.placements;metricsCache=r.metrics;state.timetable.lastResult={at:new Date().toISOString(),mode,metrics:r.metrics};state.updatedAt=new Date().toISOString();scheduleSave();metricsCache=r.metrics;toast(r.metrics.unplaced?`編成しました。未配置 ${r.metrics.unplaced}駒`:'時間割を編成しました','ok')}finally{busy=false;render()}}
function undoSchedule(){const u=state.timetable.undo||[];if(!u.length)return;state.timetable.redo=state.timetable.redo||[];state.timetable.redo.push(deepClone(state.timetable.placements));state.timetable.placements=u.pop();state.timetable.selectedPlacementId=null;scheduleSave();refreshMetrics();render()}
function redoSchedule(){const r=state.timetable.redo||[];if(!r.length)return;state.timetable.undo=state.timetable.undo||[];state.timetable.undo.push(deepClone(state.timetable.placements));state.timetable.placements=r.pop();state.timetable.selectedPlacementId=null;scheduleSave();refreshMetrics();render()}
function removePlacementGroup(id){const p=state.timetable.placements.find(x=>x.id===id);if(!p)return;const l=lessonById(state,p.lessonId),group=p.blockId?state.timetable.placements.filter(x=>x.blockId===p.blockId):[p];if(group.some(x=>x.locked))return toast('固定を解除してから外してください','warn');pushUndo();if(p.blockId)state.timetable.placements=state.timetable.placements.filter(x=>x.blockId!==p.blockId);else if(l?.syncGroup){state.timetable.placements=state.timetable.placements.filter(x=>{const q=lessonById(state,x.lessonId);return !(q?.syncGroup===l.syncGroup&&x.week===p.week&&x.day===p.day&&x.period===p.period)})}else state.timetable.placements=state.timetable.placements.filter(x=>x.id!==id);state.timetable.selectedPlacementId=null;scheduleSave();refreshMetrics();render()}
async function generateAbsence(){const tid=$('#absenceTeacher')?.value,w=n($('#absenceWeek')?.value),d=n($('#absenceDay')?.value),date=$('#absenceDate')?.value||'';if(!tid)return;if(dateWeekday(date)<0||dateWeekday(date)>4)return toast('出張・欠勤の実施日を指定してください','warn');if(dateWeekday(date)!==d)return toast('指定日と曜日が一致していません','warn');const startedRevision=mutationRevision;busy=true;render();try{const proposal=await absenceProposals(state,tid,w,d);if(startedRevision!==mutationRevision)return toast('条件が変更されたため、古い欠勤変更案を破棄しました','warn');absenceCache=proposal;absenceCache.context={teacherId:tid,week:w,day:d,date};state.ui.absenceContext=absenceCache.context;toast(`変更案 ${absenceCache.proposals.length}件を作成しました`,'ok')}finally{busy=false;render()}}
function applyAbsenceProposal(i){const p=absenceCache?.proposals?.[i];if(!p)return;const ctx=absenceCache.context||state.ui.absenceContext||{};state.operations.temporarySchedules.push({id:uid('tmp'),date:ctx.date||'',label:`${teacherById(state,ctx.teacherId)?.name||'教員'} 欠勤対応`,week:ctx.week,day:ctx.day,placements:deepClone(p.placements),changes:deepClone(p.changes),createdAt:new Date().toISOString(),source:'absence'});state.operations.absences.push({id:uid('abs'),...ctx,proposal:p.title,createdAt:new Date().toISOString()});scheduleSave();toast('基本時間割を変更せず、臨時時間割として保存しました','ok');absenceCache=null;render()}

function showCalendarExceptionModal(){openModal('学校カレンダー例外を追加',`<div class="form-grid">${field('日付','<input type="date" id="exDate">','span4')}${field('区分',`<select id="exType"><option value="school_holiday">学校独自休業日</option><option value="substitute_holiday">振替休業日</option><option value="saturday_instruction">土曜授業日</option><option value="special_instruction">特別授業日</option><option value="closed">休業日</option><option value="national_override_off">特例休業日</option><option value="national_override_on">特例授業日</option></select>`,'span4')}${field('名称','<input id="exLabel" placeholder="例：学校公開の振替休業">','span4')}</div><div class="notice info" style="margin-top:10px">法定祝日は自動登録されます。法改正や特例的な休日がある場合は、ここで追加・上書きできます。</div>`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveCalendarException">追加</button>`)}
function showEventModal(){openModal('学校行事を追加',`<div class="form-grid">${field('日付','<input type="date" id="evDate">','span3')}${field('行事名','<input id="evName">','span5')}${field('区分',`<select id="evCategory"><option>儀式的行事</option><option>文化的行事</option><option>健康安全・体育的行事</option><option>旅行・集団宿泊的行事</option><option>勤労生産・奉仕的行事</option><option>その他</option></select>`,'span4')}${field('授業日扱い','<label class="inline"><input type="checkbox" id="evInstruction" checked> 授業日として数える</label>','span4')}</div>`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveEvent">追加</button>`)}
function showIntegratedModal(i){const p=state.integrated.plans[i];openModal('総合と学校行事の関連付け',`<div class="notice info">${esc(p.title||'総合的な学習')}</div><div class="grid cols2" style="margin-top:10px">${(state.calendar.events||[]).map(e=>`<label class="constraint"><input type="checkbox" name="intEvents" value="${e.id}" ${(p.linkedEventIds||[]).includes(e.id)?'checked':''}> <strong>${esc(e.date)} ${esc(e.name)}</strong><div class="meta">${esc(e.category||'')}</div></label>`).join('')}</div>`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveIntegratedLinks" data-index="${i}">保存</button>`)}

function showTeacherMasterModal(id){const t=teacherById(state,id);if(!t)return;const subjects=(state.masters?.subjects||[]).filter(x=>x.active!==false),roles=(state.masters?.roles||[]).filter(x=>x.active!==false);openModal(`${t.name}｜教科・役割`,`${card('担当可能教科',`<div class="grid cols3">${subjects.map(x=>`<label class="constraint" style="cursor:pointer"><input type="checkbox" name="teacherMasterSubjects" value="${attr(x.name)}" ${(t.subjects||[]).includes(x.name)?'checked':''}> <strong>${esc(x.name)}</strong><div class="meta">${esc(x.category||'教科')}${x.custom?' / 学校設定':''}</div></label>`).join('')}</div>`,'複数選択できます。ここでの選択は担当候補で、実際の学級担当は「担当割当」で指定します。')}<div style="height:10px"></div>${card('校務分掌・役割',`<div class="grid cols3">${roles.map(x=>`<label class="constraint" style="cursor:pointer"><input type="checkbox" name="teacherMasterRoles" value="${attr(x.name)}" ${(t.roles||[]).includes(x.name)?'checked':''}> <strong>${esc(x.name)}</strong>${x.custom?'<div class="meta">学校設定</div>':''}</label>`).join('')}</div>`,'学年主任＋学級担任など、複数の役割を同時に設定できます。')}`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveTeacherMaster" data-id="${id}">保存</button>`)}
function showTeacherConstraints(id){const t=teacherById(state,id);if(!t)return;const leaves=(t.leaves||[]).map((x,i)=>`<tr><td>${x.week==='all'?'毎週':`${Number(x.week)+1}週`}</td><td>${DAYS[x.day]}</td><td>${x.segment}</td><td><button class="btn small danger" data-action="deleteTeacherLeave" data-id="${id}" data-index="${i}">削除</button></td></tr>`).join('');openModal(`${t.name}｜個別条件`,`${card('授業不可時間',gridUnavailable(t.unavailable||[],'teacherUnavailable'),'チェックした時限には通常時間割を配置しません。')}
  <div style="height:10px"></div>${card('半休・全休・研究日',`<div class="table-wrap"><table class="table"><thead><tr><th>適用</th><th>曜日</th><th>区分</th><th></th></tr></thead><tbody>${leaves||'<tr><td colspan="4" class="muted">未設定</td></tr>'}</tbody></table></div><div class="form-grid" style="margin-top:8px">${field('週',`<select id="leaveWeek"><option value="all">毎週</option>${Array.from({length:state.timetable.cycleWeeks},(_,w)=>`<option value="${w}">${w+1}週</option>`).join('')}</select>`,'span4')}${field('曜日',`<select id="leaveDay">${DAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select>`,'span4')}${field('区分',`<select id="leaveSegment"><option value="FULL">全休</option><option value="AM">午前休</option><option value="PM">午後休</option></select>`,'span4')}</div><button class="btn small" data-action="addTeacherLeave" data-id="${id}">＋ 休暇条件を追加</button>`)}
  <div style="height:10px"></div>${card('休憩時間',`<label class="inline"><input type="checkbox" id="breakEnabled" ${t.breakRule?.enabled?'checked':''}> 休憩確保条件を使う</label><div class="form-grid" style="margin-top:8px">${field('対象開始時限',`<input type="number" min="1" max="${state.periods.length}" id="breakStart" value="${n(t.breakRule?.startPeriod,3)+1}">`,'span3')}${field('対象終了時限',`<input type="number" min="1" max="${state.periods.length}" id="breakEnd" value="${n(t.breakRule?.endPeriod,4)+1}">`,'span3')}${field('最低空きコマ',`<input type="number" min="1" id="breakSlots" value="${n(t.breakRule?.minFreeSlots,1)}">`,'span3')}${field('扱い',`<select id="breakHard"><option value="false" ${!t.breakRule?.hard?'selected':''}>配慮条件（SOFT）</option><option value="true" ${t.breakRule?.hard?'selected':''}>厳守条件（HARD）</option></select>`,'span3')}</div><div class="form-grid" style="margin-top:8px">${field('連続授業上限の扱い',`<select id="consecutiveHard"><option value="false" ${!t.consecutiveHard?'selected':''}>できるだけ避ける（SOFT）</option><option value="true" ${t.consecutiveHard?'selected':''}>超過禁止（HARD）</option></select>`,'span4')}${field('欠勤時の代替候補',`<label><input type="checkbox" id="substituteEligible" ${t.substituteEligible!==false?'checked':''}> 自習・課題対応の代替候補に含める</label>`,'span5')}</div>`,'指定した時間帯の中に、最低限の空きコマを確保します。')}`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveTeacherConstraints" data-id="${id}">保存</button>`)}
function showFacilityConstraints(id){const f=facilityById(state,id);if(!f)return;openModal(`${f.name}｜利用不可時間`,gridUnavailable(f.unavailable||[],'facilityUnavailable'),`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveFacilityConstraints" data-id="${id}">保存</button>`)}

function showLessonModal(id){const l=id?lessonById(state,id):{id:uid('l'),subject:'',name:'',classIds:[],teacherIds:[],facilityId:'normal',annualHours:35,cycleSessionsOverride:null,blockSize:1,type:'normal',syncGroup:'',allowTeacherTBD:false,allowFacilityTBD:false};const isNew=!id;openModal(isNew?'授業を追加':'授業を編集',`<div class="form-grid">${field('教科・授業名',`<select id="lessonSubject">${(state.masters?.subjects||[]).filter(x=>x.active!==false).map(x=>`<option value="${attr(x.name)}" ${l.subject===x.name?'selected':''}>${esc(x.name)}${x.custom?'（学校設定）':''}</option>`).join('')}${l.subject&&!(state.masters?.subjects||[]).some(x=>x.name===l.subject)?`<option value="${attr(l.subject)}" selected>${esc(l.subject)}（旧データ）</option>`:''}</select>`,'span4','新設教科は「教科・役割マスタ」で追加してください。')}${field('形態',`<select id="lessonType">${['normal','TT','joint','elective','parallel','resource','support'].map(x=>`<option value="${x}" ${l.type===x?'selected':''}>${x}</option>`).join('')}</select>`,'span2')}${field('年間時数',`<input type="number" id="lessonHours" value="${n(l.annualHours,35)}">`,'span2')}${field('サイクル駒数上書き',`<input type="number" id="lessonCycle" value="${l.cycleSessionsOverride??''}" placeholder="自動">`,'span2','空欄なら年間時数÷授業週数から自動算出')}${field('連続コマ',`<select id="lessonBlock"><option value="1" ${Number(l.blockSize||1)===1?'selected':''}>1コマ</option><option value="2" ${Number(l.blockSize||1)===2?'selected':''}>2コマ連続</option><option value="3" ${Number(l.blockSize||1)===3?'selected':''}>3コマ連続</option></select>`,'span2','総合・実技等を連続ブロックで配置')}
  ${field('対象学級',`<div class="grid cols3">${state.resources.classes.map(c=>`<label class="constraint"><input type="checkbox" name="lessonClasses" value="${c.id}" ${(l.classIds||[]).includes(c.id)?'checked':''}> ${esc(c.name)}</label>`).join('')}</div>`,'span12')}
  ${field('担当教員',`<div class="grid cols3">${state.resources.teachers.map(t=>`<label class="constraint"><input type="checkbox" name="lessonTeachers" value="${t.id}" ${(l.teacherIds||[]).includes(t.id)?'checked':''}> ${esc(t.name)}</label>`).join('')}</div>`,'span12')}
  ${field('使用教室・施設',`<select id="lessonFacility"><option value="">未定</option>${state.resources.facilities.map(f=>`<option value="${f.id}" ${l.facilityId===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select>`,'span5')}${field('同時展開グループ',`<input id="lessonSync" value="${attr(l.syncGroup||'')}" placeholder="例：SEL-G1">`,'span4','同じ文字列の授業を同一時限に配置します。')}${field('仮配置',`<label><input type="checkbox" id="lessonTeacherTBD" ${l.allowTeacherTBD?'checked':''}> 教員未定を許可</label><br><label><input type="checkbox" id="lessonFacilityTBD" ${l.allowFacilityTBD?'checked':''}> 施設未定を許可</label>`,'span3')}
  ${field('授業を置けない時限',gridUnavailable(l.unavailable||[],'lessonUnavailable'),'span12','教科・授業固有の禁制時間です。')}</div><div class="notice info" style="margin-top:10px">TTは複数教員を選択、合同授業は複数学級を1授業に設定、選択・展開授業は複数の授業に同じ「同時展開グループ」を設定します。</div>`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveLesson" data-id="${l.id}" data-new="${isNew?'1':'0'}">保存</button>`)}

async function temporaryNewConflicts(before,after,allowPlannedGap=false){
 const m=placements=>({...state,timetable:{...state.timetable,placements}});
 const [oldMetrics,newMetrics]=await Promise.all([scheduleMetrics(m(before)),scheduleMetrics(m(after))]);
 const prior=new Set((oldMetrics.hard||[]).map(h=>h.type+'|'+h.text));
 const introduced=(newMetrics.hard||[]).find(h=>h.type!=='overplaced'&&!(allowPlannedGap&&h.type==='class-gap')&&!prior.has(h.type+'|'+h.text));
 return introduced?.text||'';
}

let actualDraftRows=null;
function showActualModal({date,week,placements=[],sourceId=null,sourceName='基本時間割',correction=false}){
 if(dateWeekday(date)<0||dateWeekday(date)>4)return toast('月曜から金曜の有効な日付を指定してください','warn');
 const old=(state.operations.actualDays||[]).find(d=>d.date===date);
 if(old&&!correction)return toast('この日は実績確定済みです。「内容確認・訂正」から開いてください','warn');
 let rows;
 try{rows=correction?deepClone(old.rows):actualDayRows(state,{date,week,placements})}catch(err){return toast(err.message,'warn')}
 if(!rows?.length)return toast('この日の時間割に授業がありません。日付とサイクル週を確認してください','warn');
 const content=`<div class="notice info">${esc(date)}｜${esc(sourceName)}。実施した授業のみ「実施」、休講などは「未実施」を選んでください。${correction?'訂正前の確定データは履歴に保存します。':''}</div>
 <div class="table-wrap" style="margin-top:12px;max-height:55vh;overflow:auto"><table class="table"><thead><tr><th>学級</th><th>時限</th><th>教科</th><th>実施区分</th><th>分数</th><th>備考</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.className)}</td><td class="num">${r.period+1}</td><td>${esc(r.subject)}</td><td><select data-actual-status="${i}"><option value="held" ${r.status==='held'?'selected':''}>実施</option><option value="cancelled" ${r.status==='cancelled'?'selected':''}>未実施</option></select></td><td><input type="number" min="1" max="120" value="${n(r.minutes)}" data-actual-minutes="${i}" style="width:80px"></td><td><input value="${attr(r.note||'')}" data-actual-note="${i}" placeholder="欠課・代替理由"></td></tr>`).join('')}</tbody></table></div>
 <div class="help" style="margin-top:10px">保存時点の教科・担当・実施分数を記録します。後から基本時間割を編集しても実績は変わりません。日付の二重登録は防止します。</div>`;
 actualDraftRows=rows;
 openModal(correction?'授業実績を訂正':'授業実績を確定',content,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveActualDay" data-date="${date}" data-week="${week}" data-source="${attr(sourceId||'')}" data-name="${attr(sourceName)}" data-correction="${correction?'1':'0'}">${correction?'訂正を確定':'実績を確定保存'}</button>`);
}
function showTemporaryModal(){openModal('臨時時間割を作成',`<div class="form-grid">${field('日付','<input type="date" id="tmpDate">','span4')}${field('名称','<input id="tmpLabel" placeholder="例：文化祭前日・短縮日課">','span5')}${field('基本時間割',`<select id="tmpWeek">${Array.from({length:state.timetable.cycleWeeks},(_,w)=>`<option value="${w}">${state.timetable.cycleWeeks===1?'毎週共通':`${w+1}週`}</option>`).join('')}</select>`,'span3')}</div><div class="notice info" style="margin-top:10px">基本時間割のコピーを臨時時間割として保存します。欠勤対応案を採用した場合も同じ場所に保存されます。</div>`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="saveTemporary">作成</button>`)}
function showTemporaryDetail(id){const x=state.operations.temporarySchedules.find(y=>y.id===id);if(!x)return;const ps=x.placements||[];const week=Number(x.week||0);const slotOptions=[];for(let d=0;d<5;d++)for(let p=0;p<Math.min(state.periods.length,state.instruction.maxPeriods);p++)slotOptions.push(`<option value="${d}-${p}">${DAYS[d]} ${p+1}限</option>`);const body=`<div class="notice info">${esc(x.date||'日付未設定')}｜${esc(x.label)}｜${week+1}週パターン</div><div style="margin-top:10px">${(x.changes||[]).map(c=>`<div class="constraint"><strong>${esc(c.type||'変更')}</strong><div class="meta">${esc(c.text||'')}</div></div>`).join('')||'<div class="muted">基本時間割の複製です。</div>'}</div><div class="kpi-line"><span>保存駒数</span><strong>${ps.length}</strong></div>
  <div style="height:10px"></div>${card('臨時の入替',`<div class="form-grid">${field('学級',`<select id="tmpSwapClass">${state.resources.classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`,'span4')}${field('時限A',`<select id="tmpSlotA">${slotOptions.join('')}</select>`,'span4')}${field('時限B',`<select id="tmpSlotB">${slotOptions.join('')}</select>`,'span4')}</div><button class="btn small" data-action="tempSwap" data-id="${id}">2コマを入替</button>`,'合同・同時展開など複合授業は安全のため自動入替対象外です。')}
  <div style="height:10px"></div>${card('急な教科変更・代替授業',`<div class="form-grid">
  ${field('対象学級',`<select id="tmpReplaceClass">${state.resources.classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`,'span3')}
  ${field('対象時限',`<select id="tmpReplaceSlot">${slotOptions.join('')}</select>`,'span3')}
  ${field('変更先の教科・授業',`<select id="tmpReplaceLesson">${state.lessons.filter(l=>l.classIds?.length===1).map(l=>`<option value="${l.id}">${esc(classById(state,l.classIds[0])?.name||'')}｜${esc(l.subject)}</option>`).join('')}</select>`,'span4')}
  ${field('代替教員（任意）',`<select id="tmpReplaceTeacher"><option value="">授業設定どおり</option>${state.resources.teachers.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>`,'span2')}
  </div><div style="margin-top:9px"><button class="btn primary" data-action="tempReplaceLesson" data-id="${id}">この日の授業を差し替え</button></div>`,'指定した日だけの変更です。複数学級・2コマ連続授業の変更は対象外です。')}
  <div style="height:10px"></div>${card('行事・短縮対応',`<div class="form-grid">${field('休止する時限',`<select id="tmpRemoveSlot">${slotOptions.join('')}</select>`,'span6')}</div><div class="inline"><button class="btn small warn" data-action="tempRemoveSlot" data-id="${id}">この時限を休止</button><button class="btn small" data-action="tempRemoveShift" data-id="${id}">休止して後続を前詰め</button></div>`,'学校全体の臨時変更として記録します。')}</div>`;openModal('臨時時間割',body,`<button class="btn" data-action="closeModal">閉じる</button>`)}


function showDriveModal(){openModal('Google Drive 同期',`<div class="notice info">学校の作業データは端末内へ自動保存されます。Driveはバックアップ・端末移行用です。Google認証時のみインターネットへ接続します。</div><div class="form-grid" style="margin-top:10px">${field('OAuth Client ID',`<input id="driveClientId" value="${attr(state.drive.clientId||'')}" placeholder="xxxxxxxx.apps.googleusercontent.com">`,'span8','Google Cloud ConsoleでWebアプリ用Client IDを作成し、このPWAのHTTPS配信元をAuthorized JavaScript originsへ登録します。')}${field('Driveフォルダ名',`<input id="driveFolder" value="${attr(state.drive.folderName||'CurriculumPlanner')}">`,'span4')}</div><div class="kpi-line"><span>最終同期</span><strong>${fmtTime(state.drive.lastSyncAt)}</strong></div><div class="kpi-line"><span>Drive File ID</span><strong class="mono" style="font-size:9px">${esc(state.drive.fileId||'未作成')}</strong></div>`,`<button class="btn" data-action="closeModal">閉じる</button><button class="btn" data-action="loadDrive">Driveから読込</button><button class="btn primary" data-action="saveDrive">Driveへ保存</button>`)}

async function handleSecondaryClick(e){const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;try{
  if(a==='saveCalendarException'){const date=$('#exDate')?.value;if(!date)return toast('日付を指定してください','warn');state.calendar.exceptions.push({id:uid('ex'),date,type:$('#exType').value,label:$('#exLabel').value.trim()});closeModal();scheduleSave();render();return}
  if(a==='saveEvent'){const date=$('#evDate')?.value,name=$('#evName')?.value.trim();if(!date||!name)return toast('日付と行事名を入力してください','warn');state.calendar.events.push({id:uid('ev'),date,name,category:$('#evCategory').value,countsAsInstruction:$('#evInstruction').checked});closeModal();scheduleSave();render();return}
  if(a==='saveIntegratedLinks'){const i=Number(b.dataset.index);state.integrated.plans[i].linkedEventIds=selectedValues('intEvents');closeModal();scheduleSave();render();return}
  if(a==='addTeacherLeave'){const t=teacherById(state,b.dataset.id);if(!t)return;t.leaves.push({week:$('#leaveWeek').value==='all'?'all':Number($('#leaveWeek').value),day:Number($('#leaveDay').value),segment:$('#leaveSegment').value});showTeacherConstraints(t.id);scheduleSave();return}
  if(a==='deleteTeacherLeave'){const t=teacherById(state,b.dataset.id);if(!t)return;t.leaves.splice(Number(b.dataset.index),1);showTeacherConstraints(t.id);scheduleSave();return}
  if(a==='saveTeacherConstraints'){const t=teacherById(state,b.dataset.id);if(!t)return;t.unavailable=selectedValues('teacherUnavailable');t.breakRule={enabled:$('#breakEnabled').checked,startPeriod:Math.max(0,n($('#breakStart').value)-1),endPeriod:Math.max(0,n($('#breakEnd').value)-1),minFreeSlots:Math.max(1,n($('#breakSlots').value,1)),hard:$('#breakHard').value==='true'};t.consecutiveHard=$('#consecutiveHard').value==='true';t.substituteEligible=$('#substituteEligible').checked;closeModal();scheduleSave();refreshMetrics();render();return}
  if(a==='saveFacilityConstraints'){const f=facilityById(state,b.dataset.id);if(!f)return;f.unavailable=selectedValues('facilityUnavailable');closeModal();scheduleSave();refreshMetrics();render();return}
  if(a==='saveLesson'){saveLessonFromModal(b.dataset.id,b.dataset.new==='1');return}
  if(a==='saveActualDay'){
    if(!actualDraftRows?.length)return toast('実績入力がありません','warn');
    const rows=deepClone(actualDraftRows);
    for(let i=0;i<rows.length;i++){
      rows[i].status=$(`[data-actual-status="${i}"]`)?.value||'cancelled';
      rows[i].minutes=Number($(`[data-actual-minutes="${i}"]`)?.value||0);
      rows[i].note=$(`[data-actual-note="${i}"]`)?.value||'';
    }
    const correction=b.dataset.correction==='1';
    if(correction&&!confirm('確定済みの授業実績を訂正します。訂正前の記録は履歴に残ります。続けますか？'))return;
    saveActualDay(state,{date:b.dataset.date,week:Number(b.dataset.week),sourceId:b.dataset.source||null,sourceName:b.dataset.name||'',rows,allowCorrection:correction});
    actualDraftRows=null;closeModal();scheduleSave();render();toast(correction?'訂正を履歴付きで保存しました':'授業実績を確定しました','ok');return;
  }
  if(a==='saveTemporary'){const date=$('#tmpDate').value;if(dateWeekday(date)<0||dateWeekday(date)>4)return toast('有効な平日の実施日を指定してください','warn');const existing=state.operations.temporarySchedules.some(x=>x.date===date);if(existing&&!confirm('同じ日付の臨時時間割が既にあります。別の案として追加しますか？'))return;const label=$('#tmpLabel').value.trim()||'臨時時間割',week=Number($('#tmpWeek').value);state.operations.temporarySchedules.push({id:uid('tmp'),date,label,week,day:date?((new Date(date+'T00:00:00').getDay()+6)%7):0,placements:deepClone(state.timetable.placements),changes:[],createdAt:new Date().toISOString(),source:'manual'});closeModal();scheduleSave();render();return}
  if(a==='tempReplaceLesson'){
    const x=state.operations.temporarySchedules.find(t=>t.id===b.dataset.id);if(!x)return;
    if(dateWeekday(x.date)<0)return toast('臨時時間割に実施日を設定してください','warn');
    const classId=$('#tmpReplaceClass')?.value,lessonId=$('#tmpReplaceLesson')?.value,teacherId=$('#tmpReplaceTeacher')?.value||'',[day,period]=($('#tmpReplaceSlot')?.value||'0-0').split('-').map(Number);
    if(!classId||!lessonId)return toast('学級と変更先の授業を選択してください','warn');
    if(day!==dateWeekday(x.date))return toast('実施日と同じ曜日を指定してください','warn');
    const lesson=lessonById(state,lessonId);
    if(!lesson||lesson.classIds?.length!==1||lesson.classIds[0]!==classId||lesson.blockSize>1||lesson.syncGroup)return toast('同じ学級の単独授業を選んでください','warn');
    const before=deepClone(x.placements||[]),candidate=deepClone(before),week=Number(x.week);
    const existing=candidate.filter(p=>p.week===week&&p.day===day&&p.period===period&&(lessonById(state,p.lessonId)?.classIds||[]).includes(classId));
    if(existing.length>1)return toast('同時展開の授業は簡易変更できません','warn');
    if(existing.length){const old=lessonById(state,existing[0].lessonId),p=existing[0];if(old?.classIds?.length!==1||old?.syncGroup||p.blockId||Number(old.blockSize||1)>1)return toast('合同授業・連続授業はまとめて変更してください','warn')}
    const removed=new Set(existing.map(p=>p.id));const changed=candidate.filter(p=>!removed.has(p.id));
    changed.push({id:uid('p'),lessonId,week,day,period,locked:false,...(teacherId?{teacherIdsOverride:[teacherId]}:{})});
    const conflict=await temporaryNewConflicts(before,changed,true);
    if(conflict)return toast(`変更できません：${conflict}`,'warn');
    x.placements=changed;x.changes.push({type:'replace',text:`${classById(state,classId)?.name||classId}｜${DAYS[day]}${period+1}限 → ${lesson.subject}${teacherId?'（'+(teacherById(state,teacherId)?.name||'代替')+'）':''}`});
    scheduleSave();showTemporaryDetail(x.id);toast('臨時の授業変更を保存しました','ok');return;
  }
  if(a==='tempSwap'){
    const x=state.operations.temporarySchedules.find(y=>y.id===b.dataset.id);if(!x)return;
    const cid=$('#tmpSwapClass').value,[d1,p1]=$('#tmpSlotA').value.split('-').map(Number),[d2,p2]=$('#tmpSlotB').value.split('-').map(Number),w=Number(x.week||0);
    if(d1===d2&&p1===p2)return toast('異なる時限を選んでください','warn');if(dateWeekday(x.date)<0||d1!==dateWeekday(x.date)||d2!==dateWeekday(x.date))return toast('日付と一致する同じ曜日の授業のみ入れ替えられます','warn');
    const before=deepClone(x.placements||[]),candidate=deepClone(before);
    const at=(d,p)=>candidate.filter(q=>q.week===w&&q.day===d&&q.period===p&&lessonById(state,q.lessonId)?.classIds?.includes(cid));
    const A=at(d1,p1),B=at(d2,p2);
    if(A.length!==1||B.length!==1)return toast('この入替は単一授業同士の場合に利用できます','warn');
    const la=lessonById(state,A[0].lessonId),lb=lessonById(state,B[0].lessonId);
    const inBlock=p=>p.blockId&&candidate.some(q=>q.id!==p.id&&q.blockId===p.blockId);
    if(la?.syncGroup||lb?.syncGroup||la?.classIds?.length!==1||lb?.classIds?.length!==1||inBlock(A[0])||inBlock(B[0]))return toast('連続・合同・同時展開の授業は一括変更が必要なため、この操作の対象外です','warn');
    [A[0].day,A[0].period,B[0].day,B[0].period]=[d2,p2,d1,p1];
    const conflict=await temporaryNewConflicts(before,candidate);
    if(conflict)return toast(`入替できません：${conflict}`,'warn');
    x.placements=candidate;
    x.changes.push({type:'swap',text:`${classById(state,cid)?.name||cid}：${DAYS[d1]}${p1+1}限と${DAYS[d2]}${p2+1}限を入替`});
    scheduleSave();showTemporaryDetail(x.id);return;
  }
  if(a==='tempRemoveSlot'||a==='tempRemoveShift'){
    const x=state.operations.temporarySchedules.find(y=>y.id===b.dataset.id);if(!x)return;
    const [d,p]=$('#tmpRemoveSlot').value.split('-').map(Number),w=Number(x.week||0);if(dateWeekday(x.date)<0||d!==dateWeekday(x.date))return toast('実施日と同じ曜日の時限を選んでください','warn');
    const before=deepClone(x.placements||[]),removed=before.filter(q=>q.week===w&&q.day===d&&q.period===p);
    if(removed.some(p=>p.blockId&&before.some(q=>q.id!==p.id&&q.blockId===p.blockId)))return toast('連続授業の途中は休止できません。ブロックをまとめて変更してください','warn');
    const candidate=before.filter(q=>!(q.week===w&&q.day===d&&q.period===p));
    if(a==='tempRemoveShift')for(const q of candidate)if(q.week===w&&q.day===d&&q.period>p)q.period--;
    const conflict=await temporaryNewConflicts(before,candidate,true);
    if(conflict)return toast(`変更できません：${conflict}`,'warn');
    x.placements=candidate;
    x.changes.push({type:'event',text:`${DAYS[d]}${p+1}限を休止${a==='tempRemoveShift'?'し、後続時限を前詰め':''}`});
    scheduleSave();showTemporaryDetail(x.id);return;
  }
}catch(err){console.error(err);toast(err.message||String(err),'err')}}

function saveLessonFromModal(id,isNew){const classes=selectedValues('lessonClasses'),teachers=selectedValues('lessonTeachers'),subject=$('#lessonSubject').value.trim();if(!subject||!classes.length)return toast('授業名と対象学級を設定してください','warn');const data={id,subject,name:subject,classIds:classes,teacherIds:teachers,facilityId:$('#lessonFacility').value,annualHours:n($('#lessonHours').value),cycleSessionsOverride:$('#lessonCycle').value===''?null:n($('#lessonCycle').value),blockSize:Math.max(1,Math.min(3,n($('#lessonBlock').value,1))),type:$('#lessonType').value,syncGroup:$('#lessonSync').value.trim(),allowTeacherTBD:$('#lessonTeacherTBD').checked,allowFacilityTBD:$('#lessonFacilityTBD').checked,unavailable:selectedValues('lessonUnavailable'),preferred:(lessonById(state,id)?.preferred||[])};if(!data.allowTeacherTBD&&!teachers.length)return toast('担当教員を設定するか「教員未定を許可」を選択してください','warn');if(isNew)state.lessons.push(data);else{const i=state.lessons.findIndex(x=>x.id===id);if(i>=0)state.lessons[i]=data}closeModal();scheduleSave();refreshMetrics();render()}

function importJsonDialog(){openModal('JSONバックアップを復元',`<div class="notice warn">現在の端末内データを置き換えます。必要なら先にバックアップしてください。</div><div class="field" style="margin-top:10px"><label>JSONファイル</label><input type="file" id="jsonFile" accept="application/json,.json"></div>`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="doImportJson">復元</button>`)}
async function importJsonFile(){const file=$('#jsonFile')?.files?.[0];if(!file)return toast('ファイルを選択してください','warn');const txt=await readFile(file),raw=JSON.parse(txt);mutationRevision++;state=migrateState(raw);await saveState(state);closeModal();metricsCache=null;absenceCache=null;render();refreshMetrics();toast('バックアップを復元しました','ok')}
function exportLessonCsv(){const head=['id','subject','classes','teachers','facility','annualHours','blockSize','type','syncGroup'];const rows=state.lessons.map(l=>[l.id,l.subject,(l.classIds||[]).join('|'),(l.teacherIds||[]).join('|'),l.facilityId||'',l.annualHours,l.blockSize||1,l.type,l.syncGroup||'']);downloadText(`lessons_${state.school.fiscalYear}.csv`,[head,...rows].map(r=>r.map(csvCell).join(',')).join('\n'),'text/csv;charset=utf-8')}
function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function parseCsv(text){const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i],nxt=text[i+1];if(q){if(c==='"'&&nxt==='"'){cell+='"';i++}else if(c==='"')q=false;else cell+=c}else{if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(c!=='\r')cell+=c}}row.push(cell);if(row.some(x=>x!==''))rows.push(row);return rows}
function importLessonCsvDialog(){openModal('授業設定CSVを読み込む',`<div class="notice info">CSV列：id, subject, classes（|区切りID）, teachers（|区切りID）, facility, annualHours, blockSize, type, syncGroup。既存IDと同じ行は更新します。</div><div class="field" style="margin-top:10px"><input type="file" id="lessonCsvFile" accept=".csv,text/csv"></div>`,`<button class="btn" data-action="closeModal">キャンセル</button><button class="btn primary" data-action="doImportLessonCsv">読込</button>`)}
async function importLessonCsv(){const f=$('#lessonCsvFile')?.files?.[0];if(!f)return toast('CSVを選択してください','warn');const rows=parseCsv(await readFile(f));if(rows.length<2)return toast('データ行がありません','warn');const h=rows[0].map(x=>x.trim());for(const r of rows.slice(1)){const o=Object.fromEntries(h.map((k,i)=>[k,r[i]??'']));if(!o.subject)continue;const id=o.id||uid('l');const data={id,subject:o.subject,name:o.subject,classIds:o.classes?o.classes.split('|').filter(Boolean):[],teacherIds:o.teachers?o.teachers.split('|').filter(Boolean):[],facilityId:o.facility||'',annualHours:n(o.annualHours),cycleSessionsOverride:null,blockSize:Math.max(1,Math.min(3,n(o.blockSize,1))),type:o.type||'normal',syncGroup:o.syncGroup||'',allowTeacherTBD:false,allowFacilityTBD:false};const i=state.lessons.findIndex(x=>x.id===id);if(i>=0)state.lessons[i]={...state.lessons[i],...data};else state.lessons.push(data)}closeModal();scheduleSave();refreshMetrics();render();toast('CSVを読み込みました','ok')}

async function doSaveDrive(){state.drive.clientId=$('#driveClientId')?.value.trim()||state.drive.clientId;state.drive.folderName=$('#driveFolder')?.value.trim()||'CurriculumPlanner';toast('Google認証を開始します');const r=await saveToDrive(state);state.drive={...state.drive,...r};scheduleSave();showDriveModal();toast('Driveへ保存しました','ok')}
async function doLoadDrive(){state.drive.clientId=$('#driveClientId')?.value.trim()||state.drive.clientId;state.drive.folderName=$('#driveFolder')?.value.trim()||'CurriculumPlanner';if(!confirm('Drive上のデータで現在の端末データを置き換えます。よろしいですか？'))return;const r=await loadFromDrive(state);mutationRevision++;state=migrateState(r.data);state.drive.clientId=$('#driveClientId')?.value.trim()||state.drive.clientId;state.drive.folderId=r.folderId;state.drive.fileId=r.fileId;state.drive.lastSyncAt=new Date().toISOString();await saveState(state);closeModal();metricsCache=null;render();refreshMetrics();toast('Driveから読み込みました','ok')}

function printCurrentReport(){const type=state.ui.reportType||'summary';let opts={};if(type==='timetable')opts={kind:state.timetable.view.kind,id:state.timetable.view.id};const html=reportByType(state,type,opts),w=window.open('','_blank');if(!w)return toast('ポップアップを許可してください','warn');w.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>帳票</title><link rel="stylesheet" href="${new URL('./styles.css',location.href).href}"><style>body{background:#fff}.report-sheet{box-shadow:none}</style></head><body>${html}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);w.document.close()}

// Secondary actions are kept separate so modal controls can be handled without making the main router brittle.
const originalBindGlobal=bindGlobal;
// The main init calls bindGlobal once; attach the modal listener here after DOM availability.
queueMicrotask(()=>document.body.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;try{
    if(['saveCalendarException','saveEvent','saveIntegratedLinks','addTeacherLeave','deleteTeacherLeave','saveTeacherConstraints','saveFacilityConstraints','saveLesson','saveTemporary','saveActualDay','tempReplaceLesson','tempSwap','tempRemoveSlot','tempRemoveShift'].includes(a)){await handleSecondaryClick(e);return}
    if(a==='doImportJson'){await importJsonFile();return}
    if(a==='doImportLessonCsv'){await importLessonCsv();return}
    if(a==='printReport'){e.stopImmediatePropagation();printCurrentReport();return}
  }catch(err){console.error(err);toast(err.message||String(err),'err')}
}));

init().catch(err=>{console.error(err);document.body.innerHTML=`<div style="padding:30px;font-family:sans-serif"><h1>起動エラー</h1><pre>${esc(err.stack||err.message||String(err))}</pre></div>`});
