import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { fixture } from './idea-teammates.test.mjs';

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const course of ['sts2026', 'eng3510', 'eng2112']) {
    const f = await fixture(course);
    const en = course === 'eng2112';
    const { config } = await import(`../../courses/${course}/2026-fall/team-building/config.js`);
    const base = `http://127.0.0.1:8765/courses/${course}/2026-fall/team-building/`;
    const bucket = config.imageBucket || 'team-images';
    const contexts = [];
    try {
      async function userPage(user, width = 390) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        contexts.push(context);
        const session = { access_token: `test-token-${user}`, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: user, aud: 'authenticated', role: 'authenticated', email: `${user}@example.edu`, app_metadata: { provider: 'email' }, user_metadata: {} } };
        const storageKey = config.authStorageKey || `sb-${new URL(config.supabaseUrl).hostname.split('.')[0]}-auth-token`;
        await context.addInitScript(({ session, storageKey }) => localStorage.setItem(storageKey, JSON.stringify(session)), { session, storageKey });
        await context.route(config.supabaseUrl + '/**', async route => {
          const req = route.request(), url = new URL(req.url());
          const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          try {
            if (url.pathname.endsWith('/rpc/' + (config.readRpc || 'tb_read'))) return json(await f.read(user));
            if (url.pathname.endsWith('/rpc/' + (config.actionRpc || 'tb_action'))) {
              const { action, payload } = req.postDataJSON();
              return json(await f.act(user, action, payload));
            }
            if (url.pathname === `/storage/v1/object/sign/${bucket}`) return json(req.postDataJSON().paths.map(path => ({ path, signedURL: `/object/sign/${bucket}/${path}?token=test`, error: null })));
            if (url.pathname.startsWith('/storage/v1/object/sign/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d9ef8c"/></svg>' });
            if (url.pathname.startsWith(`/storage/v1/object/${bucket}/`) && req.method() === 'POST') {
              const name = url.pathname.split(`/object/${bucket}/`)[1];
              await f.db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, name]);
              return json({ Key: `${bucket}/${name}`, Id: 'image-id' });
            }
            if (url.pathname.endsWith('/auth/v1/user')) return json(session.user);
            throw Error(`Unexpected route: ${url.pathname}`);
          } catch (error) { return json({ message: error.message, code: 'P0001' }, 400); }
        });
        const p = await context.newPage();
        p.on('pageerror', error => errors.push(error.message));
        await p.goto(base);
        await p.locator('.hero').waitFor();
        return p;
      }
      const [a, b, c, d, e, g] = f.users;
      const sn = async user => (await f.read(user)).me.student_number;
      const aSn = await sn(a), bSn = await sn(b), dSn = await sn(d), eSn = await sn(e);
      const leader = await userPage(a);
      await leader.goto(base + '#write/' + f.solo);
      await leader.locator('.existing-teammates').waitFor();
      assert.equal(await leader.locator('[name="existing_members"]').count(), f.maximum - 1);
      assert.equal(await leader.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await leader.locator('.existing-teammates').screenshot({ path: `/tmp/${course}-idea-teammates-mobile.png` });
      await leader.locator('[name="privacy"]').check();
      const save = leader.locator('form[data-form="idea"] button[type="submit"]');
      await leader.locator('#existing-member-1').fill(aSn);
      await save.click();
      await leader.getByRole('alert').filter({ hasText: en ? 'own student number' : '팀장 본인' }).waitFor();
      await leader.locator('#existing-member-1').fill(bSn);
      await leader.locator('#existing-member-2').fill(bSn);
      await save.click();
      await leader.getByRole('alert').filter({ hasText: en ? 'only once' : '중복' }).waitFor();
      await leader.locator('#existing-member-2').fill('');
      await leader.locator('#target_size').selectOption('1');
      await save.click();
      await leader.getByRole('alert').filter({ hasText: en ? 'Increase the target' : '목표 팀 인원' }).waitFor();
      await leader.locator('#target_size').selectOption(String(f.maximum));
      await leader.locator('#status').selectOption('recruiting');
      await save.click();
      await leader.locator('form[data-form="idea"]').waitFor({ state: 'detached' });
      assert.equal((await f.read(a)).invites.filter(i => i.idea_id === f.solo && i.status === 'pending').length, 1);
      assert.equal((await leader.locator('main').innerText()).includes(bSn), false);
      const teammate = await userPage(b, 1280);
      await teammate.goto(base + '#activity');
      teammate.on('dialog', dialog => dialog.accept());
      await teammate.getByRole('button', { name: en ? 'Confirm my membership' : '내 팀이 맞아요', exact: true }).click();
      await teammate.getByText(en ? 'Submission complete' : '제출 완료', { exact: true }).waitFor();
      assert.equal((await f.read(a)).members.filter(m => m.idea_id === f.solo).length, 2);
      console.log(`PASS ${course}: mobile edit existing solo idea, private fields, own/duplicate/capacity validation, member confirmation`);

      const writer = await userPage(c, 1280);
      await writer.goto(base + '#write');
      await writer.locator('#title').fill('Existing team project');
      await writer.locator('#summary').fill('A project submitted with existing teammates.');
      for (const key of ['problem', 'outcome', 'data_plan', 'technology', 'contribution', 'seeking']) await writer.locator('#' + key).fill('We will collect data and evaluate our project together.');
      const png = Buffer.from(await writer.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; return c.toDataURL('image/png').split(',')[1]; }), 'base64');
      await writer.locator('#image').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
      await writer.locator('#image_alt').fill('Project workflow');
      await writer.locator('[name="privacy"]').check();
      await writer.locator('#status').selectOption('closed');
      await writer.locator('#existing-member-1').fill(dSn);
      await writer.locator('#existing-member-2').fill('not-on-roster');
      await writer.locator('form[data-form="idea"] button[type="submit"]').click();
      await writer.getByRole('alert').filter({ hasText: en ? 'cannot be invited' : '등록할 수 없는 학번' }).waitFor();
      assert.equal((await f.read(c)).ideas.filter(i => i.owner_id === c).length, 0);
      assert.equal((await f.read(c)).invites.filter(i => !i.is_mine).length, 0);
      assert.equal(await writer.locator('#title').inputValue(), 'Existing team project');
      await writer.locator('#existing-member-2').fill(eSn);
      if (en) await writer.locator('#existing-member-3').fill(await sn(g));
      await writer.locator('.existing-teammates').screenshot({ path: `/tmp/${course}-idea-teammates-desktop.png` });
      await writer.locator('form[data-form="idea"] button[type="submit"]').click();
      await writer.getByRole('heading', { name: 'Existing team project', exact: true }).waitFor();
      const state = await f.read(c), idea = state.ideas.find(i => i.owner_id === c);
      assert.equal(state.invites.filter(i => i.idea_id === idea.id && i.status === 'pending').length, f.maximum - 1);
      assert.equal(state.members.filter(m => m.idea_id === idea.id).length, 1);
      console.log(`PASS ${course}: desktop new idea + ${f.maximum - 1} teammates; invalid number rolls back; correcting it publishes once`);
    } finally {
      for (const context of contexts) await context.close();
      await f.db.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: no JavaScript runtime errors in any classroom');
} finally { await browser.close(); }
