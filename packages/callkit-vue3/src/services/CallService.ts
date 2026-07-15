// src/services/callService.ts
import { useCallKitRtc } from "../composables/useCallKitRtc";
import { useCallTimerStore } from "../store/callTimer";
import { useGlobalCallStore } from "../store/globalCall";
import { useGroupCallStore } from "../modules/groupCall";
import { logger } from "../utils/logger";

/**
 * CallService - 纯资源清理服务
 *
 * 职责：通话结束时的 RTC 资源清理、计时器重置、小窗状态重置。
 * 信令发送和状态机管理由 callkit-core 负责，此处不做任何信令操作。
 */
export class CallService {
  private isCleaningUp = false;

  private get rtc() {
    return useCallKitRtc();
  }

  /**
   * 清理通话相关资源
   * 由 useEndCall / useCallKit 在 core hangup 后调用，或 core 失败时回退调用
   */
  async cleanup(): Promise<void> {
    if (this.isCleaningUp) {
      logger.info('[CallService] 清理已在进行中，跳过重复调用');
      return;
    }
    this.isCleaningUp = true;

    logger.info('[CallService] 开始清理通话资源');

    try {
      // 1. 离开 RTC 频道并清理轨道
      const rtcService = this.rtc.getRtcService();
      if (rtcService) {
        try {
          await rtcService.leaveChannel();
          logger.info('[CallService] 已离开 RTC 频道');
        } catch (e) {
          logger.warn('[CallService] 离开 RTC 频道失败:', e);
        }
      }

      // 2. 重置通话计时器
      try {
        const callTimerStore = useCallTimerStore();
        callTimerStore.reset();
      } catch (_e) {
        // 忽略
      }

      // 3. 重置群聊会话
      try {
        const groupCallStore = useGroupCallStore();
        if (groupCallStore.session) {
          groupCallStore.destroySession();
        }
      } catch (_e) {
        // 忽略
      }

      // 4. 重置小窗状态
      try {
        const globalCallStore = useGlobalCallStore();
        if (globalCallStore.isMinimized) {
          globalCallStore.isMinimized = false;
        }
      } catch (_e) {
        // 忽略
      }

      logger.info('[CallService] 通话资源清理完成');
    } catch (error) {
      logger.error('[CallService] 清理过程中发生错误:', error);
    } finally {
      this.isCleaningUp = false;
    }
  }
}

// 单例实例
export const callService = new CallService();
