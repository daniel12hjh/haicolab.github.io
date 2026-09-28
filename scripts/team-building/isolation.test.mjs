import assert from 'node:assert/strict';
import { fixture } from './database.test.mjs';
import { readFile } from 'node:fs/promises';

const sts=await fixture('sts2026');
const eng=await fixture('eng3510');
try {
  const oldConfig=await readFile(new URL('../../courses/sts2026/2026-fall/team-building/config.js',import.meta.url),'utf8');
  const newConfig=await readFile(new URL('../../courses/eng3510/2026-fall/team-building/config.js',import.meta.url),'utf8');
  const project=s=>s.match(/supabaseUrl:\s*'([^']+)'/)[1];
  assert.notEqual(project(oldConfig),project(newConfig));
  assert(newConfig.includes("authStorageKey: 'eng3510-2026-fall-auth'"));
  assert(newConfig.includes('/courses/eng3510/2026-fall/team-building/'));
  console.log('PASS: different Supabase projects, explicit course session key, course-specific public URL');
  assert.equal((await sts.read(sts.users[0])).me.display_id,1);
  assert.equal((await eng.read(eng.users[0])).me.display_id,1);
  assert.equal((await eng.read(eng.users[0])).course_code,'ENG3510');
  await assert.rejects(eng.read(sts.users[0]),/로그인/);
  await assert.rejects(sts.read(eng.users[0]),/로그인/);
  console.log('PASS: numbering restarts per course; accounts from the other course cannot read');
  const original=(await sts.post(sts.users[0])).id;
  assert.equal((await eng.read(eng.users[0])).ideas.length,0);
  await assert.rejects(eng.act(eng.users[1],'apply',{idea_id:original,message:'Attempt cross-course application'}));
  await eng.post(eng.users[0]);
  assert.equal((await sts.read(sts.users[0])).ideas.length,1);
  assert.equal((await eng.read(eng.users[0])).ideas.length,1);
  await eng.act(eng.admin,'admin_settings',{submissions_open:false,matching_open:false,notice:'ENG only'});
  assert.equal((await sts.read(sts.admin)).settings.submissions_open,true);
  console.log('PASS: ideas, applications and deadlines remain independent');
  // Both courses may enroll the same student number, but their codes cannot be exchanged.
  const s=await sts.act(sts.admin,'admin_roster',{students:['20269997']});
  const e=await eng.act(eng.admin,'admin_roster',{students:['20269997']});
  await assert.rejects(eng.signup('20269997',s['20269997']),/초대코드/);
  await assert.rejects(sts.signup('20269997',e['20269997']),/초대코드/);
  await eng.signup('20269997',e['20269997']);
  await sts.signup('20269997',s['20269997']);
  console.log('PASS: invitation codes are course-specific even for the same student number');
}finally{await sts.db.close();await eng.db.close();}
