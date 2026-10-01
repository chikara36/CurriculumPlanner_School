// v1.0.3 startup repair
// The original uploaded app.js contains two source-level issues. Until app.js is
// rewritten directly, repair those exact regions deterministically before import.
(async()=>{
  try{
    const appUrl=new URL('./app.js',location.href);
    const res=await fetch(appUrl,{cache:'no-store'});
    if(!res.ok)throw new Error(`app.js の取得に失敗しました (${res.status})`);
    let src=await res.text();

    // 1) Remove the first compact handleChange declaration. A fuller declaration
    // later in app.js is the one we keep.
    const legacy="function handleChange(e){const path=e.target.dataset.bind;if(path&&e.target.dataset.rerender!==undefined){state.updatedAt=new Date().toISOString();scheduleSave();render();if(['resources','timetable','days','hours'].includes(state.ui.page))refreshMetrics()}}\n";
    if(src.includes(legacy)) src=src.replace(legacy,'');

    // 2) Fix renderAbsenceResults. The uploaded source ends its return statement
    // with `)}` and then closes the function again on the next line. Work only
    // inside that function, replacing its final `)}` with `);`.
    const fnStart=src.indexOf('function renderAbsenceResults(cache){');
    const fnEnd=src.indexOf('\n\nfunction renderChecks(){',fnStart);
    if(fnStart<0||fnEnd<0)throw new Error('renderAbsenceResults の修正対象を特定できませんでした');
    let block=src.slice(fnStart,fnEnd);
    const bad=block.lastIndexOf(')}');
    if(bad<0)throw new Error('renderAbsenceResults の不正な末尾を特定できませんでした');
    block=block.slice(0,bad)+');'+block.slice(bad+2);
    src=src.slice(0,fnStart)+block+src.slice(fnEnd);

    // Blob modules have no repository-relative base URL, so convert imports.
    src=src.replace(/from\s+(['"])\.\/([^'"]+)\1/g,(_,q,path)=>`from ${JSON.stringify(new URL('./'+path,location.href).href)}`);

    const blobUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
    try{await import(blobUrl)}finally{URL.revokeObjectURL(blobUrl)}
  }catch(err){
    console.error(err);
    const pre=document.createElement('pre');
    pre.style.cssText='white-space:pre-wrap;padding:24px;font:14px/1.6 system-ui;color:#8b1e1e';
    pre.textContent='起動エラー\n\n'+(err?.stack||err?.message||String(err));
    const content=document.getElementById('content')||document.body;
    content.replaceChildren(pre);
  }
})();
