import { defineStore } from "pinia";
import type { ChatClientState } from "./types";
import type { Chat } from "../core/sdk/imSDK";
export const useChatClientStore = defineStore("chatClient", {
  state: (): ChatClientState => ({
    client: null,
    isMiniCore: false,
    isConnected: false,
  }),
  actions: {
    setClient(client: Chat.Connection) {
      this.client = client;
      // 如果传入的 client 已经处于登录/连接状态，直接标记为已连接
      this.isConnected = this.checkClientConnected(client);
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
  },
  getters: {
    getChatClient: (state) => state.client,
    getClientDeviceId: (state) => (state.client as any)?.context?.jid?.clientResource,
    getIsMiniCore: (state) => state.isMiniCore,
    getIsConnected: (state) => state.isConnected,
  },
});
