import type { RtcAdapter, JoinRtcParams } from './RtcAdapter'
import type { Client, Log } from '../vendor/agora-miniapp-sdk'
import { useCallState } from '../store/callState'
import type { LogLevel } from '../utils/logger'

/**
 * 声网小程序 SDK 为 UMD 包，vendor 到插件内使用。
 *
 * 注意：
 * 1. HBuilderX 对 ES module 方式导入本地 .js UMD 包支持不佳，使用 require 更稳定。
 * 2. require 的相对路径必须指向插件 static/ 目录，因为 HBuilderX 只会把 static/
 *    下的文件原样复制到小程序输出包；放在 src/vendor/ 下仅被动态 require 引用时
 *    不会被复制到输出目录，导致运行时"module is not defined"。
 * 3. 类型声明来自 src/vendor/agora-miniapp-sdk.d.ts（pnpm sync:agora 同步），
 *    运行时 require 得到的对象按该声明强制转换，避免 any 泛滥。
 */
declare const require: (path: string) => { Client: typeof Client; LOG?: Log }
const AgoraMiniappSDK = require('../../static/agora-miniapp-sdk.js')

export interface MpWeixinRtcAdapterOptions {
  /**
   * 可选日志器；未传入时使用 console
   */
  logger?: {
    debug: (message: string, ...args: any[]) => void
    info: (message: string, ...args: any[]) => void
    warn: (message: string, ...args: any[]) => void
    error: (message: string, ...args: any[]) => void
  }
  /**
   * 日志级别，用于同步设置声网小程序 SDK 日志级别
   */
  logLevel?: LogLevel
  /**
   * 将 Agora RTC UID 解析为环信用户 ID。
   * 用于 stream-added 后获取远端 userId 以查询昵称/头像。
   */
  getUserIdByRTCUIds?: (uids: (number | string)[]) => Promise<Record<string, string>>
  /**
   * 本地推流 URL 变化回调
   * SDK 通过 update-url 事件返回 live-pusher 的 url
   */
  onLocalStreamUrl?: (url: string) => void
  /**
   * 远端拉流 URL 变化回调（单聊兼容）
   * SDK 通过 update-url 事件返回 live-player 的 url
   */
  onRemoteStreamUrl?: (url: string, uid: string | number) => void
  /**
   * 远端用户加入/离开回调（单聊兼容）
   */
  onRemoteUserState?: (uid: string | number, joined: boolean) => void
  /**
   * 远端流新增回调（群聊）
   */
  onRemoteStreamAdded?: (uid: string | number, url: string, userId: string) => void
  /**
   * 远端流移除回调（群聊）
   */
  onRemoteStreamRemoved?: (uid: string | number, userId: string) => void
  /**
   * 通用事件/错误回调
   */
  onEvent?: (type: string, payload?: any) => void
  /**
   * 本地音频/视频开关状态回调
   */
  onLocalMediaState?: (type: 'audio' | 'video', enabled: boolean) => void
}

/**
 * 声网小程序 SDK RTC 适配器
 */
