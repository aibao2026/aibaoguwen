# 客户 ID 隐私修复说明

## 背景

旧版本客户 ID 使用 `customer:姓名:证件号` 作为业务键。虽然证件号展示字段会脱敏，但该 ID 会出现在本地提醒、飞书多维表格外部 ID、客户关联 ID、日历描述和同步预览中，因此存在通过客户 ID 看出身份证号的风险。

## 更新内容

- 新客户 ID 改为 `customer:<16位sha256摘要>`。
- hash 输入仍然使用规范化后的客户姓名和证件号，因此同一份客户资料重复导入会得到稳定 ID。
- 完整证件号和脱敏证件号仍只用于本地身份匹配，不再拼进客户 ID。
- 飞书同步中的客户外部 ID、投保人客户 ID、被保人客户 ID、提醒客户 ID 都改为 hash ID。
- 飞书日历描述中的客户 ID 也跟随改为 hash ID。

## 旧数据迁移

数据库迁移会自动识别旧格式 `customer:姓名:证件号`，并改写以下位置：

- `customers.id`
- `policies.applicant_customer_id`
- `policies.insured_customer_id`
- `reminders.customer_id`
- 包含旧客户 ID 的 `reminders.id`
- 包含旧客户 ID 的 `pending_confirmations.id`
- `pending_confirmations.payload_json`
- 包含旧客户 ID 的 `sync_state.key`

迁移是幂等的。已经是 `customer:<hash>` 的记录不会被重复改写。

## 仍需注意

本地 SQLite 仍保存完整证件号和手机号，用于生日、身份匹配和脱敏展示。请继续保护 `data/customer-reminders.sqlite`，不要把数据库文件提交或外发。

当前版本已经支持在维护页启用本地数据库加密。未启用加密前，访问密码只能保护网页入口，不能替代磁盘、文件夹和备份文件保护。数据库加密和云备份说明见 `docs/data-security-and-cloud-backup.md`。

如果后续新增外部读取、写入或同步能力，必须先定义数据权限和授权边界：

- 默认不暴露完整证件号、完整手机号、Base token、session cookie。
- 外部工具只读取完成当前任务所需的最小字段。
- 对外同步和第三方调用必须有明确授权和可撤回机制。
- 输出给外部工具、飞书、日志或测试快照的内容应优先脱敏。

## 验证重点

- 客户导入后，客户 ID 匹配 `customer:[a-f0-9]{16}`。
- 客户 ID 不包含客户姓名、完整证件号或脱敏证件号。
- 旧数据库迁移后，保单、提醒、待确认和 sync_state 不再引用旧客户 ID。
- 飞书同步计划中证件号和手机号仍保持脱敏。
- 涉及数据库加密、备份、恢复、迁移、导入、飞书同步和测试数据准备的改动，都要重新验证隐私边界。
