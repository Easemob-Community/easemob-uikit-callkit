/**
 * RTC服务组合式API - useRtcService
 *
 * 职责：
 * 1. 提供组合式API访问RtcService
 * 2. 提供类型安全的音视频操作接口
 *
 * 阶段 4 改造说明：
 * 本组合式函数不再保存 RTC 媒体状态。所有响应式状态均来自单聊域（useCallKitCore）
 * 或 RtcService 实例的实时查询。群聊场景请直接使用 GroupCallStore / useGroupCallViewModel。
 *
 * 使用方式：
 * ```typescript
 * import { useRtcService } from '@easemob-community/callkit-vue3'
 *
 * export default {
 *   setup() {
 *     const {
 *       localStream,
 *       isVideoEnabled,
 *       isAudioEnabled,
 *       isConnected,
 *       toggleVideo,
 *       toggleAudio,
 *       switchCamera,
 *       switchMicrophone
 *     } = useRtcService()
 *
 *     // 控制视频开关
 *     const handleToggleVideo = async () => {
 *       await toggleVideo()
 *     }
 *
 *     // 监听本地流变化
 *     watch(() => localStream.value, (newStream) => {
 *       if (newStream) {
 *         // 显示本地视频
 *       }
 *     })
 *   }
 * }
 * ```
 */

import { computed } from 'vue'
import { useCallKitRtc } from '../composables/useCallKitRtc'
import { useCallKitCore } from '../composables/useCallKitCore'
import { CALL_STATUS } from '../types/callstate.types'
import { logger } from '../utils/logger'

export function useRtcService() {
  const rtc = useCallKitRtc()
  const {
    callState: coreCallState,
    localStream: coreLocalStream,
    toggleAudio: coreToggleAudio,
    toggleVideo: coreToggleVideo,
  } = useCallKitCore()

  // 从单聊域状态获取响应式状态（阶段 4：替代 useCallKitRtc 全局状态）
  const localStream = computed(() => coreLocalStream.value)
  const isVideoEnabled = computed(() => coreCallState.videoEnabled)
  const isAudioEnabled = computed(() => coreCallState.audioEnabled)
  const isConnected = computed(() => coreCallState.status === CALL_STATUS.IN_CALL)

  /**
   * 获取 RtcService 实例
   */
  const getRtcServiceInstance = () => {
    const rtcService = rtc.getRtcService()
    if (!rtcService) {
      logger.warn('RtcService 未初始化，无法执行媒体控制')
    }
    return rtcService
  }

  /**
   * 切换视频状态
   *
   * 单聊媒体开关的唯一事实源是 core 状态机（方案 A）：
   * 直调 rtcService.toggleVideo 会绕过状态机，造成"双写入者"死锁
   * （core 的 videoEnabled 停驻初始值并被 syncState 周期性刷回，开关空转）。
   * 此处统一代理到 useCallKitCore：core 状态机翻转 → RtcAdapter → RtcService，失败自动回滚。
   */
  const toggleVideo = async (enabled?: boolean): Promise<boolean> => {
    try {
      const target = enabled !== undefined ? enabled : !isVideoEnabled.value
      if (target !== isVideoEnabled.value) {
        coreToggleVideo()
      }
      logger.info('Video toggled via CallKitCore:', isVideoEnabled.value)
      return isVideoEnabled.value
    } catch (error) {
      logger.error('Failed to toggle video:', error)
      return isVideoEnabled.value
    }
  }

  /**
   * 切换音频状态（同 toggleVideo，统一走 core 状态机）
   */
  const toggleAudio = async (enabled?: boolean): Promise<boolean> => {
    try {
      const target = enabled !== undefined ? enabled : !isAudioEnabled.value
      if (target !== isAudioEnabled.value) {
        coreToggleAudio()
      }
      logger.info('Audio toggled via CallKitCore:', isAudioEnabled.value)
      return isAudioEnabled.value
    } catch (error) {
      logger.error('Failed to toggle audio:', error)
      return isAudioEnabled.value
    }
  }

  /**
   * 切换摄像头
   */
  const switchCamera = async (deviceId?: string): Promise<boolean> => {
    try {
      const rtcService = getRtcServiceInstance()
      if (!rtcService) {
        logger.warn('RtcService 未就绪，跳过摄像头切换')
        return false
      }
      if (!deviceId) {
        logger.warn('switchCamera 需要 deviceId')
        return false
      }
      return await rtcService.switchCamera(deviceId)
    } catch (error) {
      logger.error('Failed to switch camera:', error)
      return false
    }
  }

  /**
   * 切换麦克风
   */
  const switchMicrophone = async (deviceId?: string): Promise<boolean> => {
    try {
      const rtcService = getRtcServiceInstance()
      if (!rtcService) {
        logger.warn('RtcService 未就绪，跳过麦克风切换')
        return false
      }
      if (!deviceId) {
        logger.warn('switchMicrophone 需要 deviceId')
        return false
      }
      return await rtcService.switchMicrophone(deviceId)
    } catch (error) {
      logger.error('Failed to switch microphone:', error)
      return false
    }
  }

  /**
   * 获取本地视频流（实时查询）
   */
  const getLocalStream = (): MediaStream | null => {
    const rtcService = getRtcServiceInstance()
    if (!rtcService) return null
    return rtcService.getLocalVideoStream()
  }

  return {
    // 响应式状态
    localStream,
    isVideoEnabled,
    isAudioEnabled,
    isConnected,

    // 控制方法
    toggleVideo,
    toggleAudio,
    switchCamera,
    switchMicrophone,

    // 流管理方法
    getLocalStream,

    // RtcService 实例访问
    getRtcServiceInstance,
  }
}
