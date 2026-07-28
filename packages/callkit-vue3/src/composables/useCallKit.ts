import { useChatClientStore } from "../store/chatClient";
import { useGlobalCallStore } from "../store/globalCall";
import type { UseCallKitReturn, CallParams, GroupCallParams } from "../types";
import { CALL_TYPE, HANGUP_REASON } from "../types/callstate.types";
import { logger } from "../utils/logger";
import { useCallKitCore } from "./useCallKitCore";
import { useGroupCallStore } from "../modules/groupCall";
import { callService } from "../services/CallService";
import { resolveUserProfiles } from "../services/UserProfileService";

// 组合式API：useCallKit —— 统一的通话控制入口
export function useCallKit(): UseCallKitReturn {
  const chatClientStore = useChatClientStore();
  const {
    callState: coreCallState,
    inviteCall: coreInviteCall,
    answerCall: coreAnswerCall,
    hangup: coreHangup,
    inviteGroupCall: coreInviteGroupCall,
    setUserInfo: coreSetUserInfo,
    setUsersInfo: coreSetUsersInfo,
    canAccept,
  } = useCallKitCore();

  // ─── 发起 ───

  const call = async ({
    targetId,
    type,
    msg = type === 'audio' ? '邀请您进行语音通话' : '邀请您进行视频通话',
    userInfo,
  }: CallParams) => {
    logger.debug(`call: 发起单人${type}通话，目标: ${targetId}`);
    if (!chatClientStore.getChatClient) {
      logger.warn("ChatClient 未初始化");
      return;
    }

    const callType = type === "audio" ? CALL_TYPE.AUDIO_1V1 : CALL_TYPE.VIDEO_1V1;

    try {
      await coreInviteCall({
        calleeUserId: targetId,
        callType,
        ext: { message: msg },
        callerInfo: userInfo,
      });
      logger.info(`call: 邀请发送成功`);

      // 批量获取被叫方资料（先查缓存 → 未命中调 Provider → 回写缓存）
      try {
        await resolveUserProfiles([targetId])
        logger.info('call: 已 enrich 被叫方资料')
      } catch (err) {
        logger.warn('call: 获取被叫方资料失败，回退到 userId', err)
      }
    } catch (error) {
      logger.error(`call: 邀请发送失败`, error);
    }
  };

  const groupCall = async ({
    groupId,
    members,
    type,
    msg = type === 'audio' ? '邀请您加入群组语音通话' : '邀请您加入群组视频通话',
    groupName,
    groupAvatar,
    userInfo,
  }: GroupCallParams) => {
    logger.debug(`groupCall: 发起群组${type}通话，groupId: ${groupId}`);
    if (!chatClientStore.getChatClient) {
      logger.warn("ChatClient 未初始化");
      return;
    }
    if (!members || members.length === 0) {
      logger.warn("群组通话必须指定邀请成员列表");
      return;
    }

    const callType = type === "audio" ? CALL_TYPE.AUDIO_MULTI : CALL_TYPE.VIDEO_MULTI;

    try {
      await coreInviteGroupCall({
        groupId,
        participantIds: members,
        callType,
        ext: { message: msg, groupName, groupAvatar },
        callerInfo: userInfo,
      });
      logger.info(`groupCall: 邀请发送成功`);

      // 批量获取被邀请成员资料（先查缓存 → 未命中调 Provider → 回写缓存）
      try {
        await resolveUserProfiles(members)
        logger.info('groupCall: 已 enrich 被邀请成员资料')
      } catch (err) {
        logger.warn('groupCall: 获取被邀请成员资料失败，回退到 userId', err)
      }

      // RtcAdapter 会自动处理 join + publish
      // GroupCallStore 初始化由 useCallKitCore 中 core 的 groupCallInit 事件驱动
      logger.info('groupCall: 主叫方 RTC 加入由 RtcAdapter 自动处理');
    } catch (error) {
      logger.error(`groupCall: 发起失败`, error);
      // 回滚：清理已设置的状态和 session，避免 UI 显示不一致
      try {
        const groupCallStore = useGroupCallStore();
        groupCallStore.destroySession();
        // core 状态重置通过 destroy 或 hangup 处理
        logger.info('groupCall: 已回滚群聊 session');
      } catch (rollbackError) {
        logger.error('groupCall: 回滚失败', rollbackError);
      }
      throw error;
    }
  };

  // ─── 结束 ───

  const hangup = async (reason: HANGUP_REASON = HANGUP_REASON.HANGUP) => {
    logger.info("useCallKit.hangup", { reason });
    try {
      const reasonMap: Record<string, 'normal' | 'cancel'> = {
        [HANGUP_REASON.HANGUP]: 'normal',
        [HANGUP_REASON.CANCEL]: 'cancel',
        [HANGUP_REASON.REMOTE_CANCEL]: 'normal',
        [HANGUP_REASON.REMOTE_REFUSE]: 'normal',
        [HANGUP_REASON.BUSY]: 'normal',
        [HANGUP_REASON.NO_RESPONSE]: 'normal',
      };
      await coreHangup({ reason: reasonMap[reason] || 'normal' });
      // core hangup 成功，callEnded 事件会触发 useCallKitCore 中的清理逻辑
      // 不需要额外调用 callService.cleanup()
    } catch (err) {
      logger.warn('useCallKit: core hangup 失败，执行资源清理', err);
      // core 失败时才需要 fallback 清理
      await callService.cleanup();
    }
  };

  const cancel = async () => {
    logger.info("useCallKit.cancel");
    try {
      await coreHangup({ reason: 'cancel' });
      // core cancel 成功，callEnded 事件会触发清理逻辑
    } catch (err) {
      logger.warn('useCallKit: core cancel 失败，执行资源清理', err);
      await callService.cleanup();
    }
  };

  // ─── 应答 ───

  const accept = async () => {
    logger.info("useCallKit.accept");
    if (!coreCallState.callerUserId) {
      logger.error("accept: 无法获取主叫方 ID");
      throw new Error("无法获取主叫方 ID");
    }
    // 使用 core 谓词判断是否可以接听（替代直接读 status）
    if (!canAccept()) {
      logger.warn(`accept: 当前状态不可接听，无法接听`);
      return;
    }
    try {
      // 被叫 accept 时把本地已知的自己资料回传给主叫方（与 invite 携带 callerInfo 对称），
      // 使主叫侧无需依赖服务端用户属性即可展示被叫昵称/头像
      const globalCallStore = useGlobalCallStore();
      const currentUserId = chatClientStore.getChatClient?.user || '';
      const localInfo = currentUserId ? globalCallStore.getUserInfo(currentUserId) : {};
      const calleeInfo =
        localInfo.nickname || localInfo.avatarURL
          ? { nickname: localInfo.nickname, avatarURL: localInfo.avatarURL }
          : undefined;
      await coreAnswerCall({
        callId: coreCallState.callId,
        result: 'accept',
        calleeInfo,
      });
      logger.info("useCallKit.accept: 已发送接听信令");
    } catch (err) {
      logger.error('useCallKit.accept: core answerCall 失败', err);
      throw err;
    }
  };

  const reject = async () => {
    logger.info("useCallKit.reject");
    if (!coreCallState.callerUserId) {
      logger.error("reject: 无法获取主叫方 ID");
      throw new Error("无法获取主叫方 ID");
    }
    try {
      await coreAnswerCall({
        callId: coreCallState.callId,
        result: 'refuse',
      });
      logger.info("useCallKit.reject: 已发送拒绝信令");
    } catch (err) {
      logger.error('useCallKit.reject: core answerCall 失败', err);
      throw err;
    }
  };

  const rejectBusy = async () => {
    logger.info("useCallKit.rejectBusy");
    if (!coreCallState.callerUserId) {
      logger.error("rejectBusy: 无法获取主叫方 ID");
      throw new Error("无法获取主叫方 ID");
    }
    try {
      await coreAnswerCall({
        callId: coreCallState.callId,
        result: 'busy',
      });
      logger.info("useCallKit.rejectBusy: 已发送忙碌拒绝信令");
    } catch (err) {
      logger.error('useCallKit.rejectBusy: core answerCall 失败', err);
      throw err;
    }
  };

  const setUserInfo = (
    userId: string,
    userInfo: { nickname?: string; avatarURL?: string }
  ) => {
    coreSetUserInfo(userId, userInfo)
  }

  const setUserInfoMap = (
    map: Record<string, { nickname?: string; avatarURL?: string }>
  ) => {
    coreSetUsersInfo(
      Object.entries(map).map(([userId, info]) => ({ userId, ...info }))
    )
  }

  return {
    call,
    groupCall,
    hangup,
    cancel,
    accept,
    reject,
    rejectBusy,
    setUserInfo,
    setUserInfoMap,
  };
}
