'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameService, userIdFor, INVITE_TTL, LIMITS } = require('../cloudfunctions/gameApi/domain');
const { makeHandler } = require('../cloudfunctions/gameApi/handler');
const { MemoryStore } = require('./helpers/memory-store');

async function fixture(options = {}) {
  const store = new MemoryStore();
  let clock = 1800000000000;
  let counter = 0;
  let code = 0;
  const service = new GameService(store, {
    now: () => clock,
    randomCode: options.randomCode || (() => String(code++).padStart(4, '0')),
    newId: () => String(counter++)
  });
  const users = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(name => [name, userIdFor(`openid-${name}`)]));
  async function register(name) {
    const uid = users[name] || userIdFor(`openid-${name}`);
    await service.execute('login', uid);
    await service.execute('saveProfile', uid, { nickname: name });
    return uid;
  }
  for (const name of Object.keys(users)) await register(name);
  const call = (action, name, payload) => service.execute(action, users[name] || name, payload);
  const create = async (owner = 'A', title = '周末牌局', requestKey = `create_${counter++}`) =>
    (await call('createRoom', owner, { title, requestKey })).room;
  async function join(room, name) {
    const request = await call('requestJoin', name, { code: room.inviteCode });
    return (await call('decideJoin', room.ownerId, { roomId: room.id, requestId: request.requestId, approve: true })).room;
  }
  const submit = async (room, name, amount, kind = 'add', requestKey = `points_${counter++}`) => {
    const result = await call('submitPoints', name, { roomId: room.id, points: amount, kind, requestKey });
    return result.room.entries.find(entry => entry.id === `${users[name] || name}_${requestKey}`);
  };
  const decide = async (room, entry, approve = true, owner = room.ownerId) =>
    (await call('decidePoints', owner, { roomId: room.id, entryId: entry.id, approve })).room;
  return { store, service, users, register, call, create, join, submit, decide, advance: ms => { clock += ms; } };
}

function code(expected) { return error => { assert.equal(error.code, expected); return true; }; }

test('微信上下文决定身份；伪造 event 和 payload 中的用户编号无效', async () => {
  const f = await fixture();
  const handler = makeHandler(f.service, () => ({ OPENID: 'openid-B' }));
  const result = await handler({ action: 'saveProfile', OPENID: 'openid-A', payload: { userId: f.users.A, nickname: 'B新昵称' } });
  assert.equal(result.data.user.id, f.users.B);
  assert.equal((await f.store.get('users', f.users.A)).nickname, 'A');
  const noContext = makeHandler(f.service, () => ({}));
  assert.equal((await noContext({ action: 'login' })).error.code, 'UNAUTHENTICATED');
});

test('登录幂等；昵称验证；账号无需手机号或客户端密码', async () => {
  const f = await fixture();
  const first = await f.call('login', 'A');
  assert.deepEqual(await f.call('login', 'A'), first);
  await assert.rejects(f.call('saveProfile', 'A', { nickname: '   ' }), code('INVALID_INPUT'));
  await assert.rejects(f.call('saveProfile', 'A', { nickname: 'a'.repeat(21) }), code('INVALID_INPUT'));
  await assert.rejects(f.call('saveProfile', 'A', { nickname: '换\n行' }), code('INVALID_INPUT'));
  await assert.rejects(f.call('constructor', 'A', {}), code('UNKNOWN_ACTION'));
});

test('创建牌局保留前导零；同一请求重试不会创建第二场', async () => {
  const f = await fixture();
  const first = await f.create('A', '朋友局', 'same_create');
  const duplicate = await f.create('A', '朋友局', 'same_create');
  assert.equal(first.inviteCode, '0000');
  assert.equal(first.id, duplicate.id);
  assert.equal((await f.call('listHistory', 'A')).items.length, 1);
  await assert.rejects(f.create('A', '另一个名字', 'same_create'), code('IDEMPOTENCY_CONFLICT'));
});

