# 云托管数据与权限设计

## 接入与身份

前端调用 `wx.cloud.callContainer`，以环境 ID 和 `X-WX-SERVICE` 定位 Express 服务，业务请求统一发往 `POST /api/game`。

首次登录时，前端通过 `wx.login` 获取临时 code。后端使用仅存在于服务环境变量的 AppID、AppSecret 调用微信官方 `jscode2session` HTTPS 接口，取得 OpenID。请求和日志不返回 AppSecret、OpenID 或微信 session_key。

内部玩家 ID 仍为 OpenID 的 SHA-256 摘要前 32 个十六进制字符，带 `u_` 前缀，昵称不参与身份判定。

应用会话令牌由 32 个随机字节生成，12 小时过期。数据库只保存令牌的 SHA-256 摘要、玩家 ID 和过期时间，前端本地保存令牌。后端通过 `X-Points-Session` 验证会话；不能通过伪造客户端 userId、openid 或 X-WX-* 头来切换身份。每半小时清理一批过期会话。

## MySQL 持久化

使用模板已有的 MySQL，默认数据库为 `nodejs_demo`，通过 `MYSQL_DATABASE` 可指向其他已创建的数据库。服务启动只执行可重复的 `CREATE TABLE IF NOT EXISTS`，不会清空任何表。

新增 `points_documents` 表，主键为逻辑集合名与文档 ID。JSON 保存业务内容，独立列 `user_id`、`joined_at`、`expires_at` 用作索引投影。所有 SQL 值使用参数绑定。

| 逻辑集合 | 内容 |
| --- | --- |
| users | 玩家昵称和创建时间 |
| rooms | 牌局、参与者、加入申请与积分事件 |
| invite_codes | 四位码的当前归属及过期时间 |
| memberships | 已批准的玩家参与关系，按玩家与加入时间索引 |
| rate_limits | 创建、加入和更新邀请码的额度 |
| sessions | 应用会话令牌的摘要对应的身份及期限 |

## 事务与并发

每次变更使用独立 MySQL 事务和 `SELECT ... FOR UPDATE` 锁。SERIALIZABLE 隔离级别同时保护缺失键的创建。死锁、锁超时和唯一键冲突先回滚，再有限次重放整个业务事务。

创建牌局通过玩家 ID 与 requestKey 确定牌局编号；创建额度在同一事务内计数，并发重试不会多消耗额度。积分通过玩家 ID 与 requestKey 确定事件 ID，重复成功请求返回已有结果；同一键不同内容会被拒绝。

加入批准原子写入牌局成员和历史关系。邀请码占用、确认积分、归档都在事务内重新检查状态。过期码已复用于新局时，旧局关闭或更新邀请码不能删掉新映射。

## 可见范围与状态

只有已批准的参与者能读取该局名单和积分，房主也是参与者。待批准用户只能查询自己的申请状态；“我的牌局”只查本人 memberships，后端再次核对参与关系。

加入申请：pending → approved / rejected / cancelled。

积分事件：pending → approved / rejected；approved → revoked。只有已确认 add 事件计入登记次数与投入。结束事件可为零；确认前须先处理该玩家的待确认登记，确认后停止追加。撤销保留原记录与原因。

牌局：open → closed。归档前处理所有待确认积分，关闭时拒绝未处理加入申请并释放仍属于本局的邀请码。归档后保留读取权限，停止新修改。未登记结束积分时净变化为 null，不是零。

## 验证边界

普通测试覆盖业务状态、HTTP 接口、伪造身份拒绝、令牌过期和页面条件。Docker MySQL 8.4 测试覆盖真实事务、并发、数据库索引查询和生产入口进程重启。

微信登录交换在本地测试中使用替身；未连接用户生产数据库、未取得用户 AppSecret，也未替用户发布云托管服务。部署和多账号真机步骤见 README。
