// v1.0.1 startup hotfix
// app.js v1.0.0 contains one duplicated top-level handleChange declaration.
// ES modules reject duplicate top-level function declarations, so patch the source
// before evaluating it. This keeps the deployed app usable while preserving the
// original source for traceability.
(async()=>{
  try{
    const appUrl=new URL('./app.js',location.href);
    const res=await fetch(appUrl,{cache:'no-store'});
    if(!res.ok)throw new Error(`app.js の取得に失敗しました (${res.status})`);
    let src=await res.text();

    const legacy="function handleChange(e){const path=e.target.dataset.bind;if(path&&e.target.dataset.rerender!==undefined){state.updatedAt=new Date().toISOString();scheduleSave();render();if(['resources','timetable','days','hours'].includes(state.ui.page))refreshMetrics()}}\n";
    if(src.includes(legacy)) src=src.replace(legacy,'');

    // Blob modules have no repository-relative base URL, so convert static imports
    // to absolute URLs before evaluating the patched module.
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