test('邀请码冲突时重新分配，不覆盖已有牌局', async () => {
  const codes = ['0386', '0386', '0387'];
  const f = await fixture({ randomCode: () => codes.shift() });
  const first = await f.create();
  const second = await f.create('B');
  assert.equal(first.inviteCode, '0386');
  assert.equal(second.inviteCode, '0387');
  assert.equal((await f.store.get('invite_codes', '0386')).roomId, first.id);
});

test('待批准玩家只能读自己的申请状态，不能读玩家名单或历史', async () => {
  const f = await fixture();
  const room = await f.create();
  const request = await f.call('requestJoin', 'B', { code: room.inviteCode });
  assert.equal(request.status, 'pending');
  assert.equal(request.title, undefined);
  await assert.rejects(f.call('getRoom', 'B', { roomId: room.id }), code('FORBIDDEN'));
  assert.equal((await f.call('listHistory', 'B')).items.length, 0);
  const status = await f.call('getJoinStatus', 'B', { roomId: room.id });
  assert.deepEqual(Object.keys(status).sort(), ['requestId', 'roomId', 'status']);
  await assert.rejects(f.call('decideJoin', 'C', { roomId: room.id, requestId: request.requestId, approve: true }), code('FORBIDDEN'));
  await f.call('cancelJoin', 'B', { roomId: room.id });
  assert.equal((await f.call('getJoinStatus', 'B', { roomId: room.id })).status, 'cancelled');
  await assert.rejects(f.call('decideJoin', 'A', { roomId: room.id, requestId: request.requestId, approve: true }), code('ALREADY_DECIDED'));
});

test('ABCD 第一场、ABCE 第二场：历史和直接读取严格按参与关系隔离', async () => {
  const f = await fixture();
  const first = await f.create('A', '第一场');
  for (const name of ['B', 'C', 'D']) await f.join(first, name);
  f.advance(1000);
  const second = await f.create('A', '第二场');
  for (const name of ['B', 'C', 'E']) await f.join(second, name);
  assert.deepEqual((await f.call('listHistory', 'D')).items.map(item => item.id), [first.id]);
  assert.deepEqual((await f.call('listHistory', 'E')).items.map(item => item.id), [second.id]);
  for (const name of ['A', 'B', 'C']) assert.equal((await f.call('listHistory', name)).items.length, 2);
  await assert.rejects(f.call('getRoom', 'D', { roomId: second.id }), code('FORBIDDEN'));
  await assert.rejects(f.call('getRoom', 'E', { roomId: first.id }), code('FORBIDDEN'));
  await assert.rejects(f.call('submitPoints', 'D', { roomId: second.id, kind: 'add', points: 100, requestKey: 'forged_123' }), code('FORBIDDEN'));
});

