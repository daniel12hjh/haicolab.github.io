import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fixture as sharedFixture } from './eng2112.test.mjs';
import { fixture as baseFixture } from './database.test.mjs';

const migration = await readFile(new URL('../../courses/eng3510/2026-fall/team-building/migrations/20261001_existing_account_enrollment.sql', import.meta.url), 'utf8');

export async function fixture() {
  const f = await sharedFixture();
  const { db, old } = f;
  // Include real classroom content and images so migration/isolation checks are meaningful.
  const oldIdea = (await old.post(old.users[0])).id;
  await old.act(old.users[1], 'comment', { idea_id: oldIdea, body: '기존 수업 댓글 보존 확인' });
  await old.act(old.users[1], 'apply', { idea_id: oldIdea, message: '기존 수업 지원 보존 확인' });
  await f.post(f.users[0]);
  // Reconstruct the deployed pre-fix contract; exercise the upgrade, not only fresh setup.
  const definition = (await db.query("select pg_get_functiondef('public.tb_read()'::regprocedure) as sql")).rows[0].sql;
  const start = definition.indexOf('  if auth.uid() is null');
  const end = definition.indexOf('  select jsonb_build_object(', start);
  assert(start > 0 && end > start);
  await db.exec(definition.slice(0, start) + "  if me.id is null then raise exception '수업 계정으로 로그인해 주세요.'; end if;\n" + definition.slice(end));
  await db.exec('drop function public.tb_enroll(text,text)');
  await assert.rejects(old.read(f.users[6]), /수업 계정/);
  const before = { old: await old.read(old.admin), eng2112: await f.read(f.admin), auth: (await db.query('select * from auth.users order by id')).rows,
    triggers: (await db.query("select tgname, pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='auth.users'::regclass order by tgname")).rows };
  await db.exec(migration);
  assert.deepEqual(await old.read(old.admin), before.old);
  assert.deepEqual(await f.read(f.admin), before.eng2112);
  assert.deepEqual((await db.query('select * from auth.users order by id')).rows, before.auth);
  assert.deepEqual((await db.query("select tgname, pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='auth.users'::regclass order by tgname")).rows, before.triggers);
  const codes = await old.act(old.admin, 'admin_roster', { students: [f.students[6], f.students[7], f.students[8]] });
  const enroll = (u, sn, code) => f.call(u, 'tb_enroll', [sn, code]);
  return { ...f, legacyCodes: codes, enrollLegacy: enroll };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const f = await fixture();
  const { db, old, users, students, legacyCodes, enrollLegacy: enroll } = f;
  const u = users[6], v = users[7], sn = students[6], otherSn = students[7];
  let count = 0;
  async function test(name, run) { await run(); console.log(`PASS ${++count}: ${name}`); }
  try {
    await test('upgrade preserves existing users, classrooms and signup triggers', async () => {
      assert.deepEqual(Object.keys(await old.read(u)).sort(), ['account_email', 'course_code', 'enrollment_required']);
      assert.equal((await old.read(u)).course_code, 'ENG3510');
      await assert.rejects(old.act(u, 'comment', {}));
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [u]);
      await db.exec('set role authenticated');
      try {
        await assert.rejects(db.query('select * from team_private.roster'), /permission denied/);
        assert.equal((await db.query("select * from storage.objects where bucket_id='team-images'")).rows.length, 0);
        await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('team-images',$1)", [`${u}/blocked.webp`]));
      } finally { await db.exec('reset role'); }
    });
    await test('anonymous, missing accounts, bad codes and cross-course codes cannot enroll', async () => {
      await assert.rejects(enroll(null, sn, legacyCodes[sn]), /permission denied/);
      await assert.rejects(enroll(randomUUID(), sn, legacyCodes[sn]), /로그인/);
      for (const code of [null, '', 'bad-code', f.codes[sn]]) await assert.rejects(enroll(u, sn, code), /초대코드/);
      await assert.rejects(enroll(u, 'missing', legacyCodes[sn]), /초대코드/);
      assert.equal((await old.read(u)).enrollment_required, true);
    });
    await test('ENG2112-first account can enroll in ENG3510 without changing its other course', async () => {
      await f.post(u);
      const before = await f.read(f.admin);
      const authBefore = (await db.query('select * from auth.users where id=$1', [u])).rows;
      await enroll(u, ` ${sn} `, ` ${legacyCodes[sn]} `);
      const state = await old.read(u);
      assert.equal(state.me.id, u);
      assert.equal(state.me.student_number, sn);
      assert.equal(state.me.role, 'student');
      assert.equal(state.me.display_id, 7);
      assert.equal(state.ideas.length, 1);
      assert.equal(state.members.some(m => m.user_id === u), false);
      assert.deepEqual(await f.read(f.admin), before);
      assert.deepEqual((await db.query('select * from auth.users where id=$1', [u])).rows, authBefore);
      const roster = (await old.read(old.admin)).roster.find(r => r.student_number === sn);
      assert.equal(roster.user_id, u);
      assert.equal(roster.submitted, false);
    });
    await test('retries do not consume another ID; claimed codes and identity switching are denied', async () => {
      await enroll(u, sn, legacyCodes[sn]);
      await assert.rejects(enroll(v, sn, legacyCodes[sn]), /초대코드/);
      await assert.rejects(enroll(u, otherSn, legacyCodes[otherSn]), /다른 학번/);
      await enroll(v, otherSn, legacyCodes[otherSn]);
      assert.equal((await old.read(v)).me.display_id, 8);
    });
    await test('existing ENG3510-first enrollment into ENG2112 still works', async () => {
      const sn = '20268888';
      const codes = await old.act(old.admin, 'admin_roster', { students: [sn] });
      const id = await old.signup(sn, codes[sn]);
      assert.equal((await f.read(id)).enrollment_required, true);
      const otherCodes = await f.act(f.admin, 'admin_roster', { students: [sn] });
      await f.enroll(id, sn, otherCodes[sn]);
      assert.equal((await f.read(id)).me.id, id);
      assert.equal((await old.read(id)).me.id, id);
    });
    await test('migration can be reapplied without changing enrolled classroom state', async () => {
      const before = await old.read(old.admin);
      await db.exec(migration);
      assert.deepEqual(await old.read(old.admin), before);
    });
    await test('STS2026 backend rejects this migration without changes', async () => {
      const sts = await baseFixture('sts2026');
      try {
        const before = await sts.read(sts.admin);
        await assert.rejects(sts.db.exec(migration), /not the ENG3510/);
        await sts.db.exec('rollback');
        assert.deepEqual(await sts.read(sts.admin), before);
        assert.equal((await sts.db.query("select to_regprocedure('public.tb_enroll(text,text)') as fn")).rows[0].fn, null);
      } finally { await sts.db.close(); }
    });
    console.log(`${count} enrollment regression scenarios passed.`);
  } finally { await db.close(); }
}
