import { defineStore } from 'pinia'

/** userInfoMap 上限：超出时按插入顺序淘汰最旧（Map 迭代序即插入序） */
const USER_INFO_MAP_LIMIT = 500

/**
 * GlobalCallStore
 * 跨通话域的共享状态：用户资料映射、窗口模式等
 * 单聊/群聊共用，但不属于任何特定通话域
 */
export const useGlobalCallStore = defineStore('globalCall', {
  state: () => ({
    userInfoMap: new Map<string, { nickname?: string; avatarURL?: string }>(),
    isMinimized: false,
  }),

  actions: {
    setUserInfo(
      userId: string,
      userInfo: { nickname?: string; avatarURL?: string }
    ) {
      if (!this.userInfoMap.has(userId) && this.userInfoMap.size >= USER_INFO_MAP_LIMIT) {
        const oldest = this.userInfoMap.keys().next().value
        if (oldest !== undefined) {
          this.userInfoMap.delete(oldest)
        }
      }
      this.userInfoMap.set(userId, userInfo)
    },

    /**
     * 批量设置用户信息
     */
    batchSetUserInfo(
      entries: Array<{
        userId: string
        userInfo: { nickname?: string; avatarURL?: string }
      }>
    ) {
      for (const { userId, userInfo } of entries) {
        this.setUserInfo(userId, userInfo)
      }
    },

    setMinimized(value: boolean) {
      this.isMinimized = value
    },
  },

  getters: {
    getUserInfo(): (userId: string) => {
      nickname?: string
      avatarURL?: string
    } {
      return (userId: string) => {
        return this.userInfoMap.get(userId) || {}
      }
    },

    getIsMinimized(): boolean {
      return this.isMinimized || false
    },
  },
})
