<template>
  <div
    v-if="isVisible"
    ref="elementRef"
    class="easemob-mini-window"
    :class="{ 'is-dragging': isDragging }"
    :style="windowStyle"
    @mousedown="startDrag"
    @click="handleWindowClick"
  >
    <!-- 音频模式 或 群组通话 - 只显示通话时长 -->
    <div v-if="shouldShowDurationOnly" class="mini-window-audio">
      <div class="audio-icon">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M8 8.90816C8 9.63672 8.16477 10.3145 8.4943 10.9414C8.83953 11.5683 9.30245 12.0681 9.88305 12.4409C10.4637 12.8136 11.0992 13 11.7896 13C12.4801 13 13.1156 12.8136 13.6962 12.4409C14.2768 12.0681 14.7319 11.5683 15.0615 10.9414C15.4067 10.3145 15.5793 9.63672 15.5793 8.90816V7.09184C15.5793 6.34633 15.4067 5.66012 15.0615 5.03321C14.7319 4.40631 14.2768 3.91495 13.6962 3.55913C13.1156 3.18638 12.4801 3 11.7896 3C11.0992 3 10.4637 3.18638 9.88305 3.55913C9.30245 3.91495 8.83953 4.40631 8.4943 5.03321C8.16477 5.66012 8 6.34633 8 7.09184V8.90816ZM12 14C13.4313 14 14.7194 14.1986 15.8644 14.5957C16.8286 14.9267 17.6648 15.3901 18.3729 15.9858C18.9605 16.4657 19.4124 16.987 19.7288 17.5496C19.9096 17.8972 20 18.3522 20 18.9149C20 19.4775 19.8117 19.9657 19.435 20.3794C19.0734 20.7931 18.629 21 18.1017 21H5.89831C5.371 21 4.91902 20.7931 4.54237 20.3794C4.18079 19.9657 4 19.4775 4 18.9149C4 18.3522 4.0904 17.8972 4.27119 17.5496C4.58757 16.987 5.03955 16.4657 5.62712 15.9858C6.33522 15.3901 7.17137 14.9267 8.13559 14.5957C9.2806 14.1986 10.5687 14 12 14Z" />
        </svg>
      </div>
      <div class="duration-info">
        <div class="duration-text">{{ callDuration }}</div>
        <div class="status-text">{{ statusText }}</div>
      </div>
    </div>

    <!-- 一对一视频模式 - 显示远程视频流 -->
    <div v-else class="mini-window-video">
      <div ref="miniRemoteVideo" class="mini-video"></div>
      <div v-if="!hasRemoteVideo" class="video-placeholder">
        <svg class="user-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M8 8.90816C8 9.63672 8.16477 10.3145 8.4943 10.9414C8.83953 11.5683 9.30245 12.0681 9.88305 12.4409C10.4637 12.8136 11.0992 13 11.7896 13C12.4801 13 13.1156 12.8136 13.6962 12.4409C14.2768 12.0681 14.7319 11.5683 15.0615 10.9414C15.4067 10.3145 15.5793 9.63672 15.5793 8.90816V7.09184C15.5793 6.34633 15.4067 5.66012 15.0615 5.03321C14.7319 4.40631 14.2768 3.91495 13.6962 3.55913C13.1156 3.18638 12.4801 3 11.7896 3C11.0992 3 10.4637 3.18638 9.88305 3.55913C9.30245 3.91495 8.83953 4.40631 8.4943 5.03321C8.16477 5.66012 8 6.34633 8 7.09184V8.90816ZM12 14C13.4313 14 14.7194 14.1986 15.8644 14.5957C16.8286 14.9267 17.6648 15.3901 18.3729 15.9858C18.9605 16.4657 19.4124 16.987 19.7288 17.5496C19.9096 17.8972 20 18.3522 20 18.9149C20 19.4775 19.8117 19.9657 19.435 20.3794C19.0734 20.7931 18.629 21 18.1017 21H5.89831C5.371 21 4.91902 20.7931 4.54237 20.3794C4.18079 19.9657 4 19.4775 4 18.9149C4 18.3522 4.0904 17.8972 4.27119 17.5496C4.58757 16.987 5.03955 16.4657 5.62712 15.9858C6.33522 15.3901 7.17137 14.9267 8.13559 14.5957C9.2806 14.1986 10.5687 14 12 14Z" />
        </svg>
      </div>
      <div class="mini-duration">{{ callDuration }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, type CSSProperties } from 'vue'