export function createMpWeixinRtcAdapter(options: MpWeixinRtcAdapterOptions = {}): RtcAdapter {
  const SDK = AgoraMiniappSDK
  const { state } = useCallState()

  /**
   * 将平台日志级别映射为声网小程序 SDK 日志级别
   * Agora: -1 BLIND, 0 DEBUG, 1 INFO, 2 WARN, 3 ERROR, 4 NONE
   */
  function mapLogLevelToAgora(level: LogLevel | undefined): number {
    switch (level) {
      case 'verbose':
        return -1
      case 'debug':
        return 0
      case 'info':
        return 1
      case 'warn':
        return 2
      case 'error':
        return 3
      case 'silent':
        return 4
      default:
        return 0
    }
  }

  SDK.LOG?.setLogLevel?.(mapLogLevelToAgora(options.logLevel))

  let client: Client | null = null
  let currentChannel = ''
  let currentUid: string | number = ''
  let currentToken = ''
  let currentAppId = ''
  let currentCallType: 'audio' | 'video' | undefined
  let localPublished = false
  let joined = false
  let reconnecting = false
  let reconnectCount = 0
  const MAX_RECONNECT = 3

  /** Agora UID → 环信 userId 映射 */
  const uidToUserIdMap = new Map<string, string>()
  /** 远端流集合（uid → { url, userId }） */
  const remoteStreams = new Map<string, { url: string; userId: string }>()

  const {
    logger = console,
    getUserIdByRTCUIds,
    onLocalStreamUrl,
    onRemoteStreamUrl,
    onRemoteUserState,
    onRemoteStreamAdded,
    onRemoteStreamRemoved,
    onEvent,
    onLocalMediaState
  } = options

  /**
   * 根据 Agora uid 解析环信 userId
   * 1. 查本地映射
   * 2. 调用 getUserIdByRTCUIds
   * 3. 兜底返回 uid 字符串
   */
  async function resolveUserIdByUid(uid: string | number): Promise<string> {
    const uidKey = String(uid)
    const cached = uidToUserIdMap.get(uidKey)
    if (cached) return cached

    if (getUserIdByRTCUIds) {
      try {
        const result = await getUserIdByRTCUIds([uid])
        logger.debug('[MpWeixinRtcAdapter] getUserIdByRTCUIds result', result)

        // 兼容多种返回格式：
        // 1. { "19": "pfh" }
        // 2. { data: { "19": "pfh" } }
        // 3. [{ uid: 19, userId: "pfh" }]
        // 4. [{ uid: "19", userId: "pfh" }]
        let userId: string | undefined

        if (result && typeof result === 'object') {
          if (Array.isArray(result)) {
            const item = result.find((r: any) => String(r?.uid) === uidKey || r?.uid === uid)
            userId = item?.userId || item?.user_id || item?.userName
          } else {
            const data = (result as any).data || result
            if (data && typeof data === 'object') {
              userId = (data as any)[uidKey] || (data as any)[uid as any]
            }
          }
        }

        if (userId) {
          uidToUserIdMap.set(uidKey, userId)
          return userId
        }
      } catch (err) {
        logger.warn('[MpWeixinRtcAdapter] getUserIdByRTCUIds failed', err)
      }
    }

    // 兜底：使用 uid 作为 userId
    return uidKey
  }

  function ensureClient(): Client {
    if (!client) {
      client = new SDK.Client({})
      bindClientEvents()
    }
    return client
  }

  function bindClientEvents(): void {
    if (!client) return

    client.on('stream-added', async (evt) => {
      logger.debug('[MpWeixinRtcAdapter] stream-added', evt)
      const uid = evt?.uid
      if (uid == null || !client) return
      try {
        const res = (await client.subscribe(uid)) as { url?: string; rotation?: number }
        logger.debug('[MpWeixinRtcAdapter] subscribe success', uid, res)
        const userId = await resolveUserIdByUid(uid)
        const uidKey = String(uid)

        // 单聊兼容：仍触发旧回调
        onRemoteUserState?.(uid, true)
        if (res?.url) {
          state.remoteUid = uidKey
          state.remoteUserId = userId
          state.remoteStreamUrl = res.url
          onRemoteStreamUrl?.(res.url, uid)
        }

        // 群聊：写入远端流集合并触发新回调
        remoteStreams.set(uidKey, { url: res?.url || '', userId })
        onRemoteStreamAdded?.(uid, res?.url || '', userId)
      } catch (err) {
        logger.error('[MpWeixinRtcAdapter] subscribe failed', uid, err)
      }
    })

    client.on('stream-removed', (evt) => {
      logger.debug('[MpWeixinRtcAdapter] stream-removed', evt)
      const uid = evt?.uid
      if (uid != null) {
        const uidKey = String(uid)
        const removed = remoteStreams.get(uidKey)
        remoteStreams.delete(uidKey)

        client!.unsubscribe(uid, () => {
          logger.debug('[MpWeixinRtcAdapter] unsubscribe success', uid)
          onRemoteUserState?.(uid, false)
          if (removed) {
            onRemoteStreamRemoved?.(uid, removed.userId)
          }
        }, (err) => {
          logger.error('[MpWeixinRtcAdapter] unsubscribe failed', uid, err)
        })
      }
    })

    client.on('update-url', async (evt) => {
      logger.debug('[MpWeixinRtcAdapter] update-url', evt)
      const { uid, url } = evt
      if (url == null) return

      // update-url 同时用于本地推流（uid 等于当前用户）和远端拉流（uid 为远端用户）
      if (uid == null || String(uid) === String(currentUid)) {
        state.localStreamUrl = url
        onLocalStreamUrl?.(url)
      } else {
        const uidKey = String(uid)
        const userId = await resolveUserIdByUid(uid)
        state.remoteUid = uidKey
        state.remoteUserId = userId
        state.remoteStreamUrl = url
        onRemoteStreamUrl?.(url, uid)

        // 更新远端流集合
        const existing = remoteStreams.get(uidKey)
        remoteStreams.set(uidKey, { url, userId: existing?.userId || userId })
        onRemoteStreamAdded?.(uid, url, existing?.userId || userId)
      }
    })

    client.on('error', (err) => {
      logger.error('[MpWeixinRtcAdapter] client error', err)
      onEvent?.('error', err)

      // 触发重连的错误码：501 网络断开 / 904 服务不可用
      const code = (err as any)?.code
      if ((code === 501 || code === 904) && joined) {
        logger.warn('[MpWeixinRtcAdapter] trigger reconnect, code:', code)
        reconnect().catch((e) => {
          logger.error('[MpWeixinRtcAdapter] reconnect failed', e)
        })
      }
    })
  }

  function parseAgoraUid(userId: string): number | null {
    const uid = Number(userId)
    if (Number.isNaN(uid)) {
      logger.error('[MpWeixinRtcAdapter] invalid userId, expected numeric uid', userId)
      return null
    }
    return uid
  }

  /**
   * RTC 断线重连：销毁旧 client，重新 init/join/publish
   */
  async function reconnect(): Promise<void> {
    if (reconnecting) return
    if (reconnectCount >= MAX_RECONNECT) {
      logger.error('[MpWeixinRtcAdapter] reconnect exhausted, give up')
      onEvent?.('reconnectExhausted', {})
      return
    }
    reconnecting = true
    reconnectCount++

    try {
      logger.warn('[MpWeixinRtcAdapter] reconnect start, attempt:', reconnectCount)

      // 销毁旧 client
      if (client) {
        try {
          if (localPublished) {
            await client.unpublish()
          }
          await client.leave()
          await client.destroy()
        } catch (e) {
          logger.warn('[MpWeixinRtcAdapter] destroy old client error', e)
        }
        client = null
      }

      // 重新创建 client
      client = new SDK.Client({})
      bindClientEvents()

      // 重新初始化并加入
      await client.init(currentAppId)
      await client.setRole('broadcaster')
      await (client.join as (token: string, channel: string, uid: number | string) => Promise<void>)(
        currentToken,
        currentChannel,
        currentUid
      )
      joined = true

      // 重新发布
      const publishUrl = await client.publish()
      if (publishUrl) {
        state.localStreamUrl = publishUrl
        onLocalStreamUrl?.(publishUrl)
      }
      localPublished = true

      reconnectCount = 0
      logger.warn('[MpWeixinRtcAdapter] reconnect success')
      onEvent?.('reconnectSuccess', {})
    } catch (err) {
      logger.error('[MpWeixinRtcAdapter] reconnect failed', err)
      // 延迟后再次尝试
      setTimeout(() => {
        reconnect().catch((e) => logger.error('[MpWeixinRtcAdapter] reconnect retry failed', e))
      }, 3000)
    } finally {
      reconnecting = false
    }
  }

  return {
    async joinChannel(params: JoinRtcParams) {
      logger.debug('[MpWeixinRtcAdapter] joinChannel', params)
      const c = ensureClient()
      currentChannel = params.channel
      currentUid = params.uid
      currentToken = params.token
      currentAppId = params.appId || ''
      currentCallType = params.callType

      // 群聊：预注册已知参与者 uid → userId 映射
      if (params.knownParticipants) {
        params.knownParticipants.forEach((p) => {
          uidToUserIdMap.set(String(p.uid), p.userId)
        })
        logger.debug('[MpWeixinRtcAdapter] pre-registered participants', params.knownParticipants)
      }

      const appId = params.appId
      logger.debug('[MpWeixinRtcAdapter] init with appId:', appId)
      if (!appId) {
        throw new Error('[MpWeixinRtcAdapter] appId is required for RTC initialization')
      }

      try {
        logger.debug('[MpWeixinRtcAdapter] client init start, appId:', appId)
        await c.init(appId)
        logger.debug('[MpWeixinRtcAdapter] client init success')

        await c.setRole('broadcaster')
        logger.debug('[MpWeixinRtcAdapter] join start:', {
          token: params.token,
          channel: params.channel,
          uid: params.uid
        })
        // 声网小程序 SDK 运行时 join 支持 3 个参数，但 .d.ts 声明为 4 个必填参数。
        // 真机测试显示传入 isAudioOnly/uidType 可能导致断线，故按开源示例只传 3 个参数。
        await (c.join as (token: string, channel: string, uid: number | string) => Promise<void>)(
          params.token,
          params.channel,
          params.uid
        )
        logger.debug('[MpWeixinRtcAdapter] join success')
        joined = true
        reconnectCount = 0

        const publishUrl = await c.publish()
        logger.debug('[MpWeixinRtcAdapter] publish success, url:', publishUrl)
        if (publishUrl) {
          state.localStreamUrl = publishUrl
          onLocalStreamUrl?.(publishUrl)
        }
        localPublished = true
      } catch (err) {
        logger.error('[MpWeixinRtcAdapter] joinChannel failed', err)
        throw err
      }
    },

    async leaveChannel() {
      logger.debug('[MpWeixinRtcAdapter] leaveChannel')
      reconnectCount = 0
      reconnecting = false
      remoteStreams.clear()
      if (!client) return

      try {
        if (localPublished) {
          await client.unpublish()
          localPublished = false
        }
        await client.leave()
        joined = false
      } catch (err) {
        logger.error('[MpWeixinRtcAdapter] leaveChannel error', err)
      } finally {
        client = null
        currentChannel = ''
        currentUid = ''
        currentToken = ''
        currentAppId = ''
        currentCallType = undefined
        state.localStreamUrl = ''
        state.remoteStreamUrl = ''
        state.remoteUserId = ''
        state.remoteUid = ''
      }
    },

    async publishLocalTracks(types: ('audio' | 'video')[]) {
      logger.debug('[MpWeixinRtcAdapter] publishLocalTracks', types)
      if (!client || localPublished) return
      await client.publish()
      localPublished = true
    },

    async unpublishLocalTracks(types: ('audio' | 'video')[]) {
      logger.debug('[MpWeixinRtcAdapter] unpublishLocalTracks', types)
      if (!client || !localPublished) return
      await client.unpublish()
      localPublished = false
    },

    async subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video') {
      logger.debug('[MpWeixinRtcAdapter] subscribeRemoteUser', userId, mediaType)
      if (!client) return
      const uid = parseAgoraUid(userId)
      if (uid == null) return
      try {
        await client.subscribe(uid)
      } catch (err) {
        logger.error('[MpWeixinRtcAdapter] subscribeRemoteUser failed', err)
      }
    },

    async unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video') {
      logger.debug('[MpWeixinRtcAdapter] unsubscribeRemoteUser', userId, mediaType)
      if (!client) return
      const uid = parseAgoraUid(userId)
      if (uid == null) return
      try {
        await client.unsubscribe(uid)
      } catch (err) {
        logger.error('[MpWeixinRtcAdapter] unsubscribeRemoteUser failed', err)
      }
    },

    async setAudioEnabled(enabled: boolean) {
      logger.debug('[MpWeixinRtcAdapter] setAudioEnabled', enabled)
      if (!client) return
      if (enabled) {
        await client.unmuteLocal('audio')
      } else {
        await client.muteLocal('audio')
      }
      state.audioEnabled = enabled
      onLocalMediaState?.('audio', enabled)
    },

    async setVideoEnabled(enabled: boolean) {
      logger.debug('[MpWeixinRtcAdapter] setVideoEnabled', enabled)
      if (!client) return
      if (enabled) {
        await client.unmuteLocal('video')
      } else {
        await client.muteLocal('video')
      }
      state.videoEnabled = enabled
      onLocalMediaState?.('video', enabled)
    },

    async switchCamera() {
      logger.debug('[MpWeixinRtcAdapter] switchCamera')
      // 声网小程序 SDK 的 Client 没有切换摄像头 API；
      // 切换摄像头需调用 live-pusher 组件实例的 switchCamera 方法，由 UI 层完成。
      onEvent?.('switchCamera', {})
    }
  }
}
