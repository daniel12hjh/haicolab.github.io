import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fixture as baseFixture } from './database.test.mjs';
import { fixture as sharedFixture } from './eng2112.test.mjs';

export async function fixture(course) {
  const shared = course === 'sts2026' ? null : await sharedFixture();
  const f = shared ? (course === 'eng2112' ? shared : shared.old) : await baseFixture(course);
  const { db } = f;
  const rpcs = shared ? ['tb_action', 'eng2112_action'] : ['tb_action'];
  // Reconstruct the old save behavior so tests exercise a live-project upgrade.
  for (const rpc of rpcs) {
    const definition = (await db.query(`select pg_get_functiondef('public.${rpc}(text,jsonb)'::regprocedure) as sql`)).rows[0].sql;
    const start = definition.indexOf('   -- Optional on new and existing ideas');
    const end = definition.indexOf("   output:=jsonb_build_object('id',rid);", start);
    assert(start > 0 && end > start);
    await db.exec(definition.slice(0, start) + definition.slice(end));
  }
  const solo = (await f.post(f.users[0])).id;
  const before = await f.read(f.admin);
  const siblingBefore = shared ? await (course === 'eng2112' ? shared.old : shared).read(f.admin) : null;
  const name = shared ? '20261001_shared_classroom_updates.sql' : '20261001_sts2026_idea_teammates.sql';
  const migration = await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
  await db.exec(migration);
  assert.deepEqual(await f.read(f.admin), before);
  if (shared) assert.deepEqual(await (course === 'eng2112' ? shared.old : shared).read(f.admin), siblingBefore);
  return { ...f, solo, migration, maximum: course === 'eng2112' ? 4 : 3 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const course of ['sts2026', 'eng3510', 'eng2112']) {
    const f = await fixture(course);
    const { db, users: [a, b, c, d, e], admin, read, act, post, solo, maximum } = f;
    const sn = async u => (await read(u)).me.student_number;
    let count = 0;
    const test = async (name, fn) => { await fn(); console.log(`PASS ${course} ${++count}: ${name}`); };
    try {
      await test('pre-existing solo recruitment survives migration and blank-field editing', async () => {
        const original = (await read(a)).ideas.find(i => i.id === solo);
        await act(a, 'save_idea', { ...original, existing_members: [] });
        const after = await read(a);
        const saved = after.ideas.find(i => i.id === solo);
        for (const key of ['id', 'owner_id', 'title', 'image_path', 'status', 'target_size']) assert.equal(saved[key], original[key]);
        assert.equal(after.members.filter(m => m.idea_id === solo).length, 1);
        assert.equal(after.invites.length, 0);
      });
      await test('bad teammate lists roll back the whole new idea and all invitations', async () => {
        const before = await read(admin);
        const bsn = await sn(b), dsn = await sn(d);
        for (const existing_members of [[bsn, bsn], [dsn], [bsn, 'not-on-roster'], Array(maximum).fill(bsn), null, 'invalid', [123], [{}], ['']]) {
          await assert.rejects(post(d, { existing_members }));
          assert.deepEqual(await read(admin), before);
        }
        await assert.rejects(post(d, { existing_members: [bsn], target_size: 1, status: 'closed' }));
        assert.deepEqual(await read(admin), before);
      });
      await test('editing an existing solo idea can add a teammate; invalid edit leaves it untouched', async () => {
        const original = (await read(a)).ideas.find(i => i.id === solo);
        const before = await read(admin);
        await assert.rejects(act(a, 'save_idea', { ...original, title: 'Must not be saved', existing_members: [await sn(b), 'not-on-roster'] }));
        assert.deepEqual(await read(admin), before);
        await act(a, 'save_idea', { ...original, existing_members: [await sn(b)] });
        const state = await read(admin);
        assert.equal(state.ideas.find(i => i.id === solo).owner_id, a);
        assert.equal(state.invites.filter(i => i.idea_id === solo && i.status === 'pending').length, 1);
        assert.equal(state.members.filter(m => m.idea_id === solo).length, 1);
        assert.equal(state.roster.find(r => r.user_id === b).submitted, false);
        const invite = (await read(b)).invites.find(i => i.is_mine);
        await act(b, 'respond_invite', { id: invite.id, decision: 'accept' });
        assert.equal((await read(admin)).roster.find(r => r.user_id === b).submitted, true);
      });
      await test('new team posts can include all teammates; confirmation is still required', async () => {
        const teammates = maximum === 4 ? [d, e, f.users[5]] : [d, e];
        const numbers = []; for (const u of teammates) numbers.push(await sn(u));
        const id = (await post(c, { existing_members: numbers, target_size: maximum, status: 'closed' })).id;
        let s = await read(admin);
        assert.equal(s.invites.filter(i => i.idea_id === id && i.status === 'pending').length, maximum - 1);
        assert.equal(s.members.filter(m => m.idea_id === id).length, 1);
        const peer = await read(a);
        assert(!JSON.stringify({ ...peer, me: null }).includes(numbers[0]));
        for (const u of teammates) {
          const invite = (await read(u)).invites.find(i => i.idea_id === id && i.is_mine);
          await act(u, 'respond_invite', { id: invite.id, decision: 'accept' });
        }
        assert.equal((await read(admin)).members.filter(m => m.idea_id === id).length, maximum);
      });
      await test('wrong-project migration is rejected without changing classroom data', async () => {
        const other = course === 'sts2026' ? '20261001_shared_classroom_updates.sql' : '20261001_sts2026_idea_teammates.sql';
        const before = await read(admin);
        await assert.rejects(db.exec(await readFile(new URL(`./migrations/${other}`, import.meta.url), 'utf8')));
        await db.exec('rollback');
        assert.deepEqual(await read(admin), before);
      });
      await test('rerunning migration preserves all published content and confirmed teams', async () => {
        const before = await read(admin);
        await db.exec(f.migration);
        assert.deepEqual(await read(admin), before);
      });
    } finally { await db.close(); }
  }
}
