import { callService } from "../services/CallService";
import { useCallKitCore } from "./useCallKitCore";
import { HANGUP_REASON } from "../types/callstate.types";
import { logger } from "../utils/logger";

/**
 * 通话结束相关功能的组合式函数
 * 信令由 callkit-core 处理，资源清理由 CallService 处理
 */
export function useEndCall() {
  const { callState: coreCallState, hangup: coreHangup, canHangup: coreCanHangup, isCalling: coreIsCalling } = useCallKitCore();

  /**
   * 挂断当前通话
   * 优先通过 core 发送信令，然后清理资源
   */
  async function hangup(
    reason: HANGUP_REASON = HANGUP_REASON.HANGUP
  ): Promise<void> {
    try {
      logger.info("useEndCall: Hanging up call", { reason });
      const reasonMap: Record<string, 'normal' | 'cancel'> = {
        [HANGUP_REASON.HANGUP]: 'normal',
        [HANGUP_REASON.CANCEL]: 'cancel',
        [HANGUP_REASON.REMOTE_CANCEL]: 'normal',
        [HANGUP_REASON.REMOTE_REFUSE]: 'normal',
        [HANGUP_REASON.BUSY]: 'normal',
        [HANGUP_REASON.NO_RESPONSE]: 'normal',
      };
      const coreReason = reasonMap[reason] || 'normal';
      try {
        await coreHangup({ reason: coreReason });
        // core 成功，callEnded 事件会触发清理，不需要重复调用
      } catch (coreErr) {
        logger.warn('useEndCall: core hangup 失败，fallback 清理', coreErr);
        // 仅在 core 失败时 fallback 清理资源
        await callService.cleanup();
      }
    } catch (error) {
      logger.error("useEndCall: Failed to hang up call", error);
      throw error;
    }
  }

  /**
   * 普通挂断通话
   */
  async function hangupCall(): Promise<void> {
    await hangup(HANGUP_REASON.HANGUP);
  }

  /**
   * 取消通话邀请
   */
  async function cancelCall(): Promise<void> {
    try {
      logger.info("useEndCall: Cancelling call invitation");
      try {
        await coreHangup({ reason: 'cancel' });
        // core 成功，callEnded 事件会触发清理
      } catch (coreErr) {
        logger.warn('useEndCall: core cancel 失败，fallback 清理', coreErr);
        // 仅在 core 失败时 fallback 清理资源
        await callService.cleanup();
      }
    } catch (error) {
      logger.error("useEndCall: Failed to cancel call invitation", error);
      throw error;
    }
  }

  /**
   * 处理远程取消通话
   */
  async function handleRemoteCancel(): Promise<void> {
    await hangup(HANGUP_REASON.REMOTE_CANCEL);
  }

  /**
   * 处理远程拒绝通话
   */
  async function handleRemoteRefuse(): Promise<void> {
    await hangup(HANGUP_REASON.REMOTE_REFUSE);
  }

  /**
   * 处理异常结束
   */
  async function handleAbnormalEnd(): Promise<void> {
    await hangup(HANGUP_REASON.ABNORMAL_END);
  }

  /**
   * 检查当前是否可以挂断
   */
  function canHangup(): boolean {
    return coreCanHangup();
  }

  /**
   * 检查当前是否可以取消通话
   */
  function canCancel(): boolean {
    return coreIsCalling();
  }

  return {
    hangup,
    hangupCall,
    cancelCall,
    handleRemoteCancel,
    handleRemoteRefuse,
    handleAbnormalEnd,
    canHangup,
    canCancel,
  };
}
