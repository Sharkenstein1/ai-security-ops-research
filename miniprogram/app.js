const config = require('./config');

App({
  globalData: { user: null, cloudReady: false },

  onLaunch() {
    if (wx.cloud && typeof wx.cloud.callContainer === 'function' && config.envId && config.service) {
      wx.cloud.init({ traceUser: false });
      this.globalData.cloudReady = true;
    }
  },

  async login() {
    if (this.globalData.user) return this.globalData.user;
    if (!this._loginPromise) {
      this._loginPromise = require('./utils/api').call('login')
        .then(data => {
          this.globalData.user = data.user;
          return data.user;
        })
        .finally(() => { this._loginPromise = null; });
    }
    return this._loginPromise;
  }
});
