const api = require('../../utils/api');
const format = require('../../utils/format');

Page({
  data: { room: null, busy: false, loading: true, error: '', syncError: '', kind: 'add', points: '' },

  onLoad(options) { this._roomId = options.roomId || ''; this._revision = 0; },
  onShow() {
    this._active = true;
    this.refresh();
    this._timer = setInterval(() => this.refresh(true), 8000);
  },
  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); },
  stopPolling() { this._active = false; clearInterval(this._timer); this._timer = null; },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },

  async refresh(silent = false) {
    if (this.data.busy || this._refreshing) return;
    this._refreshing = true;
    const revision = this._revision;
    try {
      await getApp().login();
      const result = await api.call('getRoom', { roomId: this._roomId });
      if (this._active && revision === this._revision) {
        this.setData({ room: format.decorateRoom(result.room), error: '', syncError: '' });
      }
    } catch (error) {
      if (this._active && revision === this._revision) {
        this.setData(this.data.room ? { syncError: `同步失败：${error.message}` } : { error: error.message });
      }
    } finally {
      this._refreshing = false;
      if (this._active && !silent) this.setData({ loading: false });
    }
  },

  async mutate(action, payload) {
    if (this.data.busy) return false;
    this._revision += 1;
    this.setData({ busy: true });
    try {
      const result = await api.call(action, { ...payload, roomId: this._roomId });
      this._revision += 1;
      if (this._active) this.setData({ room: format.decorateRoom(result.room), error: '', syncError: '' });
      return true;
    } catch (error) { if (this._active) api.showError(error); return false; }
    finally { if (this._active) this.setData({ busy: false }); else this.data.busy = false; }
  },

  onPoints(event) { this.setData({ points: event.detail.value }); },
  changeKind(event) {
    if (!this.data.busy) this.setData({ kind: event.currentTarget.dataset.kind, points: '' });
  },

  async submitPoints() {
    if (this.data.busy) return;
    const input = this.data.points;
    const kind = this.data.kind;
    const points = Number(input);
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(points) || points < (kind === 'finish' ? 0 : 1) || points > 1000000000) {
      return wx.showToast({ title: kind === 'finish' ? '请输入 0～10 亿的整数' : '请输入 1～10 亿的整数', icon: 'none' });
    }
    if (!this._pointRequest || this._pointRequest.points !== points || this._pointRequest.kind !== kind) {
      this._pointRequest = { kind, points, requestKey: api.requestKey() };
    }
    if (await this.mutate('submitPoints', this._pointRequest)) {
      this._pointRequest = null;
      this.setData({ points: '' });
      wx.showToast({ title: '已提交，待房主确认', icon: 'none' });
    }
  },

  decideJoin(event) {
    const { id, approve } = event.currentTarget.dataset;
    return this.mutate('decideJoin', { requestId: id, approve: approve === 'yes' });
  },

  decidePoints(event) {
    const { id, approve } = event.currentTarget.dataset;
    return this.mutate('decidePoints', { entryId: id, approve: approve === 'yes' });
  },

  async revoke(event) {
    if (this.data.busy || this._dialogOpen) return;
    this._dialogOpen = true;
    try {
      const result = await wx.showModal({
        title: '撤销已确认记录', content: '原记录和撤销原因都会保留。结束积分如已确认，须先撤销结束积分。',
        editable: true, placeholderText: '填写撤销原因（最多 80 字）', confirmText: '确认撤销'
      });
      if (result.confirm) {
        const reason = (result.content || '').trim();
        if (!reason) return wx.showToast({ title: '请填写撤销原因', icon: 'none' });
        await this.mutate('revokePoints', { entryId: event.currentTarget.dataset.id, reason });
      }
    } finally { this._dialogOpen = false; }
  },

  async closeRoom() {
    if (this.data.busy || this._dialogOpen) return;
    const room = this.data.room;
    if (room.summary.pendingCount) return wx.showToast({ title: '请先处理所有待确认积分', icon: 'none' });
    this._dialogOpen = true;
    try {
      const detail = room.summary.missingFinalCount
        ? `还有 ${room.summary.missingFinalCount} 位玩家未登记结束积分，他们的积分变化将显示为未登记。`
        : `累计投入 ${room.summary.totalLabel} 分，结束积分 ${room.summary.endingLabel} 分，核对差额 ${room.summary.differenceLabel} 分。`;
      const result = await wx.showModal({ title: '确认结束牌局？', content: `${detail}结束后所有记录归档，不能再修改。`, confirmText: '结束归档' });
      if (result.confirm) await this.mutate('closeRoom', {});
    } finally { this._dialogOpen = false; }
  },

  async refreshInvite() {
    if (this.data.busy || this._dialogOpen) return;
    this._dialogOpen = true;
    try {
      const result = await wx.showModal({ title: '更新邀请码？', content: '旧邀请码会立即失效，新邀请码有效期为 24 小时。已加入的玩家不受影响。' });
      if (result.confirm) await this.mutate('refreshInvite', {});
    } finally { this._dialogOpen = false; }
  },

  copyCode() { wx.setClipboardData({ data: this.data.room.inviteCode }); },
  goHome() { wx.switchTab({ url: '/pages/home/home' }); }
});
