import { defineStore } from "pinia";
import type { ChatClientState } from "./types";
import type { Chat } from "../core/sdk/imSDK";
import { logger } from "../utils/logger";

const STATUS_HANDLER_ID = 'callkit-chat-client-status'

export const useChatClientStore = defineStore("chatClient", {
  state: (): ChatClientState => ({
    client: null,
    isMiniCore: false,
    isConnected: false,
  }),
  actions: {
    setClient(client: Chat.Connection | null) {
      // 先解绑旧 client 的连接状态监听，避免内存泄漏和状态错乱
      this.unbindConnectionStatus()
      this.client = client;
      // 如果传入的 client 已经处于登录/连接状态，直接标记为已连接
      this.isConnected = this.checkClientConnected(client);
      // 绑定新 client 的连接状态监听
      this.bindConnectionStatus(client)
    },
    setIsMiniCore(value: boolean) {
      this.isMiniCore = value;
    },
    setConnected(value: boolean) {
      this.isConnected = value;
    },
    checkClientConnected(client: Chat.Connection | null): boolean {
      if (!client) return false;
      const c = client as any;
      // 优先使用官方连接状态方法/属性
      if (typeof c.status === 'object' && 'isOpened' in c.status) {
        return !!c.status.isOpened;
      }
      if (typeof c.isOpened === 'boolean') {
        return c.isOpened;
      }
      // 兜底：通过 deviceId 判断
      return !!c.context?.jid?.clientResource;
    },
    bindConnectionStatus(client: Chat.Connection | null) {
      if (!client) return
      const c = client as any
      if (typeof c.addEventHandler !== 'function') {
        logger.debug('[chatClientStore] client 不支持 addEventHandler，跳过状态监听绑定')
        return
      }
      c.addEventHandler(STATUS_HANDLER_ID, {
        onConnected: () => {
          logger.info('[chatClientStore] IM 已连接')
          this.isConnected = true
        },
        onDisconnected: () => {
          logger.info('[chatClientStore] IM 已断开')
          this.isConnected = false
        },
        onLogout: () => {
          logger.info('[chatClientStore] IM 已登出')
          this.isConnected = false
        },
      })
      logger.debug('[chatClientStore] IM 连接状态监听已绑定')
    },
    unbindConnectionStatus() {
      const client = this.client
      if (!client) return
      const c = client as any
      if (typeof c.removeEventHandler !== 'function') return
      try {
        c.removeEventHandler(STATUS_HANDLER_ID)
        logger.debug('[chatClientStore] IM 连接状态监听已解绑')
      } catch (err) {
        logger.debug('[chatClientStore] 移除 IM 状态监听失败', err)
      }
    },
  },
  getters: {
    getChatClient: (state) => state.client,
    getClientDeviceId: (state) => (state.client as any)?.context?.jid?.clientResource,
    getIsMiniCore: (state) => state.isMiniCore,
    getIsConnected: (state) => state.isConnected,
  },
});
