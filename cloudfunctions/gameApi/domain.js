'use strict';

const crypto = require('node:crypto');

const LIMITS = Object.freeze({ members: 20, entries: 500, joins: 100, points: 1000000000 });
const INVITE_TTL = 24 * 60 * 60 * 1000;

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireThat(condition, code, message) {
  if (!condition) throw new AppError(code, message);
}

function text(value, label, max) {
  requireThat(typeof value === 'string', 'INVALID_INPUT', `请填写${label}`);
  const result = value.trim();
  requireThat(result.length > 0 && Array.from(result).length <= max && !/[\x00-\x1f\x7f]/.test(result),
    'INVALID_INPUT', `${label}须为 1～${max} 个字符`);
  return result;
}

function key(value) {
  requireThat(typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value),
    'INVALID_INPUT', '操作编号无效，请重新提交');
  return value;
}

function roomKey(value) {
  requireThat(typeof value === 'string' && /^r_[a-f0-9]{32}$/.test(value), 'INVALID_INPUT', '牌局编号无效');
  return value;
}

function points(value, allowZero) {
  requireThat(Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= LIMITS.points,
    'INVALID_INPUT', allowZero ? '结束积分须为 0～10 亿的整数' : '登记积分须为 1～10 亿的整数');
  return value;
}

function userIdFor(openid) {
  requireThat(typeof openid === 'string' && openid.length > 0, 'UNAUTHENTICATED', '请从微信小程序登录');
  return `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`;
}

function totals(room, userId) {
  const approved = room.entries.filter(entry => entry.userId === userId && entry.kind === 'add' && entry.status === 'approved');
  return { totalPoints: approved.reduce((sum, entry) => sum + entry.points, 0), entryCount: approved.length };
}

function roomView(room, viewerId) {
  requireThat(!!room.members[viewerId], 'FORBIDDEN', '你不是该牌局的参与者');
  const isOwner = room.ownerId === viewerId;
  const members = Object.values(room.members).map(member => {
    const total = totals(room, member.userId);
    return {
      ...member, ...total,
      netPoints: member.endingPoints === null ? null : member.endingPoints - total.totalPoints
    };
  });
  const totalPoints = members.reduce((sum, member) => sum + member.totalPoints, 0);
  const endingPoints = members.reduce((sum, member) => sum + (member.endingPoints || 0), 0);
  const missingFinalCount = members.filter(member => member.endingPoints === null).length;
  return {
    id: room.id, title: room.title, ownerId: room.ownerId, viewerId, isOwner,
    status: room.status, createdAt: room.createdAt, closedAt: room.closedAt,
    inviteCode: isOwner && room.status === 'open' ? room.inviteCode : '',
    inviteExpiresAt: isOwner ? room.inviteExpiresAt : null,
    members, entries: room.entries,
    joinRequests: isOwner ? room.joinRequests.filter(request => request.status === 'pending') : [],
    summary: {
      totalPoints, endingPoints, missingFinalCount,
      difference: missingFinalCount ? null : endingPoints - totalPoints,
      pendingCount: room.entries.filter(entry => entry.status === 'pending').length
    }
  };
}

class GameService {
  constructor(store, options = {}) {
    this.store = store;
    this.now = options.now || Date.now;
    this.randomCode = options.randomCode || (() => String(crypto.randomInt(10000)).padStart(4, '0'));
    this.newId = options.newId || (() => crypto.randomUUID().replace(/-/g, ''));
  }

