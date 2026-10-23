'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadPage(relative, mocks = {}) {
  const file = path.resolve(__dirname, '../miniprogram', relative);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; },
    require: name => {
      if (name.endsWith('/api')) return mocks.api;
      throw new Error(`Unexpected import ${name}`);
    },
    getApp: () => mocks.app,
    wx: mocks.wx || {},
    setInterval: () => 1,
    clearInterval() {}
  });
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = value => { Object.assign(page.data, value); };
  return page;
}

test('创建请求的响应丢失后重试复用同一请求键', async () => {
  const requests = [];
  let count = 0;
  const user = { id: 'A', nickname: '玩家A' };
  const page = loadPage('pages/home/home.js', {
    app: { login: async () => user },
    api: {
      requestKey: () => `request_${++count}`,
      showError() {},
      call: async (action, payload) => {
        requests.push({ ...payload });
        if (requests.length === 1) throw new Error('response lost');
        return { room: { id: 'r1' } };
      }
    },
    wx: { navigateTo() {} }
  });
  page.data.title = '周末牌局';
  await page.createRoom();
  await page.createRoom();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestKey, requests[1].requestKey);
  assert.equal(count, 1);
});

test('加入请求在后台完成后，回到页面会继续进入已批准的牌局', async () => {
  let resolve;
  const request = new Promise(done => { resolve = done; });
  const navigations = [];
  const page = loadPage('pages/join/join.js', {
    app: { login: async () => ({ nickname: 'B' }) },
    api: { call: () => request },
    wx: { redirectTo: options => navigations.push(options.url) }
  });
  page.data.code = '0386';
  page.onShow();
  const pending = page.submit();
  await Promise.resolve();
  page.onHide();
  resolve({ roomId: 'r1', status: 'approved' });
  await pending;
  assert.equal(navigations.length, 0);
  page.onShow();
  assert.deepEqual(navigations, ['/pages/room/room?roomId=r1']);
});
