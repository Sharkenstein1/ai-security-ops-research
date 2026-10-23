'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const mysql = require('mysql2/promise');
const { MysqlStore } = require('../server/mysql-store');
const { GameService, userIdFor } = require('../server/domain');
const { Sessions } = require('../server/auth');

const port = Number(process.env.POINTS_MYSQL_TEST_PORT);
if (!Number.isInteger(port) || port < 1 || !process.env.POINTS_MYSQL_TEST_PASSWORD) {
  throw new Error('请使用 npm run test:mysql；测试只连接脚本创建的本机 points_test 数据库');
}
const pool = mysql.createPool({
  host: '127.0.0.1', port, user: 'root', password: process.env.POINTS_MYSQL_TEST_PASSWORD,
  database: 'points_test', connectionLimit: 20, charset: 'utf8mb4'
});
const store = new MysqlStore(pool);

test.before(async () => { await store.initialize(); });
test.beforeEach(async () => { await pool.execute('DELETE FROM points_documents'); });
test.after(async () => { await pool.end(); });

async function game() {
  const service = new GameService(store);
  const users = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(name => [name, userIdFor(`openid-${name}`)]));
  for (const [name, id] of Object.entries(users)) {
    await service.execute('login', id);
    await service.execute('saveProfile', id, { nickname: name });
  }
  const call = (action, name, payload) => service.execute(action, users[name], payload);
  const create = async (title, requestKey) => (await call('createRoom', 'A', { title, requestKey })).room;
  async function join(room, name) {
    const pending = await call('requestJoin', name, { code: room.inviteCode });
    return call('decideJoin', 'A', { roomId: room.id, requestId: pending.requestId, approve: true });
  }
  return { service, users, call, create, join };
}

test('MySQL：初始化可重复执行，异常事务完整回滚，中文 JSON 无损', async () => {
  await store.initialize();
  await assert.rejects(store.transaction(async tx => {
    await tx.set('users', 'rollback_user', { nickname: '不应保存' });
    await tx.set('rooms', 'rollback_room', { title: '不应保存' });
    throw new Error('expected rollback');
  }), /expected rollback/);
  assert.equal(await store.get('users', 'rollback_user'), null);
  assert.equal(await store.get('rooms', 'rollback_room'), null);
  await store.transaction(tx => tx.set('users', 'unicode_user', { nickname: '小林🌿' }));
  assert.equal((await store.get('users', 'unicode_user')).nickname, '小林🌿');
});

test('MySQL：并发重复创建只保留一场，同一邀请码争用不会覆盖', async () => {
  const f = await game();
  const created = await Promise.all(Array.from({ length: 8 }, () => f.create('同一场', 'same_create')));
  assert.equal(new Set(created.map(room => room.id)).size, 1);
  assert.equal((await f.call('listHistory', 'A')).items.length, 1);
  const candidates = ['0386', '0386', '0387', '0388', '0389'];
  f.service.randomCode = () => candidates.shift();
  const rooms = await Promise.all([
    f.call('createRoom', 'B', { title: 'B的牌局', requestKey: 'code_room_b' }),
    f.call('createRoom', 'C', { title: 'C的牌局', requestKey: 'code_room_c' })
  ]);
  assert.notEqual(rooms[0].room.inviteCode, rooms[1].room.inviteCode);
  for (const { room } of rooms) assert.equal((await store.get('invite_codes', room.inviteCode)).roomId, room.id);
});

test('MySQL：并发重复提交及审批只入账一次，不同申请不丢失', async () => {
  const f = await game();
  const room = await f.create('并发测试', 'concurrency_room');
  await f.join(room, 'B');
  const payload = { roomId: room.id, kind: 'add', points: 1000, requestKey: 'one_request' };
  await Promise.all(Array.from({ length: 12 }, () => f.call('submitPoints', 'B', payload)));
  const before = (await f.call('getRoom', 'A', { roomId: room.id })).room;
  assert.equal(before.entries.length, 1);
  const entryId = before.entries[0].id;
  await Promise.all(Array.from({ length: 12 }, () => f.call('decidePoints', 'A', { roomId: room.id, entryId, approve: true })));
  await Promise.all(Array.from({ length: 12 }, (_, index) => f.call('submitPoints', 'B', {
    roomId: room.id, kind: 'add', points: index + 1, requestKey: `distinct_${index}`
  })));
  const after = (await f.call('getRoom', 'A', { roomId: room.id })).room;
  assert.equal(after.entries.length, 13);
  assert.equal(after.summary.totalPoints, 1000);
  assert.equal(after.members.find(member => member.userId === f.users.B).entryCount, 1);
});

