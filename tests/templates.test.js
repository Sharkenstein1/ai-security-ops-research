'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const compiler = require('miniprogram-compiler');
const { decorateRoom, decorateHistory } = require('../miniprogram/utils/format');

const source = compiler.wxmlToJs(path.resolve(__dirname, '../miniprogram'), { maxBuffer: 4 * 1024 * 1024 });
const render = new Function('global', 'window', source)({}, {});

function content(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(content).join('');
  return node && node.children ? content(node.children) : '';
}

function roomData(overrides = {}) {
  const room = {
    id: 'room', title: '周末牌局', ownerId: 'A', viewerId: 'A', isOwner: true,
    status: 'open', createdAt: 1800000000000, closedAt: null, inviteCode: '0386', inviteExpiresAt: 1800086400000,
    members: [{ userId: 'A', nickname: '玩家A', joinedAt: 1800000000000, endingPoints: null, endingEntryId: null, totalPoints: 100, entryCount: 1, netPoints: null }],
    entries: [{ id: 'entry', userId: 'A', nickname: '玩家A', kind: 'add', points: 100, status: 'pending', createdAt: 1800000000000 }],
    joinRequests: [{ id: 'request', nickname: '玩家B', status: 'pending' }],
    summary: { totalPoints: 100, endingPoints: 0, missingFinalCount: 1, difference: null, pendingCount: 1 },
    ...overrides
  };
  return { room: decorateRoom(room), loading: false, busy: false, error: '', syncError: '', kind: 'add', points: '' };
}

test('首页根据配置和账号状态显示登录提示，已登录时不会始终显示错误提示', () => {
  const page = render('pages/home/home.wxml');
  const first = content(page({ configured: false, user: null, busy: false }));
  assert.match(first, /服务尚未配置/);
  assert.match(first, /微信登录并设置昵称/);
  const signedIn = content(page({ configured: true, user: { nickname: '小林' }, busy: false }));
  assert.doesNotMatch(signedIn, /服务尚未配置|微信登录并设置昵称/);
  assert.match(signedIn, /小林/);
});

test('WXML 渲染房主审批控件，普通玩家看不到审批或邀请码控件', () => {
  const page = render('pages/room/room.wxml');
  const owner = content(page(roomData()));
  assert.match(owner, /允许加入/);
  assert.match(owner, /确认积分/);
  assert.match(owner, /0386/);
  const member = content(page(roomData({ isOwner: false, inviteCode: '', joinRequests: [] })));
  assert.doesNotMatch(member, /允许加入|确认积分|复制邀请码|结束本局/);
  assert.match(member, /提交给房主确认/);
});

test('归档页面隐藏写入操作，仍显示玩家和积分明细', () => {
  const page = render('pages/room/room.wxml');
  const text = content(page(roomData({ status: 'closed', closedAt: 1800000010000, joinRequests: [] })));
  assert.doesNotMatch(text, /提交给房主确认|允许加入|确认积分|复制邀请码|结束本局|撤销此记录/);
  assert.match(text, /积分明细/);
  assert.match(text, /归档/);
});

test('结束积分为零时显示零和负积分变化，不误当成未登记', () => {
  const member = { userId: 'A', nickname: 'A', joinedAt: 1800000000000, totalPoints: 100, entryCount: 1, endingPoints: 0, netPoints: -100 };
  const data = roomData({ members: [member] });
  const text = content(render('pages/room/room.wxml')(data));
  assert.match(text, /结束积分 0/);
  assert.match(text, /-100/);
  assert.doesNotMatch(text, /提交给房主确认/);
  const history = decorateHistory({ totalPoints: 100, endingPoints: 0, netPoints: -100, createdAt: 1800000000000 });
  assert.equal(history.endingLabel, '0');
  assert.equal(history.netLabel, '-100');
});

test('待批准页面不渲染牌局名单，并显示房主确认状态', () => {
  const text = content(render('pages/join/join.wxml')({ status: 'pending', code: '0386', roomId: 'room', busy: false, error: '' }));
  assert.match(text, /等待房主确认/);
  assert.doesNotMatch(text, /本局玩家|积分明细/);
  assert.match(text, /取消申请/);
});

test('历史页面区分空状态、加载状态和已有记录', () => {
  const page = render('pages/history/history.wxml');
  assert.match(content(page({ items: [], loading: false, error: '', hasMore: false })), /第一场，等你开始/);
  assert.doesNotMatch(content(page({ items: [], loading: true, error: '', hasMore: false })), /第一场，等你开始/);
  const items = [decorateHistory({ id: 'r1', title: '第一场', status: 'closed', createdAt: 1800000000000, memberCount: 4, totalPoints: 100, netPoints: null })];
  const text = content(page({ items, loading: false, error: '', hasMore: false }));
  assert.match(text, /第一场/);
  assert.match(text, /未登记/);
});
