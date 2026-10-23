'use strict';

const fs = require('node:fs');
const path = require('node:path');

const COLLECTIONS = new Set(['users', 'rooms', 'invite_codes', 'memberships', 'rate_limits', 'sessions']);
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY']);

function checkKey(collection, id) {
  if (!COLLECTIONS.has(collection) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new TypeError('无效的存储键');
  }
}

function decode(value) { return typeof value === 'string' ? JSON.parse(value) : value; }

function access(connection, lock) {
  return {
    async get(collection, id) {
      checkKey(collection, id);
      const [rows] = await connection.execute(
        `SELECT payload FROM points_documents WHERE collection_name = ? AND document_id = ?${lock ? ' FOR UPDATE' : ''}`,
        [collection, id]
      );
      return rows.length ? decode(rows[0].payload) : null;
    },
    async set(collection, id, value) {
      checkKey(collection, id);
      const data = { ...value };
      delete data._id;
      const payload = JSON.stringify(data);
      if (Buffer.byteLength(payload) > 512 * 1024) throw new RangeError('单条记录超出大小限制');
      await connection.execute(
        `INSERT INTO points_documents (collection_name, document_id, payload, user_id, joined_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), user_id = VALUES(user_id),
           joined_at = VALUES(joined_at), expires_at = VALUES(expires_at)`,
        [collection, id, payload, collection === 'memberships' ? data.userId : null,
          collection === 'memberships' ? data.joinedAt : null,
          collection === 'sessions' ? data.expiresAt : null]
      );
    },
    async delete(collection, id) {
      checkKey(collection, id);
      await connection.execute('DELETE FROM points_documents WHERE collection_name = ? AND document_id = ?', [collection, id]);
    }
  };
}

class MysqlStore {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.retries = options.retries === undefined ? 5 : options.retries;
    this.delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async initialize() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await this.pool.query(schema);
  }

  get(collection, id) { return access(this.pool, false).get(collection, id); }

  async transaction(work) {
    for (let attempt = 0; ; attempt += 1) {
      const connection = await this.pool.getConnection();
      let retry = false;
      try {
        // 缺失键的并发创建也须受锁保护；死锁后回滚并重放整个事务。
        await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        await connection.beginTransaction();
        const result = await work(access(connection, true));
        await connection.commit();
        return result;
      } catch (error) {
        try { await connection.rollback(); } catch (rollbackError) { /* 连接失败时仍抛出原错误 */ }
        retry = RETRYABLE.has(error.code) && attempt < this.retries;
        if (!retry) throw error;
      } finally { connection.release(); }
      if (retry) await this.delay(Math.min(100, 10 * (attempt + 1)) + Math.floor(Math.random() * 10));
    }
  }

  async listMemberships(userId, offset, limit) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('无效的分页参数');
    }
    const [rows] = await this.pool.query(
      `SELECT payload FROM points_documents WHERE collection_name = ? AND user_id = ?
       ORDER BY joined_at DESC, document_id ASC LIMIT ? OFFSET ?`,
      ['memberships', userId, limit, offset]
    );
    return rows.map(row => decode(row.payload));
  }

  async health() { await this.pool.execute('SELECT 1 FROM points_documents LIMIT 1'); }

  async pruneExpiredSessions(now) {
    await this.pool.execute("DELETE FROM points_documents WHERE collection_name = 'sessions' AND expires_at < ? LIMIT 1000", [now]);
  }
}

module.exports = { MysqlStore };
