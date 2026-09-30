import { fixture as legacyFixture } from './database.test.mjs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
export async function fixture(){
 const old=await legacyFixture('eng3510'),{db}=old;
 const before=await old.read(old.admin);
 const results=await db.exec(await readFile(new URL('../../courses/eng2112/2026-fall/team-building/setup.sql',import.meta.url),'utf8'));
 const professorCode=results.at(-1).rows[0].professor_invite_code;
 async function call(user,fn,args=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec(`set role ${user?'authenticated':'anon'}`);try{return (await db.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;}finally{await db.exec('reset role');}}
 const read=u=>call(u,'eng2112_read'),act=(u,a,p={})=>call(u,'eng2112_action',[a,JSON.stringify(p)]),enroll=(u,s,c)=>call(u,'eng2112_enroll',[s,c]);
 assert.deepEqual(await old.read(old.admin),before);
 assert.equal((await read(old.admin)).enrollment_required,true);
 await assert.rejects(act(old.admin,'admin_roster',{students:['123']}));
 await enroll(old.admin,'professor',professorCode);
 const students=Array.from({length:52},(_,i)=>(i>=38?'G':'')+String(20260001+i));
 const codes=await act(old.admin,'admin_roster',{students});
 async function signup(sn,code){const id=randomUUID();await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${sn}@example.edu`,JSON.stringify({course_code:'ENG2112',student_number:sn,invite_code:code,role:'admin'})]);return id;}
 const users=[];
 for(let i=0;i<6;i++){await enroll(old.users[i],students[i],codes[students[i]]);users.push(old.users[i]);}
 for(let i=6;i<12;i++)users.push(await signup(students[i],codes[students[i]]));
 async function post(u,overrides={}){const path=`${u}/${randomUUID()}.webp`;await db.query("insert into storage.objects(bucket_id,name) values('eng2112-images',$1)",[path]);return act(u,'save_idea',{title:'Language in context',summary:'Evaluate how models interpret politeness',problem:'Indirect requests can be misunderstood by language models.',outcome:'An annotated evaluation dataset',data_plan:'Dialogues written for this project',technology:'Prompt design and annotation',contribution:'Linguistics and data analysis',seeking:'People interested in evaluation',image_alt:'Project workflow diagram',image_path:path,target_size:4,status:'recruiting',...overrides});}
 return {old,db,admin:old.admin,users,codes,students,signup,call,read,act,enroll,post};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const f=await fixture();const {old,db,admin,users:[a,b,c,d,e,g,h,j,k,l],codes,students,signup,call,read,act,enroll,post}=f;
 let count=0;async function test(name,fn){await fn();console.log(`PASS ${++count}: ${name}`);}
 try{
 await test('52 roster entries, independent numbering and invitation-bound identities',async()=>{assert.equal((await read(admin)).roster.length,52);const visiting=await signup(students[38],codes[students[38]]);assert.equal((await read(visiting)).me.student_number,students[38]);assert.equal((await old.read(admin)).roster.length,6);assert.equal((await read(a)).me.display_id,1);assert.equal((await read(h)).me.role,'student');await assert.rejects(signup(students[12],old.codes[students[0]]));await assert.rejects(enroll(randomUUID(),students[0],codes[students[0]]));await assert.rejects(signup(students[0],codes[students[0]]));assert.equal((await db.query('select raw_user_meta_data from auth.users where id=$1',[h])).rows[0].raw_user_meta_data.invite_code,undefined);});
 await test('legacy signups still work; new-only accounts cannot read legacy course',async()=>{const x=await old.act(admin,'admin_roster',{students:['20269999']});const u=await old.signup('20269999',x['20269999']);assert.deepEqual(Object.keys(await read(u)).sort(),['account_email','course_code','enrollment_required']);await assert.rejects(act(u,'comment',{}));assert.equal((await old.read(h)).enrollment_required,true);await assert.rejects(old.act(h,'comment',{}));await assert.rejects(old.post(old.users[0],{target_size:4}));});
 await test('anonymous, direct table access and role spoofing are denied',async()=>{await assert.rejects(read(null));await assert.rejects(enroll(null,'professor','bad'));await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from eng2112_private.roster'));await assert.rejects(db.query('select eng2112_private.claim_enrollment($1,$2,$3)',[a,'professor','bad']));}finally{await db.exec('reset role');}await assert.rejects(act(a,'admin_roster',{students:['99']}));await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||'{\"role\":\"admin\",\"course_code\":\"ENG3510\"}'::jsonb where id=$1",[h]);assert.equal((await read(h)).me.role,'student');assert.equal((await old.read(h)).enrollment_required,true);await assert.rejects(old.act(h,'comment',{}));});
 let ai;
 await test('required own image and server max four; old ideas remain separate',async()=>{await assert.rejects(post(a,{image_path:''}));await assert.rejects(post(a,{target_size:5}));ai=(await post(a)).id;await old.post(a);assert.equal((await old.read(a)).ideas.length,1);assert.equal((await read(a)).ideas.length,1);await assert.rejects(act(b,'save_idea',{id:ai}));await assert.rejects(old.act(b,'apply',{idea_id:ai,message:'Cross course attempt'}));});
 await test('three reserved teammates plus leader; fifth member rejected',async()=>{for(const sn of students.slice(1,4))await act(a,'invite_member',{idea_id:ai,student_number:sn});await assert.rejects(act(a,'invite_member',{idea_id:ai,student_number:students[4]}));for(const u of [b,c,d]){const inv=(await read(u)).invites.find(x=>x.is_mine);await act(u,'respond_invite',{id:inv.id,decision:'accept'});}const s=await read(admin);assert.equal(s.members.filter(m=>m.idea_id===ai).length,4);assert.equal(s.ideas.find(i=>i.id===ai).status,'closed');assert(s.roster.filter(r=>[b,c,d].includes(r.user_id)).every(r=>r.submitted));});
 await test('one, two and three person teams can close without filling four seats',async()=>{for(const [u,n] of [[e,1],[g,2],[h,3]]){const id=(await post(u,{target_size:n,status:'closed'})).id;const i=(await read(u)).ideas.find(x=>x.id===id);assert.equal(i.target_size,n);assert.equal(i.status,'closed');}});
 await test('competing offers cannot overfill last place; applications remain private',async()=>{const id=(await post(j,{target_size:2})).id;for(const u of [k,l])await act(u,'apply',{idea_id:id,message:'I can help with annotation.'});const apps=(await read(j)).applications;assert.equal((await read(b)).applications.length,0);for(const ap of apps)await act(j,'application',{id:ap.id,decision:'offer'});await act(k,'application',{id:apps.find(x=>x.applicant_id===k).id,decision:'accept'});await assert.rejects(act(l,'application',{id:apps.find(x=>x.applicant_id===l).id,decision:'accept'}));assert.equal((await read(admin)).members.filter(m=>m.idea_id===id).length,2);});
 await test('peer identities and images isolated by course membership',async()=>{const s=await read(a);assert.equal(s.roster,undefined);assert(!JSON.stringify({...s,me:null}).includes(students[1]));await db.query("select set_config('request.jwt.claim.sub',$1,false)",[h]);await db.exec('set role authenticated');try{const rows=(await db.query('select bucket_id from storage.objects')).rows;assert(rows.length>0);assert(rows.every(r=>r.bucket_id==='eng2112-images'));await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('team-images',$1)",[`${h}/bad.webp`]));}finally{await db.exec('reset role');}});
 await test('deadlines and instructor corrections affect only ENG2112',async()=>{await act(admin,'admin_settings',{submissions_open:false,matching_open:false,notice:'Closed'});await assert.rejects(act(a,'comment',{idea_id:ai,body:'Late'}));assert.equal((await old.read(admin)).settings.matching_open,true);await act(admin,'admin_remove_member',{user_id:b});assert.equal((await read(admin)).members.find(m=>m.user_id===b),undefined);});
 console.log(`${count} shared-backend scenarios passed.`);
 }finally{await db.close();}
}
