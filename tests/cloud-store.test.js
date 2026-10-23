'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudStore } = require('../cloudfunctions/gameApi/cloud-store');

test('云数据库适配器使用微信 SDK 的 data 包装，并保留数据库异常', async () => {
  const operations = [];
  const db = {
    collection(collection) {
      return { doc(id) {
        return {
          get: async () => ({ data: id === 'missing' ? null : { _id: id, value: 1 } }),
          set: async payload => operations.push({ collection, id, payload }),
          remove: async () => operations.push({ collection, id, removed: true })
        };
      } };
    },
    runTransaction: async (work, retries) => { assert.equal(retries, 5); return work(db); }
  };
  const store = new CloudStore(db);
  assert.equal(await store.get('rooms', 'missing'), null);
  await store.transaction(async tx => {
    const value = await tx.get('rooms', 'r1');
    await tx.set('rooms', 'r1', { ...value, value: 2 });
    await tx.delete('invite_codes', '0386');
  });
  assert.deepEqual(operations[0], { collection: 'rooms', id: 'r1', payload: { data: { value: 2 } } });
  assert.equal(operations[1].removed, true);
  db.runTransaction = async () => { throw new Error('permission denied'); };
  await assert.rejects(store.transaction(() => {}), /permission denied/);
});

test('历史查询固定为调用者的 membership 条件，并在云端分页', async () => {
  const operations = [];
  const query = {
    where: value => { operations.push(['where', value]); return query; },
    orderBy: (...value) => { operations.push(['orderBy', ...value]); return query; },
    skip: value => { operations.push(['skip', value]); return query; },
    limit: value => { operations.push(['limit', value]); return query; },
    get: async () => ({ data: [{ roomId: 'r1' }] })
  };
  const db = { collection: name => { assert.equal(name, 'memberships'); return query; } };
  const result = await new CloudStore(db).listMemberships('u1', 20, 21);
  assert.deepEqual(result, [{ roomId: 'r1' }]);
  assert.deepEqual(operations, [['where', { userId: 'u1' }], ['orderBy', 'joinedAt', 'desc'], ['skip', 20], ['limit', 21]]);
});