test('积分只在确认后计入；并发重复提交和确认均不重复入账', async () => {
  const f = await fixture();
  const room = await f.create();
  await f.join(room, 'B');
  const payload = { roomId: room.id, kind: 'add', points: 1000, requestKey: 'same_points' };
  await Promise.all(Array.from({ length: 6 }, () => f.call('submitPoints', 'B', payload)));
  let current = (await f.call('getRoom', 'A', { roomId: room.id })).room;
  assert.equal(current.entries.length, 1);
  assert.equal(current.summary.totalPoints, 0);
  await Promise.all(Array.from({ length: 6 }, () => f.decide(room, current.entries[0])));
  current = (await f.call('getRoom', 'A', { roomId: room.id })).room;
  assert.equal(current.summary.totalPoints, 1000);
  assert.equal(current.members.find(member => member.userId === f.users.B).entryCount, 1);
  await assert.rejects(f.call('submitPoints', 'B', { ...payload, points: 2000 }), code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(f.call('decidePoints', 'B', { roomId: room.id, entryId: current.entries[0].id, approve: true }), code('OWNER_ONLY'));
});

test('并发不同积分申请不丢失；客户端不能替其他玩家登记', async () => {
  const f = await fixture();
  const room = await f.create();
  await f.join(room, 'B');
  await Promise.all(Array.from({ length: 10 }, (_, index) => f.call('submitPoints', 'B', {
    roomId: room.id, userId: f.users.A, kind: 'add', points: 10 + index, requestKey: `parallel_${index}`
  })));
  const current = (await f.call('getRoom', 'A', { roomId: room.id })).room;
  assert.equal(current.entries.length, 10);
  assert.ok(current.entries.every(entry => entry.userId === f.users.B));
});

test('拒绝负数、小数、字符串、NaN、无穷和超范围积分', async () => {
  const f = await fixture();
  const room = await f.create();
  for (const amount of [-1, 0, 0.5, '100', NaN, Infinity, LIMITS.points + 1]) {
    await assert.rejects(f.submit(room, 'A', amount), code('INVALID_INPUT'));
  }
  await assert.rejects(f.submit(room, 'A', 100, 'unknown'), code('INVALID_INPUT'));
});

test('结束积分可为零；确认前须处理登记；确认后停止追加', async () => {
  const f = await fixture();
  const room = await f.create();
  const add = await f.submit(room, 'A', 100);
  await assert.rejects(f.submit(room, 'A', 0, 'finish'), code('PENDING_POINTS'));
  await f.decide(room, add);
  const finish = await f.submit(room, 'A', 0, 'finish');
  await assert.rejects(f.submit(room, 'A', 50), code('FINAL_PENDING'));
  const current = await f.decide(room, finish);
  assert.equal(current.members[0].endingPoints, 0);
  assert.equal(current.members[0].netPoints, -100);
  await assert.rejects(f.submit(room, 'A', 50), code('PLAYER_FINISHED'));
  const history = (await f.call('listHistory', 'A')).items[0];
  assert.equal(history.netPoints, -100);
});

test('撤销保留原记录与原因；撤销结束记录后可以更正登记', async () => {
  const f = await fixture();
  const room = await f.create();
  const add = await f.submit(room, 'A', 100);
  await f.decide(room, add);
  const finish = await f.submit(room, 'A', 120, 'finish');
  await f.decide(room, finish);
  const revoke = entryId => f.call('revokePoints', 'A', { roomId: room.id, entryId, reason: '登记有误，重新核对' });
  await assert.rejects(revoke(add.id), code('PLAYER_FINISHED'));
  await revoke(finish.id);
  await revoke(add.id);
  const current = (await f.call('getRoom', 'A', { roomId: room.id })).room;
  assert.equal(current.entries.length, 2);
  assert.ok(current.entries.every(entry => entry.status === 'revoked' && entry.decidedAt && entry.revokeReason));
  assert.equal(current.members[0].totalPoints, 0);
  assert.equal(current.members[0].entryCount, 0);
  assert.equal(current.members[0].endingPoints, null);
});

test('结束牌局要求先处理待确认积分；归档后保留历史并阻止修改', async () => {
  const f = await fixture();
  const room = await f.create();
  await f.join(room, 'B');
  const waiting = await f.call('requestJoin', 'C', { code: room.inviteCode });
  const entry = await f.submit(room, 'B', 200);
  await assert.rejects(f.call('closeRoom', 'A', { roomId: room.id }), code('PENDING_POINTS'));
  await f.decide(room, entry, false);
  await f.call('closeRoom', 'A', { roomId: room.id });
  assert.equal((await f.call('getJoinStatus', 'C', { roomId: waiting.roomId })).status, 'rejected');
  await assert.rejects(f.submit(room, 'B', 100), code('ROOM_CLOSED'));
  await assert.rejects(f.call('refreshInvite', 'A', { roomId: room.id }), code('ROOM_CLOSED'));
  await assert.rejects(f.call('requestJoin', 'E', { code: room.inviteCode }), code('INVALID_INVITE'));
  const history = (await f.call('listHistory', 'B')).items[0];
  assert.equal(history.status, 'closed');
  assert.equal(history.netPoints, null);
  assert.equal((await f.call('listHistory', 'C')).items.length, 0);
});

test('邀请码过期可复用；结束旧牌局不会删除新牌局的邀请码', async () => {
  const f = await fixture({ randomCode: () => '0386' });
  const first = await f.create('A');
  f.advance(INVITE_TTL + 1);
  await assert.rejects(f.call('requestJoin', 'B', { code: first.inviteCode }), code('INVALID_INVITE'));
  const second = await f.create('B');
  await f.call('closeRoom', 'A', { roomId: first.id });
  const request = await f.call('requestJoin', 'C', { code: '0386' });
  assert.equal(request.roomId, second.id);
  assert.equal((await f.call('listHistory', 'A')).items.length, 1);
});

test('房主可以刷新邀请码，旧码立即失效；其他成员不能读取或刷新邀请码', async () => {
  const f = await fixture();
  const room = await f.create();
  const memberView = await f.join(room, 'B');
  assert.equal((await f.call('getRoom', 'B', { roomId: room.id })).room.inviteCode, '');
  const next = (await f.call('refreshInvite', 'A', { roomId: room.id })).room;
  assert.notEqual(next.inviteCode, room.inviteCode);
  await assert.rejects(f.call('requestJoin', 'C', { code: room.inviteCode }), code('INVALID_INVITE'));
  await assert.rejects(f.call('refreshInvite', 'B', { roomId: memberView.id }), code('OWNER_ONLY'));
});

test('无效邀请码也消耗限流额度；一分钟后恢复', async () => {
  const f = await fixture();
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(f.call('requestJoin', 'B', { code: '9999' }), code('INVALID_INVITE'));
  }
  await assert.rejects(f.call('requestJoin', 'B', { code: '9999' }), code('RATE_LIMITED'));
  f.advance(60000);
  await assert.rejects(f.call('requestJoin', 'B', { code: '9999' }), code('INVALID_INVITE'));
});

