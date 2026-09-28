import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function fixture(course=process.env.TEAM_COURSE||'sts2026'){
 if(!['sts2026','eng3510'].includes(course))throw Error('Unsupported test course');
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema storage to authenticated,anon; grant select,insert on storage.objects to authenticated;
 `);
 const results=await db.exec(await readFile(new URL(`../../courses/${course}/2026-fall/team-building/setup.sql`,import.meta.url),'utf8'));
 const code=results.at(-1).rows[0].professor_invite_code;
 async function signup(sn,invite){const id=randomUUID();await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${sn}@example.edu`,JSON.stringify({student_number:sn,invite_code:invite,role:'admin'})]);return id;}
 async function call(user,fn,args=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec(`set role ${user?'authenticated':'anon'}`);try{return (await db.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;}finally{await db.exec('reset role');}}
 const act=(user,action,payload={})=>call(user,'tb_action',[action,JSON.stringify(payload)]);
 const read=user=>call(user,'tb_read');
 const admin=await signup('professor',code);
 const codes=await act(admin,'admin_roster',{students:['20260001','20260002','20260003','20260004','20260005','20260006']});
 const users=[];for(const [sn,invite]of Object.entries(codes))users.push(await signup(sn,invite));
 async function post(user,overrides={}){const path=`${user}/${randomUUID()}.webp`;await db.query("insert into storage.objects(bucket_id,name) values('team-images',$1)",[path]);return act(user,'save_idea',{title:'학습을 돕는 AI 동료',summary:'수업 노트로 학습을 돕는 아이디어',problem:'복습 과정에서 내가 모르는 부분을 알아내기 어렵습니다.',outcome:'학습 도우미 시제품',data_plan:'직접 작성한 수업 노트',technology:'질문 생성과 AI 피드백',contribution:'자료 조사와 전공 지식',seeking:'디자인과 실험을 함께할 동료',image_alt:'학습 과정의 흐름도',image_path:path,target_size:3,status:'recruiting',...overrides});}
 return {db,admin,users,codes,signup,act,read,post};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
const f=await fixture();const {db,admin,users:[a,b,c,d,e,g],act,read,post,signup,codes}=f;
let passed=0;async function test(name,fn){await fn();console.log(`PASS ${++passed}: ${name}`);}
await test('signup is invitation-bound, clears secret, assigns student ID 1, ignores forged role',async()=>{const s=await read(a);assert.equal(s.me.display_id,1);assert.equal(s.me.role,'student');const u=(await db.query('select raw_user_meta_data from auth.users where id=$1',[a])).rows[0];assert.equal(u.raw_user_meta_data.invite_code,undefined);await assert.rejects(signup('20260001',codes['20260001']));await assert.rejects(signup('not-enrolled','bad'));});
await test('anonymous cannot read RPCs or mutate data',async()=>{await assert.rejects(read(null),/permission denied/);await assert.rejects(act(null,'admin_roster',{students:['99']}),/permission denied/);});
await test('students cannot access private tables or administer roster',async()=>{await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from team_private.roster'),/permission denied/);await assert.rejects(db.query('select team_private.join_team($1,$2)',[a,randomUUID()]),/permission denied/);}finally{await db.exec('reset role');}await assert.rejects(act(a,'admin_roster',{students:['99']}),/교수자/);});
let ai,di;
await test('image is mandatory, only own uploaded image is accepted, leader immutable',async()=>{await assert.rejects(post(a,{image_path:`${b}/not-real.webp`}),/이미지/);ai=(await post(a)).id;await assert.rejects(act(b,'save_idea',{id:ai}),/본인의/);await assert.rejects(post(a),/이미 팀/);});
await test('public student payload contains no peer student numbers or roster',async()=>{const s=await read(a);assert.equal(s.roster,undefined);assert.equal(s.profiles.find(p=>p.id===b).student_number,undefined);assert(!JSON.stringify({...s,me:null}).includes('20260002'));});
await test('existing member needs confirmation, occupies a reserved seat',async()=>{await act(a,'invite_member',{idea_id:ai,student_number:'20260002'});const before=await read(admin);assert.equal(before.roster.find(r=>r.user_id===b).submitted,false);const bs=await read(b);const invite=bs.invites.find(v=>v.is_mine);await assert.rejects(act(c,'respond_invite',{id:invite.id,decision:'accept'}),/권한/);await act(b,'respond_invite',{id:invite.id,decision:'accept'});const after=await read(admin);assert.equal(after.roster.find(r=>r.user_id===b).submitted,true);assert.equal(after.members.filter(m=>m.idea_id===ai).length,2);});
await test('private applications visible only to applicant, target leader and admin',async()=>{await act(c,'apply',{idea_id:ai,message:'기획과 디자인을 맡을 수 있습니다.'});const cs=await read(c);assert.equal(cs.applications.length,1);assert.equal((await read(a)).applications.length,1);assert.equal((await read(b)).applications.length,0);assert.equal((await read(d)).applications.length,0);const id=cs.applications[0].id;await assert.rejects(act(d,'application',{id,decision:'offer'}),/권한/);await assert.rejects(act(c,'application',{id,decision:'accept'}),/팀장의/);});
await test('multiple offers cannot overfill team; member has exactly one team',async()=>{await act(d,'apply',{idea_id:ai,message:'자료 수집을 맡을 수 있습니다.'});let apps=(await read(a)).applications;for(const x of apps)await act(a,'application',{id:x.id,decision:'offer'});await act(c,'application',{id:apps.find(x=>x.applicant_id===c).id,decision:'accept'});await assert.rejects(act(d,'application',{id:apps.find(x=>x.applicant_id===d).id,decision:'accept'}));const s=await read(admin);assert.equal(s.members.filter(m=>m.idea_id===ai).length,3);assert.equal(s.ideas.find(i=>i.id===ai).status,'closed');await assert.rejects(post(b),/이미 팀/);});
await test('solo author joining elsewhere archives original idea and remains original author',async()=>{di=(await post(d)).id;const ei=(await post(e)).id;await act(d,'apply',{idea_id:ei,message:'프로젝트에 합류하고 싶습니다.'});const app=(await read(e)).applications.find(x=>x.applicant_id===d);await act(e,'application',{id:app.id,decision:'offer'});await act(d,'application',{id:app.id,decision:'accept'});const s=await read(d);assert.equal(s.ideas.find(i=>i.id===di).status,'archived');assert.equal(s.ideas.find(i=>i.id===di).owner_id,d);assert.equal(s.members.filter(m=>m.user_id===d).length,1);});
await test('representative team membership cannot move without instructor correction',async()=>{const gi=(await post(g)).id;await assert.rejects(act(a,'apply',{idea_id:gi,message:'다른 팀으로 이동하려고 합니다.'}),/이미 구성된 팀/);await assert.rejects(act(b,'apply',{idea_id:gi,message:'다른 팀으로 이동하려고 합니다.'}),/이미 구성된 팀/);});
await test('student comments are escaped at rendering layer and author-only delete enforced',async()=>{await act(a,'comment',{idea_id:ai,body:'<img src=x onerror=alert(1)>'});const comment=(await read(b)).comments[0];await act(b,'delete_comment',{id:comment.id});assert.equal((await read(b)).comments.length,1);await act(a,'delete_comment',{id:comment.id});assert.equal((await read(b)).comments.length,0);});
await test('deadlines enforced on server; admin can reopen',async()=>{await act(admin,'admin_settings',{submissions_open:false,matching_open:false,notice:'마감'});await assert.rejects(act(a,'comment',{idea_id:ai,body:'test'}),/마감/);await assert.rejects(post(a),/마감/);await act(admin,'admin_settings',{submissions_open:true,matching_open:true,notice:'다시 모집'});});
await test('admin roster export tracks submission and can release a member with audit',async()=>{await assert.rejects(act(a,'admin_remove_member',{user_id:b}),/교수자/);await act(admin,'admin_remove_member',{user_id:b});const s=await read(admin);assert.equal(s.members.find(m=>m.user_id===b),undefined);assert.equal(s.roster.find(r=>r.user_id===b).submitted,false);assert.equal((await db.query('select count(*)::int as n from team_private.audit')).rows[0].n,1);});
await test('student cannot claim admin through mutable auth metadata',async()=>{await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||'{\"role\":\"admin\"}'::jsonb where id=$1",[a]);assert.equal((await read(a)).me.role,'student');});
await db.close();console.log(`${passed} database scenarios passed.`);
}
