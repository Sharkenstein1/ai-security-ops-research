'use strict';

// 原子提交、失败回滚的本地数据库替身；不代表已连接真实云数据库。
class MemoryStore {
  constructor() { this.documents = new Map(); this.tail = Promise.resolve(); }
  async get(collection, id) { return structuredClone(this.documents.get(`${collection}/${id}`) || null); }
  async transaction(work) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const snapshot = structuredClone(this.documents);
      const result = await work({
        get: async (collection, id) => structuredClone(snapshot.get(`${collection}/${id}`) || null),
        set: async (collection, id, value) => { snapshot.set(`${collection}/${id}`, structuredClone(value)); },
        delete: async (collection, id) => { snapshot.delete(`${collection}/${id}`); }
      });
      this.documents = snapshot;
      return structuredClone(result);
    } finally { release(); }
  }
  async listMemberships(userId, offset, limit) {
    return [...this.documents.entries()].filter(([key, value]) => key.startsWith('memberships/') && value.userId === userId)
      .map(([, value]) => structuredClone(value)).sort((a, b) => b.joinedAt - a.joinedAt).slice(offset, offset + limit);
  }
}

module.exports = { MemoryStore };
