import { defineStore } from 'pinia'

export interface CallTimerState {
  callDuration: number
  callStartTime: number
}

/**
 * CallTimerStore
 * 通话计时器状态（单聊域）
 * 职责：管理一对一通话的时长计时
 */
export const useCallTimerStore = defineStore('callTimer', {
  state: (): CallTimerState => ({
    callDuration: 0,
    callStartTime: 0,
  }),

  getters: {
    /**
     * 获取格式化的通话时长
     */
    formattedCallDuration(): string {
      const hours = Math.floor(this.callDuration / 3600)
      const minutes = Math.floor((this.callDuration % 3600) / 60)
      const seconds = this.callDuration % 60

      if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      }
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    },
  },

  actions: {
    /**
     * 重置计时器状态
     * 计时本身由 CallKitCore 的 durationTimer 驱动（callDurationUpdated 事件镜像），
     * 这里只负责清零，通话结束时不让下一场通话显示上一场终值
     */
    reset() {
      this.callStartTime = 0
      this.callDuration = 0
    },
  },
})
