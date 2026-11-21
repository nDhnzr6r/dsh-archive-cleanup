/**
 * Host 部分：记录每个会话的归档时刻，归档满保留期限后把会话连同日志一起删除。
 */

import { readFileSync } from 'node:fs'
import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'

export const name = '@nDhnzr6r/archive-cleanup'
export const inject = ['workspaceRegistry', 'sessionPersistence']

const DAY_MS = 86_400_000
const STARTUP_DELAY_MS = 20_000
const MAX_RETENTION_DAYS = 3650
const STATE_VERSION = 1

export const Config = z.object({
  /** 自动清理归档会话。 */
  enabled: z.boolean().default(true).volatile(),
  /** 归档满多少天后删除。 */
  retentionDays: z.number().step(1).min(1).max(MAX_RETENTION_DAYS).default(30).volatile(),
  /** 两次检查之间的间隔（分钟），修改后重启插件生效。 */
  scanIntervalMinutes: z.number().step(1).min(1).max(1440).default(60),
})

/** 会话 id 只允许进入安全文件名的字符，防止拼接路径时逃逸。 */
function safeSessionId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 200
    && id !== '.' && id !== '..' && /^[A-Za-z0-9._-]+$/.test(id)
}

/** 与持久化后端一致的会话目录名编码：安全字符保留，其余转成 ~XXXX。 */
function encodeSegment(raw) {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index)
    const char = String.fromCharCode(code)
    out += char !== '~' && /^[A-Za-z0-9._-]$/.test(char)
      ? char
      : `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * 确认待删除目录确实是该会话自己的日志目录：目录名等于编码后的会话 id，
 * 上层是项目目录，且目录本身不是指向别处的符号链接。
 */
async function assertSessionDirectory(directory, sessionId) {
  if (!safeSessionId(sessionId)) throw new Error(`会话 ${sessionId} 的标识不合法，已跳过`)
  const encoded = encodeSegment(sessionId)
  if (basename(directory) !== encoded) throw new Error('会话目录名与会话标识不一致，已跳过')
  if (!/^--.*--$/.test(basename(dirname(directory)))) throw new Error('会话目录不在项目目录内，已跳过')
  const canonical = await realpath(directory)
  if (dirname(canonical) !== await realpath(dirname(directory))) throw new Error('会话目录解析到了别处，已跳过')
  if (basename(canonical) !== encoded) throw new Error('会话目录解析后名称不一致，已跳过')
}

/** 会话日志按 cwd 分组存放，DSH home 下的投影缓存按会话 id 存放。 */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function projectionCachePath(sessionId) {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
}

/** 归档时刻表：会话 id 到归档时间的毫秒时间戳。 */
function stateFilePath() {
  return join(dshHome(), 'archive-retention', 'archives.json')
}

function loadArchivedAt(logger) {
  try {
    const parsed = JSON.parse(readFileSync(stateFilePath(), 'utf8'))
    const entries = parsed?.archivedAt
    if (parsed?.version !== STATE_VERSION || typeof entries !== 'object' || entries === null) return new Map()
    const map = new Map()
    for (const [id, value] of Object.entries(entries)) {
      if (typeof value === 'number' && Number.isFinite(value)) map.set(id, value)
    }
    return map
  } catch (error) {
    // 记录不可读时从头计时，宁可晚删，也不按不可信的时间提前删。
    if (error?.code !== 'ENOENT') logger.warn('archive-cleanup: 归档时间记录不可用，将从现在重新计时：%s', error)
    return new Map()
  }
}

async function saveArchivedAt(map) {
  const file = stateFilePath()
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify({ version: STATE_VERSION, archivedAt: Object.fromEntries(map) }), 'utf8')
  await rename(temp, file)
}

/** 读取配置字段：volatile 字段是引用，普通字段是值。 */
function readConfig(reference, fallback) {
  if (reference === undefined || reference === null) return fallback
  return typeof reference.get === 'function' ? reference.get() : reference
}

/**
 * @param ctx Host 上下文
 * @param config 插件配置；volatile 字段用 get() 实时读取
 */
export function apply(ctx, config) {
  const registry = ctx.workspaceRegistry
  const persistence = ctx.sessionPersistence
  const archivedAt = loadArchivedAt(ctx.logger)
  let scanning = false
  let writeChain = Promise.resolve()

  // 启动时先写一次记录，让状态文件尽早到位。
  void persist()

  ctx.inject(['settings'], (scope) => {
    // 配置页由本插件的 Client 部分绘制，这里关闭通用表单。
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })

  /** 串行写盘，避免检查与归档事件同时改写记录。 */
  function persist() {
    const snapshot = new Map(archivedAt)
    writeChain = writeChain.then(() => saveArchivedAt(snapshot)).catch((error) => {
      ctx.logger.warn('archive-cleanup: 保存归档时间失败：%s', error)
    })
    return writeChain
  }

  ctx.on('workspace/session-archived', (request) => {
    const sessionId = request?.sessionId
    if (typeof sessionId !== 'string' || archivedAt.has(sessionId)) return
    archivedAt.set(sessionId, Date.now())
    void persist()
  })

  ctx.on('workspace/session-unarchiving', (request) => {
    const sessionId = request?.sessionId
    if (typeof sessionId !== 'string' || !archivedAt.delete(sessionId)) return
    void persist()
  })

  /** 删除一个会话的全部落盘数据，并把它从各处的会话清单里摘掉。 */
  async function purge(sessionId, logPath) {
    const directory = dirname(logPath)
    await assertSessionDirectory(directory, sessionId)
    await rm(directory, { recursive: true, force: true, maxRetries: 3 })
    archivedAt.delete(sessionId)
    await registry.unarchiveSession(sessionId)
    for (const workspace of registry.list()) {
      if (typeof workspace.detachSession === 'function') await workspace.detachSession(sessionId)
    }
    await rm(projectionCachePath(sessionId), { force: true })
    try {
      ctx.emit('api-session/removed', sessionId)
    } catch (error) {
      ctx.logger.warn('archive-cleanup: 通知客户端移除会话失败：%s', error)
    }
  }

  async function scanOnce() {
    if (readConfig(config.enabled, true) !== true) return { archived: 0, due: 0, removed: 0, disabled: true }
    const archived = [...registry.archivedSessionIds]
    if (archived.length === 0) {
      if (archivedAt.size > 0) {
        archivedAt.clear()
        await persist()
      }
      return { archived: 0, due: 0, removed: 0, disabled: false }
    }

    const snapshots = await persistence.list()
    const byId = new Map()
    for (const snapshot of snapshots) {
      const id = snapshot?.header?.id
      const path = snapshot?.location?.path
      if (typeof id === 'string' && typeof path === 'string') byId.set(id, { id, path })
    }

    const archivedSet = new Set(archived)
    let changed = false
    for (const sessionId of [...archivedAt.keys()]) {
      if (archivedSet.has(sessionId)) continue
      archivedAt.delete(sessionId)
      changed = true
    }

    const agents = ctx.get('agents')
    const sessions = ctx.get('sessions')
    const isLive = (id) => agents?.get(id) !== undefined || sessions?.get(id) !== undefined
    const now = Date.now()
    const retentionMs = readConfig(config.retentionDays, 30) * DAY_MS
    let removed = 0
    let due = 0

    for (const sessionId of archived) {
      const stored = byId.get(sessionId)
      if (stored === undefined) {
        // 日志已经不存在：清掉悬空的归档标记，避免它一直留在归档列表里。
        if (!isLive(sessionId)) {
          try {
            await registry.unarchiveSession(sessionId)
          } catch (error) {
            ctx.logger.warn('archive-cleanup: 清理归档标记 %s 失败：%s', sessionId, error)
          }
        }
        continue
      }
      if (isLive(sessionId)) continue

      let archivedAtMs = archivedAt.get(sessionId)
      if (archivedAtMs === undefined) {
        // 插件首次见到这个归档会话：没有历史归档时刻，从此刻开始计时。
        archivedAtMs = now
        changed = true
      }

      // 归档之后日志仍有写入，说明会话又被用过了，从那次写入重新计时。
      let modifiedAt
      try {
        modifiedAt = (await lstat(stored.path)).mtimeMs
      } catch {
        continue
      }
      if (modifiedAt > archivedAtMs) {
        archivedAtMs = modifiedAt
        changed = true
      }
      if (archivedAt.get(sessionId) !== archivedAtMs) {
        archivedAt.set(sessionId, archivedAtMs)
        changed = true
      }

      if (now - archivedAtMs < retentionMs) continue

      due += 1
      try {
        await purge(sessionId, stored.path)
        removed += 1
        changed = true
        ctx.logger.info('archive-cleanup: 已删除归档会话 %s', sessionId)
      } catch (error) {
        ctx.logger.warn('archive-cleanup: 删除归档会话 %s 失败：%s', sessionId, error)
      }
    }

    if (changed) await persist()
    if (removed > 0) {
      ctx.logger.info('archive-cleanup: 本次共删除 %d 个归档会话', removed)
    }
    return { archived: archived.length, due, removed, disabled: false }
  }

  async function scan() {
    if (scanning) return undefined
    scanning = true
    try {
      return await scanOnce()
    } catch (error) {
      ctx.logger.warn('archive-cleanup: 检查归档会话失败：%s', error)
      return undefined
    } finally {
      scanning = false
    }
  }

  function describeStatus() {
    const archived = [...registry.archivedSessionIds]
    const now = Date.now()
    const retentionMs = readConfig(config.retentionDays, 30) * DAY_MS
    let recorded = 0
    let due = 0
    for (const sessionId of archived) {
      const archivedAtMs = archivedAt.get(sessionId)
      if (archivedAtMs === undefined) continue
      recorded += 1
      if (now - archivedAtMs >= retentionMs) due += 1
    }
    return [
      `自动清理：${readConfig(config.enabled, true) === true ? '开启' : '关闭'}`,
      `保留期限：${readConfig(config.retentionDays, 30)} 天`,
      `归档会话：${archived.length} 个`,
      `已记录归档时刻：${recorded} 个`,
      `已到期：${due} 个`,
    ].join('\n')
  }

  ctx.inject(['commands'], (scope) => {
    scope.effect(() => scope.commands.register({
      definitionId: '@nDhnzr6r/archive-cleanup',
      name: 'archive-retention',
      description: '查看归档会话清理状态，或立即执行一次检查',
      input: { hint: 'run' },
      handler: async (invocation) => {
        const argument = String(invocation?.rawInput ?? '').trim()
        if (argument === 'run') {
          const result = await scan()
          if (result === undefined) return { kind: 'error', text: '检查没有执行完成，请稍后再试。' }
          if (result.disabled) return { kind: 'error', text: '自动清理已关闭，先在设置里打开。' }
          return {
            kind: 'success',
            text: `检查完成：归档会话 ${result.archived} 个，到期 ${result.due} 个，删除 ${result.removed} 个。`,
          }
        }
        return { kind: 'success', text: describeStatus() }
      },
    }))
  })

  ctx.effect(() => {
    const intervalMs = Math.max(1, readConfig(config.scanIntervalMinutes, 60)) * 60_000
    let interval
    const startup = setTimeout(() => {
      void scan()
      interval = setInterval(() => { void scan() }, intervalMs)
      interval.unref?.()
    }, STARTUP_DELAY_MS)
    startup.unref?.()
    return () => {
      clearTimeout(startup)
      if (interval !== undefined) clearInterval(interval)
    }
  })
}
