let gisPromise=null;
function loadGIS(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();
  if(gisPromise)return gisPromise;
  gisPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.defer=true;s.onload=()=>resolve();s.onerror=()=>reject(new Error('Google Identity Services を読み込めませんでした'));document.head.appendChild(s);
  });return gisPromise;
}
async function token(clientId){
  if(!navigator.onLine)throw new Error('Drive同期にはインターネット接続が必要です');
  if(!clientId?.trim())throw new Error('Google OAuth Client ID を設定してください');
  await loadGIS();
  return new Promise((resolve,reject)=>{
    const tc=google.accounts.oauth2.initTokenClient({client_id:clientId.trim(),scope:'https://www.googleapis.com/auth/drive.file',callback:r=>{if(r.error)reject(new Error(r.error));else resolve(r.access_token)},error_callback:e=>reject(new Error(e?.message||'Google認証に失敗しました'))});
    tc.requestAccessToken({prompt:''});
  });
}
async function driveFetch(accessToken,url,opts={}){
  const res=await fetch(url,{...opts,headers:{Authorization:`Bearer ${accessToken}`,...(opts.headers||{})}});if(!res.ok){let t='';try{t=await res.text()}catch{}throw new Error(`Google Drive API ${res.status}: ${t.slice(0,250)}`)}return res;
}
function escQ(s){return String(s).replace(/'/g,"\\'")}
async function findFolder(tok,name){
  const q=encodeURIComponent(`name='${escQ(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);const r=await driveFetch(tok,`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);const j=await r.json();return j.files?.[0]||null;
}
async function createFolder(tok,name){const r=await driveFetch(tok,'https://www.googleapis.com/drive/v3/files?fields=id,name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder'})});return r.json()}
async function findFile(tok,name,folderId){const q=encodeURIComponent(`name='${escQ(name)}' and '${folderId}' in parents and trashed=false`);const r=await driveFetch(tok,`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&spaces=drive`);const j=await r.json();return j.files?.[0]||null}
function multipart(metadata,text){const boundary='-------curriculumBoundary'+Math.random().toString(36).slice(2);const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;return {boundary,body}}

export async function saveToDrive(state){
  const tok=await token(state.drive.clientId);let folder=state.drive.folderId?{id:state.drive.folderId}:await findFolder(tok,state.drive.folderName||'CurriculumPlanner');if(!folder)folder=await createFolder(tok,state.drive.folderName||'CurriculumPlanner');
  const filename=`${(state.school.code||state.school.name||'school').replace(/[\\/:*?"<>|]/g,'_')}_${state.school.fiscalYear}_curriculum.json`;let f=state.drive.fileId?{id:state.drive.fileId}:await findFile(tok,filename,folder.id);
  const payload=JSON.stringify({...state,drive:{...state.drive,folderId:folder.id,fileId:f?.id||state.drive.fileId,lastSyncAt:new Date().toISOString()}},null,2);
  if(f?.id){await driveFetch(tok,`https://www.googleapis.com/upload/drive/v3/files/${f.id}?uploadType=media&fields=id,modifiedTime`,{method:'PATCH',headers:{'Content-Type':'application/json; charset=UTF-8'},body:payload});}
  else{const {boundary,body}=multipart({name:filename,parents:[folder.id],mimeType:'application/json'},payload);const r=await driveFetch(tok,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});f=await r.json()}
  return {folderId:folder.id,fileId:f.id,lastSyncAt:new Date().toISOString(),filename};
}

export async function loadFromDrive(state){
  const tok=await token(state.drive.clientId);let folder=state.drive.folderId?{id:state.drive.folderId}:await findFolder(tok,state.drive.folderName||'CurriculumPlanner');if(!folder)throw new Error('Drive上に保存フォルダが見つかりません');
  const filename=`${(state.school.code||state.school.name||'school').replace(/[\\/:*?"<>|]/g,'_')}_${state.school.fiscalYear}_curriculum.json`;let f=state.drive.fileId?{id:state.drive.fileId}:await findFile(tok,filename,folder.id);if(!f)throw new Error('Drive上にこの学校・年度の保存データが見つかりません');
  const r=await driveFetch(tok,`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);const text=await r.text();return {data:JSON.parse(text),folderId:folder.id,fileId:f.id,filename};
}