  async execute(action, userId, payload = {}) {
    const actions = {
      login: () => this.login(userId),
      saveProfile: () => this.saveProfile(userId, payload),
      createRoom: () => this.createRoom(userId, payload),
      requestJoin: () => this.requestJoin(userId, payload),
      getJoinStatus: () => this.getJoinStatus(userId, payload),
      cancelJoin: () => this.cancelJoin(userId, payload),
      getRoom: () => this.getRoom(userId, payload),
      decideJoin: () => this.decideJoin(userId, payload),
      submitPoints: () => this.submitPoints(userId, payload),
      decidePoints: () => this.decidePoints(userId, payload),
      revokePoints: () => this.revokePoints(userId, payload),
      closeRoom: () => this.closeRoom(userId, payload),
      refreshInvite: () => this.refreshInvite(userId, payload),
      listHistory: () => this.listHistory(userId, payload)
    };
    requireThat(Object.prototype.hasOwnProperty.call(actions, action), 'UNKNOWN_ACTION', '不支持的操作');
    requireThat(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_INPUT', '请求格式无效');
    return actions[action]();
  }

  async login(userId) {
    const now = this.now();
    return this.store.transaction(async tx => {
      let user = await tx.get('users', userId);
      if (!user) {
        user = { id: userId, nickname: '', createdAt: now };
        await tx.set('users', userId, user);
      }
      return { user: { id: user.id, nickname: user.nickname } };
    });
  }

  async saveProfile(userId, payload) {
    const nickname = text(payload.nickname, '昵称', 20);
    return this.store.transaction(async tx => {
      const user = await tx.get('users', userId);
      requireThat(!!user, 'UNAUTHENTICATED', '请先登录');
      user.nickname = nickname;
      await tx.set('users', userId, user);
      return { user: { id: user.id, nickname } };
    });
  }

  async requireProfile(userId) {
    const user = await this.store.get('users', userId);
    requireThat(!!user && !!user.nickname, 'PROFILE_REQUIRED', '请先填写昵称');
    return user;
  }

  async consumeLimit(userId, scope, limit) {
    const now = this.now();
    const id = `${userId}_${scope}`;
    await this.store.transaction(async tx => {
      let state = await tx.get('rate_limits', id);
      if (!state || now - state.startedAt >= 60000) state = { startedAt: now, count: 0 };
      requireThat(state.count < limit, 'RATE_LIMITED', '操作较频繁，请一分钟后重试');
      state.count += 1;
      await tx.set('rate_limits', id, state);
    });
  }

  async createRoom(userId, payload) {
    const user = await this.requireProfile(userId);
    const title = text(payload.title, '牌局名称', 30);
    const requestKey = key(payload.requestKey);
    const id = `r_${crypto.createHash('sha256').update(`${userId}:${requestKey}`).digest('hex').slice(0, 32)}`;
    const existing = await this.store.get('rooms', id);
    if (existing) {
      requireThat(existing.title === title, 'IDEMPOTENCY_CONFLICT', '同一次操作的内容不一致');
      return { room: roomView(existing, userId) };
    }
    await this.consumeLimit(userId, 'create', 5);
    const now = this.now();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const code = this.randomCode();
      const result = await this.store.transaction(async tx => {
        const duplicate = await tx.get('rooms', id);
        if (duplicate) {
          requireThat(duplicate.title === title, 'IDEMPOTENCY_CONFLICT', '同一次操作的内容不一致');
          return duplicate;
        }
        const occupied = await tx.get('invite_codes', code);
        if (occupied && occupied.expiresAt > now) return null;
        const room = {
          id, title, ownerId: userId, status: 'open', createdAt: now, closedAt: null,
          inviteCode: code, inviteExpiresAt: now + INVITE_TTL,
          members: { [userId]: { userId, nickname: user.nickname, joinedAt: now, endingPoints: null, endingEntryId: null } },
          joinRequests: [], entries: []
        };
        await tx.set('invite_codes', code, { roomId: id, expiresAt: room.inviteExpiresAt });
        await tx.set('memberships', `${id}_${userId}`, { roomId: id, userId, joinedAt: now });
        await tx.set('rooms', id, room);
        return room;
      });
      if (result) return { room: roomView(result, userId) };
    }
    throw new AppError('CODE_BUSY', '暂时无法分配邀请码，请稍后重试');
  }