test('并发批准加入时人数上限仍生效，失败申请不会生成历史关系', async () => {
  const f = await fixture();
  const room = await f.create();
  const applicants = [];
  for (let index = 0; index < LIMITS.members; index += 1) {
    const uid = await f.register(`P${index}`);
    applicants.push({ uid, ...await f.call('requestJoin', uid, { code: room.inviteCode }) });
  }
  const results = await Promise.allSettled(applicants.map(item => f.call('decideJoin', 'A', {
    roomId: room.id, requestId: item.requestId, approve: true
  })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, LIMITS.members - 1);
  const failed = results.findIndex(result => result.status === 'rejected');
  assert.equal(results[failed].reason.code, 'ROOM_FULL');
  assert.equal((await f.call('listHistory', applicants[failed].uid)).items.length, 0);
  assert.equal((await f.call('getRoom', 'A', { roomId: room.id })).room.members.length, LIMITS.members);
});

test('历史分页加载超过二十场，客户端提供 userId 不能查询他人历史', async () => {
  const f = await fixture();
  for (let index = 0; index < 23; index += 1) {
    f.advance(61000);
    await f.create('A', `第${index}场`);
  }
  const first = await f.call('listHistory', 'A');
  const second = await f.call('listHistory', 'A', { offset: first.nextOffset });
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 3);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 23);
  assert.equal((await f.call('listHistory', 'B', { userId: f.users.A })).items.length, 0);
});

test('未预期的云数据库错误不会伪装成空历史或泄露后台内容', async () => {
  const f = await fixture();
  f.store.listMemberships = async () => { throw new Error('private-database-detail'); };
  const logs = [];
  const handler = makeHandler(f.service, () => ({ OPENID: 'openid-A' }), { error: (...parts) => logs.push(parts) });
  const result = await handler({ action: 'listHistory' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SERVER_ERROR');
  assert.ok(!JSON.stringify({ result, logs }).includes('private-database-detail'));
});
