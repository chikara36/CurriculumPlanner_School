// v1.0.2 startup hotfix
// Patch two syntax issues in the uploaded v1.0.0 app.js before evaluating it:
// 1) duplicated top-level handleChange declaration
// 2) an extra closing brace at the end of renderAbsenceResults
(async()=>{
  try{
    const appUrl=new URL('./app.js',location.href);
    const res=await fetch(appUrl,{cache:'no-store'});
    if(!res.ok)throw new Error(`app.js の取得に失敗しました (${res.status})`);
    let src=await res.text();

    const legacy="function handleChange(e){const path=e.target.dataset.bind;if(path&&e.target.dataset.rerender!==undefined){state.updatedAt=new Date().toISOString();scheduleSave();render();if(['resources','timetable','days','hours'].includes(state.ui.page))refreshMetrics()}}\n";
    if(src.includes(legacy)) src=src.replace(legacy,'');

    // Uploaded app.js has `return card('変更案', ... )}` followed by another `}`.
    // Remove only the extra brace attached to that return statement.
    src=src.replace(
      /return card\('変更案',([\s\S]*?)`\)\}\n\}/,
      "return card('変更案',$1`);\n}"
    );

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
