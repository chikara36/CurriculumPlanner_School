const D=['月','火','水','木','金'];
const uid=()=>`p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
const clone=v=>JSON.parse(JSON.stringify(v));

function maps(m){return {
  cls:new Map(m.classes.map(x=>[x.id,x])),teach:new Map(m.teachers.map(x=>[x.id,x])),fac:new Map(m.facilities.map(x=>[x.id,x])),les:new Map(m.lessons.map(x=>[x.id,x]))
}}
function placementLesson(maps,p){return maps.les.get(p.lessonId)}
function effectiveTeachers(l,p){return (p?.teacherIdsOverride?.length?p.teacherIdsOverride:l.teacherIds||[]).filter(Boolean)}
function effectiveFacility(l,p){return p?.facilityIdOverride!==undefined?p.facilityIdOverride:l.facilityId}
function slotKey(w,d,p){return `${w}-${d}-${p}`}
function teacherUnavailable(t,w,d,p,absence=null){
  if(!t)return false;
  if((t.unavailable||[]).includes(`${d}-${p}`)||(t.unavailable||[]).includes(slotKey(w,d,p)))return true;
  if(absence&&absence.teacherId===t.id&&absence.week===w&&absence.day===d)return true;
  for(const lv of t.leaves||[]){
    if(lv.week!=='all'&&lv.week!==undefined&&Number(lv.week)!==Number(w))continue;
    if(Number(lv.day)!==Number(d))continue;
    const seg=lv.segment||'FULL';
    if(seg==='FULL')return true;
    if(seg==='AM'&&p<=Number(lv.endPeriod??2))return true;
    if(seg==='PM'&&p>=Number(lv.startPeriod??3))return true;
    if(seg==='RANGE'&&p>=Number(lv.startPeriod??0)&&p<=Number(lv.endPeriod??99))return true;
  }
  return false;
}
function facilityUnavailable(f,w,d,p){return !!f&&(f.unavailable||[]).some(x=>x===`${d}-${p}`||x===slotKey(w,d,p));}
function classDailyLimit(c,w,d){return Number(c.patterns?.[w]?.[d]??0)}
function occupiedPeriodsForClass(m,mp,placements,classId,w,d,ignore=new Set()){
  const s=new Set();for(const p of placements){if(ignore.has(p.id)||p.week!==w||p.day!==d)continue;const l=mp.les.get(p.lessonId);if(l?.classIds?.includes(classId))s.add(p.period)}return s;
}
function occupiedPeriodsForTeacher(m,mp,placements,teacherId,w,d,ignore=new Set()){
  const s=new Set();for(const p of placements){if(ignore.has(p.id)||p.week!==w||p.day!==d)continue;const l=mp.les.get(p.lessonId);if(effectiveTeachers(l,p).includes(teacherId))s.add(p.period)}return s;
}
function maxRun(set){const a=[...set].sort((a,b)=>a-b);let run=0,max=0,prev=-9;for(const x of a){run=x===prev+1?run+1:1;max=Math.max(max,run);prev=x}return max}
function firstMissingPrefix(occupied,limit){for(let i=0;i<limit;i++)if(!occupied.has(i))return i;return limit}

function groupLessons(m,lessonId){
  const l=m.lessons.find(x=>x.id===lessonId);if(!l)return [];
  if(!l.syncGroup)return [l];return m.lessons.filter(x=>x.syncGroup&&x.syncGroup===l.syncGroup);
}
function taskKey(l){return l.syncGroup?`g:${l.syncGroup}`:`l:${l.id}`}
function lessonBlockSize(l){return Math.max(1,Math.min(3,Number(l?.blockSize||1)))}
function tasks(m,placements){
  const counts=new Map();for(const p of placements)counts.set(p.lessonId,(counts.get(p.lessonId)||0)+1);
  const byKey=new Map();for(const l of m.lessons){const k=taskKey(l);if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(l)}
  const out=[];
  for(const [key,lessons] of byKey){
    const required=Math.max(...lessons.map(l=>Number(l.sessionsCycle||0)));
    const placed=Math.min(...lessons.map(l=>counts.get(l.id)||0));
    const configured=Math.max(...lessons.map(lessonBlockSize));
    for(let i=placed;i<required;){const span=Math.min(configured,required-i);out.push({key,lessonIds:lessons.map(l=>l.id),instance:i,span});i+=span}
  }
  return out;
}
function allSlots(m,span=1){const out=[];for(let w=0;w<m.cycleWeeks;w++)for(let d=0;d<5;d++)for(let p=0;p<=m.periodsCount-Math.max(1,span);p++)out.push({week:w,day:d,period:p});return out}

function hardForTask(m,mp,lessonIds,slot,placements,ignoreIds=[],absence=null,{prefix=true,candidatePlacements=[]}={}){
  const ignore=new Set(ignoreIds);const conflicts=[];const lessons=lessonIds.map(id=>mp.les.get(id)).filter(Boolean);
  if(!lessons.length)return [{type:'data',text:'授業定義がありません'}];
  const candClasses=new Set(),candTeachers=new Set(),candFacilities=[];
  for(const l of lessons){const cp=candidatePlacements.find(p=>p.lessonId===l.id);for(const c of l.classIds||[])candClasses.add(c);for(const t of effectiveTeachers(l,cp))if(t)candTeachers.add(t);const ef=effectiveFacility(l,cp);if(ef)candFacilities.push(ef)}
  for(const l of lessons){if((l.unavailable||[]).includes(`${slot.day}-${slot.period}`)||(l.unavailable||[]).includes(slotKey(slot.week,slot.day,slot.period)))conflicts.push({type:'lesson-unavailable',text:`${l.subject} は${D[slot.day]}曜${slot.period+1}限が配置不可`})}
  for(const cid of candClasses){
    const c=mp.cls.get(cid);const limit=classDailyLimit(c,slot.week,slot.day);
    if(slot.period>=limit){conflicts.push({type:'class-end',text:`${c?.name||cid} は${D[slot.day]}曜${limit}限まで`});continue}
    if(m.settings.studentNoGaps&&prefix){
      const occ=occupiedPeriodsForClass(m,mp,placements,cid,slot.week,slot.day,ignore);const next=firstMissingPrefix(occ,limit);
      if(!occ.has(slot.period)&&slot.period!==next)conflicts.push({type:'class-gap',text:`${c?.name||cid} は生徒の中抜けを避けるため${next+1}限から配置してください`});
    }
  }
  for(const tid of candTeachers){
    const t=mp.teach.get(tid);if(teacherUnavailable(t,slot.week,slot.day,slot.period,absence))conflicts.push({type:'teacher-unavailable',text:`${t?.name||tid} は${D[slot.day]}曜${slot.period+1}限が授業不可`});
  }
  for(const fid of candFacilities){const f=mp.fac.get(fid);if(facilityUnavailable(f,slot.week,slot.day,slot.period))conflicts.push({type:'facility-unavailable',text:`${f?.name||fid} は使用不可`})}
  const same=placements.filter(p=>!ignore.has(p.id)&&p.week===slot.week&&p.day===slot.day&&p.period===slot.period);
  for(const p of same){
    const l=placementLesson(mp,p);if(!l)continue;
    const classes=(l.classIds||[]).filter(x=>candClasses.has(x));
    // Parallel lessons in the same synchronization group may intentionally share a class cohort.
    const sameSync=lessons.some(cl=>cl.syncGroup&&cl.syncGroup===l.syncGroup);
    if(classes.length&&!sameSync)conflicts.push({type:'class-overlap',placementId:p.id,text:`${classes.map(x=>mp.cls.get(x)?.name||x).join('・')} に別授業があります`});
    const teachers=effectiveTeachers(l,p).filter(x=>candTeachers.has(x));if(teachers.length)conflicts.push({type:'teacher-overlap',placementId:p.id,text:`${teachers.map(x=>mp.teach.get(x)?.name||x).join('・')} が別授業を担当中`});
  }
  for(const tid of candTeachers){
    const t=mp.teach.get(tid),occ=occupiedPeriodsForTeacher(m,mp,placements,tid,slot.week,slot.day,ignore);occ.add(slot.period);
    const teacherDayPlacements=placements.filter(p=>!ignore.has(p.id)&&p.week===slot.week&&p.day===slot.day&&effectiveTeachers(mp.les.get(p.lessonId),p).includes(tid));
    const movableTeacherPlacement=teacherDayPlacements.find(p=>!p.locked)?.id;
    if(occ.size>Number(t?.maxDaily||99))conflicts.push({type:'teacher-maxdaily',placementId:movableTeacherPlacement,text:`${t?.name||tid} の1日授業上限 ${t?.maxDaily} を超えます`});
    if(t?.consecutiveHard&&maxRun(occ)>Number(t?.maxConsecutive||99))conflicts.push({type:'teacher-consecutive',placementId:movableTeacherPlacement,text:`${t?.name||tid} の連続授業上限 ${t?.maxConsecutive} を超えます`});
    const br=t?.breakRule;if(br?.enabled&&br.hard){const win=[];for(let p=Number(br.startPeriod);p<=Number(br.endPeriod);p++)win.push(p);const used=win.filter(p=>occ.has(p)).length;if(win.length-used<Number(br.minFreeSlots||1))conflicts.push({type:'teacher-break',placementId:movableTeacherPlacement,text:`${t?.name||tid} の休憩確保条件を満たしません`})}
  }
  const fCounts=new Map();for(const fid of candFacilities)fCounts.set(fid,(fCounts.get(fid)||0)+1);
  for(const [fid,candCount] of fCounts){
    const f=mp.fac.get(fid);const existing=same.filter(p=>effectiveFacility(placementLesson(mp,p),p)===fid).length;const cap=Math.max(1,Number(f?.capacity||1));if(existing+candCount>cap)conflicts.push({type:'facility-capacity',placementId:same.find(p=>effectiveFacility(placementLesson(mp,p),p)===fid)?.id,text:`${f?.name||fid} の同時利用上限 ${cap} を超えます`})
  }
  return conflicts;
}

function hardForBlockTask(m,mp,lessonIds,slot,placements,ignoreIds=[],absence=null,opts={},span=1){
  span=Math.max(1,Number(span||1));if(slot.period<0||slot.period+span>m.periodsCount)return [{type:'block-end',text:`${span}コマ連続ではこの開始時限に配置できません`}];
  let working=placements.slice();
  for(let off=0;off<span;off++){
    const s={week:slot.week,day:slot.day,period:slot.period+off};
    const cand=lessonIds.map((lessonId,i)=>({id:`cand_${off}_${i}`,lessonId,week:s.week,day:s.day,period:s.period,locked:false}));
    const conf=hardForTask(m,mp,lessonIds,s,working,ignoreIds,absence,{...opts,candidatePlacements:cand});
    if(conf.length)return conf;working=working.concat(cand);
  }
  return [];
}

function softForTask(m,mp,lessonIds,slot,placements,ignoreIds=[],absence=null){
  const ignore=new Set(ignoreIds);let cost=0;const reasons=[];const lessons=lessonIds.map(id=>mp.les.get(id)).filter(Boolean);cost+=slot.period*0.03;
  for(const l of lessons){
    for(const cid of l.classIds||[]){
      const sameDay=placements.filter(p=>!ignore.has(p.id)&&p.week===slot.week&&p.day===slot.day&&placementLesson(mp,p)?.classIds?.includes(cid));
      const sameSub=sameDay.filter(p=>placementLesson(mp,p)?.subject===l.subject);
      if(m.settings.avoidSameSubjectTwice&&sameSub.length){cost+=5;reasons.push('同一教科の同日重複')}
      if(sameSub.some(p=>Math.abs(p.period-slot.period)===1)){cost+=3;reasons.push('同一教科の連続')}
    }
    if((l.preferred||[]).length && !((l.preferred||[]).includes(`${slot.day}-${slot.period}`)||(l.preferred||[]).includes(slotKey(slot.week,slot.day,slot.period)))){cost+=0.7;reasons.push('希望時限外')}
    if(m.settings.avoidLastPE&&l.subject==='保健体育'){
      for(const cid of l.classIds||[]){const c=mp.cls.get(cid);const limit=classDailyLimit(c,slot.week,slot.day);if(slot.period===limit-1){cost+=2;reasons.push('保健体育が最終時限')}}
    }
    for(const tid of l.teacherIds||[]){
      if(!tid)continue;const t=mp.teach.get(tid),occ=occupiedPeriodsForTeacher(m,mp,placements,tid,slot.week,slot.day,ignore);occ.add(slot.period);
      const br=t?.breakRule;if(br?.enabled&&!br.hard){const win=[];for(let p=Number(br.startPeriod);p<=Number(br.endPeriod);p++)win.push(p);const used=win.filter(p=>occ.has(p)).length;if(win.length-used<Number(br.minFreeSlots||1)){cost+=8;reasons.push(`${t.name}の休憩確保`)}}
      const r=maxRun(occ),lim=Number(t?.maxConsecutive||99);if(!t?.consecutiveHard&&r>lim){cost+=8+(r-lim)*5;reasons.push(`${t?.name||tid}の連続授業が${r}コマ（目安${lim}）`)}else if(r===lim){cost+=1.5;reasons.push(`${t?.name||tid}の連続授業が目安上限`) }
    }
  }
  // Spread a subject over the cycle rather than clumping on one day.
  const first=lessons[0];if(first){const same=placements.filter(p=>!ignore.has(p.id)&&placementLesson(mp,p)?.subject===first.subject&&placementLesson(mp,p)?.classIds?.some(c=>(first.classIds||[]).includes(c)));const wd=same.filter(p=>p.week===slot.week&&p.day===slot.day).length;cost+=wd*1.2}
  return {cost,reasons:[...new Set(reasons)]};
}
function softForBlockTask(m,mp,lessonIds,slot,placements,ignoreIds=[],absence=null,span=1){
  let cost=0,reasons=[],working=placements.slice();span=Math.max(1,Number(span||1));
  for(let off=0;off<span;off++){const s={week:slot.week,day:slot.day,period:slot.period+off};const r=softForTask(m,mp,lessonIds,s,working,ignoreIds,absence);cost+=r.cost;reasons.push(...r.reasons);working.push(...lessonIds.map((lessonId,i)=>({id:`soft_${off}_${i}`,lessonId,week:s.week,day:s.day,period:s.period,locked:false})))}
  return {cost,reasons:[...new Set(reasons)]};
}
function makePlacements(lessonIds,slot,span=1){const blockId=uid();const out=[];for(let off=0;off<Math.max(1,Number(span||1));off++)for(const lessonId of lessonIds)out.push({id:uid(),blockId,lessonId,week:slot.week,day:slot.day,period:slot.period+off,locked:false});return out}
function difficulty(m,mp,task,placements){
  let resource=0,scarcity=0;for(const id of task.lessonIds){const l=mp.les.get(id);resource+=(l.classIds?.length||0)*3+(l.teacherIds?.filter(Boolean).length||0)*4+(l.facilityId&&l.facilityId!=='normal'?6:0)+(l.syncGroup?10:0)+(lessonBlockSize(l)>1?12:0);for(const tid of l.teacherIds||[]){const t=mp.teach.get(tid);scarcity+=(t?.unavailable||[]).length+(t?.leaves||[]).length*3}const f=mp.fac.get(l.facilityId);if(f&&Number(f.capacity||1)===1&&l.facilityId!=='normal')scarcity+=5}
  return {resource,scarcity,rank:-(resource+scarcity)};
}
function scheduleMetrics(m,placements,absence=null){
  const mp=maps(m);let hard=[];const prior=[];
  const grouped=new Map();for(const p of placements){const l=mp.les.get(p.lessonId);const k=l?.syncGroup?`${l.syncGroup}|${p.week}|${p.day}|${p.period}`:`${p.id}`;if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(p)}
  for(const ps of grouped.values()){
    const lessonIds=ps.map(p=>p.lessonId),slot=ps[0];const ids=ps.map(p=>p.id);hard.push(...hardForTask(m,mp,lessonIds,slot,prior,[],absence,{prefix:false,candidatePlacements:ps}).map(x=>({...x,placementIds:ids})));prior.push(...ps)
  }
  // Final student gap check.
  if(m.settings.studentNoGaps){for(const c of m.classes)for(let w=0;w<m.cycleWeeks;w++)for(let d=0;d<5;d++){const occ=occupiedPeriodsForClass(m,mp,placements,c.id,w,d);if(!occ.size)continue;const max=Math.max(...occ);for(let p=0;p<=max;p++)if(!occ.has(p))hard.push({type:'class-gap',text:`${c.name} ${w+1}週 ${D[d]}曜に中抜けがあります`})}}
  let soft=0;const prev=[];for(const p of placements){const l=mp.les.get(p.lessonId);soft+=softForTask(m,mp,[p.lessonId],p,prev).cost;prev.push(p)}
  const reqCounts=new Map(m.lessons.map(l=>[l.id,Number(l.sessionsCycle||0)]));const actual=new Map();for(const p of placements)actual.set(p.lessonId,(actual.get(p.lessonId)||0)+1);
  let unplaced=0;for(const [id,n] of reqCounts)unplaced+=Math.max(0,n-(actual.get(id)||0));
  const score=Math.max(0,Math.round(100-hard.length*25-unplaced*4-Math.min(30,soft/18)));return {hard,soft,unplaced,placed:placements.length,locked:placements.filter(p=>p.locked).length,score}
}
function tryOneRepair(m,mp,placements,task){
  if(Number(task.span||1)>1)return null;
  const slots=allSlots(m);
  for(const slot of slots){
    const conf=hardForTask(m,mp,task.lessonIds,slot,placements,[],null,{prefix:false});const blockerIds=[...new Set(conf.map(x=>x.placementId).filter(Boolean))];if(conf.some(x=>!x.placementId)||blockerIds.length!==1)continue;
    const blocker=placements.find(p=>p.id===blockerIds[0]);if(!blocker||blocker.locked)continue;
    const bl=mp.les.get(blocker.lessonId);const related=bl?.syncGroup?placements.filter(p=>{const l=mp.les.get(p.lessonId);return l?.syncGroup===bl.syncGroup&&p.week===blocker.week&&p.day===blocker.day&&p.period===blocker.period}):[blocker];
    if(related.some(p=>p.locked))continue;const ids=related.map(p=>p.id),without=placements.filter(p=>!ids.includes(p.id));
    if(hardForTask(m,mp,task.lessonIds,slot,without,[],null,{prefix:false}).length)continue;
    const blIds=related.map(p=>p.lessonId);
    for(const alt of slots){if(alt.week===slot.week&&alt.day===slot.day&&alt.period===slot.period)continue;if(hardForTask(m,mp,blIds,alt,without,[],null,{prefix:false}).length===0){return [...without,...related.map((p,i)=>({...p,week:alt.week,day:alt.day,period:alt.period})),...makePlacements(task.lessonIds,slot)]}}
  }
  return null;
}
function solve(m,mode='rebuild'){
  const mp=maps(m);const base=mode==='fill'?clone(m.placements||[]):clone((m.placements||[]).filter(p=>p.locked));const restarts=Math.max(4,Math.min(80,Number(m.settings.restarts||16)));let best=null;
  for(let a=0;a<restarts;a++){
    let ps=clone(base),pending=tasks(m,ps);pending=pending.map(t=>({...t,d:difficulty(m,mp,t,ps)})).sort((x,y)=>x.d.rank-y.d.rank+(Math.random()-.5)*20);
    const stuck=[];
    for(const task of pending){
      const cands=[];for(const slot of allSlots(m,task.span)){const hard=hardForBlockTask(m,mp,task.lessonIds,slot,ps,[],null,{prefix:false},task.span);if(hard.length)continue;const soft=softForBlockTask(m,mp,task.lessonIds,slot,ps,[],null,task.span);cands.push({...slot,cost:soft.cost+Math.random()*1.4})}
      cands.sort((x,y)=>x.cost-y.cost);if(cands.length){const pool=cands.slice(0,Math.min(3,cands.length));const s=pool[Math.floor(Math.random()*pool.length)];ps.push(...makePlacements(task.lessonIds,s,task.span))}else stuck.push(task)
    }
    for(const task of stuck){const repaired=tryOneRepair(m,mp,ps,task);if(repaired)ps=repaired}
    const met=scheduleMetrics(m,ps);const rank=met.hard.length*100000+met.unplaced*2000+met.soft;if(!best||rank<best.rank)best={rank,placements:ps,metrics:met};if(met.hard.length===0&&met.unplaced===0&&met.soft<15)break;
  }
  return best||{placements:base,metrics:scheduleMetrics(m,base)};
}

function placeLesson(m,lessonId,target){
  const mp=maps(m),lessons=groupLessons(m,lessonId);if(!lessons.length)return {ok:false,conflicts:[{text:'授業が見つかりません'}]};
  const ids=lessons.map(x=>x.id),left=[];for(const l of lessons){const placed=m.placements.filter(p=>p.lessonId===l.id).length,remain=Number(l.sessionsCycle||0)-placed;if(remain<=0)return {ok:false,conflicts:[{text:`${l.subject} は必要コマ数を配置済みです`}]};left.push(remain)}
  const span=Math.min(Math.max(...lessons.map(lessonBlockSize)),Math.min(...left));const conf=hardForBlockTask(m,mp,ids,target,m.placements,[],null,{prefix:true},span);if(conf.length)return {ok:false,conflicts:conf};const ps=[...m.placements,...makePlacements(ids,target,span)];return {ok:true,placements:ps,metrics:scheduleMetrics(m,ps)};
}

function movePlacement(m,placementId,target){
  const mp=maps(m),p=m.placements.find(x=>x.id===placementId);if(!p)return {ok:false,conflicts:[{text:'配置が見つかりません'}]};const l=mp.les.get(p.lessonId);
  const related=p.blockId?m.placements.filter(x=>x.blockId===p.blockId):(l?.syncGroup?m.placements.filter(x=>{const q=mp.les.get(x.lessonId);return q?.syncGroup===l.syncGroup&&x.week===p.week&&x.day===p.day&&x.period===p.period}):[p]);if(related.some(x=>x.locked))return {ok:false,conflicts:[{text:'固定された授業は移動できません'}]};
  const ids=related.map(x=>x.id),without=m.placements.filter(x=>!ids.includes(x.id)),basePeriod=Math.min(...related.map(x=>x.period)),lastPeriod=Math.max(...related.map(x=>x.period)),span=lastPeriod-basePeriod+1,dragOffset=p.period-basePeriod,start={week:target.week,day:target.day,period:target.period-dragOffset};if(start.period<0)return {ok:false,conflicts:[{text:'連続授業の開始時限が範囲外です'}]};
  const lessonIds=[...new Set(related.filter(x=>x.period===basePeriod).map(x=>x.lessonId))];const conf=hardForBlockTask(m,mp,lessonIds,start,without,[],null,{prefix:false},span);if(conf.length)return {ok:false,conflicts:conf};const moved=related.map(x=>({...x,week:start.week,day:start.day,period:start.period+(x.period-basePeriod)}));return {ok:true,placements:[...without,...moved],metrics:scheduleMetrics(m,[...without,...moved])}
}

function substituteCandidate(m,mp,placements,p,absentId,absence){
  const l=mp.les.get(p.lessonId),old=effectiveTeachers(l,p),subject=l.subject;
  const pools=[m.teachers.filter(t=>t.id!==absentId&&t.subjects?.includes(subject)),m.teachers.filter(t=>t.id!==absentId&&t.substituteEligible!==false&&!t.subjects?.includes(subject))];
  for(let poolIndex=0;poolIndex<pools.length;poolIndex++)for(const t of pools[poolIndex]){if(teacherUnavailable(t,p.week,p.day,p.period,absence))continue;const busy=placements.some(q=>q.id!==p.id&&q.week===p.week&&q.day===p.day&&q.period===p.period&&effectiveTeachers(mp.les.get(q.lessonId),q).includes(t.id));if(busy)continue;const newIds=old.map(x=>x===absentId?t.id:x);const test={...p,teacherIdsOverride:newIds},without=placements.filter(q=>q.id!==p.id),lm={...l,teacherIds:newIds},tempMap=new Map(mp.les);tempMap.set(l.id,lm);const mp2={...mp,les:tempMap};if(hardForTask(m,mp2,[l.id],test,without,[],absence,{prefix:false}).length===0)return {teacherId:t.id,name:t.name,newIds,qualified:poolIndex===0}}
  return null;
}

function swapCandidate(m,mp,placements,p,absentId,absence){
  const l=mp.les.get(p.lessonId);if(l.syncGroup||l.classIds?.length!==1)return null;const cid=l.classIds[0];
  for(const q of placements){if(q.id===p.id||q.week!==p.week||q.day===p.day||q.locked)continue;const ql=mp.les.get(q.lessonId);if(ql?.syncGroup||!ql?.classIds?.includes(cid))continue;
    // absent teacher must be available at q's day/time; q's teachers available at p's day/time.
    if(teacherUnavailable(mp.teach.get(absentId),q.week,q.day,q.period,null))continue;
    const without=placements.filter(x=>x.id!==p.id&&x.id!==q.id);const movedP={...p,week:q.week,day:q.day,period:q.period};const movedQ={...q,week:p.week,day:p.day,period:p.period};
    if(hardForTask(m,mp,[p.lessonId],movedP,without,[],null,{prefix:false}).length)continue;const temp=[...without,movedP];if(hardForTask(m,mp,[q.lessonId],movedQ,temp,[],absence,{prefix:false}).length)continue;return {p:movedP,q:movedQ,description:`${l.subject}を${D[q.day]}${q.period+1}限へ、${ql.subject}を${D[p.day]}${p.period+1}限へ交換`};
  }return null;
}
function absenceProposals(m,teacherId,week,day){
  const mp=maps(m),absence={teacherId,week:Number(week),day:Number(day)},affected=m.placements.filter(p=>p.week===absence.week&&p.day===absence.day&&effectiveTeachers(mp.les.get(p.lessonId),p).includes(teacherId));
  if(!affected.length)return {affected:[],proposals:[]};const proposals=[];
  // Proposal 1: substitute-first.
  {let ps=clone(m.placements),changes=[],ok=true;for(const ap of affected){const p=ps.find(x=>x.id===ap.id);const sub=substituteCandidate(m,mp,ps,p,teacherId,absence);if(sub){p.teacherIdsOverride=sub.newIds;changes.push({type:sub.qualified?'substitute':'supervision',text:`${mp.les.get(p.lessonId).subject}：${mp.teach.get(teacherId)?.name} → ${sub.name}${sub.qualified?'':'（自習・課題対応候補）'}`})}else{const sw=swapCandidate(m,mp,ps,p,teacherId,absence);if(sw){ps=ps.filter(x=>x.id!==sw.p.id&&x.id!==sw.q.id).concat(sw.p,sw.q);changes.push({type:'swap',text:sw.description})}else{ok=false;changes.push({type:'unresolved',text:`${mp.les.get(p.lessonId).subject}は自動解決できませんでした`})}}}const met=scheduleMetrics(m,ps,absence);proposals.push({id:'sub-first',title:'代替教員優先案',ok:ok&&met.hard.length===0,placements:ps,changes,metrics:met})}
  // Proposal 2: swap-first.
  {let ps=clone(m.placements),changes=[],ok=true;for(const ap of affected){const p=ps.find(x=>x.id===ap.id);const sw=swapCandidate(m,mp,ps,p,teacherId,absence);if(sw){ps=ps.filter(x=>x.id!==sw.p.id&&x.id!==sw.q.id).concat(sw.p,sw.q);changes.push({type:'swap',text:sw.description})}else{const sub=substituteCandidate(m,mp,ps,p,teacherId,absence);if(sub){p.teacherIdsOverride=sub.newIds;changes.push({type:sub.qualified?'substitute':'supervision',text:`${mp.les.get(p.lessonId).subject}：${mp.teach.get(teacherId)?.name} → ${sub.name}${sub.qualified?'':'（自習・課題対応候補）'}`})}else{ok=false;changes.push({type:'unresolved',text:`${mp.les.get(p.lessonId).subject}は自動解決できませんでした`})}}}const met=scheduleMetrics(m,ps,absence);proposals.push({id:'swap-first',title:'時間割交換優先案',ok:ok&&met.hard.length===0,placements:ps,changes,metrics:met})}
  // Proposal 3: minimal edits = rank the above, keep a distinct label; if identical, omit.
  const uniq=[];for(const p of proposals){const sig=JSON.stringify(p.placements.map(x=>[x.id,x.week,x.day,x.period,x.teacherIdsOverride||[]]).sort());if(!uniq.some(x=>x.sig===sig))uniq.push({...p,sig})}
  return {affected,proposals:uniq.map(({sig,...x})=>x).sort((a,b)=>(a.metrics.hard.length*100+a.changes.length)-(b.metrics.hard.length*100+b.changes.length))};
}

self.onmessage=e=>{
  const {id,action,model}=e.data||{};try{
    let result;
    if(action==='solve')result=solve(model,e.data.mode||'rebuild');
    else if(action==='metrics')result=scheduleMetrics(model,model.placements||[]);
    else if(action==='move')result=movePlacement(model,e.data.placementId,e.data.target);
    else if(action==='place')result=placeLesson(model,e.data.lessonId,e.data.target);
    else if(action==='absence')result=absenceProposals(model,e.data.teacherId,e.data.week,e.data.day);
    else throw new Error('Unknown solver action');
    self.postMessage({id,ok:true,result});
  }catch(err){self.postMessage({id,ok:false,error:err?.stack||String(err)})}
};
