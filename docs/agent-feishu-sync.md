# Agent 飞书同步方法

这份文档给 WorkBuddy、Workbody、Codex 或其他本地 agent 使用。用户只需要提供一个可编辑的飞书多维表格链接；agent 负责检查环境、生成计划、执行同步和回报结果。

首次安装、启动、导入说明见 `docs/AI_AGENT_SETUP.md`。本文件只描述飞书同步。

## 用户要准备什么

- 本地工具已经能启动：`npm run start`
- 本机已经安装并授权 `lark-cli`
- 一个可编辑的飞书多维表格链接，例如：

```text
https://xxx.feishu.cn/base/xxxx
```

## Agent 要做什么

1. 确认本项目在运行，默认 API 地址是：

```text
http://127.0.0.1:3001
```

2. 检查飞书 CLI 是否可用：

```bash
lark-cli auth status
```

如果未授权，先让用户完成 `lark-cli` 授权，再继续。

3. 从用户给的飞书链接里取出 `/base/` 后面的 Base 标识。不要在最终回复里展示完整 Base 标识。网页本身也支持粘贴完整飞书多维表格链接。

4. 先看本地要同步的数据概况：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/dry-run \
  -H 'Content-Type: application/json' \
  -d '{}'
```

注意核对：飞书提醒表只同步本地已生成的行动提醒；续期提醒默认只包含未来 60 天内需要跟进的保单。更远的续期不会进提醒表，会保留在保单表的“下次续期”和“缴费结束年”字段。

5. 先生成飞书表结构计划：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/base/schema \
  -H 'Content-Type: application/json' \
  -d '{"baseToken":"这里换成Base标识","mode":"plan"}'
```

6. 用户确认后，执行飞书表结构准备：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/base/schema \
  -H 'Content-Type: application/json' \
  -d '{"baseToken":"这里换成Base标识","mode":"execute"}'
```

7. 准备提醒日历视图：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/base/calendar-view \
  -H 'Content-Type: application/json' \
  -d '{"baseToken":"这里换成Base标识","mode":"execute","viewName":"提醒日历"}'
```

8. 先生成数据同步计划：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/base \
  -H 'Content-Type: application/json' \
  -d '{"baseToken":"这里换成Base标识","mode":"plan","strategy":"batch-create"}'
```

9. 用户确认后，执行多维表格同步。首次全量同步必须带 `confirmFullSync:true`；如果用户只想小批量测试，可以传 `limit`：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/base \
  -H 'Content-Type: application/json' \
  -d '{"baseToken":"这里换成Base标识","mode":"execute","strategy":"batch-create","confirmFullSync":true}'
```

小批量测试示例：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/base \
  -H 'Content-Type: application/json' \
  -d '{"baseToken":"这里换成Base标识","mode":"execute","strategy":"batch-create","limit":20}'
```

10. 如果用户也要同步关键提醒到飞书日历，先生成计划：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/calendar \
  -H 'Content-Type: application/json' \
  -d '{"mode":"plan","calendarId":"primary","startTime":"09:00"}'
```

确认后执行：

```bash
curl -s -X POST http://127.0.0.1:3001/api/sync/feishu/calendar \
  -H 'Content-Type: application/json' \
  -d '{"mode":"execute","calendarId":"primary","startTime":"09:00","confirmFullSync":true}'
```

## 回报给用户

同步结束后，只说业务结果：

- 同步了多少客户、保单、提醒
- 飞书里是否创建了客户、保单、提醒三张表
- 保单表是否包含“下次续期”和“缴费结束年”
- 提醒表里的续期是否只包含未来 60 天内的行动提醒
- 是否创建了提醒日历视图
- 是否同步了关键提醒到飞书日历
- 是否有失败项，以及用户下一步要做什么

不要在回复里展示完整手机号、完整证件号、完整 Base 标识、session cookie 或其他敏感信息。

## 失败时怎么说

- `lark-cli` 未授权：告诉用户先完成飞书授权。
- 飞书链接不是多维表格：让用户重新复制飞书多维表格浏览器地址。
- 当前账号没有编辑权限：让用户换有编辑权限的飞书账号或表格。
- 本地 API 未启动：让用户先运行 `npm run start`。
- 同步计划里数量异常：先停止执行，让用户回到本地页面检查导入和待确认。续期提醒数明显少于保单数不一定是异常，因为只有未来 60 天内的续期会进入提醒表。
- 重复执行跳过很多记录：这是本地 `sync_state` 在避免重复创建，属于正常行为；需要重新同步到新的 Base 时，换新的飞书多维表格链接或清理对应同步状态后再执行。
