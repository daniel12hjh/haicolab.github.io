import { chromium } from '@playwright/test';
import { fixture } from './eng2112.test.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const course='eng2112';

const {config}=await import(`../../courses/${course}/2026-fall/team-building/config.js`);
const base=`http://127.0.0.1:8765/courses/${course}/2026-fall/team-building/`;
const courseTitle='Linguistics with AI';
const demoSearch='polite';
const demoTitle='When polite words miss the point';
const artifacts=new URL(`../../../artifacts/team-building-${course}/`,import.meta.url);
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[];
const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'?demo=1');
await page.locator('.card').first().waitFor();
assert((await page.locator('footer').innerText()).includes(courseTitle));
assert.equal(await page.locator('.card').count(),3);
await page.screenshot({path:fileURLToPath(new URL('desktop.png',artifacts)),fullPage:true});
await page.getByRole('button',{name:'Recruiting',exact:true}).click();
assert.equal(await page.locator('.card').count(),2);
await page.getByRole('searchbox').fill(demoSearch);
assert.equal(await page.locator('.card').count(),1);
await page.locator('.card').click();
await page.getByRole('heading',{name:demoTitle}).waitFor();
await page.setViewportSize({width:390,height:844});
await page.goto(base+'?demo=1');
await page.locator('.card').first().waitFor();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.screenshot({path:fileURLToPath(new URL('mobile.png',artifacts)),fullPage:true});
await page.getByRole('link',{name:'＋ Share an idea'}).click();
await page.locator('form[data-form="idea"]').waitFor();
assert.equal(await page.locator('#image').getAttribute('required'),'');
assert.deepEqual(await page.locator('#target_size option').evaluateAll(xs=>xs.map(x=>x.value)),['1','2','3','4']);
assert.equal(/[가-힣]/.test(await page.locator('body').innerText()),false);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
console.log('PASS browser: desktop/mobile demo, filters, search, detail, required image, no overflow');

const f=await fixture(course);const {db,admin,users:[a,b,c],act,post}=f;
const ai=(await post(a)).id;
await act(b,'apply',{idea_id:ai,message:'조사와 디자인을 함께하고 싶습니다.'});
await act(c,'comment',{idea_id:ai,body:'<img src=x onerror="window.XSS=true">'});
const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#d9ef8c';x.fillRect(0,0,320,180);x.fillStyle='#244b40';x.fillText('Project idea',40,90);return c.toDataURL('image/png').split(',')[1];}),'base64');
async function userPage(user,viewport={width:1280,height:900}){
 const context=await browser.newContext({viewport});
 const session={access_token:`test-token-${user}`,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',role:'authenticated',email:`${user}@example.edu`,app_metadata:{provider:'email'},user_metadata:{}}};
 const storageKey=config.authStorageKey||`sb-${new URL(config.supabaseUrl).hostname.split('.')[0]}-auth-token`;
 await context.addInitScript(({session,storageKey})=>localStorage.setItem(storageKey,JSON.stringify(session)),{session,storageKey});
 await context.route(config.supabaseUrl+'/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  const json=async(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  try{
   if(url.pathname.endsWith('/rpc/eng2112_read'))return json(await f.read(user));
   if(url.pathname.endsWith('/rpc/eng2112_enroll')){const {student_number,invite_code}=req.postDataJSON();return json(await f.enroll(user,student_number,invite_code));}
   if(url.pathname.endsWith('/rpc/eng2112_action')){const {action,payload}=req.postDataJSON();return json(await f.act(user,action,payload));}
   if(url.pathname==='/storage/v1/object/sign/eng2112-images'){return json(req.postDataJSON().paths.map(path=>({path,signedURL:`/object/sign/eng2112-images/${path}?token=test`,error:null})));}
   if(url.pathname.startsWith('/storage/v1/object/sign/'))return route.fulfill({contentType:'image/png',body:png});
   if(url.pathname.startsWith('/storage/v1/object/eng2112-images/')&&req.method()==='POST'){const name=url.pathname.split('/eng2112-images/')[1];await db.query("insert into storage.objects(bucket_id,name) values('eng2112-images',$1)",[name]);return json({Key:`eng2112-images/${name}`,Id:'image-id'});}
   if(url.pathname.endsWith('/auth/v1/logout'))return json({});
   if(url.pathname.endsWith('/auth/v1/user'))return json(session.user);
   return json({error:'unexpected mock route'},400);
  }catch(error){return json({message:error.message,code:'P0001'},400);}
 });
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('.hero, form[data-form="enroll"]').waitFor();return p;
}
const pa=await userPage(a);await pa.goto(base+'#activity');await pa.getByRole('heading',{name:'Applications to our team'}).waitFor();
await pa.getByRole('button',{name:'Make an offer',exact:true}).click();await pa.getByText('Offer received',{exact:true}).waitFor();
const pb=await userPage(b);await pb.goto(base+'#activity');pb.on('dialog',d=>d.accept());await pb.getByRole('button',{name:'Accept offer and join'}).click();await pb.getByText('Joined',{exact:true}).waitFor();
assert.equal((await f.read(b)).members.find(m=>m.user_id===b).idea_id,ai);
console.log('PASS browser: private application → leader offer → applicant acceptance');
await pa.goto(base+`#idea/${ai}`);await pa.locator('.comment').waitFor();assert.equal(await pa.evaluate(()=>window.XSS),undefined);assert.equal(await pa.locator('.comment img').count(),0);
console.log('PASS browser: user comment HTML is rendered as text');

