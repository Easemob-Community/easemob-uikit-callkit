Component({
  properties: {
    minBitrate: { type: Number, value: 200 },
    maxBitrate: { type: Number, value: 500 },
    width: { type: Number, value: 0 },
    height: { type: Number, value: 0 },
    x: { type: Number, value: 0 },
    y: { type: Number, value: 0 },
    muted: { type: Boolean, value: false },
    debug: { type: Boolean, value: false },
    beauty: { type: String, value: '0' },
    aspect: { type: String, value: '3:4' },
    enableCamera: { type: Boolean, value: true },
    logger: {
      type: Object,
      value: null
    },
    status: {
      type: String,
      value: 'loading',
      observer: function (newVal, oldVal) {
        const log = this.getLog()
        log.debug(`[agora-pusher] status changed from ${oldVal} to ${newVal}`)
      }
    },
    url: {
      type: String,
      value: '',
      observer: function (newVal, oldVal) {
        const log = this.getLog()
        log.debug(`[agora-pusher] url changed from ${oldVal} to ${newVal}`)
        // autopush 在部分真机/动态赋值场景下可能不自动启动，主动触发一次 start
        if (newVal && newVal !== oldVal) {
          this.start()
        }
      }
    }
  },

  data: {
    pusherContext: null,
    detached: false
  },

  methods: {
    getLog() {
      return this.data.logger || console
    },

    start() {
      const log = this.getLog()
      log.debug('[agora-pusher] start')
      if (this.data.detached) {
        log.warn('[agora-pusher] try to start while detached')
        return
      }
      if (this.data.pusherContext) {
        this.data.pusherContext.stop()
        this.data.pusherContext.start()
      }
    },

    stop() {
      const log = this.getLog()
      log.debug('[agora-pusher] stop')
      if (this.data.pusherContext) {
        this.data.pusherContext.stop()
      }
    },

    switchCamera() {
      const log = this.getLog()
      log.debug('[agora-pusher] switchCamera')
      if (this.data.pusherContext) {
        this.data.pusherContext.switchCamera()
      }
    },

    recorderStateChange(e) {
      const log = this.getLog()
      this.triggerEvent('statechange', e)
      log.debug(`[agora-pusher] state code: ${e.detail.code} - ${e.detail.message}`)

      if (e.detail.code === -1307) {
        log.error('[agora-pusher] push failed')
        this.setData({ status: 'error' })
        this.triggerEvent('pushfailed')
      } else if (e.detail.code === 1008) {
        log.debug('[agora-pusher] started')
        if (this.data.status === 'loading') {
          this.setData({ status: 'ok' })
        }
      }
    },

    recorderNetChange(e) {
      this.triggerEvent('netstatus', e)
    }
  },

  ready() {
    const log = this.getLog()
    log.debug('[agora-pusher] ready')
    if (!this.data.pusherContext) {
      this.data.pusherContext = wx.createLivePusherContext(this)
    }
  },

  detached() {
    const log = this.getLog()
    log.debug('[agora-pusher] detached')
    if (this.data.pusherContext) {
      this.data.pusherContext.stop()
    }
    this.data.detached = true
  }
})
