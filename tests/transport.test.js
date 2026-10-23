'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function client(responder, existing) {
  const file = path.resolve(__dirname, '../miniprogram/utils/api.js');
  const storage = new Map();
  const calls = [];
  let logins = 0;
  const config = { envId: 'test-env', service: 'test-service', apiPath: '/api/game' };
  if (existing) storage.set('points-session:test-env:test-service', existing);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, require: () => config,
    getApp: () => ({ globalData: { cloudReady: true } }),
    wx: {
      login: async () => ({ code: `wxcode_${++logins}` }),
      getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: key => storage.delete(key),
      cloud: { callContainer: async request => { calls.push(request); return responder(request); } }
    }
  }, { filename: file });
  return { api: module.exports, calls, loginCount: () => logins, storage };
}

function ok(data) { return { statusCode: 200, data: { ok: true, data } }; }
const fresh = () => ({ token: 'n'.repeat(43), expiresAt: Date.now() + 3600000 });

test('前端使用 callContainer 的 data 响应，填入环境、服务名和会话头', async () => {
  const c = client(request => request.data.payload.code
    ? ok({ session: fresh(), user: { id: 'A' } }) : ok({ user: { id: 'A' } }));
  const result = await c.api.call('login');
  assert.equal(result.user.id, 'A');
  assert.equal(c.loginCount(), 1);
  assert.equal(c.calls[0].config.env, 'test-env');
  assert.equal(c.calls[0].header['X-WX-SERVICE'], 'test-service');
  assert.equal(c.calls[0].path, '/api/game');
  assert.equal(c.calls[0].data.payload.code, 'wxcode_1');
  assert.equal(c.calls[1].header['X-Points-Session'], 'n'.repeat(43));
});

test('服务器拒绝过期令牌后重新微信登录，原记账请求键保持不变', async () => {
  const c = client(request => {
    if (request.data.payload.code) return ok({ session: fresh() });
    if (request.header['X-Points-Session'] === 'o'.repeat(43)) {
      return { statusCode: 401, data: { ok: false, error: { code: 'UNAUTHENTICATED', message: '过期' } } };
    }
    return ok({ saved: true });
  }, { token: 'o'.repeat(43), expiresAt: Date.now() + 3600000 });
  const result = await c.api.call('submitPoints', { points: 100, requestKey: 'same_request' });
  assert.equal(result.saved, true);
  const writes = c.calls.filter(request => request.data.action === 'submitPoints');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].data.payload.requestKey, writes[1].data.payload.requestKey);
  assert.equal(c.loginCount(), 1);
});

test('服务仍是计数器模板时，404 明确提示需要部署积分后端', async () => {
  const c = client(() => ({ statusCode: 404, data: '<html>Not Found</html>' }));
  await assert.rejects(c.api.call('login'), error => error.code === 'BACKEND_NOT_DEPLOYED' && error.message.includes('/api/game'));
});
