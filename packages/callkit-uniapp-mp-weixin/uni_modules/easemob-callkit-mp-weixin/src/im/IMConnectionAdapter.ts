/**
 * 环信 IM connection 实例的最小类型定义。
 *
 * 插件不负责创建 connection，由宿主项目使用 `easemob-websdk` 自行创建后传入。
 * 这里只声明 adapter 实际会用到的属性和方法。
 */
export interface IMConnection {
  user?: string
  context?: {
    userId?: string
    jid?: { clientResource?: string }
  }
  token?: string
  send(msg: any): Promise<any>
  addEventHandler?(id: string, handlers: Record<string, (...args: any[]) => void>): void
  removeEventHandler?(id: string): void
  getRTCToken?(channel: string): Promise<string>
  getUserIdByRTCUIds?(uids: (number | string)[]): Promise<any>
  [key: string]: any
}

/**
 * 把环信 UniApp SDK 的 connection 实例包装成 callkit-core 期望的 EasemobConnection 形态。
 */
export function createIMConnectionAdapter(conn: IMConnection) {
  return {
    get user() {
      return conn.user || ''
    },

    get context() {
      return {
        userId: conn.context?.userId || conn.user || '',
        jid: conn.context?.jid || { clientResource: '' }
      }
    },

    get token() {
      return conn.token || ''
    },

    async send(msg: any) {
      return conn.send(msg)
    },

    addEventHandler(id: string, handlers: Record<string, (...args: any[]) => void>) {
      if (typeof conn.addEventHandler === 'function') {
        conn.addEventHandler(id, handlers)
      } else {
        Object.entries(handlers).forEach(([event, handler]) => {
          const key = event.startsWith('on') ? event : `on${event.charAt(0).toUpperCase()}${event.slice(1)}`
          ;(conn as any)[key] = handler
        })
      }
    },

    removeEventHandler(id: string) {
      if (typeof conn.removeEventHandler === 'function') {
        conn.removeEventHandler(id)
      }
    },

    async getRTCToken(channel: string) {
      if (typeof conn.getRTCToken !== 'function') {
        throw new Error('[IMConnectionAdapter] 当前 IM SDK 不支持 getRTCToken')
      }
      return conn.getRTCToken(channel)
    },

    async getUserIdByRTCUIds(uids: (number | string)[]) {
      if (typeof conn.getUserIdByRTCUIds !== 'function') {
        throw new Error('[IMConnectionAdapter] 当前 IM SDK 不支持 getUserIdByRTCUIds')
      }
      return conn.getUserIdByRTCUIds(uids)
    }
  }
}

export type IMAdaptedConnection = ReturnType<typeof createIMConnectionAdapter>