  async requestJoin(userId, payload) {
    const user = await this.requireProfile(userId);
    requireThat(typeof payload.code === 'string' && /^\d{4}$/.test(payload.code), 'INVALID_INPUT', '请输入四位数字邀请码');
    // 单独提交限流事务：无效邀请码也必须消耗尝试次数。
    await this.consumeLimit(userId, 'join', 5);
    const now = this.now();
    const requestId = `j_${this.newId()}`;
    return this.store.transaction(async tx => {
      const invitation = await tx.get('invite_codes', payload.code);
      requireThat(!!invitation && invitation.expiresAt > now, 'INVALID_INVITE', '邀请码无效或已过期');
      const room = await tx.get('rooms', invitation.roomId);
      requireThat(!!room && room.status === 'open' && room.inviteCode === payload.code,
        'INVALID_INVITE', '邀请码无效或已过期');
      if (room.members[userId]) return { roomId: room.id, status: 'approved' };
      const pending = room.joinRequests.find(request => request.userId === userId && request.status === 'pending');
      if (pending) return { roomId: room.id, requestId: pending.id, status: 'pending' };
      requireThat(Object.keys(room.members).length < LIMITS.members, 'ROOM_FULL', '牌局人数已满');
      requireThat(room.joinRequests.length < LIMITS.joins, 'JOIN_LIMIT', '本局加入申请已达上限');
      room.joinRequests.push({ id: requestId, userId, nickname: user.nickname, status: 'pending', createdAt: now, decidedAt: null });
      await tx.set('rooms', room.id, room);
      return { roomId: room.id, requestId, status: 'pending' };
    });
  }

  async getJoinStatus(userId, payload) {
    const room = await this.store.get('rooms', roomKey(payload.roomId));
    requireThat(!!room, 'NOT_FOUND', '牌局不存在');
    if (room.members[userId]) return { roomId: room.id, status: 'approved' };
    const request = [...room.joinRequests].reverse().find(item => item.userId === userId);
    requireThat(!!request, 'FORBIDDEN', '没有你的加入申请');
    return { roomId: room.id, requestId: request.id, status: request.status };
  }

  async cancelJoin(userId, payload) {
    const id = roomKey(payload.roomId);
    return this.store.transaction(async tx => {
      const room = await tx.get('rooms', id);
      requireThat(!!room, 'NOT_FOUND', '牌局不存在');
      const request = [...room.joinRequests].reverse().find(item => item.userId === userId);
      requireThat(!!request, 'FORBIDDEN', '没有你的加入申请');
      requireThat(!room.members[userId], 'ALREADY_JOINED', '已加入牌局，请返回牌局页面');
      if (request.status === 'pending') {
        request.status = 'cancelled';
        request.decidedAt = this.now();
        await tx.set('rooms', id, room);
      }
      return { status: request.status };
    });
  }

  async getRoom(userId, payload) {
    const room = await this.store.get('rooms', roomKey(payload.roomId));
    requireThat(!!room, 'NOT_FOUND', '牌局不存在');
    return { room: roomView(room, userId) };
  }

  async mutateRoom(userId, id, ownerOnly, mutation) {
    roomKey(id);
    return this.store.transaction(async tx => {
      const room = await tx.get('rooms', id);
      requireThat(!!room, 'NOT_FOUND', '牌局不存在');
      requireThat(!!room.members[userId], 'FORBIDDEN', '你不是该牌局的参与者');
      requireThat(!ownerOnly || room.ownerId === userId, 'OWNER_ONLY', '只有房主可以执行此操作');
      await mutation(room, tx);
      await tx.set('rooms', id, room);
      return { room: roomView(room, userId) };
    });
  }

  requireOpen(room) {
    requireThat(room.status === 'open', 'ROOM_CLOSED', '牌局已结束，记录已归档');
  }

