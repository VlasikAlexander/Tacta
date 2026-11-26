import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { encodeDevice, parseDevice } from '../web/device.js';
import { compareVersions, createDrive, driveScope, fingerprint, makeGraph } from '../web/drive.js';
import { createDriveSync, validClientId } from '../web/drive-sync.js';
import { blankStore } from '../web/model.js';

const clientId = '123456-example.apps.googleusercontent.com';
const json = (value, options) => new Response(JSON.stringify(value), options);
const local = (payload, initialized = true) => ({ payload, binding: null, revision: null, recovery: [], initialized });
const client = name => ({ id: crypto.randomUUID(), name, phone: '', birthday: null, allergies: '',
  contraindications: '', preferences: '', notes: '' });

function fakeGoogle() {
  const accounts = new Map([['token-wife', []], ['token-other', []]]);
  const requests = [];
  async function fetcher(url, options) {
    const request = new URL(url);
    assert.equal(request.origin, 'https://www.googleapis.com');
    assert.equal(options.credentials, 'omit');
    const token = options.headers.Authorization?.replace('Bearer ', '');
    const account = accounts.get(token);
    requests.push({ request, method: options.method, token });
    if (!account) return json({ error: 'expired' }, { status: 401 });
    if (request.pathname === '/drive/v3/about') {
      return json({ user: { permissionId: token, emailAddress: token.replace('token-', '') + '@example.com' } });
    }
    if (request.pathname === '/drive/v3/files') {
      assert.equal(request.searchParams.get('spaces'), 'appDataFolder');
      const index = Number(request.searchParams.get('pageToken') ?? 0);
      const { content, ...metadata } = account[index] ?? {};
      return json({
        files: content ? [metadata] : [],
        ...(account.length > index + 1 ? { nextPageToken: String(index + 1) } : {}),
      });
    }
    if (request.pathname === '/upload/drive/v3/files') {
      assert.equal(options.method, 'POST');
      assert.equal(request.searchParams.get('uploadType'), 'multipart');
      assert.match(options.headers['Content-Type'], /^multipart\/related/);
      const [metadata, content] = options.body.split('\r\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
      assert.deepEqual(metadata.parents, ['appDataFolder']);
      const id = 'file-' + account.length;
      account.push({ id, name: metadata.name, description: metadata.description, createdTime: new Date().toISOString(), content });
      return json({ id });
    }
    const file = account.find(item => request.pathname === '/drive/v3/files/' + item.id);
    assert.equal(request.searchParams.get('alt'), 'media');
    return file ? json(file.content) : json({}, { status: 404 });
  }
  return { accounts, fetcher, requests };
}

test('локальная версия v1 импортируется, а замена атомарно архивирует предыдущие записи', () => {
  const first = blankStore();
  first.clients.push(client('Первая версия'));
  const legacy = parseDevice(JSON.stringify(first));
  assert.deepEqual(legacy.payload, first);
  assert.equal(legacy.binding, null);
  const next = blankStore();
  const newer = parseDevice(encodeDevice(legacy, { payload: next, preserve: true }));
  assert.deepEqual(newer.payload, next);
  assert.deepEqual(newer.recovery[0].payload, first);
  assert.notEqual(newer.revision, legacy.revision);
  assert.throws(() => parseDevice('invalid'));
});

test('два устройства могут сохранить одновременно, обе ветви остаются доступны после выбора', async () => {
  const { accounts, fetcher } = fakeGoogle();
  const drive = createDrive('token-wife', fetcher);
  const first = blankStore();
  first.clients.push(client('Общий клиент'));
  const empty = await drive.list();
  const root = await drive.write(first, [], empty);
  const initial = await drive.list();
  const left = structuredClone(first);
  const right = structuredClone(first);
  left.clients.push(client('Из первого устройства'));
  right.clients.push(client('Из второго устройства'));
  const [a, b] = await Promise.all([drive.write(left, [root], initial), drive.write(right, [root], initial)]);
  const branches = await drive.list();
  assert.deepEqual(new Set(branches.heads.map(item => item.id)), new Set([a, b]));
  assert.equal(compareVersions(branches, { clientId, accountId: 'token-wife', snapshot: root, hash: await fingerprint(first) },
    await fingerprint(left), 'token-wife', clientId), 'conflict');
  const chosen = await drive.write(right, [a, b], branches);
  const resolved = await drive.list();
  assert.deepEqual(resolved.heads.map(item => item.id), [chosen]);
  assert.deepEqual(await drive.read(resolved.byId.get(a)), left);
  assert.deepEqual(await drive.read(resolved.byId.get(chosen)), right);
  assert.equal(await drive.write(right, [b, a], resolved), chosen);
  assert.equal(accounts.get('token-wife').length, 4);
  assert.equal((await createDrive('token-other', fetcher).list()).history.length, 0);
  const corrupted = accounts.get('token-wife').find(item => item.name.includes(a));
  corrupted.content.payload.clients[0].name = 'Изменено вне Tacta';
  await assert.rejects(() => drive.read(resolved.byId.get(a)), /целостности/);
});

test('повреждённые и неполные графы отклоняются, истёкший доступ обрабатывается', async () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const entry = (id, parents) => ({
    id, name: 'tacta-v1-' + id + '.json', description: JSON.stringify(parents), createdTime: new Date().toISOString(),
  });
  assert.throws(() => makeGraph([entry(a, [b])]), /не полностью/);
  assert.throws(() => makeGraph([entry(a, [b]), entry(b, [a])]), /историю/);
  const { fetcher } = fakeGoogle();
  await assert.rejects(() => createDrive('expired', fetcher).list(), { status: 401 });
  const incomplete = createDrive('token-wife', async () => json({ incompleteSearch: true, files: [] }));
  await assert.rejects(() => incomplete.list(), /неполный список/);
  assert.equal(validClientId(clientId), true);
  assert.equal(validClientId('secret-or-url'), false);
});

