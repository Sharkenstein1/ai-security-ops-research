'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { GameService, AppError } = require('../server/domain');
const { Sessions } = require('../server/auth');
const { MemoryStore } = require('./helpers/memory-store');

async function setup(t) {
  const store = new MemoryStore();
  store.health = async () => {};
  const service = new GameService(store);
  const sessions = new Sessions(store, service, async code => {
    if (!/^code_[ABCDE]$/.test(code)) throw new AppError('WECHAT_LOGIN_FAILED', '无效凭证');
    return code.replace('code_', 'openid_');
  });
  const app = createApp({ store, service, sessions, logger: { error() {} } });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  async function post(action, payload, token, headers = {}) {
    const response = await fetch(`${base}/api/game`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers, ...(token ? { 'X-Points-Session': token } : {}) },
      body: JSON.stringify({ action, payload })
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function login(name) {
    const result = await post('login', { code: `code_${name}` });
    assert.equal(result.status, 200);
    const token = result.body.data.session.token;
    const profile = await post('saveProfile', { nickname: name }, token);
    assert.equal(profile.status, 200);
    return token;
  }
  return { store, base, post, login };
}

test('HTTP 拒绝伪造微信请求头和客户端身份；令牌不写入响应缓存', async t => {
  const f = await setup(t);
  const forged = await f.post('listHistory', { userId: 'A' }, undefined, { 'X-WX-OPENID': 'forged', 'X-WX-SOURCE': 'wx' });
  assert.equal(forged.status, 401);
  const invalid = await f.post('login', { code: 'invalid', openid: 'forged' });
  assert.equal(invalid.status, 400);
  const loggedIn = await f.post('login', { code: 'code_A' });
  assert.equal(loggedIn.headers.get('cache-control'), 'no-store');
  assert.equal(loggedIn.headers.get('x-powered-by'), null);
  const token = loggedIn.body.data.session.token;
  const profile = await f.post('login', {}, token);
  assert.equal(profile.body.data.user.id, loggedIn.body.data.user.id);
  assert.ok(!JSON.stringify(loggedIn.body).includes('openid_A'));
});

test('完整 HTTP 流程：创建、审批加入、积分确认、归档、跨局权限', async t => {
  const f = await setup(t);
  const tokens = {};
  for (const name of ['A', 'B', 'C', 'D', 'E']) tokens[name] = await f.login(name);
  const invoke = async (name, action, payload) => f.post(action, payload, tokens[name]);
  const first = (await invoke('A', 'createRoom', { title: '第一场', requestKey: 'create_first' })).body.data.room;
  async function join(room, name) {
    const pending = await invoke(name, 'requestJoin', { code: room.inviteCode });
    assert.equal((await invoke(name, 'getRoom', { roomId: room.id })).status, 403);
    const approved = await invoke('A', 'decideJoin', { roomId: room.id, requestId: pending.body.data.requestId, approve: true });
    assert.equal(approved.status, 200);
  }
  for (const name of ['B', 'C', 'D']) await join(first, name);
  const submitted = await invoke('B', 'submitPoints', { roomId: first.id, kind: 'add', points: 1000, requestKey: 'first_points' });
  assert.equal(submitted.body.data.room.summary.totalPoints, 0);
  const entryId = submitted.body.data.room.entries[0].id;
  assert.equal((await invoke('B', 'decidePoints', { roomId: first.id, entryId, approve: true })).status, 403);
  const confirmed = await invoke('A', 'decidePoints', { roomId: first.id, entryId, approve: true });
  assert.equal(confirmed.body.data.room.summary.totalPoints, 1000);
  const second = (await invoke('A', 'createRoom', { title: '第二场', requestKey: 'create_second' })).body.data.room;
  for (const name of ['B', 'C', 'E']) await join(second, name);
  assert.equal((await invoke('D', 'getRoom', { roomId: second.id })).status, 403);
  assert.equal((await invoke('E', 'getRoom', { roomId: first.id })).status, 403);
  assert.deepEqual((await invoke('D', 'listHistory', {})).body.data.items.map(item => item.id), [first.id]);
  assert.deepEqual((await invoke('E', 'listHistory', {})).body.data.items.map(item => item.id), [second.id]);
  assert.equal((await invoke('A', 'closeRoom', { roomId: first.id })).status, 200);
  assert.equal((await invoke('B', 'getRoom', { roomId: first.id })).body.data.room.status, 'closed');
});

test('健康检查实际检查存储；错误 JSON、过大请求和旧模板路径正确报错', async t => {
  const f = await setup(t);
  assert.equal((await fetch(`${f.base}/healthz`)).status, 200);
  f.store.health = async () => { throw new Error('database unavailable'); };
  assert.equal((await fetch(`${f.base}/healthz`)).status, 503);
  assert.equal((await fetch(`${f.base}/api/count`)).status, 404);
  const bad = await fetch(`${f.base}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal(bad.status, 400);
  const large = await fetch(`${f.base}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(17000) }) });
  assert.equal(large.status, 413);
});