  async decideJoin(userId, payload) {
    requireThat(typeof payload.approve === 'boolean', 'INVALID_INPUT', '请选择通过或拒绝');
    return this.mutateRoom(userId, payload.roomId, true, async (room, tx) => {
      const request = room.joinRequests.find(item => item.id === payload.requestId);
      requireThat(!!request, 'NOT_FOUND', '加入申请不存在');
      const targetStatus = payload.approve ? 'approved' : 'rejected';
      if (request.status === targetStatus) return;
      this.requireOpen(room);
      requireThat(request.status === 'pending', 'ALREADY_DECIDED', '该申请已处理，请刷新页面');
      if (payload.approve) {
        requireThat(Object.keys(room.members).length < LIMITS.members, 'ROOM_FULL', '牌局人数已满');
        const joinedAt = this.now();
        room.members[request.userId] = {
          userId: request.userId, nickname: request.nickname, joinedAt, endingPoints: null, endingEntryId: null
        };
        await tx.set('memberships', `${room.id}_${request.userId}`, { roomId: room.id, userId: request.userId, joinedAt });
      }
      request.status = targetStatus;
      request.decidedAt = this.now();
      request.decidedBy = userId;
    });
  }

  async submitPoints(userId, payload) {
    const requestKey = key(payload.requestKey);
    const kind = payload.kind;
    requireThat(kind === 'add' || kind === 'finish', 'INVALID_INPUT', '积分记录类型无效');
    const amount = points(payload.points, kind === 'finish');
    const entryId = `${userId}_${requestKey}`;
    return this.mutateRoom(userId, payload.roomId, false, async room => {
      const existing = room.entries.find(entry => entry.id === entryId);
      if (existing) {
        requireThat(existing.kind === kind && existing.points === amount, 'IDEMPOTENCY_CONFLICT', '同一次操作的内容不一致');
        return;
      }
      this.requireOpen(room);
      const member = room.members[userId];
      requireThat(member.endingPoints === null, 'PLAYER_FINISHED', '你的结束积分已确认，不能追加积分');
      requireThat(!room.entries.some(entry => entry.userId === userId && entry.kind === 'finish' && entry.status === 'pending'),
        'FINAL_PENDING', '结束积分正在等待确认');
      if (kind === 'finish') {
        requireThat(!room.entries.some(entry => entry.userId === userId && entry.status === 'pending'),
          'PENDING_POINTS', '请先由房主处理你的待确认积分');
      }
      requireThat(room.entries.length < LIMITS.entries, 'ENTRY_LIMIT', '本局积分记录已达上限');
      room.entries.push({
        id: entryId, userId, nickname: member.nickname, kind, points: amount,
        status: 'pending', createdAt: this.now(), decidedAt: null, decidedBy: null,
        revokedAt: null, revokedBy: null, revokeReason: ''
      });
    });
  }

  async decidePoints(userId, payload) {
    requireThat(typeof payload.approve === 'boolean', 'INVALID_INPUT', '请选择通过或拒绝');
    return this.mutateRoom(userId, payload.roomId, true, async room => {
      const entry = room.entries.find(item => item.id === payload.entryId);
      requireThat(!!entry, 'NOT_FOUND', '积分记录不存在');
      const targetStatus = payload.approve ? 'approved' : 'rejected';
      if (entry.status === targetStatus) return;
      this.requireOpen(room);
      requireThat(entry.status === 'pending', 'ALREADY_DECIDED', '该记录已处理，请刷新页面');
      if (payload.approve) {
        const member = room.members[entry.userId];
        requireThat(member.endingPoints === null, 'PLAYER_FINISHED', '该玩家的结束积分已确认');
        if (entry.kind === 'finish') {
          requireThat(!room.entries.some(item => item.userId === entry.userId && item.kind === 'add' && item.status === 'pending'),
            'PENDING_POINTS', '请先处理该玩家的待确认积分');
          member.endingPoints = entry.points;
          member.endingEntryId = entry.id;
        }
      }
      entry.status = targetStatus;
      entry.decidedAt = this.now();
      entry.decidedBy = userId;
    });
  }