test('сессия Drive подключается по клику, ждёт подтверждения и не выгружает в другой аккаунт', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { accounts, fetcher, requests } = fakeGoogle();
  const panel = { innerHTML: '' };
  let confirmation;
  let activeToken = 'token-wife';
  let launches = 0;
  const original = { fetch: globalThis.fetch, document: globalThis.document, google: globalThis.google };
  t.after(() => Object.assign(globalThis, original));
  globalThis.document = {
    visibilityState: 'visible', addEventListener() {},
    querySelector: selector => selector === '#drive-settings' ? panel : null,
    createElement: () => ({}),
    head: { append: item => item.onload() },
  };
  globalThis.fetch = (url, options) => typeof url === 'string' && url.startsWith('./')
    ? Promise.resolve(json({ clientId })) : fetcher(url, options);
  globalThis.google = { accounts: { oauth2: { initTokenClient(options) {
    assert.equal(options.client_id, clientId);
    assert.equal(options.scope, driveScope);
    assert.equal(options.include_granted_scopes, false);
    return { requestAccessToken(request) {
      launches++;
      assert.equal(request.prompt, 'select_account');
      options.callback({ access_token: activeToken, scope: driveScope, expires_in: 60 });
    } };
  } } } };
  const settle = async check => {
    for (let tries = 0; tries < 50 && !check(); tries++) await wait(5);
    assert.ok(check());
  };
  const old = blankStore();
  old.clients.push(client('Первые записи'));
  let device = parseDevice(encodeDevice(local(old)));
  let indicator;
  const sync = createDriveSync({
    getLocal: () => device,
    commitLocal(revision, changes, valid) {
      assert.ok(valid());
      assert.equal(revision, device.revision);
      device = parseDevice(encodeDevice(device, changes));
    },
    confirm(title, message, label, action) { confirmation = { title, message, label, action }; },
    download() {}, notify() {}, setIndicator(value) { indicator = value; },
  });
  await sync.settingOpened();
  assert.equal(launches, 0);
  assert.equal(requests.length, 0);
  sync.actions['drive-connect']();
  await settle(() => panel.innerHTML.includes('ещё не связан'));
  assert.equal(accounts.get('token-wife').length, 0);
  await sync.actions['drive-save']();
  assert.match(confirmation.message, /wife@example.com/);
  assert.equal(accounts.get('token-wife').length, 0);
  await confirmation.action();
  assert.equal(device.binding.accountId, 'token-wife');
  assert.equal(accounts.get('token-wife').length, 1);
  const edited = structuredClone(device.payload);
  edited.clients.push(client('Второй клиент'));
  device = parseDevice(encodeDevice(device, { payload: edited }));
  sync.changed();
  assert.match(indicator, /выгрузки/);
  t.mock.timers.tick(2400);
  await settle(() => panel.innerHTML.includes('Копия сохранена на Google Drive.'));
  assert.equal(accounts.get('token-wife').length, 2);

  device = local(blankStore(), false);
  sync.actions['drive-connect']();
  await settle(() => panel.innerHTML.includes('ещё не связан'));
  assert.match(panel.innerHTML, /data-action="drive-save" disabled/);
  assert.equal(device.payload.clients.length, 0);
  await sync.actions['drive-restore']();
  assert.equal(device.payload.clients.length, 0);
  await confirmation.action();
  assert.equal(device.payload.clients.length, 2);

  await sync.actions['drive-restore']();
  const updated = structuredClone(device.payload);
  updated.clients.push(client('Изменение до подтверждения'));
  device = parseDevice(encodeDevice(device, { payload: updated }));
  await assert.rejects(confirmation.action, /локальные записи изменились/);
  assert.equal(device.payload.clients.length, 3);

  activeToken = 'token-other';
  sync.actions['drive-connect']();
  await settle(() => panel.innerHTML.includes('Выбран другой аккаунт.'));
  sync.changed();
  t.mock.timers.tick(2400);
  assert.equal(accounts.get('token-other').length, 0);
  t.mock.timers.tick(60_000);
  assert.match(panel.innerHTML, /Доступ к Google Drive истёк/);
  assert.equal(device.payload.clients.length, 3);
});
