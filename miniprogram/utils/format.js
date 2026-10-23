function number(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function signed(value) {
  return value === null ? '未登记' : `${value > 0 ? '+' : ''}${number(value)}`;
}

function date(value) {
  if (!value) return '';
  const item = new Date(value);
  const pad = part => String(part).padStart(2, '0');
  return `${item.getFullYear()}.${pad(item.getMonth() + 1)}.${pad(item.getDate())} ${pad(item.getHours())}:${pad(item.getMinutes())}`;
}

function decorateRoom(room) {
  const statuses = { pending: '待确认', approved: '已确认', rejected: '已拒绝', revoked: '已撤销' };
  const members = room.members.map(member => ({
    ...member, isMe: member.userId === room.viewerId, isOwner: member.userId === room.ownerId,
    initial: Array.from(member.nickname)[0] || '友',
    totalLabel: number(member.totalPoints), endingLabel: member.endingPoints === null ? '未登记' : number(member.endingPoints),
    netLabel: signed(member.netPoints), netPositive: member.netPoints !== null && member.netPoints > 0
  }));
  const entries = [...room.entries].reverse().map(entry => ({
    ...entry, pointsLabel: number(entry.points), timeLabel: date(entry.createdAt),
    decidedLabel: date(entry.decidedAt), revokedLabel: date(entry.revokedAt),
    kindLabel: entry.kind === 'finish' ? '结束积分' : '登记积分',
    statusLabel: statuses[entry.status],
    canRevoke: room.isOwner && room.status === 'open' && entry.status === 'approved'
  }));
  return {
    ...room, members, entries,
    pendingEntries: entries.filter(entry => entry.status === 'pending'),
    self: members.find(member => member.isMe),
    dateLabel: date(room.createdAt), closedLabel: date(room.closedAt),
    inviteExpiryLabel: date(room.inviteExpiresAt),
    summary: {
      ...room.summary, totalLabel: number(room.summary.totalPoints), endingLabel: number(room.summary.endingPoints),
      differenceLabel: signed(room.summary.difference)
    }
  };
}

function decorateHistory(item) {
  return {
    ...item, dateLabel: date(item.createdAt), totalLabel: number(item.totalPoints),
    endingLabel: item.endingPoints === null ? '未登记' : number(item.endingPoints),
    netLabel: signed(item.netPoints), netPositive: item.netPoints !== null && item.netPoints > 0
  };
}

module.exports = { number, signed, date, decorateRoom, decorateHistory };
