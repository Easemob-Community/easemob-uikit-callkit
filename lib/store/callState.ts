import { defineStore } from "pinia";
import type { CallState, INVITE_INFO } from "./types";
import { CALL_STATUS, CALL_TYPE } from "../types/callstate.types";
import type { Chat } from "../core/sdk/imSDK";
import { generateRandomChannel } from "../utils";
import { useSingleCallRtcStore } from "./singleCallRtc";
import { callKitEventBus } from "../core/events/CallKitEventBus";
import { buildBaseEventFields } from "../core/events/helpers";
import { logger } from "../utils/logger";
export const useCallStateStore = defineStore("callState", {
  /**
   * 通话状态数据
   */
  state: (): CallState => ({
    // 基础状态
    status: CALL_STATUS.IDLE,
    callType: null,
    callId: "",
    channel: "",
    token: "",
    type: CALL_TYPE.AUDIO_1V1,
    callerDevId: "",
    calleeDevId: "",
    callerUserId: "",
    calleeUserId: "",
    // 注：groupId / groupName / invitedMembers 等群聊字段已迁移至 GroupCallStore
    inviteMessageId: "",
    duration: "",
    // 超时设置
    inviteTimeout: 30000, // 默认30秒超时
    inviteTimeoutTimer: null,
  }),

  /**
   * 状态更新方法
   */
  actions: {
    //通过传入的chatClient，初始化部分state内容。
    initCallState(chatClient: Chat.Connection) {
      this.callerDevId = chatClient.context.jid.clientResource || "web";
      this.callerUserId = chatClient.context.userId;
      this.token = chatClient.token;
    },
    // 初始化邀请信息状态创建（单聊专用，群聊字段已迁移至 GroupCallStore）
    initInviteInfo(inviteInfo: INVITE_INFO) {
      const { type, calleeUserId } = inviteInfo;
      this.type = type;
      this.calleeUserId = calleeUserId;
      this.callId = generateRandomChannel(10);
      this.channel = generateRandomChannel(8);
      this.status = CALL_STATUS.INVITING;

      // 关联日志 sessionId（使用 callId 作为会话标识）
      logger.setSessionId(this.callId);
      logger.stateChange(CALL_STATUS.IDLE, CALL_STATUS.INVITING, {
        callId: this.callId,
        channel: this.channel,
        type: this.type,
        calleeUserId,
      });

      // 开始超时计时
      this.startTimeoutTimer();
    },
    // 注：updateInvitedMembers 已废弃，群聊成员管理请使用 GroupCallStore
    /**
     * 开始超时计时
     * 支持传入callback，超时后执行callback
     */
    startTimeoutTimer(callback?: () => void) {
      // 先清除已有的定时器，避免重复计时
      this.clearTimeoutTimer();

      // 设置新的超时定时器
      if (this.inviteTimeout) {
        this.inviteTimeoutTimer = setTimeout(() => {
          this.handleTimeout();
          callback?.();
        }, this.inviteTimeout) as unknown as number;
      }
    },

    /**
     * 清除超时计时器
     */
    clearTimeoutTimer() {
      if (this.inviteTimeoutTimer) {
        clearTimeout(this.inviteTimeoutTimer);
        this.inviteTimeoutTimer = null;
      }
    },

    /**
     * 处理超时逻辑
     */
    handleTimeout() {
      logger.warn("通话邀请超时");
      logger.event('callTimeout', {
        callId: this.callId,
        channel: this.channel,
        type: this.type,
      });

      const callState = this.getCallState;
      callKitEventBus.emit("callTimeout", {
        ...buildBaseEventFields(
          {
            callId: callState.callId,
            channel: callState.channel,
            type: callState.type,
            callerUserId: callState.callerUserId,
            calleeUserId: callState.calleeUserId,
            groupId: undefined,
          },
          true
        ),
      });

      // 单人通话场景下，设置状态为IDLE，自动隐藏界面
      this.setCallStatus(CALL_STATUS.IDLE);
    },
    /**
     * 更新部分通话状态
     */
    updateCallState(partialState: Partial<CallState>) {
      Object.assign(this, partialState);
    },

    /**
     * 设置通话状态
     */
    setCallStatus(status: CALL_STATUS) {
      const oldStatus = this.status;
      if (oldStatus === status) return;

      this.status = status;
      logger.stateChange(oldStatus, status, {
        callId: this.callId,
        channel: this.channel,
        type: this.type,
      });

      // 触发状态变化事件
      const callState = this.getCallState;
      callKitEventBus.emit("statusChanged", {
        ...buildBaseEventFields(
          {
            callId: callState.callId,
            channel: callState.channel,
            type: callState.type,
            callerUserId: callState.callerUserId,
            calleeUserId: callState.calleeUserId,
            groupId: undefined,
          },
          true
        ),
        from: oldStatus,
        to: status,
      });

      // 🔑 关键逻辑：当从IDLE状态转换为其他状态时，清空leftUsers（新通话开始）
      if (oldStatus === CALL_STATUS.IDLE && status !== CALL_STATUS.IDLE) {
        const singleCallRtcStore = useSingleCallRtcStore();
        singleCallRtcStore.clearLeftUsers();
      }
    },

    /**
     * 重置所有通话状态
     */
    resetCallState() {
      // 清除超时计时器
      this.clearTimeoutTimer();

      logger.stateChange(this.status, CALL_STATUS.IDLE, {
        trigger: 'resetCallState',
        callId: this.callId,
        channel: this.channel,
      });

      this.status = CALL_STATUS.IDLE;
      this.callType = null;
      // 重置其他状态字段
      this.callId = "";
      this.channel = "";
      this.calleeUserId = "";
      this.calleeDevId = "";
      // 修复：不再跨通话保留主叫身份。作为“被叫”时 callerUserId/callerDevId 会被对端身份覆盖，
      // 若在此保留，会在下一次“角色互换”的呼叫中把对方身份当成自己发出，导致二次通话失败。
      // 主叫身份改为在每次发起呼叫时由 useCallKit.call/groupCall 调用 initCallState 从 chatClient 重新写入。
      this.callerUserId = "";
      this.callerDevId = "";
      this.inviteMessageId = "";
      this.duration = "";
      
      // 重置通话类型为默认值
      this.type = CALL_TYPE.AUDIO_1V1;

      // 通话结束，清空日志 sessionId 关联
      logger.setSessionId(undefined);
    },

    /**
     * 构建邀请所需的通话信息，并更新至state中
     * @param inviteInfo 邀请信息
     */
    buildAndUpdateInviteState(inviteInfo: INVITE_INFO) {
      this.initInviteInfo(inviteInfo);
      // 可以在这里添加更多的构建逻辑
      return this.state as unknown as CallState;
    },

    /**
     * 生成唯一通话ID
     */
    generateCallId(): string {
      return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },
  },
  /**
   * 计算属性
   */
  getters: {
    /**
     * 只读获取当前CallState
     */
    getCallStatus(): CALL_STATUS {
      return this.status as CALL_STATUS;
    },
    getCallState(): CallState {
      return this as CallState;
    },
    //获取定时器状态
    getInviteTimeoutTimer(): number | null {
      return this.inviteTimeoutTimer;
    },
    /**
     * 判断是否处于邀请中状态
     */
    isInviting(): boolean {
      return this.status === CALL_STATUS.INVITING;
    },

    /**
     * 判断是否处于通话中
     */
    isInCall(): boolean {
      // 根据实际业务需求定义通话中状态
      return this.status !== CALL_STATUS.IDLE;
    },

    // 注：getInvitedMembers 已废弃，群聊成员请使用 GroupCallStore.participantList
    
    // 注：getIsMinimized 已迁移至 GlobalCallStore
  },
});
