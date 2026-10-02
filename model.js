export const APP_VERSION='1.1.1';
export const SCHEMA_VERSION=6;
export const DAYS=['月','火','水','木','金'];

export const DEFAULT_SUBJECTS_JHS=[
  ['japanese','国語'],['social','社会'],['math','数学'],['science','理科'],['music','音楽'],['art','美術'],['pe','保健体育'],['tech','技術・家庭'],['english','外国語'],['moral','道徳'],['integrated','総合的な学習の時間'],['special','特別活動']
];
export const DEFAULT_SUBJECTS_ES=[
  ['japanese','国語'],['social','社会'],['math','算数'],['science','理科'],['life','生活'],['music','音楽'],['art','図画工作'],['home','家庭'],['pe','体育'],['foreign_activity','外国語活動'],['english','外国語'],['moral','道徳'],['integrated','総合的な学習の時間'],['special','特別活動']
];

export function uid(prefix='id'){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`}
export function deepClone(v){return typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v))}
export function standardUnitMinutesForSchool(type,grade=null){
  if(type==='elementary')return 45;
  if(type==='junior_high')return 50;
  if(type==='compulsory')return Number(grade)<=6?45:50;
  return 50;
}
export function implementationPeriodsForStandardUnits(st,standardUnits,grade=null){
  const std=standardUnitMinutesForSchool(st?.school?.type,grade);
  const actual=Math.max(1,Number(st?.school?.lessonMinutes||std));
  return Math.ceil(Math.max(0,Number(standardUnits||0))*std/actual-1e-9);
}
export function implementationExactPeriods(st,standardUnits,grade=null){
  const std=standardUnitMinutesForSchool(st?.school?.type,grade);
  const actual=Math.max(1,Number(st?.school?.lessonMinutes||std));
  return Math.max(0,Number(standardUnits||0))*std/actual;
}

function teacher(id,name,role,subjects){return {id,name,role,subjects,substituteEligible:true,unavailable:[],leaves:[],maxDaily:5,maxConsecutive:3,consecutiveHard:false,breakRule:{enabled:false,startPeriod:3,endPeriod:4,minFreeSlots:1,hard:false}}}
function jhsHourPlans(){
  const y1={japanese:140,social:105,math:140,science:105,music:45,art:45,pe:105,tech:70,english:140,moral:35,integrated:50,special:35};
  const y2={japanese:140,social:105,math:105,science:140,music:35,art:35,pe:105,tech:70,english:140,moral:35,integrated:70,special:35};
  const y3={japanese:105,social:140,math:140,science:140,music:35,art:35,pe:105,tech:35,english:140,moral:35,integrated:70,special:35};
  return [y1,y2,y3].map((row,i)=>({grade:i+1,annualTarget:Object.values(row).reduce((a,b)=>a+b,0),subjects:DEFAULT_SUBJECTS_JHS.map(([id,name])=>({id,name,hours:row[id]||0,adjustment:0}))}));
}
function elementaryHourPlans(){
  const rows=[
    {japanese:306,math:136,life:102,music:68,art:68,pe:102,moral:34,special:34},
    {japanese:315,math:175,life:105,music:70,art:70,pe:105,moral:35,special:35},
    {japanese:245,social:70,math:175,science:90,music:60,art:60,pe:105,foreign_activity:35,moral:35,integrated:70,special:35},
    {japanese:245,social:90,math:175,science:105,music:60,art:60,pe:105,foreign_activity:35,moral:35,integrated:70,special:35},
    {japanese:175,social:100,math:175,science:105,music:50,art:50,home:60,pe:90,english:70,moral:35,integrated:70,special:35},
    {japanese:175,social:105,math:175,science:105,music:50,art:50,home:55,pe:90,english:70,moral:35,integrated:70,special:35}
  ];
  return rows.map((row,i)=>({grade:i+1,annualTarget:Object.values(row).reduce((a,b)=>a+b,0),subjects:DEFAULT_SUBJECTS_ES.map(([id,name])=>({id,name,hours:row[id]||0,adjustment:0}))}));
}
export function defaultHourPlansForType(type){return type==='elementary'?elementaryHourPlans():jhsHourPlans()}

function classesForType(type){
  const grades=type==='elementary'?6:3;
  const out=[];for(let g=1;g<=grades;g++)for(let c=1;c<=2;c++)out.push({id:`c${g}${c}`,grade:g,name:`${g}年${c}組`});
  return out;
}
function teachersForType(type,classes){
  if(type==='elementary'){
    return classes.map(c=>teacher(`t_${c.id}`,`${c.name}担任`,'学級担任',DEFAULT_SUBJECTS_ES.map(x=>x[1]))).concat([
      teacher('tE','外国語専科','専科',['外国語','外国語活動']),teacher('tMu','音楽専科','専科',['音楽']),teacher('tPE','体育専科','専科',['体育'])
    ]);
  }
  const ts=[
    teacher('tJ','山田','国語',['国語']),teacher('tS','佐藤','社会',['社会']),teacher('tM','鈴木','数学',['数学']),teacher('tSc','田中','理科',['理科']),
    teacher('tE','高橋','外国語',['外国語']),teacher('tPE','伊藤','保健体育',['保健体育']),teacher('tMu','渡辺','音楽',['音楽']),teacher('tA','中村','美術',['美術']),
    teacher('tT','小林','技術・家庭',['技術・家庭']),teacher('tH1','加藤','学級担任',['道徳','総合的な学習の時間','特別活動']),teacher('tH2','吉田','学級担任',['道徳','総合的な学習の時間','特別活動'])
  ];
  ts[0].unavailable=['0-0'];ts[2].maxConsecutive=3;ts[5].breakRule={enabled:true,startPeriod:3,endPeriod:4,minFreeSlots:1,hard:false};return ts;
}
function facilitiesForType(type){
  const common=[{id:'normal',name:'普通教室',kind:'room',capacity:99,unavailable:[]},{id:'gym',name:'体育館',kind:'facility',capacity:1,unavailable:[]},{id:'music',name:'音楽室',kind:'facility',capacity:1,unavailable:[]}];
  if(type==='elementary')return common.concat([{id:'science1',name:'理科室',kind:'facility',capacity:1,unavailable:[]},{id:'art',name:'図工室',kind:'facility',capacity:1,unavailable:[]},{id:'home',name:'家庭科室',kind:'facility',capacity:1,unavailable:[]}]);
  return common.concat([{id:'science1',name:'理科室1',kind:'facility',capacity:1,unavailable:[]},{id:'science2',name:'理科室2',kind:'facility',capacity:1,unavailable:[]},{id:'art',name:'美術室',kind:'facility',capacity:1,unavailable:[]},{id:'tech',name:'技術室',kind:'facility',capacity:1,unavailable:[]}]);
}
function periodsForType(type){
  if(type==='elementary')return [
    {id:'p1',name:'1限',start:'08:45',end:'09:30'},{id:'p2',name:'2限',start:'09:40',end:'10:25'},{id:'p3',name:'3限',start:'10:45',end:'11:30'},
    {id:'p4',name:'4限',start:'11:40',end:'12:25'},{id:'p5',name:'5限',start:'13:30',end:'14:15'},{id:'p6',name:'6限',start:'14:25',end:'15:10'}
  ];
  return [
    {id:'p1',name:'1限',start:'08:50',end:'09:40'},{id:'p2',name:'2限',start:'09:50',end:'10:40'},{id:'p3',name:'3限',start:'10:50',end:'11:40'},
    {id:'p4',name:'4限',start:'11:50',end:'12:40'},{id:'p5',name:'5限',start:'13:35',end:'14:25'},{id:'p6',name:'6限',start:'14:35',end:'15:25'}
  ];
}
function defaultLessons(classes,teachers,hourPlans,type='junior_high'){
  const out=[];
  const facility=type==='elementary'?{理科:'science1',音楽:'music','図画工作':'art',家庭:'home',体育:'gym'}:{理科:'science1',音楽:'music',美術:'art','保健体育':'gym','技術・家庭':'tech'};
  const subjTeacher=type==='elementary'?{}:{'国語':'tJ','社会':'tS','数学':'tM','理科':'tSc','音楽':'tMu','美術':'tA','保健体育':'tPE','技術・家庭':'tT','外国語':'tE','道徳':'tH1','総合的な学習の時間':'tH1','特別活動':'tH2'};
  for(const c of classes){
    const hp=hourPlans.find(x=>x.grade===c.grade);if(!hp)continue;
    for(const s of hp.subjects){if(!s.hours)continue;
      let tid=subjTeacher[s.name]||'';
      if(type==='elementary'){
        if(['外国語','外国語活動'].includes(s.name))tid='tE';else if(s.name==='音楽')tid='tMu';else if(s.name==='体育')tid='tPE';else tid=`t_${c.id}`;
      }
      out.push({id:`l_${c.id}_${s.id}`,name:s.name,subject:s.name,classIds:[c.id],teacherIds:[tid].filter(Boolean),facilityId:facility[s.name]||'normal',annualHours:s.hours,cycleSessionsOverride:null,type:'normal',syncGroup:'',allowTeacherTBD:false,allowFacilityTBD:false,unavailable:[],preferred:[]});
    }
  }
  return out;
}

function profileParts(type){
  const normalized=type==='elementary'?'elementary':'junior_high';
  const classes=classesForType(normalized),hourPlans=defaultHourPlansForType(normalized),teachers=teachersForType(normalized,classes),facilities=facilitiesForType(normalized);
  return {type:normalized,classes,hourPlans,teachers,facilities,periods:periodsForType(normalized),lessons:defaultLessons(classes,teachers,hourPlans,normalized),lessonMinutes:standardUnitMinutesForSchool(normalized)};
}
export function applySchoolTypeDefaults(st,type){
  const p=profileParts(type);st.school.type=p.type;st.school.lessonMinutes=p.lessonMinutes;st.hourPlans=p.hourPlans;st.resources={classes:p.classes,teachers:p.teachers,facilities:p.facilities};st.periods=p.periods;st.lessons=p.lessons;
  st.integrated={plans:p.type==='elementary'?[{id:uid('int'),grade:3,title:'',hours:70,linkedEventIds:[]}]:[{id:uid('int'),grade:1,title:'',hours:50,linkedEventIds:[]}]};
  st.timetable={...(st.timetable||{}),placements:[],view:{kind:'class',id:p.classes[0]?.id||'',week:0},undo:[],redo:[],lastResult:null};
  st.operations={absences:[],temporarySchedules:[]};st.updatedAt=new Date().toISOString();return st;
}

export function defaultState(){
  const now=new Date(),fy=now.getMonth()>=3?now.getFullYear():now.getFullYear()-1;const p=profileParts('junior_high');
  return {schemaVersion:SCHEMA_VERSION,appVersion:APP_VERSION,updatedAt:new Date().toISOString(),
    school:{code:'',name:'〇〇中学校',type:'junior_high',principal:'',fiscalYear:fy,termSystem:3,lessonMinutes:50,notes:''},
    goals:{educationGoal:'',focusItems:[{id:'focus_inquiry',label:'探究的な学び',text:''},{id:'focus_individual',label:'個別最適・協働的な学び',text:''},{id:'focus_support',label:'特別支援教育',text:''},{id:'focus_career',label:'キャリア教育',text:''}],featureTags:[],featureSummary:''},
    calendar:{holidayRuleVersion:'JP-HOLIDAY-2026.10',terms:[{id:'t1',name:'1学期',start:`${fy}-04-06`,end:`${fy}-07-20`},{id:'t2',name:'2学期',start:`${fy}-09-01`,end:`${fy}-12-23`},{id:'t3',name:'3学期',start:`${fy+1}-01-08`,end:`${fy+1}-03-24`}],exceptions:[],events:[{id:uid('ev'),date:`${fy}-04-06`,name:'始業式',category:'儀式的行事',countsAsInstruction:true},{id:uid('ev'),date:`${fy}-04-07`,name:'入学式',category:'儀式的行事',countsAsInstruction:true},{id:uid('ev'),date:`${fy}-09-25`,name:'体育大会',category:'体育的行事',countsAsInstruction:true},{id:uid('ev'),date:`${fy+1}-03-24`,name:'修了式',category:'儀式的行事',countsAsInstruction:true}]},
    instruction:{manualWeeklyTarget:false,weeklyTargetOverride:null,cycleWeeks:2,maxPeriods:6,dailyPatternMode:'auto'},hourPlans:p.hourPlans,
    adjusted:{enabled:false,rules:{maxReductionRate:.15,minHours:35,excludeAtOrBelow:35},allocations:[]},integrated:{plans:[{id:uid('int'),grade:1,title:'地域課題をテーマにした探究',hours:50,linkedEventIds:[]}]},periods:p.periods,
    resources:{classes:p.classes,teachers:p.teachers,facilities:p.facilities},lessons:p.lessons,
    timetable:{cycleWeeks:2,placements:[],view:{kind:'class',id:'c11',week:0},settings:{studentNoGaps:true,avoidSameSubjectTwice:true,avoidLastPE:true,restarts:24,repairDepth:2},lastResult:null,undo:[],redo:[]},
    operations:{absences:[],temporarySchedules:[]},drive:{clientId:'',folderName:'CurriculumPlanner',fileId:'',folderId:'',lastSyncAt:null,autoSync:false},ui:{page:'basic',scheduleTab:'board',resourceTab:'classes',reportType:'summary'}};
}

export function migrateState(raw){
  if(!raw||typeof raw!=='object')return defaultState();
  const base=defaultState(),oldSchema=Number(raw.schemaVersion||0),st={...base,...raw};st.schemaVersion=SCHEMA_VERSION;st.appVersion=APP_VERSION;st.updatedAt=new Date().toISOString();st.school={...base.school,...(raw.school||raw.schoolInfo||{})};
  st.goals={...base.goals,...(raw.goals||{})};st.calendar={...base.calendar,...(raw.calendar||{})};st.calendar.terms=Array.isArray(st.calendar.terms)?st.calendar.terms:base.calendar.terms;st.calendar.exceptions=Array.isArray(st.calendar.exceptions)?st.calendar.exceptions:[];st.calendar.events=Array.isArray(st.calendar.events)?st.calendar.events:[];st.instruction={...base.instruction,...(raw.instruction||{})};
  st.hourPlans=Array.isArray(raw.hourPlans)?raw.hourPlans:base.hourPlans;st.adjusted={...base.adjusted,...(raw.adjusted||{})};st.integrated={...base.integrated,...(raw.integrated||{})};st.periods=Array.isArray(raw.periods)?raw.periods:base.periods;const oldLab=raw.scheduleLab;st.resources=raw.resources||base.resources;
  st.lessons=Array.isArray(raw.lessons)?raw.lessons:(oldLab?.lessons?oldLab.lessons.map(l=>({id:l.id,name:l.subject||l.name,subject:l.subject||l.name,classIds:l.classIds||[],teacherIds:l.teacherIds||[],facilityId:l.roomId||'normal',annualHours:35,cycleSessionsOverride:l.sessions||null,type:l.type||'normal',syncGroup:'',allowTeacherTBD:false,allowFacilityTBD:false,unavailable:l.unavailable||[],preferred:l.preferred||[]})):base.lessons);
  st.timetable={...base.timetable,...(raw.timetable||{})};if(oldLab&&!raw.timetable){st.timetable.placements=(oldLab.placements||[]).map(p=>({...p,week:p.week||0}));st.timetable.view={kind:oldLab.view?.kind||'class',id:oldLab.view?.id||'c11',week:0};st.timetable.settings={...base.timetable.settings,...(oldLab.settings||{})}}
  st.lessons.forEach(l=>{l.unavailable=Array.isArray(l.unavailable)?l.unavailable:[];l.preferred=Array.isArray(l.preferred)?l.preferred:[]});st.timetable.undo=[];st.timetable.redo=[];st.operations={...base.operations,...(raw.operations||{})};st.drive={...base.drive,...(raw.drive||{})};st.ui={...base.ui,...(raw.ui||{})};normalizeResources(st);
  if(oldSchema<5&&st.school.type==='elementary'&&(!Array.isArray(raw.hourPlans)||raw.hourPlans.length<=3))applySchoolTypeDefaults(st,'elementary');
  if(oldSchema<6){const mixedElementary=st.school.type==='elementary'&&st.hourPlans.length!==6;const mixedJhs=st.school.type==='junior_high'&&st.hourPlans.length!==3;if(mixedElementary||mixedJhs)applySchoolTypeDefaults(st,st.school.type);}
  return st;
}

export function normalizeResources(st){
  st.resources=st.resources||{classes:[],teachers:[],facilities:[]};st.resources.classes=Array.isArray(st.resources.classes)?st.resources.classes:[];st.resources.teachers=Array.isArray(st.resources.teachers)?st.resources.teachers:[];st.resources.facilities=Array.isArray(st.resources.facilities)?st.resources.facilities:[];
  for(const t of st.resources.teachers){t.subjects=Array.isArray(t.subjects)?t.subjects:[];t.substituteEligible=t.substituteEligible!==false;t.unavailable=Array.isArray(t.unavailable)?t.unavailable:[];t.leaves=Array.isArray(t.leaves)?t.leaves:[];t.maxDaily=Number(t.maxDaily||5);t.maxConsecutive=Number(t.maxConsecutive||3);t.consecutiveHard=!!t.consecutiveHard;t.breakRule={enabled:false,startPeriod:3,endPeriod:4,minFreeSlots:1,hard:false,...(t.breakRule||{})}}
  for(const f of st.resources.facilities){f.capacity=Math.max(1,Number(f.capacity||1));f.unavailable=Array.isArray(f.unavailable)?f.unavailable:[]}
}
export function classById(st,id){return st.resources.classes.find(x=>x.id===id)}
export function teacherById(st,id){return st.resources.teachers.find(x=>x.id===id)}
export function facilityById(st,id){return st.resources.facilities.find(x=>x.id===id)}
export function lessonById(st,id){return st.lessons.find(x=>x.id===id)}
export function hourPlanForGrade(st,grade){return st.hourPlans.find(x=>Number(x.grade)===Number(grade))}
export function instructionWeeksFromDays(days){return days>0?days/5:0}
export function subjectAnnualHours(st,grade,subject){const p=hourPlanForGrade(st,grade);return p?.subjects?.find(s=>s.name===subject)?.hours||0}

export function cycleAllocationForGrade(st,grade,instructionDays){
  const hp=hourPlanForGrade(st,grade),weeks=instructionWeeksFromDays(instructionDays),cycle=Number(st.timetable.cycleWeeks||st.instruction.cycleWeeks||1);if(!hp||!weeks)return {};
  const ratio=standardUnitMinutesForSchool(st.school.type,grade)/Math.max(1,Number(st.school.lessonMinutes||standardUnitMinutesForSchool(st.school.type,grade)));
  const annualImpl=implementationPeriodsForStandardUnits(st,Number(hp.annualTarget||0),grade);const target=Math.max(0,Math.round((annualImpl/weeks)*cycle));
  const rows=(hp.subjects||[]).map(s=>{const annual=Number(s.hours||0)*ratio;const raw=(annual/weeks)*cycle;return {name:s.name,base:Math.floor(raw),rem:raw-Math.floor(raw)}});
  let used=rows.reduce((a,x)=>a+x.base,0),left=Math.max(0,target-used);rows.sort((a,b)=>b.rem-a.rem);for(let i=0;i<left&&rows.length;i++)rows[i%rows.length].base++;return Object.fromEntries(rows.map(x=>[x.name,x.base]));
}
export function cycleSessionsForLesson(st,lesson,instructionDays){
  if(lesson.cycleSessionsOverride!==null&&lesson.cycleSessionsOverride!==''&&lesson.cycleSessionsOverride!==undefined)return Math.max(0,Number(lesson.cycleSessionsOverride));
  const cls=classById(st,lesson.classIds?.[0]),alloc=cycleAllocationForGrade(st,cls?.grade,instructionDays);if(lesson.subject in alloc)return Math.max(0,Number(alloc[lesson.subject]));
  const annual=Number(lesson.annualHours||subjectAnnualHours(st,cls?.grade,lesson.subject)||0),weeks=instructionWeeksFromDays(instructionDays);if(!weeks)return 0;const impl=implementationPeriodsForStandardUnits(st,annual,cls?.grade);return Math.max(0,Math.round((impl/weeks)*Number(st.timetable.cycleWeeks||st.instruction.cycleWeeks||1)));
}

export function validateState(st,calendarStats){
  const issues=[],push=(level,code,title,desc)=>issues.push({level,code,title,desc});if(!st.school.name?.trim())push('ERROR','BASIC-SCHOOL','学校名が未入力','学校名を入力してください。');if(!st.school.principal?.trim())push('WARNING','BASIC-PRINCIPAL','校長名が未入力','帳票に必要な場合は入力してください。');if(!st.goals.educationGoal?.trim())push('WARNING','GOAL-EMPTY','学校教育目標が未入力','学校教育目標を入力してください。');if((calendarStats?.instructionDays||0)<150)push('WARNING','CAL-DAYS-LOW','年間授業日数が少なめです',`現在の計算値は${calendarStats?.instructionDays||0}日です。学期範囲・休業日・土曜授業を確認してください。`);
  const classIds=new Set(st.resources.classes.map(x=>x.id)),teacherIds=new Set(st.resources.teachers.map(x=>x.id)),facilityIds=new Set(st.resources.facilities.map(x=>x.id));for(const l of st.lessons){if(!l.classIds?.length)push('ERROR','LESSON-NOCLASS',`${l.name||l.subject}の学級未設定`,'授業には少なくとも1学級が必要です。');for(const id of l.classIds||[])if(!classIds.has(id))push('ERROR','LESSON-BADCLASS',`${l.name||l.subject}の学級参照エラー`,id);if(!l.allowTeacherTBD&&!(l.teacherIds||[]).filter(Boolean).length)push('WARNING','LESSON-NOTEACHER',`${l.name||l.subject}の担当未定`,'仮配置を許可するか、担当教員を設定してください。');for(const id of(l.teacherIds||[]).filter(Boolean))if(!teacherIds.has(id))push('ERROR','LESSON-BADTEACHER',`${l.name||l.subject}の教員参照エラー`,id);if(l.facilityId&&!facilityIds.has(l.facilityId))push('ERROR','LESSON-BADFACILITY',`${l.name||l.subject}の施設参照エラー`,l.facilityId)}
  for(const p of st.hourPlans){const sum=(p.subjects||[]).reduce((a,s)=>a+Number(s.hours||0),0);if(Number(p.annualTarget||0)!==sum)push('WARNING','HOURS-TOTAL',`${p.grade}年の年間標準時数と内訳が不一致`,`目標${p.annualTarget}、教科等の合計${sum}です。`)}
  const std=standardUnitMinutesForSchool(st.school.type),actual=Number(st.school.lessonMinutes||std);if(actual!==std)push('INFO','UNIT-CONVERSION','授業時間を換算して時間割を編成',`${st.school.type==='elementary'?'小学校':'中学校'}の標準1単位時間${std}分に対し、実施1コマ${actual}分で換算します。`);
  const seen=new Set();for(const p of st.timetable.placements||[]){if(seen.has(p.id))push('ERROR','TT-DUPID','時間割データID重複',p.id);seen.add(p.id)}return issues;
}
