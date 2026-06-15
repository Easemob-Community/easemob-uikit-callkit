import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SingleCallSignalHandler } from './SingleCallSignalHandler'
import { SingleCallStateMachine } from '../state/SingleCallStateMachine'
import { SignalSender } from './SignalSender'
import { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from '../types/callstate.types'

// ─── Mock ───

function createMockSender(): SignalSender {
  return {
    sendCmdMessage: vi.fn().mockResolvedValue(undefined),
    sendInviteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as SignalSender
}

const DEVICE_ID = 'dev_web_001'

function createHandler() {
  const stateMachine = new SingleCallStateMachine()
  const sender = createMockSender()
  const handler = new SingleCallSignalHandler(stateMachine, sender, DEVICE_ID)
  return { stateMachine, sender, handler }
}

const MOCK_CALL = {
  callId: 'call_abc',
  channel: 'ch_001',
  token: 'tkn_001',
  callerUserId: 'user_a',
  callerDevId: 'dev_a',
  calleeUserId: 'user_b',
  calleeDevId: 'dev_b',
}

/** 构建测试用的 CmdMsgBody，自动填充 ts/msgType 以满足 SignalingExt 类型 */
function buildMsg(overrides: { from?: string; ext: Record<string, any> }): any {
  return {
    from: overrides.from,
    ext: {
      ts: Date.now(),
      msgType: 'rtcCallWithAgora',
      ...overrides.ext,
    },
  }
}

// ─── 测试 ───

describe('SingleCallSignalHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  describe('handleAlert', () => {
    it('主叫 INVITING 收到 alert → 发送 confirmRing 并返回 STATUS_CHANGED', async () => {
      const { stateMachine, sender, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'alert',
          callId: MOCK_CALL.callId,
          callerDevId: DEVICE_ID,
          calleeDevId: MOCK_CALL.calleeDevId,
        },
      })

      expect(events).toHaveLength(0)
      expect(sender.sendCmdMessage).toHaveBeenCalledTimes(1)
    })

    it('callerDevId 不匹配 → 忽略', () => {
      const { stateMachine, sender, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'alert',
          callId: MOCK_CALL.callId,
          callerDevId: 'wrong_dev',
          calleeDevId: MOCK_CALL.calleeDevId,
        },
      })

      expect(events).toHaveLength(0)
      expect(sender.sendCmdMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleConfirmRing', () => {
    it('被叫 ALERTING 收到 confirmRing(true) → RECEIVED_CONFIRM_RING', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initIncoming({
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: MOCK_CALL.callerDevId,
        callerUserId: MOCK_CALL.callerUserId,
        calleeDevId: DEVICE_ID,
        calleeUserId: MOCK_CALL.calleeUserId,
      })

      const events = handler.handle({
        from: MOCK_CALL.callerUserId,
        ext: {
          action: 'confirmRing',
          callId: MOCK_CALL.callId,
          callerDevId: MOCK_CALL.callerDevId,
          calleeDevId: DEVICE_ID,
          status: true,
        },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'STATUS_CHANGED',
        to: CALL_STATUS.RECEIVED_CONFIRM_RING,
      })
    })

    it('calleeDevId 不匹配 → 忽略', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initIncoming({
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: MOCK_CALL.callerDevId,
        callerUserId: MOCK_CALL.callerUserId,
        calleeDevId: DEVICE_ID,
        calleeUserId: MOCK_CALL.calleeUserId,
      })

      const events = handler.handle({
        from: MOCK_CALL.callerUserId,
        ext: {
          action: 'confirmRing',
          callId: MOCK_CALL.callId,
          callerDevId: MOCK_CALL.callerDevId,
          calleeDevId: 'wrong_dev',
          status: true,
        },
      })

      expect(events).toHaveLength(0)
    })
  })

  describe('handleAnswerCall', () => {
    it('主叫收到 accept → 发送 confirmCallee + IN_CALL + SHOULD_JOIN_RTC', () => {
      const { stateMachine, sender, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'answerCall',
          callId: MOCK_CALL.callId,
          callerDevId: DEVICE_ID,
          calleeDevId: MOCK_CALL.calleeDevId,
          result: 'accept',
        },
      })

      expect(sender.sendCmdMessage).toHaveBeenCalledTimes(1)
      expect(events).toHaveLength(4)
      expect(events[0]).toMatchObject({ type: 'STATUS_CHANGED', to: CALL_STATUS.IN_CALL })
      expect(events[1]).toMatchObject({ type: 'CALL_ACCEPTED', isCaller: true })
      expect(events[2]).toMatchObject({ type: 'CALL_STARTED', isCaller: true })
      expect(events[3]).toMatchObject({ type: 'SHOULD_JOIN_RTC', role: 'caller' })
    })

    it('主叫收到 refuse → 发送 confirmCallee + CALL_REFUSED + CALL_ENDED', () => {
      const { stateMachine, sender, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'answerCall',
          callId: MOCK_CALL.callId,
          callerDevId: DEVICE_ID,
          calleeDevId: MOCK_CALL.calleeDevId,
          result: 'refuse',
        },
      })

      expect(sender.sendCmdMessage).toHaveBeenCalledTimes(1)
      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ type: 'CALL_REFUSED', isRemote: true })
      expect(events[1]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.REMOTE_REFUSE })
    })

    it('主叫收到 busy → 发送 confirmCallee + CALL_BUSY + CALL_ENDED', () => {
      const { stateMachine, sender, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'answerCall',
          callId: MOCK_CALL.callId,
          callerDevId: DEVICE_ID,
          calleeDevId: MOCK_CALL.calleeDevId,
          result: 'busy',
        },
      })

      expect(sender.sendCmdMessage).toHaveBeenCalledTimes(1)
      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ type: 'CALL_BUSY' })
      expect(events[1]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.BUSY })
    })

    it('callId 不匹配 → 忽略', () => {
      const { stateMachine, sender, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'answerCall',
          callId: 'wrong_call_id',
          callerDevId: DEVICE_ID,
          calleeDevId: MOCK_CALL.calleeDevId,
          result: 'accept',
        },
      })

      expect(events).toHaveLength(0)
      expect(sender.sendCmdMessage).not.toHaveBeenCalled()
    })

    it('callerDevId 不匹配（非其他端）→ 忽略', () => {
      const { stateMachine, sender, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: 'some_random_user',
        ext: {
          action: 'answerCall',
          callId: MOCK_CALL.callId,
          callerDevId: 'wrong_dev',
          calleeDevId: MOCK_CALL.calleeDevId,
          result: 'accept',
        },
      })

      expect(events).toHaveLength(0)
      expect(sender.sendCmdMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleCancelCall', () => {
    it('callId 匹配 → CALL_CANCELED + CALL_ENDED', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'cancelCall',
          callId: MOCK_CALL.callId,
        },
      })

      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ type: 'CALL_CANCELED', isRemote: true })
      expect(events[1]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.REMOTE_CANCEL })
    })

    it('callId 不匹配 + 来自 caller + ALERTING → 容错挂断', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })
      stateMachine.receiveAlert(MOCK_CALL.calleeDevId)

      const events = handler.handle({
        from: MOCK_CALL.callerUserId,
        ext: {
          action: 'cancelCall',
          callId: 'wrong_id',
        },
      })

      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ type: 'CALL_CANCELED', isRemote: true })
    })

    it('callId 不匹配 + 非 caller → 忽略', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })

      const events = handler.handle({
        from: 'random_user',
        ext: {
          action: 'cancelCall',
          callId: 'wrong_id',
        },
      })

      expect(events).toHaveLength(0)
    })
  })

  describe('handleLeaveCall', () => {
    it('callId 匹配 + IN_CALL → CALL_ENDED', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })
      stateMachine.receiveAnswer('accept')
      vi.advanceTimersByTime(3000)

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'leaveCall',
          callId: MOCK_CALL.callId,
        },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'CALL_ENDED',
        reason: HANGUP_REASON.HANGUP,
      })
      expect((events[0] as any).duration).toBeGreaterThanOrEqual(3000)
    })

    it('callId 不匹配 + IN_CALL → 容错挂断', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: DEVICE_ID,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })
      stateMachine.receiveAnswer('accept')
      vi.advanceTimersByTime(1000)

      const events = handler.handle({
        from: MOCK_CALL.calleeUserId,
        ext: {
          action: 'leaveCall',
          callId: 'wrong_id',
        },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.HANGUP })
    })

    it('ALERTING + 来自 caller → 容错挂断', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initIncoming({
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: MOCK_CALL.callerDevId,
        callerUserId: MOCK_CALL.callerUserId,
        calleeDevId: DEVICE_ID,
        calleeUserId: MOCK_CALL.calleeUserId,
      })

      const events = handler.handle({
        from: MOCK_CALL.callerUserId,
        ext: {
          action: 'leaveCall',
          callId: 'wrong_id',
        },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.HANGUP })
    })
  })

  describe('handleConfirmCallee', () => {
    it('被叫收到 confirmCallee → IN_CALL + CALL_STARTED + SHOULD_JOIN_RTC', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initIncoming({
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: MOCK_CALL.callerDevId,
        callerUserId: MOCK_CALL.callerUserId,
        calleeDevId: DEVICE_ID,
        calleeUserId: MOCK_CALL.calleeUserId,
      })

      const events = handler.handle({
        from: MOCK_CALL.callerUserId,
        ext: {
          action: 'confirmCallee',
          callId: MOCK_CALL.callId,
          callerDevId: MOCK_CALL.callerDevId,
          calleeDevId: DEVICE_ID,
          result: 'accept',
        },
      })

      expect(events).toHaveLength(4)
      expect(events[0]).toMatchObject({ type: 'STATUS_CHANGED', to: CALL_STATUS.IN_CALL })
      expect(events[1]).toMatchObject({ type: 'CALL_CONNECTED' })
      expect(events[2]).toMatchObject({ type: 'CALL_STARTED', isCaller: false })
      expect(events[3]).toMatchObject({ type: 'SHOULD_JOIN_RTC', role: 'callee' })
    })

    it('callId 不匹配 → 忽略', () => {
      const { stateMachine, handler } = createHandler()
      stateMachine.initIncoming({
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: MOCK_CALL.callerDevId,
        callerUserId: MOCK_CALL.callerUserId,
        calleeDevId: DEVICE_ID,
        calleeUserId: MOCK_CALL.calleeUserId,
      })

      const events = handler.handle({
        from: MOCK_CALL.callerUserId,
        ext: {
          action: 'confirmCallee',
          callId: 'wrong_id',
          callerDevId: MOCK_CALL.callerDevId,
          calleeDevId: DEVICE_ID,
          result: 'accept',
        },
      })

      expect(events).toHaveLength(0)
    })
  })
})
