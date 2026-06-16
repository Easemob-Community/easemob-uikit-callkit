<template>
  <div class="gcall-tile" @click="handleClick">
    <!-- 视频层 -->
    <video
      v-if="showVideo"
      ref="videoEl"
      class="gcall-tile-video"
      :class="{ mirror: participant.isLocal }"
      autoplay
      playsinline
      :muted="participant.isLocal"
    />

    <!-- 占位层 -->
    <div v-else class="gcall-tile-placeholder">
      <img
        v-if="participant.avatarUrl"
        :src="participant.avatarUrl"
        class="gcall-tile-avatar"
        alt="avatar"
      />
      <div
        v-else
        class="gcall-tile-avatar-fallback"
        :style="{ background: avatarGradient }"
      >
        {{ nicknameFirstChar }}
      </div>
      <div v-if="participant.state === 'invited'" class="gcall-tile-loading">
        <div class="gcall-spinner" />
        <span>邀请中...</span>
      </div>
      <div v-else-if="participant.state === 'joinedRtc'" class="gcall-tile-hint">
        已接通，等待画面...
      </div>
    </div>

    <!-- Hover 放大提示 -->
    <div class="gcall-tile-hover-icon">
      <CallKitIcon name="chevron-4-all-around" :width="14" :height="14" color="#fff" />
    </div>

    <!-- 信息条 -->
    <div class="gcall-tile-info">
      <span class="gcall-tile-name">{{ participant.nickname }}</span>
      <span v-if="participant.isMuted" class="gcall-tile-mic">
        <CallKitIcon name="mic-slash" :width="14" :height="14" />
      </span>
      <span v-else-if="participant.isSpeaking" class="gcall-tile-speaking">
        <CallKitIcon name="speaker-wave-2" :width="14" :height="14" />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted, nextTick } from 'vue'
import CallKitIcon from './CallKitIcon.vue'
import type { Participant } from '../types'
import { logger } from '../../../utils/logger'

interface ParticipantTileProps {
  participant: Participant
}

const props = defineProps<ParticipantTileProps>()
const emit = defineEmits<{
  click: [userId: string]
}>()

const videoEl = ref<HTMLVideoElement | null>(null)

const showVideo = computed(() => {
  if (!props.participant.isCameraOn) return false
  if (props.participant.isLocal) {
    return !!props.participant.localStream
  }
  return props.participant.state === 'publishing' && !!props.participant.videoTrack
})

const nicknameFirstChar = computed(() => {
  return props.participant.nickname?.charAt(0)?.toUpperCase() || '?'
})

// 根据 userId hash 生成渐变色
const avatarGradient = computed(() => {
  const hash = props.participant.userId.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc)
  }, 0)
  const h1 = Math.abs(hash % 360)
  const h2 = (h1 + 40) % 360
  return `linear-gradient(135deg, hsl(${h1}, 60%, 45%) 0%, hsl(${h2}, 60%, 35%) 100%)`
})

function enforceVideoSize(el: HTMLVideoElement) {
  el.style.width = '100%'
  el.style.height = '100%'
  el.style.objectFit = 'cover'
  el.style.maxWidth = '100%'
  el.style.maxHeight = '100%'
}

// 安全播放：先 stop，等 Vue DOM 更新完成 + 浏览器重排后再 play，避免 Agora 状态残留或读到 0 尺寸导致黑屏
function safePlayTrack(track: any, el: HTMLElement) {
  if (!track || !el) return
  try {
    track.stop()
  } catch (e) {
    // 忽略 stop 失败（可能之前未播放）
  }
  nextTick(() => {
    requestAnimationFrame(() => {
      try {
        track.play(el)
      } catch (e) {
        logger.warn('[ParticipantTile] track.play 失败', e)
      }
    })
  })
}

// 当 track、stream 或 video 元素本身变化时，执行 play
watch(
  [() => props.participant.videoTrack, () => props.participant.localStream, videoEl],
  (newVals, oldVals) => {
    const el = videoEl.value
    if (!el) return

    const [, , oldEl] = oldVals || [undefined, undefined, undefined]
    const domChanged = oldEl !== el

    if (props.participant.isLocal) {
      // 优先使用 Agora track.play() 方式（兼容性更好）
      const track = props.participant.videoTrack
      if (track) {
        if (domChanged) {
          safePlayTrack(track, el)
        } else {
          // DOM 没变只补约束尺寸
          try { track.play(el) } catch (e) {}
        }
        enforceVideoSize(el)
        return
      }
      // 兜底：使用标准 MediaStream 方式
      if (props.participant.localStream) {
        if (el.srcObject !== props.participant.localStream) {
          el.srcObject = props.participant.localStream
          el.play().catch((err) => logger.warn('本地视频播放失败', err))
        }
        enforceVideoSize(el)
        return
      }
    }

    const track = props.participant.videoTrack
    if (track) {
      if (domChanged) {
        safePlayTrack(track, el)
      } else {
        try { track.play(el) } catch (e) {}
      }
      // Agora play() 是异步设置尺寸的，需要多轮强制覆盖
      enforceVideoSize(el)
      requestAnimationFrame(() => enforceVideoSize(el))
      setTimeout(() => enforceVideoSize(el), 50)
      setTimeout(() => enforceVideoSize(el), 300)
    } else {
      el.srcObject = null
    }
  },
  { immediate: true }
)

function handleClick() {
  emit('click', props.participant.userId)
}

onUnmounted(() => {
  const el = videoEl.value
  if (el) {
    el.srcObject = null
  }
  // 组件卸载时停止 Agora track 播放，避免状态残留
  const track = props.participant.videoTrack
  if (track) {
    try {
      track.stop()
    } catch (e) {
      // ignore
    }
  }
})
</script>

<style scoped src="./ParticipantTile.css"></style>