import { useCallKitRtc } from '../composables/useCallKitRtc'
import { useCallTimerStore } from '../store/callTimer'
import { useGlobalCallStore } from '../store/globalCall'
import { useCallKitCore } from '../composables/useCallKitCore'
import { useCornerDraggable } from '../composables/useDraggable'
import { CALL_TYPE } from '../types/callstate.types'
import { logger } from '../utils/logger'

const emit = defineEmits<{
  expand: []
  close: []
}>()

const { callState: coreCallState } = useCallKitCore()
const rtc = useCallKitRtc()
const callTimerStore = useCallTimerStore()
const globalCallStore = useGlobalCallStore()

// 小窗口引用
const miniRemoteVideo = ref<HTMLVideoElement>()

// 窗口尺寸
const AUDIO_WIDTH = 200
const AUDIO_HEIGHT = 80
const VIDEO_WIDTH = 180
const VIDEO_HEIGHT = 240

// 是否显示小窗口
const isVisible = computed(() => globalCallStore.isMinimized)

// 通话类型
const callType = computed(() => coreCallState.type)

// 判断是否只显示时长（音频模式或群组通话）
const shouldShowDurationOnly = computed(() => {
  return callType.value === CALL_TYPE.AUDIO_1V1 || 
         callType.value === CALL_TYPE.AUDIO_MULTI || 
         callType.value === CALL_TYPE.VIDEO_MULTI
})

// 当前窗口尺寸
const currentWidth = computed(() => 
  shouldShowDurationOnly.value ? AUDIO_WIDTH : VIDEO_WIDTH
)
const currentHeight = computed(() => 
  shouldShowDurationOnly.value ? AUDIO_HEIGHT : VIDEO_HEIGHT
)

// 使用角落定位的拖拽 Hook（默认右上角）
const {
  elementRef,
  isDragging,
  hasDragged,
  style: draggableStyle,
  startDrag
} = useCornerDraggable(
  'top-right',
  currentWidth.value,
  currentHeight.value,
  20,
  {
    boundary: true,
    boundaryPadding: 10
  }
)

// 组合样式
const windowStyle = computed<CSSProperties>(() => {
  return {
    ...(draggableStyle.value as CSSProperties),
    width: `${currentWidth.value}px`,
    height: `${currentHeight.value}px`,
    zIndex: 9999,
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: isDragging.value 
      ? '0 12px 48px rgba(0, 0, 0, 0.6)' 
      : '0 8px 32px rgba(0, 0, 0, 0.4)'
  }
})

// 通话时长（从 store 获取格式化后的字符串）
const callDuration = computed(() => callTimerStore.formattedCallDuration)

// 状态文本
const statusText = computed(() => {
  if (callType.value === CALL_TYPE.AUDIO_MULTI || callType.value === CALL_TYPE.VIDEO_MULTI) {
    return '群组通话中'
  }
  return '通话中'
})

// 远程视频状态
const hasRemoteVideo = ref(false)
const retryCount = ref(0) // 重试计数
const MAX_RETRY = 5 // 最大重试次数

// 点击窗口展开（仅在未拖拽时生效）
const handleWindowClick = () => {
  // 只有点击且没有拖拽时才展开
  if (!hasDragged.value) {
    emit('expand')
  }
}

// 播放远程视频
const playRemoteVideo = () => {
  const rtcService = rtc.getRtcService()
  if (!rtcService || !miniRemoteVideo.value) {
    logger.warn('小窗口播放远程视频失败：rtcService或video元素不存在')
    return
  }

  const client = rtcService.getClient()
  if (!client || !client.remoteUsers || client.remoteUsers.length === 0) {
    // 如果没有远程用户，可能是还没加入或者已经离开
    logger.warn('小窗口播放远程视频失败：未找到远程用户')
    return
  }

  // 1v1 视频通话，获取第一个远程用户
  const remoteUser = client.remoteUsers[0]
  if (!remoteUser) return

  // 获取该用户的远程视频轨道
  const remoteVideoTrack = remoteUser.videoTrack || rtcService.getRemoteVideoTrack(remoteUser.uid)
  if (remoteVideoTrack) {
    try {
      remoteVideoTrack.play(miniRemoteVideo.value)
      hasRemoteVideo.value = true
      retryCount.value = 0
      logger.info('小窗口远程视频开始播放', { uid: remoteUser.uid })
    } catch (error) {
      logger.error('小窗口播放远程视频异常', error)
    }
  } else {
    // 重试逻辑
    if (retryCount.value < MAX_RETRY) {
      retryCount.value++
      logger.warn(`小窗口未找到远程视频轨道，准备重试 ${retryCount.value}/${MAX_RETRY}`)
      setTimeout(() => {
        playRemoteVideo()
      }, 1000)
    } else {
      logger.error('小窗口达到最大重试次数，仍未找到远程视频轨道')
    }
  }
}

