const DB_NAME='curriculum-planner-school';const DB_VERSION=1;const STORE='state';const KEY='current';
let dbPromise=null;
function openDb(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });return dbPromise;
}
export async function loadState(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
export async function saveState(state){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(state,KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
export async function clearState(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
export function downloadText(filename,text,type='application/json'){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
export function readFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsText(file)})}
