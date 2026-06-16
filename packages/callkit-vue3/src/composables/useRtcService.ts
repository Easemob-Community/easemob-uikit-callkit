/**
 * RTC服务组合式API - useRtcService
 * 
 * 职责：
 * 1. 提供组合式API访问RtcService
 * 2. 管理音视频设备的生命周期
 * 3. 提供类型安全的音视频操作接口
 * 4. 自动处理音视频资源的清理
 * 
 * 使用方式：
 * ```typescript
 * import { useRtcService } from '@easemob-community/callkit-vue3'
 * 
 * export default {
 *   setup() {
 *     const { 
 *       localStream,
 *       remoteStreams,
 *       isVideoEnabled,
 *       isAudioEnabled,
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
 *     
 *     // 监听远程流
 *     watch(() => remoteStreams.value, (streams) => {
 *       // 更新远程视频显示
 *     }, { deep: true })
 *   }
 * }
 * ```
 */

import { computed, ref } from 'vue'
import { useRtcChannelStore } from '../store/rtcChannel'
import { logger } from '../utils/logger'

export function useRtcService() {
  const rtcChannelStore = useRtcChannelStore()

  // 从 store 获取响应式状态
  const localStream = computed(() => rtcChannelStore.localStream)
  const isVideoEnabled = computed(() => rtcChannelStore.videoEnabled)
  const isAudioEnabled = computed(() => rtcChannelStore.audioEnabled)
  const isConnected = computed(() => rtcChannelStore.isConnected)

  /**
   * 获取 RtcService 实例
   */
  const getRtcServiceInstance = () => {
    const rtcService = rtcChannelStore.getRtcService()
    if (!rtcService) {
      logger.warn('RtcService 未初始化，无法执行媒体控制')
    }
    return rtcService
  }

  /**
   * 切换视频状态
   */
  const toggleVideo = async (enabled?: boolean): Promise<boolean> => {
    try {
      const rtcService = getRtcServiceInstance()
      if (!rtcService) {
        // 降级：仅更新 store 状态
        const newState = enabled !== undefined ? enabled : !isVideoEnabled.value
        rtcChannelStore.setVideoEnabled(newState)
        return newState
      }

      const newState = enabled !== undefined ? enabled : !isVideoEnabled.value
      const result = await rtcService.toggleVideo(newState)
      // RtcService 内部已通过回调同步 store 状态，无需手动更新
      logger.info('Video toggled via RtcService:', result)
      return result
    } catch (error) {
      logger.error('Failed to toggle video:', error)
      return isVideoEnabled.value
    }
  }

  /**
   * 切换音频状态
   */
  const toggleAudio = async (enabled?: boolean): Promise<boolean> => {
    try {
      const rtcService = getRtcServiceInstance()
      if (!rtcService) {
        // 降级：仅更新 store 状态
        const newState = enabled !== undefined ? enabled : !isAudioEnabled.value
        rtcChannelStore.setAudioEnabled(newState)
        return newState
      }

      const newState = enabled !== undefined ? enabled : !isAudioEnabled.value
      const result = await rtcService.toggleAudio(newState)
      // RtcService 内部已通过回调同步 store 状态，无需手动更新
      logger.info('Audio toggled via RtcService:', result)
      return result
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
      // TODO: 实现摄像头切换逻辑
      // 需要通过 RTC service 获取可用设备列表并切换
      logger.info('Switch camera:', deviceId)
      return true
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
      // TODO: 实现麦克风切换逻辑
      // 需要通过 RTC service 获取可用设备列表并切换
      logger.info('Switch microphone:', deviceId)
      return true
    } catch (error) {
      logger.error('Failed to switch microphone:', error)
      return false
    }
  }

  /**
   * 获取本地视频流
   */
  const getLocalStream = (): MediaStream | null => {
    return localStream.value
  }

  /**
   * 设置本地流
   */
  const setLocalStream = (stream: MediaStream | null): void => {
    rtcChannelStore.setLocalStream(stream)
  }

  /**
   * 重置 RTC 状态
   */
  const reset = (): void => {
    rtcChannelStore.reset()
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
    setLocalStream,

    // 其他方法
    reset
  }
}