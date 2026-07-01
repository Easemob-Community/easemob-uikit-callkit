import { useChatClientStore } from "../store/chatClient";
import { useGlobalCallStore } from "../store/globalCall";
import type { Chat } from "../core/sdk/imSDK";
import type { UseCallKitReturn, CallParams, GroupCallParams } from "../types";
import { useCallStateStore } from "../store/callState";
import { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from "../types/callstate.types";
import { logger } from "../utils/logger";
import { useSignalManager } from "./useSignalManager";
import { useJoinChannel } from "./useJoinChannel";
import { useGroupCallStore } from "../modules/groupCall";
import { callService } from "../services/CallService";
import { callKitEventBus } from "../core/events/CallKitEventBus";
import { buildBaseEventFields } from "../core/events/helpers";
import { resolveUserProfiles } from "../services/UserProfileService";

// 组合式API：useCallKit —— 统一的通话控制入口
export function useCallKit(): UseCallKitReturn {
  const chatClientStore = useChatClientStore();
  const callStateStore = useCallStateStore();
  const { sendInviteMessage, sendAnswerMessage } = useSignalManager();

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
    // 修复：每次发起呼叫前，从当前登录的 chatClient 重新写入主叫身份（callerUserId/callerDevId/token），
    // 避免上一通通话（尤其是本端作为“被叫”时被对端身份覆盖）残留的 callerUserId 泄漏到本次邀请，
    // 否则“角色互换”的第二通会把对方 ID 当作主叫发出，导致接收方误判身份、通话失败。
    callStateStore.initCallState(chatClientStore.getChatClient as Chat.Connection);
    callStateStore.initInviteInfo({
      calleeUserId: targetId,
      type: type === "audio" ? CALL_TYPE.AUDIO_1V1 : CALL_TYPE.VIDEO_1V1,
    });
    try {
      const message = await sendInviteMessage(targetId, "singleChat" as any, msg, undefined, userInfo);
      logger.info(`call: 邀请发送成功，msgId: ${message.serverMsgId}`);

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

    try {
      // 修复：同 call()，发起前从当前 chatClient 重新写入主叫身份，避免跨通话残留
      callStateStore.initCallState(chatClientStore.getChatClient as Chat.Connection);
      callStateStore.initInviteInfo({
        calleeUserId: groupId,
        type: type === "audio" ? CALL_TYPE.AUDIO_MULTI : CALL_TYPE.VIDEO_MULTI,
      });

      const message = await sendInviteMessage(members, "groupChat" as any, msg, groupId, userInfo);
      logger.info(`groupCall: 邀请发送成功，msgId: ${message.serverMsgId}`);

      // 批量获取被邀请成员资料（先查缓存 → 未命中调 Provider → 回写缓存）
      try {
        await resolveUserProfiles(members)
        logger.info('groupCall: 已 enrich 被邀请成员资料')
      } catch (err) {
        logger.warn('groupCall: 获取被邀请成员资料失败，回退到 userId', err)
      }

      // 主叫方立即进入 IN_CALL 并加入 RTC
      callStateStore.setCallStatus(CALL_STATUS.IN_CALL);

      // 触发 callStarted（群通话主叫方）
      const currentCallState = callStateStore.getCallState;
      callKitEventBus.emit('callStarted', {
        ...buildBaseEventFields(
          {
            callId: currentCallState.callId,
            channel: currentCallState.channel,
            type: currentCallState.type,
            callerUserId: currentCallState.callerUserId,
            calleeUserId: currentCallState.calleeUserId,
            groupId: groupId,
          },
          true
        ),
        isCaller: true,
      });

      const groupCallStore = useGroupCallStore();
      const globalCallStore = useGlobalCallStore();
      const currentUserId = chatClientStore.getChatClient?.user || '';

      // 从 GlobalCallStore 获取本地用户资料
      const localUserInfo = globalCallStore.getUserInfo(currentUserId);

      groupCallStore.initSession({
        sessionId: callStateStore.getCallState.channel || groupId,
        groupId,
        groupName,
        callType: type,
        isActive: true,
        startTime: Date.now(),
      });
      groupCallStore.addParticipant({
        userId: currentUserId,
        nickname: localUserInfo.nickname || currentUserId,
        avatarUrl: localUserInfo.avatarURL,
        state: 'joinedRtc',
        isLocal: true,
        videoTrack: null,
        audioTrack: null,
        localStream: null,
        isMuted: false,
        isCameraOn: type === 'video',
        isSpeaking: false,
      });
      members.forEach((m) => {
        // 从 GlobalCallStore 获取成员资料
        const memberInfo = globalCallStore.getUserInfo(m);
        groupCallStore.addParticipant({
          userId: m,
          nickname: memberInfo.nickname || m,
          avatarUrl: memberInfo.avatarURL,
          state: 'invited',
          isLocal: false,
          videoTrack: null,
          audioTrack: null,
          localStream: null,
          isMuted: false,
          isCameraOn: false,
          isSpeaking: false,
        });
      });

      const { joinChannel } = useJoinChannel();
      await joinChannel();
      logger.info('groupCall: 主叫方已加入 RTC 频道');
    } catch (error) {
      logger.error(`groupCall: 发起失败`, error);
      // 回滚：清理已设置的状态和 session，避免 UI 显示不一致
      try {
        const groupCallStore = useGroupCallStore();
        groupCallStore.destroySession();
        callStateStore.resetCallState();
        logger.info('groupCall: 已回滚通话状态和群聊 session');
      } catch (rollbackError) {
        logger.error('groupCall: 回滚失败', rollbackError);
      }
      throw error;
    }
  };

  // ─── 结束 ───

  const hangup = async (reason: HANGUP_REASON = HANGUP_REASON.HANGUP) => {
    logger.info("useCallKit.hangup", { reason });
    await callService.hangup(reason);
  };

  const cancel = async () => {
    logger.info("useCallKit.cancel");
    const callState = callStateStore.getCallState;
    callKitEventBus.emit('callCanceled', {
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
      isRemote: false,
    });

    await callService.cancelCall();
  };

  // ─── 应答 ───

  const accept = async () => {
    logger.info("useCallKit.accept");
    const callState = callStateStore.getCallState;
    if (!callState.callerUserId) {
      logger.error("accept: 无法获取主叫方 ID");
      throw new Error("无法获取主叫方 ID");
    }
    if (callStateStore.getCallStatus !== CALL_STATUS.ALERTING) {
      logger.warn(`accept: 当前状态不是 ALERTING，无法接听`);
      return;
    }
    if (callStateStore.getInviteTimeoutTimer) {
      callStateStore.clearTimeoutTimer();
    }
    await sendAnswerMessage(
      callState.callerUserId,
      { callId: callState.callId, callerDevId: callState.callerDevId, calleeDevId: chatClientStore.getClientDeviceId },
      "accept" as any
    );
    callStateStore.setCallStatus(CALL_STATUS.ANSWER_CALL);
    logger.info("useCallKit.accept: 已发送接听信令");
  };

  const reject = async () => {
    logger.info("useCallKit.reject");
    const callState = callStateStore.getCallState;
    if (!callState.callerUserId) {
      logger.error("reject: 无法获取主叫方 ID");
      throw new Error("无法获取主叫方 ID");
    }
    if (callStateStore.getInviteTimeoutTimer) {
      callStateStore.clearTimeoutTimer();
    }
    await sendAnswerMessage(
      callState.callerUserId,
      { callId: callState.callId, callerDevId: callState.callerDevId, calleeDevId: chatClientStore.getClientDeviceId },
      "refuse" as any
    );
    callStateStore.resetCallState();
    logger.info("useCallKit.reject: 已发送拒绝信令");
  };

  const rejectBusy = async () => {
    logger.info("useCallKit.rejectBusy");
    const callState = callStateStore.getCallState;
    if (!callState.callerUserId) {
      logger.error("rejectBusy: 无法获取主叫方 ID");
      throw new Error("无法获取主叫方 ID");
    }
    if (callStateStore.getInviteTimeoutTimer) {
      callStateStore.clearTimeoutTimer();
    }
    await sendAnswerMessage(
      callState.callerUserId,
      { callId: callState.callId, callerDevId: callState.callerDevId, calleeDevId: chatClientStore.getClientDeviceId },
      "busy" as any
    );
    callStateStore.resetCallState();
    logger.info("useCallKit.rejectBusy: 已发送忙碌拒绝信令");
  };

  return {
    call,
    groupCall,
    hangup,
    cancel,
    accept,
    reject,
    rejectBusy,
  };
}
