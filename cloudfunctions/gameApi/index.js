'use strict';

const cloud = require('wx-server-sdk');
const { CloudStore } = require('./cloud-store');
const { GameService } = require('./domain');
const { makeHandler } = require('./handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const database = cloud.database({ throwOnNotFound: false });
const service = new GameService(new CloudStore(database));

exports.main = makeHandler(service, () => cloud.getWXContext());
