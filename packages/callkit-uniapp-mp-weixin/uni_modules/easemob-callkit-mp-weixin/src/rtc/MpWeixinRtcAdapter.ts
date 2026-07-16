import type { RtcAdapter, JoinRtcParams } from './RtcAdapter'
import type { Client, Log, UidType } from '../vendor/agora-miniapp-sdk'
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

    client.on('stream-added', (evt) => {
      console.log('[MpWeixinRtcAdapter] stream-added', evt)
      const uid = evt?.uid
      if (uid != null) {
        client!.subscribe(uid, {}, () => {
          console.log('[MpWeixinRtcAdapter] subscribe success', uid)
          onRemoteUserState?.(uid, true)
        }, (err) => {
          console.error('[MpWeixinRtcAdapter] subscribe failed', uid, err)
        })
      }
    })

    client.on('stream-removed', (evt) => {
      console.log('[MpWeixinRtcAdapter] stream-removed', evt)
      const uid = evt?.uid
      if (uid != null) {
        client!.unsubscribe(uid, () => {
          console.log('[MpWeixinRtcAdapter] unsubscribe success', uid)
          onRemoteUserState?.(uid, false)
        }, (err) => {
          console.error('[MpWeixinRtcAdapter] unsubscribe failed', uid, err)
        })
      }
    })

    client.on('update-url', (evt) => {
      console.log('[MpWeixinRtcAdapter] update-url', evt)
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
      console.error('[MpWeixinRtcAdapter] client error', err)
      onEvent?.('error', err)
    })
  }

  function parseAgoraUid(userId: string): number | null {
    const uid = Number(userId)
    if (Number.isNaN(uid)) {
      console.error('[MpWeixinRtcAdapter] invalid userId, expected numeric uid', userId)
      return null
    }
    return uid
  }

  function resolveUidType(uid: number | string): UidType {
    return typeof uid === 'string' ? 1 /* UidType.STRING */ : 0 /* UidType.INT */
  }

  return {
    async joinChannel(params: JoinRtcParams) {
      console.log('[MpWeixinRtcAdapter] joinChannel', params)
      const c = ensureClient()
      currentChannel = params.channel
      currentUid = params.uid

      const appId = params.appId
      if (!appId) {
        throw new Error('[MpWeixinRtcAdapter] appId is required for RTC initialization')
      }

      const uidType = resolveUidType(params.uid)
      const isAudioOnly = params.callType === 'audio'

      try {
        await c.init(appId)
        console.log('[MpWeixinRtcAdapter] client init success')

        await c.setRole('broadcaster')
        await c.join(params.token, params.channel, params.uid, isAudioOnly, uidType)
        console.log('[MpWeixinRtcAdapter] join success')
        joined = true

        await c.publish()
        console.log('[MpWeixinRtcAdapter] publish success')
        localPublished = true
      } catch (err) {
        console.error('[MpWeixinRtcAdapter] joinChannel failed', err)
        throw err
      }
    },

    async leaveChannel() {
      console.log('[MpWeixinRtcAdapter] leaveChannel')
      if (!client) return

      try {
        if (localPublished) {
          await client.unpublish()
          localPublished = false
        }
        await client.leave()
        joined = false
      } catch (err) {
        console.error('[MpWeixinRtcAdapter] leaveChannel error', err)
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
      console.log('[MpWeixinRtcAdapter] publishLocalTracks', types)
      if (!client || localPublished) return
      await client.publish()
      localPublished = true
    },

    async unpublishLocalTracks(types: ('audio' | 'video')[]) {
      console.log('[MpWeixinRtcAdapter] unpublishLocalTracks', types)
      if (!client || !localPublished) return
      await client.unpublish()
      localPublished = false
    },

    async subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video') {
      console.log('[MpWeixinRtcAdapter] subscribeRemoteUser', userId, mediaType)
      if (!client) return
      const uid = parseAgoraUid(userId)
      if (uid == null) return
      await client.subscribe(uid, {})
    },

    async unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video') {
      console.log('[MpWeixinRtcAdapter] unsubscribeRemoteUser', userId, mediaType)
      if (!client) return
      const uid = parseAgoraUid(userId)
      if (uid == null) return
      try {
        await client.unsubscribe(uid)
      } catch (err) {
        console.error('[MpWeixinRtcAdapter] unsubscribeRemoteUser failed', err)
      }
    },

    async setAudioEnabled(enabled: boolean) {
      console.log('[MpWeixinRtcAdapter] setAudioEnabled', enabled)
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
      console.log('[MpWeixinRtcAdapter] setVideoEnabled', enabled)
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
      console.log('[MpWeixinRtcAdapter] switchCamera')
      onEvent?.('switchCamera', {})
    }
  }
}
