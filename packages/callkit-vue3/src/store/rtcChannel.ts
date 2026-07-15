import { defineStore } from 'pinia'
import type { IAgoraRTCClient, IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng'
import type { RtcChannelState } from './types'
import { RtcService } from '../services/RtcService'
import { logger } from '../utils/logger'
import { useChatClientStore } from './chatClient'

// RtcService 实例保存在模块级变量中，避免放入 Pinia state 造成循环依赖和响应式污染
let _rtcServiceInstance: RtcService | null = null
// 模块级 onUserLeft 回调（由 useCallKitCore 注册，用于 RTC 兜底挂断）
let _onUserLeftHandler: ((userId: string) => void) | null = null

/**
 * RtcChannelStore（简化版）
 * 职责：管理 RtcService 单例、本地媒体流状态、音视频开关状态
 * 注意：频道管理、远程流管理已由 RtcService / GroupCallStore 负责
 */
export const useRtcChannelStore = defineStore('rtcChannel', {
  state: (): RtcChannelState => ({
    isConnected: false,
    localStream: null,
    audioEnabled: true,
    videoEnabled: true,
    agoraAppId: null as string | null,
  }),

  actions: {
    /**
     * 获取RTC服务实例（从模块级变量读取，非 state）
     */
    getRtcService(): RtcService | null {
      return _rtcServiceInstance
    },

    /**
     * 初始化RTC服务
     */
    async initializeRtcService(agoraAppId: string, agoraClient?: IAgoraRTCClient) {
      if (_rtcServiceInstance) {
        logger.warn('RTC服务已经初始化,无需重复初始化')
        return
      }

      try {
        logger.info('初始化RTC服务...')
        this.agoraAppId = agoraAppId

        const service = new RtcService({
          appId: agoraAppId,
          client: agoraClient,
          onAudioEnabledChange: (enabled) => this.setAudioEnabled(enabled),
          onVideoEnabledChange: (enabled) => this.setVideoEnabled(enabled),
          onLocalStreamChange: (stream) => this.setLocalStream(stream),
          onUserLeft: async (user, reason) => {
            logger.info('[rtcChannelStore] RTC 用户离开:', user.uid, reason)
            let userId: string = user.uid.toString()
            const chatClient = useChatClientStore().getChatClient
            if (chatClient && typeof chatClient.getUserIdByRTCUIds === 'function') {
              try {
                const res = await (chatClient as any).getUserIdByRTCUIds([user.uid])
                userId = res?.data?.[user.uid] || userId
              } catch (e) {
                logger.debug('[rtcChannelStore] 获取 userId 映射失败，使用 uid', e)
              }
            }
            _onUserLeftHandler?.(userId)
          },
        })
        await service.initialize()
        _rtcServiceInstance = service
        logger.info('RTC服务初始化成功')
      } catch (error) {
        logger.error('RTC服务初始化失败:', error)
        throw error
      }
    },

    /**
     * 销毁RTC服务
     */
    async destroyRtcService() {
      if (_rtcServiceInstance) {
        logger.info('销毁RTC服务...')
        await _rtcServiceInstance.destroy()
        _rtcServiceInstance = null
        this.agoraAppId = null
      }
    },

    /**
     * 设置连接状态
     */
    setConnected(connected: boolean) {
      this.isConnected = connected
    },

    /**
     * 设置本地媒体流
     */
    setLocalStream(stream: MediaStream | null) {
      this.localStream = stream
    },

    /**
     * 启用/禁用音频
     */
    setAudioEnabled(enabled: boolean) {
      this.audioEnabled = enabled
    },

    /**
     * 启用/禁用视频
     */
    setVideoEnabled(enabled: boolean) {
      this.videoEnabled = enabled
    },

    /**
     * 注册 onUserLeft 回调（用于 RTC 兜底挂断：当 1v1 通话中对方离开 RTC 频道时触发）
     */
    setOnUserLeftHandler(handler: ((userId: string) => void) | null) {
      _onUserLeftHandler = handler
    },

    /**
     * 重置所有RTC状态
     */
    reset() {
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          track.stop()
          logger.debug('本地轨道已停止:', track.kind)
        })
      }

      this.isConnected = false
      this.localStream = null
      this.audioEnabled = true
      this.videoEnabled = true
    }
  }
})