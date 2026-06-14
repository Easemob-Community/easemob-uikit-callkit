import type { EasemobConnection } from '../core/CallKitCore.types'
import type { SignalingExt } from '../types/signal.types'
import type { Logger } from '../utils/logger'
import { getLogger } from '../utils/logger'

/**
 * SignalSender
 * 信令发送器，封装环信 IM SDK 的消息发送。
 *
 * 由 useSignalManager 改造而来，从 Vue Composable 退化为普通类。
 */
export class SignalSender {
  private imClient: EasemobConnection
  private logger: Logger
  private createMessageFn?: (options: any) => any

  constructor(imClient: EasemobConnection, logger?: Logger, createMessageFn?: (options: any) => any) {
    this.imClient = imClient
    this.logger = logger || getLogger()
    this.createMessageFn = createMessageFn
  }

  /**
   * 发送 invite 文本消息
   */
  async sendInviteMessage(
    targetId: string | string[],
    chatType: 'singleChat' | 'groupChat',
    message: string,
    ext: SignalingExt | Record<string, any>,
    groupId?: string
  ): Promise<any> {
    const isGroupChat = Array.isArray(targetId)
    const to = isGroupChat ? groupId || '' : targetId
    const msgBody: any = {
      type: 'txt',
      to,
      msg: message,
      chatType: isGroupChat ? 'groupChat' : chatType,
      ext,
    }
    if (isGroupChat && Array.isArray(targetId)) {
      msgBody.receiverList = targetId
    }

    const msg = this.createMessage(msgBody)
    this.logger.debug?.('[SignalSender] sendInviteMessage msgBody', JSON.parse(JSON.stringify(msgBody)))
    this.logger.debug?.('[SignalSender] sendInviteMessage ext', {
      action: msgBody.ext?.action,
      callId: msgBody.ext?.callId,
      callerIMName: msgBody.ext?.callerIMName,
      calleeIMName: msgBody.ext?.calleeIMName,
      callerDevId: msgBody.ext?.callerDevId,
      channelName: msgBody.ext?.channelName,
      chatType: msgBody.ext?.chatType,
      type: msgBody.ext?.type,
      msgType: msgBody.ext?.msgType,
      invitedMembers: msgBody.ext?.invitedMembers,
      em_push_ext: msgBody.ext?.em_push_ext,
      em_apns_ext: msgBody.ext?.em_apns_ext,
      ease_chat_uikit_user_info: msgBody.ext?.ease_chat_uikit_user_info,
      callkitGroupInfo: msgBody.ext?.callkitGroupInfo,
    })
    const result = await this.imClient.send(msg)
    this.logger.signal?.('send', 'invite', { to, callId: ext.callId })
    return result
  }

  /**
   * 发送 CMD 信令消息
   */
  async sendCmdMessage(
    targetId: string,
    chatType: 'singleChat' | 'groupChat',
    ext: SignalingExt | Record<string, any>,
    options?: {
      deliverOnlineOnly?: boolean
      receiverList?: string[]
    }
  ): Promise<any> {
    const msgBody: any = {
      type: 'cmd',
      to: targetId,
      chatType,
      action: 'rtcCall',
      ext,
      deliverOnlineOnly: options?.deliverOnlineOnly || false,
    }
    if (options?.receiverList) {
      msgBody.receiverList = options.receiverList
    }

    const msg = this.createMessage(msgBody)
    const result = await this.imClient.send(msg)
    this.logger.signal?.('send', ext.action, { to: targetId, callId: ext.callId })
    return result
  }

  /**
   * 兼容 full 版与 miniCore 版的消息创建
   * full 版: ChatSDK.message.create(options)
   * miniCore 版: client.Message.create(options)
   */
  private createMessage(options: any): any {
    // 优先使用外部传入的工厂函数
    if (this.createMessageFn) {
      return this.createMessageFn(options)
    }

    const client = this.imClient as any
    // 优先 full 版本静态 API
    if (typeof client !== 'undefined' && client.message?.create) {
      return client.message.create(options)
    }
    // fallback miniCore 实例 API
    if (client?.Message?.create) {
      return client.Message.create(options)
    }
    throw new Error(
      '[SignalSender] 无法创建消息：当前环境缺少 message.create API。' +
        '请确认 easemob-websdk 已安装（full 版），或 miniCore 已注册消息插件。'
    )
  }
}
