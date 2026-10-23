const api = require('../../utils/api');

Page({
  data: { user: null, nickname: '', initial: '友', busy: false, error: '' },

  onShow() { this.load(); },

  async load() {
    this.setData({ error: '' });
    try {
      const user = await getApp().login();
      this.setData({ user, nickname: user.nickname, initial: Array.from(user.nickname)[0] || '友' });
    } catch (error) { this.setData({ error: error.message }); }
  },

  onNickname(event) { this.setData({ nickname: event.detail.value }); },

  async save() {
    if (this.data.busy) return;
    const nickname = this.data.nickname.trim();
    if (!nickname) return wx.showToast({ title: '请输入昵称', icon: 'none' });
    this.setData({ busy: true });
    try {
      await getApp().login();
      const { user } = await api.call('saveProfile', { nickname });
      getApp().globalData.user = user;
      this.setData({ user, initial: Array.from(user.nickname)[0] });
      wx.showToast({ title: '昵称已保存', icon: 'success' });
    } catch (error) { api.showError(error); }
    finally { this.setData({ busy: false }); }
  },

  goHome() { wx.switchTab({ url: '/pages/home/home' }); }
});
