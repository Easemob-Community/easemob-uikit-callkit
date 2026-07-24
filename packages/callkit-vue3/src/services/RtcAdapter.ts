/**
 * RtcAdapter — Vue3 层对 @easemob-community/callkit-core 的 RTC 适配器实现
 *
 * 职责：
 * 1. 将 core 的 shouldJoinRtc / shouldPublishTracks / localAudioChanged / localVideoChanged
 *    等指令转换为对 Agora RtcService 的具体操作。
 * 2. 管理本地轨道创建、发布、订阅等生命周期。
 * 3. 不持有业务状态，所有状态通过 getCoreCallState / getCurrentUserId 实时读取。
 */
import type { RtcAdapter } from '@easemob-community/callkit-core'
import { CALL_TYPE } from '@easemob-community/callkit-core'
import { useCallKitRtc } from '../composables/useCallKitRtc'
import { logger } from '../utils/logger'

export interface CoreCallStateLike {
  type: CALL_TYPE
  callerUserId: string
  calleeUserId: string
}

export interface CreateRtcAdapterOptions {
  getCoreCallState: () => CoreCallStateLike
  getCurrentUserId: () => string
}

export function createRtcAdapter(options: CreateRtcAdapterOptions): RtcAdapter {
  return {
    joinChannel: async ({ channel, token, uid, appId }) => {
      const rtc = useCallKitRtc()
      const rtcService = rtc.getRtcService()
      if (!rtcService) {
        logger.error('[RtcAdapter] RtcService 未初始化')
        throw new Error('RtcService 未初始化')
      }

      const coreCallState = options.getCoreCallState()

      try {
        // 1. 加入 RTC 频道
        await rtcService.joinChannel(channel, token, uid as number, appId)
        logger.info('[RtcAdapter] joinChannel 成功', { channel, uid })

        // 2. 自动创建并发布本地轨道
        const tracks: any[] = []

        const audioTrack = await rtcService.createAudioTrack()
        tracks.push(audioTrack)
        logger.rtc('createAudioTrackSuccess', {})

        if (
          coreCallState.type === CALL_TYPE.VIDEO_1V1 ||
          coreCallState.type === CALL_TYPE.VIDEO_MULTI
        ) {
          const videoTrack = await rtcService.createVideoTrack()
          tracks.push(videoTrack)
          logger.rtc('createVideoTrackSuccess', {})
        }

        if (tracks.length > 0) {
          await rtcService.publishTracks(tracks)
          logger.rtc('publishTracksSuccess', {})
        }

        // 进房成功：启动媒体输入监控（设备枚举 + 轨道活跃度周期检测）
        rtcService.startMediaInputMonitor()

        logger.rtc('rtcJoined', {})
      } catch (err) {
        logger.warn('[RtcAdapter] joinChannel 失败', err)
        throw err
      }
    },

    leaveChannel: async () => {
      const rtc = useCallKitRtc()
      const rtcService = rtc.getRtcService()
      if (rtcService) {
        await rtcService.leaveChannel()
      }
    },

    publishLocalTracks: async (types) => {
      const rtc = useCallKitRtc()
      const rtcService = rtc.getRtcService()
      if (!rtcService) return
      const tracks: any[] = []
      if (types.includes('audio')) {
        tracks.push(await rtcService.createAudioTrack())
      }
      if (types.includes('video')) {
        tracks.push(await rtcService.createVideoTrack())
      }
      if (tracks.length > 0) {
        await rtcService.publishTracks(tracks)
      }
    },

    unpublishLocalTracks: async (types) => {
      const rtc = useCallKitRtc()
      const rtcService = rtc.getRtcService()
      if (!rtcService) return
      const tracks: any[] = []
      if (types.includes('audio')) {
        const t = rtcService.getLocalAudioTrack()
        if (t) tracks.push(t)
      }
      if (types.includes('video')) {
        const t = rtcService.getLocalVideoTrack()
        if (t) tracks.push(t)
      }
      if (tracks.length > 0) {
        await rtcService.unpublishTracks(tracks)
      }
    },

    subscribeRemoteUser: async (userId, mediaType) => {
      const rtc = useCallKitRtc()
      const rtcService = rtc.getRtcService()
      if (rtcService) {
        await rtcService.subscribeRemoteUser(userId, mediaType)
      }
    },

    unsubscribeRemoteUser: async (userId, mediaType) => {
      const rtc = useCallKitRtc()
      const rtcService = rtc.getRtcService()
      if (rtcService) {
        await rtcService.unsubscribeRemoteUser(userId, mediaType)
      }
    },

    setAudioEnabled: async (enabled) => {
      const rtc = useCallKitRtc()
      const rtcService = rtc.getRtcService()
      if (!rtcService) {
        throw new Error('[RtcAdapter] RtcService 未初始化，无法切换音频')
      }
      const actual = await rtcService.toggleAudio(enabled)
      // RtcService 失败时返回旧值而非抛错，这里统一校验：
      // 结果与目标不一致即视为失败，由 core 回滚状态机（单一事实源）
      if (actual !== enabled) {
        throw new Error(`[RtcAdapter] 切换音频失败：期望 ${enabled}，实际 ${actual}`)
      }
    },

    setVideoEnabled: async (enabled) => {
      const rtc = useCallKitRtc()
      const rtcService = rtc.getRtcService()
      if (!rtcService) {
        throw new Error('[RtcAdapter] RtcService 未初始化，无法切换视频')
      }
      const actual = await rtcService.toggleVideo(enabled)
      if (actual !== enabled) {
        throw new Error(`[RtcAdapter] 切换视频失败：期望 ${enabled}，实际 ${actual}`)
      }
    },
  }
}
