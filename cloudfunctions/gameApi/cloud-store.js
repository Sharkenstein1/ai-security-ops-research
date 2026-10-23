'use strict';

// wx-server-sdk 的 doc.set 接收 { data }；不能直接使用 Node SDK 的 set(data) 形式。
function documentAccess(database) {
  return {
    async get(collection, id) {
      const result = await database.collection(collection).doc(id).get();
      return result.data || null;
    },
    async set(collection, id, value) {
      const data = { ...value };
      delete data._id;
      await database.collection(collection).doc(id).set({ data });
    },
    async delete(collection, id) {
      await database.collection(collection).doc(id).remove();
    }
  };
}

class CloudStore {
  constructor(database) {
    this.database = database;
    this.get = documentAccess(database).get;
  }

  transaction(work) {
    return this.database.runTransaction(tx => work(documentAccess(tx)), 5);
  }

  async listMemberships(userId, offset, limit) {
    const result = await this.database.collection('memberships')
      .where({ userId }).orderBy('joinedAt', 'desc').skip(offset).limit(limit).get();
    return result.data;
  }
}

module.exports = { CloudStore };
