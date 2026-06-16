<template>
  <!-- 主视频模式 -->
  <MainVideoLayout
    v-if="selectedId && participants.length > 1"
    :participants="participants"
    :selected-id="selectedId"
    @select="handleSelect"
    @exit="handleExit"
  />

  <!-- 网格模式 -->
  <div v-else class="gcall-grid" :style="gridStyle">
    <div
      v-for="p in participants"
      :key="p.userId"
      class="gcall-grid-cell"
    >
      <ParticipantTile :participant="p" @click="handleTileClick" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue'
import ParticipantTile from './ParticipantTile.vue'
import MainVideoLayout from './MainVideoLayout.vue'
import type { Participant } from '../types'

const props = defineProps({
  participants: { type: Array as PropType<Participant[]>, default: () => [] },
  selectedId: { type: String as PropType<string | null>, default: null }
})
const emit = defineEmits<{
  select: [userId: string | null]
}>()

const gridStyle = computed(() => {
  const count = props.participants.length
  if (count <= 1) {
    return {
      gridTemplateColumns: '1fr',
      gridTemplateRows: '1fr',
    }
  }
  if (count === 2) {
    return {
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr',
    }
  }
  if (count <= 4) {
    return {
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
    }
  }
  if (count <= 6) {
    return {
      gridTemplateColumns: '1fr 1fr 1fr',
      gridTemplateRows: '1fr 1fr',
    }
  }
  if (count <= 9) {
    return {
      gridTemplateColumns: '1fr 1fr 1fr',
      gridTemplateRows: '1fr 1fr 1fr',
    }
  }
  // 超过 9 人后动态计算行列，保证 16/25/36... 人均可显示
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  return {
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
  }
})

function handleTileClick(userId: string) {
  // 只有多人时才支持选中
  if (props.participants.length > 1) {
    emit('select', userId)
  }
}

function handleSelect(userId: string) {
  emit('select', userId)
}

function handleExit() {
  emit('select', null as any)
}
</script>

<style scoped src="./VideoGrid.css"></style>
