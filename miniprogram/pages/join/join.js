const api = require('../../utils/api');

Page({
  data: { code: '', roomId: '', status: '', busy: false, error: '' },

  onLoad(options) {
    if (options.code) {
      this.setData({ code: options.code });
      this.submit();
    }
  },
  onShow() {
    this._active = true;
    if (this.data.status === 'approved') this.openRoom();
    else this.startPolling();
  },
  onHide() { this._active = false; this.stopPolling(); },
  onUnload() { this._active = false; this.stopPolling(); },
  onCode(event) { this.setData({ code: event.detail.value.replace(/\D/g, '').slice(0, 4) }); },

  startPolling() {
    this.stopPolling();
    if (this._active && this.data.roomId && this.data.status === 'pending') {
      this._timer = setInterval(() => this.checkStatus(), 5000);
    }
  },
  stopPolling() { if (this._timer) clearInterval(this._timer); this._timer = null; },

  async submit() {
    if (this.data.busy) return;
    if (!/^\d{4}$/.test(this.data.code)) return wx.showToast({ title: '请输入四位邀请码', icon: 'none' });
    this.setData({ busy: true, error: '' });
    try {
      const user = await getApp().login();
      if (!user.nickname) {
        wx.switchTab({ url: '/pages/profile/profile' });
        return;
      }
      const result = await api.call('requestJoin', { code: this.data.code });
      this.setData(result);
      if (result.status === 'approved') this.openRoom();
      else this.startPolling();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },

  async checkStatus() {
    if (this._checking || !this.data.roomId || !this._active || this.data.busy) return;
    this._checking = true;
    try {
      const result = await api.call('getJoinStatus', { roomId: this.data.roomId });
      if (!this._active) return;
      this.setData({ status: result.status, error: '' });
      if (result.status === 'approved') this.openRoom();
      else if (result.status !== 'pending') this.stopPolling();
    } catch (error) { if (this._active) this.setData({ error: error.message }); }
    finally { this._checking = false; }
  },

  openRoom() {
    this.stopPolling();
    if (this._active && !this._navigating) {
      this._navigating = true;
      wx.redirectTo({
        url: `/pages/room/room?roomId=${this.data.roomId}`,
        fail: () => {
          this._navigating = false;
          this.setData({ error: '打开页面失败，请点击刷新状态重试' });
        }
      });
    }
  },

  async cancel() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.call('cancelJoin', { roomId: this.data.roomId });
      this.stopPolling();
      this.setData({ status: 'cancelled' });
    } catch (error) { api.showError(error); }
    finally { this.setData({ busy: false }); }
  },

  goHome() { wx.switchTab({ url: '/pages/home/home' }); }
});
