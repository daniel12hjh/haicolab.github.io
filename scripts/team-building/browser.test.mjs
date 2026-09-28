import { chromium } from '@playwright/test';
import { fixture } from './database.test.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const course=process.env.TEAM_COURSE||'sts2026';
if(!['sts2026','eng3510'].includes(course))throw Error('Unsupported test course');
const {config}=await import(`../../courses/${course}/2026-fall/team-building/config.js`);
const base=`http://127.0.0.1:8765/courses/${course}/2026-fall/team-building/`;
const courseTitle=course==='eng3510'?'인공지능을 위한 데이터분석':'생성형 AI의 이해와 활용';
const demoSearch=course==='eng3510'?'소설':'동네';
const demoTitle=course==='eng3510'?'소설 속 인물의 언어는 어떻게 다를까?':'동네 가게의 이야기를 만드는 AI 스튜디오';
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
await page.getByRole('button',{name:'모집 중',exact:true}).click();
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
await page.getByRole('link',{name:'＋ 아이디어 제안하기'}).click();
await page.locator('form[data-form="idea"]').waitFor();
assert.equal(await page.locator('#image').getAttribute('required'),'');
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
   if(url.pathname.endsWith('/rpc/tb_read'))return json(await f.read(user));
   if(url.pathname.endsWith('/rpc/tb_action')){const {action,payload}=req.postDataJSON();return json(await f.act(user,action,payload));}
   if(url.pathname==='/storage/v1/object/sign/team-images'){return json(req.postDataJSON().paths.map(path=>({path,signedURL:`/object/sign/team-images/${path}?token=test`,error:null})));}
   if(url.pathname.startsWith('/storage/v1/object/sign/'))return route.fulfill({contentType:'image/png',body:png});
   if(url.pathname.startsWith('/storage/v1/object/team-images/')&&req.method()==='POST'){const name=url.pathname.split('/team-images/')[1];await db.query("insert into storage.objects(bucket_id,name) values('team-images',$1)",[name]);return json({Key:`team-images/${name}`,Id:'image-id'});}
   if(url.pathname.endsWith('/auth/v1/logout'))return json({});
   if(url.pathname.endsWith('/auth/v1/user'))return json(session.user);
   return json({error:'unexpected mock route'},400);
  }catch(error){return json({message:error.message,code:'P0001'},400);}
 });
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('.hero').waitFor();return p;
}
const pa=await userPage(a);await pa.goto(base+'#activity');await pa.getByRole('heading',{name:'우리 팀에 온 지원'}).waitFor();
await pa.getByRole('button',{name:'합류 제안',exact:true}).click();await pa.getByText('합류 제안 도착',{exact:true}).waitFor();
const pb=await userPage(b);await pb.goto(base+'#activity');pb.on('dialog',d=>d.accept());await pb.getByRole('button',{name:'제안 수락 · 합류 확정'}).click();await pb.getByText('합류 확정',{exact:true}).waitFor();
assert.equal((await f.read(b)).members.find(m=>m.user_id===b).idea_id,ai);
console.log('PASS browser: private application → leader offer → applicant acceptance');
await pa.goto(base+`#idea/${ai}`);await pa.locator('.comment').waitFor();assert.equal(await pa.evaluate(()=>window.XSS),undefined);assert.equal(await pa.locator('.comment img').count(),0);
console.log('PASS browser: user comment HTML is rendered as text');

const pc=await userPage(c,{width:390,height:844});await pc.goto(base+'#write');await pc.locator('#title').fill('학생이 직접 만든 테스트 아이디어');await pc.locator('#summary').fill('브라우저에서 이미지를 첨부하고 제출합니다.');
for(const key of ['problem','outcome','data_plan','technology','contribution','seeking'])await pc.locator('#'+key).fill('직접 작성한 테스트 내용이며 자세한 계획을 소개합니다.');
await pc.locator('#image').setInputFiles({name:'test.png',mimeType:'image/png',buffer:png});await pc.locator('#image_alt').fill('시험용 흐름도 이미지');await pc.locator('[name=privacy]').check();await pc.getByRole('button',{name:'아이디어 게시하기 →'}).click();try{await pc.getByRole('heading',{name:'학생이 직접 만든 테스트 아이디어',exact:true}).waitFor({timeout:10000});}catch(e){console.log(await pc.locator('body').innerText());throw e;}assert.equal((await f.read(c)).ideas.filter(i=>i.owner_id===c).length,1);
console.log('PASS browser: mobile image preprocessing/upload, complete form, server-backed publish');

const padmin=await userPage(admin);await padmin.goto(base+'#admin');await padmin.getByRole('heading',{name:'팀빌딩 운영 현황'}).waitFor();await padmin.locator('#students').fill('20269999\n20269998');const downloaded=padmin.waitForEvent('download');await padmin.getByRole('button',{name:'초대코드 만들기 · CSV 저장'}).click();await downloaded;assert.equal((await f.read(admin)).roster.length,8);await padmin.screenshot({path:fileURLToPath(new URL('admin.png',artifacts)),fullPage:true});
console.log('PASS browser: instructor enrollment and invitation CSV download');
await padmin.locator('[name=matching_open]').uncheck();await padmin.getByRole('button',{name:'설정 저장'}).click();await padmin.getByText('운영 설정을 저장했습니다.').waitFor();assert.equal((await f.read(admin)).settings.matching_open,false);
assert.deepEqual(errors,[]);console.log('PASS browser: settings persistence and no JavaScript runtime errors');
await browser.close();await db.close();
