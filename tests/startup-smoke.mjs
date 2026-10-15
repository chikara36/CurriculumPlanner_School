import assert from 'node:assert/strict';
const nodes=new Map();
function node(sel){if(!nodes.has(sel))nodes.set(sel,{innerHTML:'',textContent:'',className:'',hidden:false,addEventListener(){},appendChild(){},remove(){}});return nodes.get(sel)}
globalThis.document={body:node('body'),querySelector:node,querySelectorAll:()=>[],createElement:()=>node('created')};
globalThis.window={addEventListener(){},onLine:true};
globalThis.navigator={onLine:true};
await import('../app.js');
await new Promise(resolve=>setTimeout(resolve,100));
assert(!document.body.innerHTML.includes('起動エラー'),document.body.innerHTML);
assert(document.querySelector('#nav').innerHTML.includes('基本情報'),'navigation must render');
assert(document.querySelector('#content').innerHTML.includes('学校情報'),'default page must render');
console.log('Startup smoke passed');