const pc=await userPage(c,{width:390,height:844});await pc.goto(base+'#write');await pc.locator('#title').fill('A student browser test idea');await pc.locator('#summary').fill('Submit an idea with a picture in the browser.');
for(const key of ['problem','outcome','data_plan','technology','contribution','seeking'])await pc.locator('#'+key).fill('We will annotate dialogues and compare model interpretations.');
await pc.locator('#image').setInputFiles({name:'test.png',mimeType:'image/png',buffer:png});await pc.locator('#image_alt').fill('A test project diagram');await pc.locator('[name=privacy]').check();await pc.getByRole('button',{name:'Publish idea →'}).click();try{await pc.getByRole('heading',{name:'A student browser test idea',exact:true}).waitFor({timeout:10000});}catch(e){console.log(await pc.locator('body').innerText());throw e;}assert.equal((await f.read(c)).ideas.filter(i=>i.owner_id===c).length,1);
console.log('PASS browser: mobile image preprocessing/upload, complete form, server-backed publish');

const padmin=await userPage(admin);await padmin.goto(base+'#admin');await padmin.getByRole('heading',{name:'Team-building overview'}).waitFor();await padmin.locator('#students').fill('20269999\n20269998');const downloaded=padmin.waitForEvent('download');await padmin.getByRole('button',{name:'Generate codes and download CSV'}).click();await downloaded;assert.equal((await f.read(admin)).roster.length,54);await padmin.screenshot({path:fileURLToPath(new URL('admin.png',artifacts)),fullPage:true});
console.log('PASS browser: instructor enrollment and invitation CSV download');
await padmin.locator('[name=matching_open]').uncheck();await padmin.getByRole('button',{name:'Save settings'}).click();await padmin.getByText('Classroom settings saved.').waitFor();assert.equal((await f.read(admin)).settings.matching_open,false);
const legacyCodes=await f.old.act(admin,'admin_roster',{students:['20268888']});
const legacyUser=await f.old.signup('20268888',legacyCodes['20268888']);
const joinCodes=await act(admin,'admin_roster',{students:['20268888']});
const joinPage=await userPage(legacyUser);
await joinPage.locator('#enroll-number').fill('20268888');
await joinPage.locator('#enroll-code').fill('bad-code');
await joinPage.getByRole('button',{name:'Join ENG2112',exact:true}).click();
await joinPage.getByRole('alert').filter({hasText:'Check your student number'}).waitFor();
await joinPage.locator('#enroll-code').fill(joinCodes['20268888']);
await joinPage.getByRole('button',{name:'Join ENG2112',exact:true}).click();
await joinPage.locator('.hero').waitFor();
assert.equal((await f.read(legacyUser)).me.role,'student');
console.log('PASS browser: existing account enrolls with a separate course invitation');
assert.deepEqual(errors,[]);console.log('PASS browser: settings persistence and no JavaScript runtime errors');
await browser.close();await db.close();
