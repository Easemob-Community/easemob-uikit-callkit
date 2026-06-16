import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SingleCallStateMachine } from './SingleCallStateMachine'
import { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from '../types/callstate.types'

// ─── 辅助函数 ───

function createCallerMachine() {
  return new SingleCallStateMachine()
}

function createCalleeMachine() {
  return new SingleCallStateMachine()
}

const MOCK_CALL = {
  callId: 'call_abc123',
  channel: 'ch_xyz789',
  token: 'tkn_001',
  callerUserId: 'user_a',
  callerDevId: 'dev_a_web',
  calleeUserId: 'user_b',
  calleeDevId: 'dev_b_ios',
}

// ─── 测试套件 ───

describe('SingleCallStateMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ═══════════════════════════════════════════════
  // 基础查询
  // ═══════════════════════════════════════════════

  describe('查询方法', () => {
    it('初始状态为 IDLE', () => {
      const sm = createCallerMachine()
      expect(sm.isIdle()).toBe(true)
      expect(sm.isInCall()).toBe(false)
      expect(sm.getState().status).toBe(CALL_STATUS.IDLE)
    })

    it('getDuration 在未通话时返回 0', () => {
      const sm = createCallerMachine()
      expect(sm.getDuration()).toBe(0)
    })
  })

  // ═══════════════════════════════════════════════
  // 主叫发起 → 被叫接受 → 通话 → 挂断（完整流程）
  // ═══════════════════════════════════════════════

  describe('完整主叫流程', () => {
    it('invite → alert → accept → hangup', () => {
      const sm = createCallerMachine()

      // 1. 发起邀请
      const r1 = sm.initInvite({
        calleeUserId: MOCK_CALL.calleeUserId,
        callType: CALL_TYPE.VIDEO_1V1,
        callerDevId: MOCK_CALL.callerDevId,
        callerUserId: MOCK_CALL.callerUserId,
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
      })
      expect(r1.ok).toBe(true)
      expect(r1.events).toHaveLength(2)
      expect(r1.events[0]).toMatchObject({
        type: 'STATUS_CHANGED',
        from: CALL_STATUS.IDLE,
        to: CALL_STATUS.INVITING,
        callId: MOCK_CALL.callId,
      })
      expect(r1.events[1]).toMatchObject({
        type: 'CALL_INVITED',
        callId: MOCK_CALL.callId,
        isCaller: true,
        channel: MOCK_CALL.channel,
        callType: CALL_TYPE.VIDEO_1V1,
      })
      expect(sm.getState().status).toBe(CALL_STATUS.INVITING)

      // 2. 收到 alert（与 v1.0.6 lib 对齐：保持 INVITING，只记录 calleeDevId）
      const r2 = sm.receiveAlert(MOCK_CALL.calleeDevId)
      expect(r2.ok).toBe(true)
      expect(r2.events).toHaveLength(0)
      expect(sm.getState().status).toBe(CALL_STATUS.INVITING)
      expect(sm.getState().calleeDevId).toBe(MOCK_CALL.calleeDevId)

      // 3. 收到 accept
      const r3 = sm.receiveAnswer('accept')
      expect(r3.ok).toBe(true)
      expect(r3.events).toHaveLength(4)
      expect(r3.events[0]).toMatchObject({ type: 'STATUS_CHANGED', to: CALL_STATUS.IN_CALL })
      expect(r3.events[1]).toMatchObject({ type: 'CALL_ACCEPTED', isCaller: true })
      expect(r3.events[2]).toMatchObject({ type: 'CALL_STARTED', isCaller: true })
      expect(r3.events[3]).toMatchObject({ type: 'SHOULD_JOIN_RTC', role: 'caller' })
      expect(sm.isInCall()).toBe(true)
      expect(sm.getState().startTime).toBeGreaterThan(0)

      // 模拟通话 5 秒
      vi.advanceTimersByTime(5000)
      expect(sm.getDuration()).toBeGreaterThanOrEqual(5000)

      // 4. 本地挂断
      const r4 = sm.hangup(HANGUP_REASON.HANGUP)
      expect(r4.ok).toBe(true)
      expect(r4.events[0]).toMatchObject({
        type: 'CALL_ENDED',
        reason: HANGUP_REASON.HANGUP,
        duration: expect.any(Number),
      })
      expect((r4.events[0] as any).duration).toBeGreaterThanOrEqual(5000)
      expect(sm.isIdle()).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════
  // 被叫响应流程
  // ═══════════════════════════════════════════════

  describe('被叫流程', () => {
    it('incoming → answer(accept) → confirmCallee → hangup', () => {
      const sm = createCalleeMachine()

      // 1. 收到邀请
      const r1 = sm.initIncoming({
        callId: MOCK_CALL.callId,
        channel: MOCK_CALL.channel,
        token: MOCK_CALL.token,
        callType: CALL_TYPE.AUDIO_1V1,
        callerDevId: MOCK_CALL.callerDevId,
        callerUserId: MOCK_CALL.callerUserId,
        calleeDevId: MOCK_CALL.calleeDevId,
        calleeUserId: MOCK_CALL.calleeUserId,
      })
      expect(r1.ok).toBe(true)
      expect(sm.getState().status).toBe(CALL_STATUS.ALERTING)

      // 2. 本地接受（主叫收到 answer 后发送 confirmCallee）
      const r2 = sm.receiveConfirmCallee()
      expect(r2.ok).toBe(true)
      expect(r2.events).toHaveLength(4)
      expect(r2.events[0]).toMatchObject({ type: 'STATUS_CHANGED', to: CALL_STATUS.IN_CALL })
      expect(r2.events[1]).toMatchObject({ type: 'CALL_CONNECTED' })
      expect(r2.events[2]).toMatchObject({ type: 'CALL_STARTED', isCaller: false })
      expect(r2.events[3]).toMatchObject({ type: 'SHOULD_JOIN_RTC', role: 'callee' })
      expect(sm.isInCall()).toBe(true)

      // 3. 本地挂断
      const r3 = sm.hangup(HANGUP_REASON.HANGUP)
      expect(r3.ok).toBe(true)
      expect(r3.events[0].type).toBe('CALL_ENDED')
    })
  })

  // ═══════════════════════════════════════════════
  // 拒绝 / 忙线
  // ═══════════════════════════════════════════════

  describe('拒绝与忙线', () => {
    it('收到 refuse → 状态变为 IDLE，触发 CALL_REFUSED + CALL_ENDED', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })
      sm.receiveAlert(MOCK_CALL.calleeDevId)

      const r = sm.receiveAnswer('refuse')
      expect(r.ok).toBe(true)
      expect(r.events).toHaveLength(2)
      expect(r.events[0]).toMatchObject({ type: 'CALL_REFUSED', isRemote: true })
      expect(r.events[1]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.REMOTE_REFUSE, duration: 0 })
      expect(sm.isIdle()).toBe(true)
    })

    it('收到 busy → 状态变为 IDLE，触发 CALL_BUSY + CALL_ENDED', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.AUDIO_1V1, calleeUserId: MOCK_CALL.calleeUserId })

      const r = sm.receiveAnswer('busy')
      expect(r.ok).toBe(true)
      expect(r.events[0]).toMatchObject({ type: 'CALL_BUSY' })
      expect(r.events[1]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.BUSY })
    })

    it('已在 IN_CALL 时收到 accept → 忽略', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })
      sm.receiveAnswer('accept')

      const r = sm.receiveAnswer('accept')
      expect(r.ok).toBe(false)
      expect(r.events).toHaveLength(0)
    })
  })

  // ═══════════════════════════════════════════════
  // 取消
  // ═══════════════════════════════════════════════

  describe('取消', () => {
    it('收到 cancel → 状态变为 IDLE', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })

      const r = sm.receiveCancel()
      expect(r.ok).toBe(true)
      expect(r.events).toHaveLength(2)
      expect(r.events[0]).toMatchObject({ type: 'CALL_CANCELED', isRemote: true })
      expect(r.events[1]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.REMOTE_CANCEL })
      expect(sm.isIdle()).toBe(true)
    })

    it('IDLE 时收到 cancel → 忽略', () => {
      const sm = createCallerMachine()
      const r = sm.receiveCancel()
      expect(r.ok).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════
  // 超时
  // ═══════════════════════════════════════════════

  describe('超时', () => {
    it('INVITING 状态超时 → IDLE，触发 CALL_TIMEOUT + CALL_ENDED', () => {
      const sm = createCallerMachine()
      sm.initInvite({
        ...MOCK_CALL,
        callType: CALL_TYPE.VIDEO_1V1,
        calleeUserId: MOCK_CALL.calleeUserId,
        timeout: 5000,
      })
      sm.startTimeout()

      expect(sm.getState().status).toBe(CALL_STATUS.INVITING)
      vi.advanceTimersByTime(5000)

      expect(sm.isIdle()).toBe(true)
    })

    it('显式调用 timeout()', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })

      const r = sm.timeout()
      expect(r.ok).toBe(true)
      expect(r.events[0]).toMatchObject({ type: 'CALL_TIMEOUT' })
      expect(r.events[1]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.NO_RESPONSE })
      expect(sm.isIdle()).toBe(true)
    })

    it('IN_CALL 状态下调用 timeout → 忽略', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })
      sm.receiveAnswer('accept')

      const r = sm.timeout()
      expect(r.ok).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════
  // leaveCall
  // ═══════════════════════════════════════════════

  describe('收到 leaveCall', () => {
    it('IN_CALL 时收到 leave → 挂断', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })
      sm.receiveAnswer('accept')
      vi.advanceTimersByTime(3000)

      const r = sm.receiveLeave()
      expect(r.ok).toBe(true)
      expect(r.events[0]).toMatchObject({
        type: 'CALL_ENDED',
        reason: HANGUP_REASON.HANGUP,
        duration: expect.any(Number),
      })
      expect((r.events[0] as any).duration).toBeGreaterThanOrEqual(3000)
    })

    it('ALERTING 时收到 leave → 挂断', () => {
      const sm = createCalleeMachine()
      sm.initIncoming({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1 })

      const r = sm.receiveLeave()
      expect(r.ok).toBe(true)
      expect(r.events[0]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.HANGUP })
    })
  })

  // ═══════════════════════════════════════════════
  // confirmRing
  // ═══════════════════════════════════════════════

  describe('confirmRing', () => {
    it('ALERTING → RECEIVED_CONFIRM_RING', () => {
      const sm = createCalleeMachine()
      sm.initIncoming({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1 })

      const r = sm.receiveConfirmRing(true)
      expect(r.ok).toBe(true)
      expect(sm.getState().status).toBe(CALL_STATUS.RECEIVED_CONFIRM_RING)
    })

    it('status=false → 忽略', () => {
      const sm = createCalleeMachine()
      sm.initIncoming({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1 })

      const r = sm.receiveConfirmRing(false)
      expect(r.ok).toBe(false)
    })

    it('重复 RECEIVED_CONFIRM_RING → 忽略', () => {
      const sm = createCalleeMachine()
      sm.initIncoming({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1 })
      sm.receiveConfirmRing(true)

      const r = sm.receiveConfirmRing(true)
      expect(r.ok).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════
  // reset 与保留字段
  // ═══════════════════════════════════════════════

  describe('reset', () => {
    it('reset 后保留 callerDevId / callerUserId', () => {
      const sm = createCallerMachine()
      sm.initInvite({
        ...MOCK_CALL,
        callType: CALL_TYPE.VIDEO_1V1,
        calleeUserId: MOCK_CALL.calleeUserId,
      })
      sm.receiveAnswer('accept')
      sm.hangup()

      const state = sm.getState()
      expect(state.status).toBe(CALL_STATUS.IDLE)
      expect(state.callerDevId).toBe(MOCK_CALL.callerDevId)
      expect(state.callerUserId).toBe(MOCK_CALL.callerUserId)
      expect(state.callId).toBe('')
      expect(state.calleeUserId).toBe('')
    })

    it('显式 reset() 保留 callerDevId / callerUserId', () => {
      const sm = createCallerMachine()
      sm.initInvite({
        ...MOCK_CALL,
        callType: CALL_TYPE.VIDEO_1V1,
        calleeUserId: MOCK_CALL.calleeUserId,
      })
      sm.reset()

      const state = sm.getState()
      expect(state.callerDevId).toBe(MOCK_CALL.callerDevId)
      expect(state.callerUserId).toBe(MOCK_CALL.callerUserId)
    })
  })

  // ═══════════════════════════════════════════════
  // 本地挂断
  // ═══════════════════════════════════════════════

  describe('本地挂断', () => {
    it('IDLE 时 hangup → 忽略', () => {
      const sm = createCallerMachine()
      const r = sm.hangup()
      expect(r.ok).toBe(false)
    })

    it('INVITING 时 hangup(cancel) → 结束', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })

      const r = sm.hangup(HANGUP_REASON.CANCEL)
      expect(r.ok).toBe(true)
      expect(r.events[0]).toMatchObject({ type: 'CALL_ENDED', reason: HANGUP_REASON.CANCEL, duration: 0 })
    })
  })

  // ═══════════════════════════════════════════════
  // alert 状态校验
  // ═══════════════════════════════════════════════

  describe('receiveAlert 状态校验', () => {
    it('非 INVITING 状态收到 alert → 忽略', () => {
      const sm = createCalleeMachine()
      sm.initIncoming({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1 })
      expect(sm.getState().status).toBe(CALL_STATUS.ALERTING)

      const r = sm.receiveAlert(MOCK_CALL.calleeDevId)
      expect(r.ok).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════
  // 媒体状态切换
  // ═══════════════════════════════════════════════

  describe('toggleAudio', () => {
    it('初始 audioEnabled 为 true', () => {
      const sm = createCallerMachine()
      expect(sm.getState().audioEnabled).toBe(true)
    })

    it('toggleAudio → 切换为 false 并触发 LOCAL_AUDIO_CHANGED', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })

      const r = sm.toggleAudio()
      expect(r.ok).toBe(true)
      expect(r.events).toHaveLength(1)
      expect(r.events[0]).toMatchObject({
        type: 'LOCAL_AUDIO_CHANGED',
        enabled: false,
      })
      expect(sm.getState().audioEnabled).toBe(false)
    })

    it('连续 toggleAudio → 状态来回切换', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })

      sm.toggleAudio()
      expect(sm.getState().audioEnabled).toBe(false)

      const r2 = sm.toggleAudio()
      expect(r2.events[0]).toMatchObject({ type: 'LOCAL_AUDIO_CHANGED', enabled: true })
      expect(sm.getState().audioEnabled).toBe(true)
    })

    it('reset 后 audioEnabled 恢复为 true', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })
      sm.toggleAudio()
      expect(sm.getState().audioEnabled).toBe(false)

      sm.reset()
      expect(sm.getState().audioEnabled).toBe(true)
    })
  })

  describe('toggleVideo', () => {
    it('初始 videoEnabled 为 true', () => {
      const sm = createCallerMachine()
      expect(sm.getState().videoEnabled).toBe(true)
    })

    it('toggleVideo → 切换为 false 并触发 LOCAL_VIDEO_CHANGED', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })

      const r = sm.toggleVideo()
      expect(r.ok).toBe(true)
      expect(r.events).toHaveLength(1)
      expect(r.events[0]).toMatchObject({
        type: 'LOCAL_VIDEO_CHANGED',
        enabled: false,
      })
      expect(sm.getState().videoEnabled).toBe(false)
    })

    it('reset 后 videoEnabled 恢复为 true', () => {
      const sm = createCallerMachine()
      sm.initInvite({ ...MOCK_CALL, callType: CALL_TYPE.VIDEO_1V1, calleeUserId: MOCK_CALL.calleeUserId })
      sm.toggleVideo()
      expect(sm.getState().videoEnabled).toBe(false)

      sm.reset()
      expect(sm.getState().videoEnabled).toBe(true)
    })
  })
})
