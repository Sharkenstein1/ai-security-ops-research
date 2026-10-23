const api = require('../../utils/api');
const { decorateHistory } = require('../../utils/format');

Page({
  data: { items: [], loading: false, error: '', hasMore: false },
  onShow() { this.load(true); },
  async onPullDownRefresh() { try { await this.load(true); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.load(false); },

  async load(reset = false) {
    // bindtap 传入事件对象时，按重新加载处理。
    if (reset !== false) reset = true;
    if (this.data.loading) return;
    if (reset) this._offset = 0;
    this.setData({ loading: true, error: '' });
    try {
      await getApp().login();
      const result = await api.call('listHistory', { offset: this._offset || 0 });
      const current = reset ? [] : this.data.items;
      const known = new Set(current.map(item => item.id));
      const added = result.items.filter(item => !known.has(item.id)).map(decorateHistory);
      this.setData({ items: current.concat(added), hasMore: result.hasMore });
      this._offset = result.nextOffset;
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },

  loadMore() { this.load(false); },
  openRoom(event) { wx.navigateTo({ url: `/pages/room/room?roomId=${event.currentTarget.dataset.id}` }); },
  goHome() { wx.switchTab({ url: '/pages/home/home' }); }
});