onMounted(() => {
  // 如果是视频通话，延迟后尝试播放远程视频
  if (!shouldShowDurationOnly.value) {
    // 重置重试计数
    retryCount.value = 0
    // 延迟确保DOM已渲染
    setTimeout(() => {
      playRemoteVideo()
    }, 200)
    
    // 监听RTC事件
    const rtcService = rtc.getRtcService()
    if (rtcService) {
      const client = rtcService.getClient()
      if (client) {
        client.on('user-published', async (_user: any, mediaType: any) => {
          if (mediaType === 'video') {
            logger.info('小窗口收到远程视频发布事件')
            retryCount.value = 0 // 重置重试计数
            setTimeout(() => {
              playRemoteVideo()
            }, 200)
          }
        })
        
        client.on('user-unpublished', (_user: any, mediaType: any) => {
          if (mediaType === 'video') {
            hasRemoteVideo.value = false
            logger.info('小窗口远程视频取消发布')
          }
        })
      }
    }
  }
})

// 组件隐藏时停止视频播放，释放视频轨道
watch(isVisible, (visible) => {
  if (!visible && miniRemoteVideo.value) {
    // 小窗隐藏时，停止所有正在播放的远程视频轨道
    const rtcService = rtc.getRtcService()
    if (rtcService) {
      const client = rtcService.getClient()
      if (client && client.remoteUsers) {
        client.remoteUsers.forEach((remoteUser: any) => {
          const remoteVideoTrack = remoteUser.videoTrack || rtcService.getRemoteVideoTrack(remoteUser.uid)
          if (remoteVideoTrack) {
            remoteVideoTrack.stop()
            logger.info('小窗隐藏，停止远程视频轨道播放', { uid: remoteUser.uid })
          }
        })
      }
    }
    
    // 清空video元素
    if (miniRemoteVideo.value.srcObject) {
      miniRemoteVideo.value.srcObject = null
    }
    hasRemoteVideo.value = false
  }
})

onUnmounted(() => {
  // 组件销毁时停止所有视频轨道
  if (miniRemoteVideo.value) {
    const rtcService = rtc.getRtcService()
    if (rtcService) {
      const client = rtcService.getClient()
      if (client && client.remoteUsers) {
        client.remoteUsers.forEach((remoteUser: any) => {
          const remoteVideoTrack = remoteUser.videoTrack || rtcService.getRemoteVideoTrack(remoteUser.uid)
          if (remoteVideoTrack) {
            remoteVideoTrack.stop()
          }
        })
      }
    }
  }
})
</script>

<style scoped>
.easemob-mini-window {
  position: fixed;
  transition: box-shadow 0.3s;
  user-select: none;
}

.easemob-mini-window:hover {
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
}

/* 音频模式样式 */
.mini-window-audio {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 12px;
}

.audio-icon {
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.audio-icon svg {
  width: 24px;
  height: 24px;
  color: white;
}

.duration-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.duration-text {
  font-size: 16px;
  font-weight: 600;
  color: white;
  font-variant-numeric: tabular-nums;
}

.status-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 视频模式样式 */
.mini-window-video {
  width: 100%;
  height: 100%;
  background: #1a1a2e;
  position: relative;
}

.mini-video {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.mini-video video,
.mini-video canvas {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 100% !important;
  object-fit: cover;
}

.video-placeholder {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 60px;
  height: 60px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-icon {
  width: 32px;
  height: 32px;
  color: rgba(255, 255, 255, 0.6);
}

.mini-duration {
  position: absolute;
  bottom: 8px;
  left: 8px;
  right: 8px;
  text-align: center;
  color: white;
  background: rgba(0, 0, 0, 0.6);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
