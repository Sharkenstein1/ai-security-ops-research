'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Sessions, createWeChatExchange, SESSION_TTL } = require('../server/auth');
const { GameService, userIdFor } = require('../server/domain');
const { MemoryStore } = require('./helpers/memory-store');
const { readConfig } = require('../server/config');

test('只用微信服务端返回的 OpenID 建立会话；数据库不保存原始会话令牌', async () => {
  const store = new MemoryStore();
  const service = new GameService(store);
  let now = Date.now();
  const sessions = new Sessions(store, service, async code => {
    assert.equal(code, 'real-code');
    return 'verified-openid';
  }, { now: () => now });
  const result = await sessions.login('real-code');
  assert.equal(result.user.id, userIdFor('verified-openid'));
  assert.equal(await sessions.authenticate(result.session.token), result.user.id);
  assert.ok(!JSON.stringify([...store.documents]).includes(result.session.token));
  assert.ok(!JSON.stringify(result).includes('verified-openid'));
  now += SESSION_TTL;
  await assert.rejects(sessions.authenticate(result.session.token), error => error.code === 'UNAUTHENTICATED');
  await assert.rejects(sessions.authenticate('forged-token'), error => error.code === 'UNAUTHENTICATED');
});

test('微信凭证校验固定使用官方 HTTPS 接口，配置错误不泄露密钥', async () => {
  const appSecret = 'unit-test-only';
  const exchange = createWeChatExchange({
    appId: 'wx0000000000000000', appSecret,
    fetcher: async (url, options) => {
      assert.equal(url.origin, 'https://api.weixin.qq.com');
      assert.equal(url.pathname, '/sns/jscode2session');
      assert.equal(url.searchParams.get('js_code'), 'valid-code');
      assert.equal(url.searchParams.get('secret'), appSecret);
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => ({ errcode: 40125, errmsg: appSecret }) };
    }
  });
  await assert.rejects(exchange('valid-code'), error => error.code === 'WECHAT_CONFIG_ERROR' && !error.message.includes(appSecret));
  await assert.rejects(exchange('bad code'), error => error.code === 'WECHAT_LOGIN_FAILED');
  const unavailable = createWeChatExchange({ appId: 'x', appSecret, fetcher: async () => { throw new Error(appSecret); } });
  await assert.rejects(unavailable('code'), error => error.code === 'WECHAT_UNAVAILABLE' && !error.message.includes(appSecret));
});

test('复用模板的 MYSQL_* 变量；配置错误只报告变量名', () => {
  const environment = {
    MYSQL_ADDRESS: 'mysql.internal:3306', MYSQL_USERNAME: 'test-user', MYSQL_PASSWORD: 'unit-test-only',
    WX_APPID: 'wx0000000000000000', WX_APP_SECRET: 'unit-test-only'
  };
  const config = readConfig(environment);
  assert.equal(config.mysql.database, 'nodejs_demo');
  assert.equal(config.port, 80);
  assert.equal(config.mysql.host, 'mysql.internal');
  assert.equal(config.mysql.port, 3306);
  assert.equal(readConfig({ ...environment, MYSQL_SSL_CA: 'test-ca' }).mysql.ssl.rejectUnauthorized, true);
  assert.throws(() => readConfig({ ...environment, WX_APP_SECRET: '' }), /WX_APP_SECRET/);
  assert.throws(() => readConfig({ ...environment, MYSQL_ADDRESS: 'https://invalid/' }), /MYSQL_ADDRESS/);
  assert.throws(() => readConfig({ ...environment, WX_APPID: 'touristappid' }), /WX_APPID/);
});
