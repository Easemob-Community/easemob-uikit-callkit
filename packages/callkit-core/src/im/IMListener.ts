import type { EasemobConnection } from '../core/CallKitCore.types'
import type { Logger } from '../utils/logger'
import { getLogger } from '../utils/logger'

export interface IMListenerCallbacks {
  onTextMessage?: (msg: any) => void | Promise<void>
  onCmdMessage?: (msg: any) => void | Promise<void>
  onConnected?: () => void
  onDisconnected?: () => void
}

/**
 * IMListener
 * 环信 IM SDK 消息监听器薄壳。
 *
 * 职责：
 * 1. 挂载 onTextMessage / onCmdMessage 监听
 * 2. 收到后通过回调交给 CallKitCore 处理（不处理任何业务逻辑）
 */
export class IMListener {
  private imClient: EasemobConnection
  private callbacks: IMListenerCallbacks
  private logger: Logger
  private mounted = false
  private handlerId = 'callkit-core-listener'

  constructor(
    imClient: EasemobConnection,
    callbacks: IMListenerCallbacks,
    logger?: Logger
  ) {
    this.imClient = imClient
    this.callbacks = callbacks
    this.logger = logger || getLogger()
  }

  mount(): void {
    if (this.mounted) return
    this.mounted = true

    this.imClient.addEventHandler(this.handlerId, {
      onTextMessage: async (msg: any) => {
        this.logger.debug('[IMListener] onTextMessage', { from: msg.from, id: msg.id })
        await this.callbacks.onTextMessage?.(msg)
      },
      onCmdMessage: async (msg: any) => {
        this.logger.debug('[IMListener] onCmdMessage', { from: msg.from, action: msg.action })
        await this.callbacks.onCmdMessage?.(msg)
      },
      onConnected: () => {
        this.logger.info('[IMListener] IM 已连接')
        this.callbacks.onConnected?.()
      },
      onDisconnected: () => {
        this.logger.warn('[IMListener] IM 已断开')
        this.callbacks.onDisconnected?.()
      },
    })

    this.logger.warn('🔵 [IMListener] CORE 链路 IM 监听已挂载 | handlerId:', this.handlerId)
  }

  unmount(): void {
    if (!this.mounted) return
    this.mounted = false
    this.imClient.removeEventHandler(this.handlerId)
    this.logger.info('[IMListener] 监听已卸载')
  }

  /**
   * 更新底层 IM 客户端实例（用于账号切换等场景）
   */
  updateImClient(imClient: EasemobConnection): void {
    const wasMounted = this.mounted
    if (wasMounted) {
      this.unmount()
    }
    this.imClient = imClient
    if (wasMounted) {
      this.mount()
    }
    this.logger.info('[IMListener] IM 客户端实例已更新')
  }
}
