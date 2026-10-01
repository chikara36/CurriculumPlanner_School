const MS_DAY=86400000;
export function parseISO(s){if(!s)return null;const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
export function isoDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
export function eachDate(start,end){const a=[];let d=parseISO(start),e=parseISO(end);if(!d||!e||d>e)return a;for(;d<=e;d=addDays(d,1))a.push(new Date(d));return a}
export function nthWeekday(year,month0,weekday,n){const first=new Date(year,month0,1);const delta=(weekday-first.getDay()+7)%7;return new Date(year,month0,1+delta+7*(n-1))}
function vernal(year){return Math.floor(20.8431+0.242194*(year-1980)-Math.floor((year-1980)/4))}
function autumnal(year){return Math.floor(23.2488+0.242194*(year-1980)-Math.floor((year-1980)/4))}
function put(map,d,name){map.set(isoDate(d),name)}

// Built-in rules for Japan, designed for modern school-year use. Exceptional future legislation can be added as a school calendar exception.
export function japanHolidays(year){
  const m=new Map();
  put(m,new Date(year,0,1),'元日');
  put(m,nthWeekday(year,0,1,2),'成人の日');
  put(m,new Date(year,1,11),'建国記念の日');
  if(year>=2020)put(m,new Date(year,1,23),'天皇誕生日');
  put(m,new Date(year,2,vernal(year)),'春分の日');
  put(m,new Date(year,3,29),'昭和の日');
  put(m,new Date(year,4,3),'憲法記念日');put(m,new Date(year,4,4),'みどりの日');put(m,new Date(year,4,5),'こどもの日');
  // 2020/2021 Olympic special cases retained for migration/history; later years use ordinary rules.
  if(year===2020){put(m,new Date(year,6,23),'海の日');put(m,new Date(year,6,24),'スポーツの日');put(m,new Date(year,7,10),'山の日')}
  else if(year===2021){put(m,new Date(year,6,22),'海の日');put(m,new Date(year,6,23),'スポーツの日');put(m,new Date(year,7,8),'山の日')}
  else {put(m,nthWeekday(year,6,1,3),'海の日');put(m,new Date(year,7,11),'山の日');put(m,nthWeekday(year,9,1,2),'スポーツの日')}
  put(m,nthWeekday(year,8,1,3),'敬老の日');put(m,new Date(year,8,autumnal(year)),'秋分の日');
  put(m,new Date(year,10,3),'文化の日');put(m,new Date(year,10,23),'勤労感謝の日');
  // Citizens' holiday: a weekday sandwiched between two statutory holidays.
  for(let d=new Date(year,0,2);d<=new Date(year,11,30);d=addDays(d,1)){
    const key=isoDate(d);if(m.has(key))continue;
    const prev=isoDate(addDays(d,-1)),next=isoDate(addDays(d,1));
    if(m.has(prev)&&m.has(next))m.set(key,'国民の休日');
  }
  // Substitute holiday: a statutory holiday on Sunday shifts to the first subsequent non-holiday.
  const originals=[...m.entries()].map(([k,n])=>[parseISO(k),n]);
  for(const [d] of originals){
    if(d.getDay()!==0)continue;
    let x=addDays(d,1);while(m.has(isoDate(x)))x=addDays(x,1);m.set(isoDate(x),'振替休日');
  }
  return m;
}
export function holidaysForFiscalYear(fy){const a=japanHolidays(Number(fy)),b=japanHolidays(Number(fy)+1);return new Map([...a,...b])}

export function calendarStats(state){
  const fy=Number(state.school.fiscalYear);
  const holidays=holidaysForFiscalYear(fy);
  const exceptions=new Map((state.calendar.exceptions||[]).map(x=>[x.date,x]));
  const termDates=new Set();
  for(const t of state.calendar.terms||[])for(const d of eachDate(t.start,t.end))termDates.add(isoDate(d));
  let instructionDays=0;const byMonth={};const byDate={};
  const start=new Date(fy,3,1),end=new Date(fy+1,2,31);
  for(let d=new Date(start);d<=end;d=addDays(d,1)){
    const key=isoDate(d);const ex=exceptions.get(key);const inTerm=termDates.has(key);const weekend=d.getDay()===0||d.getDay()===6;const holiday=holidays.get(key);
    let instruction=false,reason='';
    if(inTerm && !weekend && !holiday){instruction=true;reason='通常授業日'}
    if(ex){
      if(['school_holiday','substitute_holiday','closed'].includes(ex.type)){instruction=false;reason=ex.label||typeLabel(ex.type)}
      if(['saturday_instruction','special_instruction'].includes(ex.type)){instruction=true;reason=ex.label||typeLabel(ex.type)}
      if(ex.type==='national_override_off'){instruction=false;reason=ex.label||'休業日'}
      if(ex.type==='national_override_on'){instruction=true;reason=ex.label||'授業日'}
    }
    if(instruction){instructionDays++;const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;byMonth[mk]=(byMonth[mk]||0)+1}
    byDate[key]={date:key,inTerm,weekend,holiday:holiday||'',exception:ex||null,instruction,reason};
  }
  const weeks=instructionDays/5;
  return {fy,holidays,instructionDays,weeks,byMonth,byDate};
}
export function typeLabel(t){return ({school_holiday:'学校独自休業日',substitute_holiday:'振替休業日',closed:'休業日',saturday_instruction:'土曜授業日',special_instruction:'特別授業日',national_override_off:'特例休業日',national_override_on:'特例授業日'})[t]||t}

export function weeklyTargetForGrade(state,grade,stats){
  const plan=state.hourPlans.find(x=>Number(x.grade)===Number(grade));
  const annual=Number(plan?.annualTarget||0);const weeks=stats?.weeks||0;
  const avg=weeks?annual/weeks:0;
  const override=state.instruction.manualWeeklyTarget?Number(state.instruction.weeklyTargetOverride||0):0;
  const base=override||Math.ceil(avg);
  const cycle=Math.max(1,Math.min(3,Number(state.timetable.cycleWeeks||state.instruction.cycleWeeks||1)));
  let targets=[];
  if(override){targets=Array(cycle).fill(base)}
  else{
    const total=Math.round(avg*cycle),lo=Math.floor(total/cycle),rem=total-lo*cycle;
    targets=Array.from({length:cycle},(_,i)=>lo+(i<rem?1:0)).sort((a,b)=>b-a);
  }
  return {annual,weeks,avg,base,targets,cycle};
}
export function dailyPattern(target,maxPeriods=6){
  const t=Math.max(0,Number(target||0));const base=Math.floor(t/5),rem=t-base*5;const a=Array.from({length:5},(_,i)=>Math.min(maxPeriods,base+(i<rem?1:0)));
  let sum=a.reduce((x,y)=>x+y,0),i=0;while(sum<t&&i<100){const idx=i%5;if(a[idx]<maxPeriods){a[idx]++;sum++}i++}
  return a;
}
export function gradePatterns(state,stats){
  const out={};for(const hp of state.hourPlans){const w=weeklyTargetForGrade(state,hp.grade,stats);out[hp.grade]=w.targets.map(t=>dailyPattern(t,state.instruction.maxPeriods||state.periods.length||6))}return out;
}

export function monthMatrix(year,month0){
  const first=new Date(year,month0,1),last=new Date(year,month0+1,0);const start=addDays(first,-((first.getDay()+6)%7));const out=[];for(let i=0;i<42;i++){const d=addDays(start,i);out.push({date:d,inMonth:d.getMonth()===month0})}return out;
}
