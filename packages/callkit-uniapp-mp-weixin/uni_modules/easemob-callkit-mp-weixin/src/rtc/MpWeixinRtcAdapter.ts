import type { RtcAdapter, JoinRtcParams } from './RtcAdapter'
import type { Client, Log } from '../vendor/agora-miniapp-sdk'
import { useCallState } from '../store/callState'

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
   * 本地推流 URL 变化回调
   * SDK 通过 update-url 事件返回 live-pusher 的 url
   */
  onLocalStreamUrl?: (url: string) => void
  /**
   * 远端拉流 URL 变化回调
   * SDK 通过 update-url 事件返回 live-player 的 url
   */
  onRemoteStreamUrl?: (url: string, uid: string | number) => void
  /**
   * 远端用户加入/离开回调
   */
  onRemoteUserState?: (uid: string | number, joined: boolean) => void
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

  SDK.LOG?.setLogLevel?.(0)

  let client: Client | null = null
  let currentChannel = ''
  let currentUid: string | number = ''
  let localPublished = false
  let joined = false

  const {
    logger = console,
    onLocalStreamUrl,
    onRemoteStreamUrl,
    onRemoteUserState,
    onEvent,
    onLocalMediaState
  } = options

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
        onRemoteUserState?.(uid, true)
        if (res?.url) {
          state.remoteUserId = String(uid)
          state.remoteStreamUrl = res.url
          onRemoteStreamUrl?.(res.url, uid)
        }
      } catch (err) {
        logger.error('[MpWeixinRtcAdapter] subscribe failed', uid, err)
      }
    })

    client.on('stream-removed', (evt) => {
      logger.debug('[MpWeixinRtcAdapter] stream-removed', evt)
      const uid = evt?.uid
      if (uid != null) {
        client!.unsubscribe(uid, () => {
          logger.debug('[MpWeixinRtcAdapter] unsubscribe success', uid)
          onRemoteUserState?.(uid, false)
        }, (err) => {
          logger.error('[MpWeixinRtcAdapter] unsubscribe failed', uid, err)
        })
      }
    })

    client.on('update-url', (evt) => {
      logger.debug('[MpWeixinRtcAdapter] update-url', evt)
      const { uid, url } = evt
      if (url == null) return

      // update-url 同时用于本地推流（uid 等于当前用户）和远端拉流（uid 为远端用户）
      if (uid == null || String(uid) === String(currentUid)) {
        state.localStreamUrl = url
        onLocalStreamUrl?.(url)
      } else {
        state.remoteUserId = String(uid)
        state.remoteStreamUrl = url
        onRemoteStreamUrl?.(url, uid)
      }
    })

    client.on('error', (err) => {
      logger.error('[MpWeixinRtcAdapter] client error', err)
      onEvent?.('error', err)
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

  return {
    async joinChannel(params: JoinRtcParams) {
      logger.debug('[MpWeixinRtcAdapter] joinChannel', params)
      const c = ensureClient()
      currentChannel = params.channel
      currentUid = params.uid

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
        state.localStreamUrl = ''
        state.remoteStreamUrl = ''
        state.remoteUserId = ''
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