test('MySQL：ABCD/ABCE 历史隔离、结束积分和归档读取', async () => {
  const f = await game();
  const first = await f.create('第一场', 'history_first');
  for (const name of ['B', 'C', 'D']) await f.join(first, name);
  const submitted = await f.call('submitPoints', 'B', { roomId: first.id, kind: 'add', points: 1000, requestKey: 'history_points' });
  await f.call('decidePoints', 'A', { roomId: first.id, entryId: submitted.room.entries[0].id, approve: true });
  const finished = await f.call('submitPoints', 'B', { roomId: first.id, kind: 'finish', points: 0, requestKey: 'history_finish' });
  await f.call('decidePoints', 'A', { roomId: first.id, entryId: finished.room.entries.at(-1).id, approve: true });
  const second = await f.create('第二场', 'history_second');
  for (const name of ['B', 'C', 'E']) await f.join(second, name);
  await f.call('closeRoom', 'A', { roomId: first.id });
  const history = await f.call('listHistory', 'D');
  assert.deepEqual(history.items.map(item => item.id), [first.id]);
  assert.deepEqual((await f.call('listHistory', 'E')).items.map(item => item.id), [second.id]);
  const bFirst = (await f.call('listHistory', 'B')).items.find(item => item.id === first.id);
  assert.equal(bFirst.netPoints, -1000);
  assert.equal(bFirst.status, 'closed');
  await assert.rejects(f.call('getRoom', 'D', { roomId: second.id }), error => error.code === 'FORBIDDEN');
});

test('MySQL：过期会话清理不删除仍有效的会话或其他业务数据', async () => {
  const now = Date.now();
  await store.transaction(async tx => {
    await tx.set('sessions', 'expired_session', { userId: 'a', expiresAt: now - 1 });
    await tx.set('sessions', 'active_session', { userId: 'b', expiresAt: now + 10000 });
    await tx.set('users', 'existing_user', { nickname: '保留' });
  });
  await store.pruneExpiredSessions(now);
  assert.equal(await store.get('sessions', 'expired_session'), null);
  assert.ok(await store.get('sessions', 'active_session'));
  assert.ok(await store.get('users', 'existing_user'));
});

test('生产服务入口：真实 MySQL、HTTP 读写、进程重启后账号会话和牌局仍在', async t => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const httpPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const f = await game();
  const sessions = new Sessions(store, f.service, async () => 'openid-A');
  const loggedIn = await sessions.login('local-integration-only');
  const base = `http://127.0.0.1:${httpPort}`;
  let child;
  async function start() {
    child = spawn(process.execPath, ['server/index.js'], {
      env: {
        ...process.env, PORT: String(httpPort), MYSQL_ADDRESS: `127.0.0.1:${port}`, MYSQL_DATABASE: 'points_test',
        MYSQL_USERNAME: 'root', MYSQL_PASSWORD: process.env.POINTS_MYSQL_TEST_PASSWORD,
        WX_APPID: 'wx0000000000000000', WX_APP_SECRET: 'local-integration-placeholder'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.resume();
    child.stderr.resume();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error('生产入口进程意外退出');
      try { if ((await fetch(`${base}/healthz`)).status === 200) return; } catch (error) {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('生产入口未能就绪');
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGTERM');
      await exit;
    }
  }
  t.after(stop);
  const post = async (action, payload) => {
    const response = await fetch(`${base}/api/game`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Points-Session': loggedIn.session.token },
      body: JSON.stringify({ action, payload })
    });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  };
  await start();
  const created = await post('createRoom', { title: '重启仍在', requestKey: 'restart_room' });
  await stop();
  await start();
  const result = await post('listHistory', {});
  assert.equal(result.items[0].id, created.room.id);
  assert.equal(result.items[0].title, '重启仍在');
});