  async revokePoints(userId, payload) {
    const reason = text(payload.reason, '撤销原因', 80);
    return this.mutateRoom(userId, payload.roomId, true, async room => {
      this.requireOpen(room);
      const entry = room.entries.find(item => item.id === payload.entryId);
      requireThat(!!entry, 'NOT_FOUND', '积分记录不存在');
      if (entry.status === 'revoked') return;
      requireThat(entry.status === 'approved', 'INVALID_STATE', '只能撤销已确认的记录');
      const member = room.members[entry.userId];
      if (entry.kind === 'add') {
        requireThat(member.endingPoints === null, 'PLAYER_FINISHED', '请先撤销该玩家的结束积分记录');
      } else {
        requireThat(member.endingEntryId === entry.id, 'INVALID_STATE', '结束积分状态不一致');
        member.endingPoints = null;
        member.endingEntryId = null;
      }
      entry.status = 'revoked';
      entry.revokedAt = this.now();
      entry.revokedBy = userId;
      entry.revokeReason = reason;
    });
  }

  async closeRoom(userId, payload) {
    return this.mutateRoom(userId, payload.roomId, true, async (room, tx) => {
      if (room.status === 'closed') return;
      requireThat(!room.entries.some(entry => entry.status === 'pending'), 'PENDING_POINTS', '请先处理所有待确认积分');
      const invitation = await tx.get('invite_codes', room.inviteCode);
      room.status = 'closed';
      room.closedAt = this.now();
      room.joinRequests.forEach(request => {
        if (request.status === 'pending') {
          request.status = 'rejected';
          request.decidedAt = room.closedAt;
          request.decidedBy = userId;
        }
      });
      // 邀请码可能已过期并分配给另一场牌局，不能删掉另一场的映射。
      if (invitation && invitation.roomId === room.id) await tx.delete('invite_codes', room.inviteCode);
    });
  }

  async refreshInvite(userId, payload) {
    const id = roomKey(payload.roomId);
    const preview = await this.store.get('rooms', id);
    requireThat(!!preview && preview.ownerId === userId, 'OWNER_ONLY', '只有房主可以更新邀请码');
    this.requireOpen(preview);
    await this.consumeLimit(userId, 'invite', 5);
    const now = this.now();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const code = this.randomCode();
      const result = await this.store.transaction(async tx => {
        const room = await tx.get('rooms', id);
        requireThat(!!room && room.ownerId === userId, 'OWNER_ONLY', '只有房主可以更新邀请码');
        this.requireOpen(room);
        if (code === room.inviteCode) return null;
        const occupied = await tx.get('invite_codes', code);
        if (occupied && occupied.expiresAt > now) return null;
        const old = await tx.get('invite_codes', room.inviteCode);
        if (old && old.roomId === id) await tx.delete('invite_codes', room.inviteCode);
        room.inviteCode = code;
        room.inviteExpiresAt = now + INVITE_TTL;
        await tx.set('invite_codes', code, { roomId: id, expiresAt: room.inviteExpiresAt });
        await tx.set('rooms', id, room);
        return room;
      });
      if (result) return { room: roomView(result, userId) };
    }
    throw new AppError('CODE_BUSY', '暂时无法更新邀请码，请稍后重试');
  }

  async listHistory(userId, payload) {
    const offset = payload.offset === undefined ? 0 : payload.offset;
    requireThat(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000, 'INVALID_INPUT', '分页参数无效');
    const relations = await this.store.listMemberships(userId, offset, 21);
    const rooms = await Promise.all(relations.slice(0, 20).map(relation => this.store.get('rooms', relation.roomId)));
    const items = rooms.filter(room => room && room.members[userId]).map(room => {
      const total = totals(room, userId);
      const endingPoints = room.members[userId].endingPoints;
      return {
        id: room.id, title: room.title, status: room.status, createdAt: room.createdAt, closedAt: room.closedAt,
        memberCount: Object.keys(room.members).length, isOwner: room.ownerId === userId,
        ...total, endingPoints,
        netPoints: endingPoints === null ? null : endingPoints - total.totalPoints
      };
    });
    return { items, hasMore: relations.length > 20, nextOffset: offset + Math.min(relations.length, 20) };
  }
}

module.exports = { AppError, GameService, userIdFor, LIMITS, INVITE_TTL };
