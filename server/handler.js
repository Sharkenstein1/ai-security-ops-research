'use strict';

const { AppError } = require('./domain');

function makeHandler(service, logger = console) {
  return async (action, userId, payload) => {
    try {
      const data = await service.execute(action, userId, payload);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof AppError) return { ok: false, error: { code: error.code, message: error.message } };
      // 不记录事件、用户身份或错误正文，避免日志携带个人信息和数据库内容。
      logger.error('gameApi unexpected error', { code: error && (error.errCode || error.code) || 'UNKNOWN' });
      return { ok: false, error: { code: 'SERVER_ERROR', message: '服务暂时不可用，请稍后重试；如持续失败请查看服务日志与数据库配置' } };
    }
  };
}

module.exports = { makeHandler };
