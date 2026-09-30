import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { fixture } from './eng3510-enrollment.test.mjs';
import { config } from '../../courses/eng3510/2026-fall/team-building/config.js';

const base = 'http://127.0.0.1:8765/courses/eng3510/2026-fall/team-building/';
const f = await fixture();
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [index, viewport] of [[6, { width: 1280, height: 900 }], [7, { width: 390, height: 844 }]]) {
    const user = f.users[index], sn = f.students[index];
    const context = await browser.newContext({ viewport });
    const session = { access_token: `test-token-${user}`, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: user, aud: 'authenticated', role: 'authenticated', email: `${sn}@example.edu`, app_metadata: { provider: 'email' }, user_metadata: {} } };
    let storageRequests = 0;
    await context.route(config.supabaseUrl + '/**', async route => {
      const req = route.request(), url = new URL(req.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      try {
        if (url.pathname === '/auth/v1/signup') return json({ code: 'user_already_exists', msg: 'User already registered' }, 422);
        if (url.pathname === '/auth/v1/token') return json(session);
        if (url.pathname === '/auth/v1/user') return json(session.user);
        if (url.pathname === '/auth/v1/logout') return json({});
        if (url.pathname === '/rest/v1/rpc/tb_read') return json(await f.old.read(user));
        if (url.pathname === '/rest/v1/rpc/tb_enroll') {
          const { student_number, invite_code } = req.postDataJSON();
          return json(await f.enrollLegacy(user, student_number, invite_code));
        }
        if (url.pathname.startsWith('/storage/')) storageRequests++;
        if (url.pathname === '/storage/v1/object/sign/team-images') return json(req.postDataJSON().paths.map(path => ({ path, signedURL: '/object/sign/team-images/' + path + '?token=test', error: null })));
        if (url.pathname.startsWith('/storage/v1/object/sign/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d9ef8c"/></svg>' });
        throw Error(`Unexpected mock route: ${url.pathname}`);
      } catch (error) { return json({ message: error.message, code: 'P0001' }, 400); }
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: '로그인 / 가입', exact: true }).click();
    await page.getByRole('button', { name: '처음 가입하기', exact: true }).click();
    await page.locator('#student_number').fill(sn);
    await page.locator('#invite_code').fill(f.legacyCodes[sn]);
    await page.locator('#email').fill(session.user.email);
    await page.locator('#password').fill('TestPassword123!');
    await page.getByRole('button', { name: '가입하고 입장하기', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'ENG2112에서 사용한 이메일' }).waitFor();
    await page.locator('[data-action="auth-tab"][data-mode="login"]').click();
    await page.locator('#email').fill(session.user.email);
    await page.locator('#password').fill('TestPassword123!');
    await page.locator('form[data-form="auth"] button').click();
    await page.getByRole('heading', { name: '이 수업에 참가하기', exact: true }).waitFor();
    assert.equal(storageRequests, 0);
    assert.equal(await page.locator('.card').count(), 0);
    await page.goto(base + '#admin');
    await page.locator('form[data-form="enroll"]').waitFor();
    assert.equal(await page.locator('#students').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/tmp/eng3510-enrollment-${viewport.width}.png`, fullPage: true });
    await page.locator('#enroll-number').fill(sn);
    await page.locator('#enroll-code').fill(f.codes[sn]);
    await page.getByRole('button', { name: 'ENG3510 수업 참가하기', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'ENG3510 개인 초대코드' }).waitFor();
    assert.equal((await f.old.read(user)).enrollment_required, true);
    // Existing bookmarked routes must render correctly after joining.
    await page.goto(base);
    await page.locator('#enroll-number').fill(sn);
    await page.locator('#enroll-code').fill(f.legacyCodes[sn]);
    await page.getByRole('button', { name: 'ENG3510 수업 참가하기', exact: true }).click();
    await page.locator('.hero').waitFor();
    assert.equal((await f.old.read(user)).me.id, user);
    assert.equal((await f.read(user)).me.id, user);
    await page.reload();
    await page.locator('.hero').waitFor();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.getByRole('button', { name: '로그인 / 가입', exact: true }).waitFor();
    console.log(`PASS ${viewport.width}px: duplicate signup guidance → existing login → isolated enrollment → wrong-code rejection → join → reload/logout`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: no browser runtime errors');
} finally { await browser.close(); await f.db.close(); }
