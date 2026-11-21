# DSH 归档会话清理

DeepSeek Harness 插件。归档的会话在归档满保留期限后自动删除，期限可设置，默认 30 天。

## 功能

- 定时检查归档会话，把归档满保留期限的会话整体删除：会话日志、工作区分组记录、归档标记、投影缓存。
- 保留期限从归档时刻算起，不受会话闲置多久才归档的影响。
- 归档后又被打开继续使用的会话会重新计时，不会因为早已归档而被删掉。
- 正在运行的会话不会被处理。
- 删除前校验目录名与路径，确认目标是该会话自己的日志目录。

## 安装

插件依赖 DeepSeek Harness 自带的 `@deepseek-ai/schemastery`，因此需要以包的形式安装，不能直接把源码目录链接进 profile。

```sh
pnpm pack
```

把生成的 `.tgz` 通过插件管理器的本地安装入口装入当前 profile。装在 profile 的 `node_modules` 下时，依赖从 DeepSeek Harness 安装目录解析。

安装后在「设置」里会出现「归档会话清理」一项。

## 配置

在设置页里可以直接开关和修改保留期限。

也可以写在 profile 的 `cordis.patch.yml`：

```yaml
- id: archive-retention
  config:
    enabled: true
    retentionDays: 30
    scanIntervalMinutes: 60
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否启用自动清理 |
| `retentionDays` | `30` | 归档满多少天后删除，1 到 3650 |
| `scanIntervalMinutes` | `60` | 两次检查之间的间隔，修改后重启生效 |

检查在后台进行，插件启动约 20 秒后执行第一次检查。实际删除落在到期后的下一次检查，最多晚一个检查间隔。

## 查看状态

在会话里输入斜杠命令：

```text
/archive-retention        查看当前状态
/archive-retention run    立即执行一次检查
```

状态输出包含归档会话数量、已记录归档时刻的数量和已到期的数量。

## 保留期限怎么算

插件在 `~/.dsh/archive-retention/archives.json` 里记录每个会话的归档时刻。

- 会话归档时立即记录时刻。
- 插件第一次运行时已经存在的归档会话没有历史归档时刻，从插件第一次看到它们时开始计时。
- 如果归档之后会话日志仍有新的写入，说明会话又被用过，从那次写入重新计时。

删除这个记录文件会让所有归档会话重新开始计时。

## 限制

- 删除不可恢复。
- 插件第一次运行前的归档会话，无法还原真实的归档时刻，只能从插件第一次看到它开始算。
- 更新插件代码后需要重启一次 DeepSeek Harness，让新的插件代码生效。

## 许可证

GNU General Public License v3.0，见 [LICENSE](LICENSE)。
