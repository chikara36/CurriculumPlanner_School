import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const name=pathname.endsWith('/')?pathname+'index.html':pathname;
  const full=path.resolve(base,'.'+name);
  if(!full.startsWith(base+path.sep)){res.writeHead(403).end();return}
  const bytes=await fs.readFile(full);res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
 }catch(err){res.writeHead(404).end('Not found')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
 await page.locator('#nav [data-nav="basic"]').waitFor({timeout:15000});
 assert((await page.locator('#content').innerText()).includes('学校情報'));
 await page.locator('[data-nav="resources"]').click();
 await page.locator('[data-action="resourceTab"][data-tab="teachers"]').click();
 await page.locator('[data-action="teacherMaster"]').first().click();
 await page.locator('.modal-backdrop').waitFor();
 await page.locator('[name="teacherMasterSubjects"]').first().check();
 await page.locator('[name="teacherMasterRoles"]').first().check();
 await page.locator('[data-action="saveTeacherMaster"]').click();
 assert.equal(await page.locator('.modal-backdrop').count(),0,'modal Save must close the modal');
 await page.locator('[data-action="resourceTab"][data-tab="classes"]').click();
 await page.locator('[data-action="addClass"]').click();
 assert((await page.locator('#content input[value="1年3組"]').count())>0,'new class should be shown in the class input');
 await page.locator('[data-action="resourceTab"][data-tab="assignments"]').click();
 assert((await page.locator('#content').innerText()).includes('1年3組'),'new class must have generated assignments');
 await page.locator('[data-action="resourceTab"][data-tab="lessons"]').click();
 await page.locator('[data-action="editLesson"]').first().click();
 await page.locator('.modal-backdrop').waitFor();
 await page.locator('[data-action="saveLesson"]').click();
 assert.equal(await page.locator('.modal-backdrop').count(),0,'lesson details should save via delegated event');
 await page.locator('[data-action="resourceTab"][data-tab="classes"]').click();
 const gradeField=page.locator('input[data-bind^="resources.classes."][data-bind$=".grade"]').first();
 page.once('dialog',dialog=>dialog.dismiss());
 await gradeField.fill('2');await gradeField.press('Tab');
 assert.equal(await gradeField.inputValue(),'1','cancelled grade switch must restore original grade');
 await page.locator('[data-nav="hours"]').click();
 const table=page.locator('.hours-adjust-table').first();
 const widthBefore=await table.evaluate(el=>el.getBoundingClientRect().width);
 const slider=page.locator('[data-hours-adjust]').first();
 await slider.evaluate(el=>{el.value=String(Math.max(Number(el.min),-5));el.dispatchEvent(new Event('change',{bubbles:true}))});
 await page.locator('.hours-adjust-table').first().waitFor();
 const widthAfter=await table.evaluate(el=>el.getBoundingClientRect().width);
 assert(Math.abs(widthBefore-widthAfter)<2,'hour table width should remain fixed');
 assert((await page.locator('.hours-percent-cell').first().innerText()).includes('％'));
 await page.locator('[data-nav="basic"]').click();
 page.once('dialog',dialog=>dialog.dismiss());
 await page.locator('[data-bind="school.type"]').selectOption('elementary');
 assert.equal(await page.locator('[data-bind="school.type"]').inputValue(),'junior_high','cancelled switch must restore school type');
 await page.waitForTimeout(800);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('[data-nav="resources"]').click();
 await page.locator('[data-action="resourceTab"][data-tab="classes"]').click();
 assert((await page.locator('#content input[value="1年3組"]').count())>0,'class data should persist after reload');
 await page.locator('[data-action="resourceTab"][data-tab="teachers"]').click();
 await page.locator('[data-action="teacherMaster"]').first().click();
 assert((await page.locator('input[name="teacherMasterRoles"]:checked').count())>=1,'saved roles must persist');
 await page.locator('[data-action="closeModal"]').last().click();
 assert.deepEqual(errors,[],'browser errors: '+errors.join('; '));
 console.log('Real Chrome E2E passed: startup, teacher modal, class creation, fixed table, cancelled school switch, persistence.');
}catch(err){
 if(page){await fs.mkdir(path.join(base,'artifacts'),{recursive:true});await page.screenshot({path:path.join(base,'artifacts','browser-failure.png')}).catch(()=>{})}
 throw err;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
