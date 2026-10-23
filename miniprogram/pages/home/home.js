const api = require('../../utils/api');

Page({
  data: { user: null, title: '', code: '', busy: false, configured: false },

  onShow() {
    this.setData({ user: getApp().globalData.user, configured: getApp().globalData.cloudReady });
  },

  onTitle(event) { this.setData({ title: event.detail.value }); },
  onCode(event) { this.setData({ code: event.detail.value.replace(/\D/g, '').slice(0, 4) }); },

  async login() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const user = await getApp().login();
      this.setData({ user });
      if (!user.nickname) wx.switchTab({ url: '/pages/profile/profile' });
    } catch (error) { api.showError(error); }
    finally { this.setData({ busy: false }); }
  },

  async requireProfile() {
    const user = await getApp().login();
    this.setData({ user });
    if (!user.nickname) {
      wx.switchTab({ url: '/pages/profile/profile' });
      return false;
    }
    return true;
  },

  async createRoom() {
    if (this.data.busy) return;
    const title = this.data.title.trim();
    if (!title) return wx.showToast({ title: '先给牌局起个名字', icon: 'none' });
    this.setData({ busy: true });
    try {
      if (!await this.requireProfile()) return;
      if (!this._createRequest || this._createRequest.title !== title) {
        this._createRequest = { title, requestKey: api.requestKey() };
      }
      const result = await api.call('createRoom', this._createRequest);
      this._createRequest = null;
      this.setData({ title: '' });
      wx.navigateTo({ url: `/pages/room/room?roomId=${result.room.id}` });
    } catch (error) { api.showError(error); }
    finally { this.setData({ busy: false }); }
  },

  async joinRoom() {
    if (this.data.busy) return;
    if (!/^\d{4}$/.test(this.data.code)) return wx.showToast({ title: '请输入四位邀请码', icon: 'none' });
    this.setData({ busy: true });
    try {
      if (!await this.requireProfile()) return;
      wx.navigateTo({ url: `/pages/join/join?code=${this.data.code}` });
    } catch (error) { api.showError(error); }
    finally { this.setData({ busy: false }); }
  }
});
