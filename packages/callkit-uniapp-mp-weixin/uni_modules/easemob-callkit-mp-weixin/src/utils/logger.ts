import type { Logger as CoreLogger } from '../vendor/callkit-core.esm.js'

export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  verbose: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5
}

export interface CreateLoggerOptions {
  /** 日志级别，默认根据 NODE_ENV 判断：开发环境 debug，生产环境 warn */
  level?: LogLevel
  /** 日志前缀，默认 [CallKit][微信小程序] */
  prefix?: string
}

function detectDefaultLevel(): LogLevel {
  try {
    const g = globalThis as any
    // UniApp / Node 构建环境
    if (g.process?.env?.NODE_ENV === 'production') {
      return 'warn'
    }
    // 微信小程序运行环境
    if (g.wx?.getAccountInfoSync) {
      const accountInfo = g.wx.getAccountInfoSync()
      const env = accountInfo?.miniProgram?.envVersion
      if (env === 'release') {
        return 'warn'
      }
    }
  } catch {
    // 异常时保持默认 debug
  }
  return 'debug'
}

/**
 * 创建微信小程序平台专用 Logger
 *
 * 统一前缀、级别控制，并兼容 callkit-core 的 Logger 接口。
 */
export function createMpWeixinLogger(options: CreateLoggerOptions = {}): CoreLogger {
  const level = options.level ?? detectDefaultLevel()
  const prefix = options.prefix ?? '[CallKit][微信小程序]'

  function shouldOutput(target: LogLevel): boolean {
    return LEVEL_PRIORITY[target] >= LEVEL_PRIORITY[level]
  }

  function output(method: 'log' | 'info' | 'warn' | 'error', target: LogLevel, message: string, ...args: any[]) {
    if (!shouldOutput(target)) return
    console[method](`${prefix} ${message}`, ...args)
  }

  return {
    verbose: (message, ...args) => output('log', 'verbose', message, ...args),
    debug: (message, ...args) => output('log', 'debug', message, ...args),
    info: (message, ...args) => output('info', 'info', message, ...args),
    warn: (message, ...args) => output('warn', 'warn', message, ...args),
    error: (message, ...args) => output('error', 'error', message, ...args),

    // 可选结构化日志通道，默认按 info 级别输出
    signal: (direction, action, meta) => {
      if (shouldOutput('debug')) {
        output('log', 'debug', `[信令] ${direction} ${action}`, meta)
      }
    },
    stateChange: (from, to, meta) => {
      if (shouldOutput('debug')) {
        output('log', 'debug', `[状态机] ${from} → ${to}`, meta)
      }
    },
    rtc: (event, meta) => {
      if (shouldOutput('debug')) {
        output('log', 'debug', `[RTC] ${event}`, meta)
      }
    },
    event: (event, meta) => {
      if (shouldOutput('debug')) {
        output('log', 'debug', `[事件] ${event}`, meta)
      }
    }
  }
}

let defaultLogger: CoreLogger | null = null

/**
 * 获取默认的微信小程序 Logger 实例
 */
export function getMpWeixinLogger(): CoreLogger {
  if (!defaultLogger) {
    defaultLogger = createMpWeixinLogger()
  }
  return defaultLogger
}
