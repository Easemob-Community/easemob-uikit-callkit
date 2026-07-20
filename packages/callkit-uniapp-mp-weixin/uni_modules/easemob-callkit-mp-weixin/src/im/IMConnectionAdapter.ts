/**
 * 环信 IM connection 实例的最小类型定义。
 *
 * 插件不负责创建 connection，由宿主项目使用 `easemob-websdk` 自行创建后传入。
 * 这里只声明 adapter 实际会用到的属性和方法。
 */
export interface UserProfile {
  userId: string
  nickname?: string
  avatarURL?: string
}

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
  getRTCToken?(channel: string): Promise<any>
  getUserIdByRTCUIds?(uids: (number | string)[]): Promise<any>
  fetchUserInfoById?(userIds: string | string[], properties?: string | string[]): Promise<any>
  [key: string]: any
}

/**
 * 把环信 UniApp SDK 的 connection 实例包装成 callkit-core 期望的 EasemobConnection 形态。
 */
export function createIMConnectionAdapter(conn: IMConnection) {
  const adapter: {
    user: string
    context: { userId: string; jid: { clientResource: string } }
    token: string
    send(msg: any): Promise<any>
    createMessage(payload: any): any
    addEventHandler(id: string, handlers: Record<string, (...args: any[]) => void>): void
    removeEventHandler(id: string): void
    getRTCToken(channel: string): Promise<any>
    getUserIdByRTCUIds(uids: (number | string)[]): Promise<any>
    fetchUserInfoById(userIds: string[]): Promise<UserProfile[]>
    onConnected?: () => void
    onDisconnected?: () => void
  } = {
    get user() {
      return conn.user || ''
    },

    get context() {
      return {
        userId: conn.context?.userId || conn.user || '',
        jid: {
          clientResource: conn.context?.jid?.clientResource || ''
        }
      }
    },

    get token() {
      return conn.token || ''
    },

    async send(msg: any) {
      return conn.send(msg)
    },

    /**
     * 使用环信 SDK 的 message.create 创建带 id 的合法消息对象。
     *
     * callkit-core 内部会构造 { type, to, msg, chatType, ext } 的裸消息体，
     * 必须由 IM SDK 包装成带 id 等必要字段的消息对象后再 send，
     * 否则会报 "Missing required parameter: id"。
     *
     * 兼容多种 SDK 形态：
     * 1. full 版静态 SDK：WebIM.message.create / SDK.message.create
     * 2. miniCore 实例：conn.Message.create
     * 3. 早期实例：conn.message.create
     */
    createMessage(payload: any) {
      const WebIM = (uni as any).WebIM
      if (typeof WebIM?.message?.create === 'function') {
        return WebIM.message.create(payload)
      }
      if (typeof (conn as any).Message?.create === 'function') {
        return (conn as any).Message.create(payload)
      }
      if (typeof conn.message?.create === 'function') {
        return conn.message.create(payload)
      }
      // 兜底：手动补齐 id，确保 send 不会失败
      return {
        ...payload,
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`
      }
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
    },

    /**
     * 批量拉取环信用户属性（昵称、头像等）。
     * 优先使用 conn.fetchUserInfoById；不存在时返回空数组，由业务侧兜底。
     * 响应字段 avatarurl 会统一转换为 avatarURL。
     */
    async fetchUserInfoById(userIds: string[]): Promise<UserProfile[]> {
      if (typeof conn.fetchUserInfoById !== 'function') {
        return []
      }
      try {
        const res = await conn.fetchUserInfoById(userIds, ['nickname', 'avatarurl'])
        const data = res?.data || {}
        return Object.entries(data).map(([userId, info]: [string, any]) => ({
          userId,
          nickname: info?.nickname,
          avatarURL: info?.avatarurl || info?.avatarURL
        }))
      } catch (e) {
        return []
      }
    }
  }

  // 透传 IM 连接状态回调，便于 core 感知断线/重连
  const connAny = conn as any
  const originalOnConnected = connAny.onConnected
  const originalOnDisconnected = connAny.onDisconnected

  connAny.onConnected = (...args: any[]) => {
    originalOnConnected?.(...args)
    adapter.onConnected?.()
  }
  connAny.onDisconnected = (...args: any[]) => {
    originalOnDisconnected?.(...args)
    adapter.onDisconnected?.()
  }

  return adapter
}

export interface IMAdaptedConnection extends ReturnType<typeof createIMConnectionAdapter> {
  onConnected?: () => void
  onDisconnected?: () => void
}
