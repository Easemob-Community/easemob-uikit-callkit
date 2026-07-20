Component({
  properties: {
    width: { type: Number, value: 0 },
    height: { type: Number, value: 0 },
    x: { type: Number, value: 0 },
    y: { type: Number, value: 0 },
    debug: { type: Boolean, value: false },
    orientation: { type: String, value: 'vertical' },
    name: { type: String, value: '' },
    uid: { type: String, value: '' },
    logger: {
      type: Object,
      value: null
    },
    status: {
      type: String,
      value: 'loading',
      observer: function (newVal, oldVal) {
        const log = this.getLog()
        log.debug(`[agora-player] status changed from ${oldVal} to ${newVal}`)
      }
    },
    url: {
      type: String,
      value: '',
      observer: function (newVal, oldVal) {
        const log = this.getLog()
        log.debug(`[agora-player] url changed from ${oldVal} to ${newVal}`)
      }
    }
  },

  data: {
    playContext: null,
    detached: false
  },

  methods: {
    getLog() {
      return this.data.logger || console
    },

    start() {
      const uid = this.data.uid
      const log = this.getLog()
      log.debug(`[agora-player] start ${uid}`)
      if (this.data.detached) {
        log.warn('[agora-player] try to start while detached')
        return
      }
      if (this.data.status === 'ok') {
        log.debug(`[agora-player] ${uid} already started`)
        return
      }
      if (this.data.playContext) {
        this.data.playContext.play()
      }
    },

    stop() {
      const uid = this.data.uid
      const log = this.getLog()
      log.debug(`[agora-player] stop ${uid}`)
      if (this.data.playContext) {
        this.data.playContext.stop()
      }
    },

    rotate(rotation) {
      const orientation = rotation === 90 || rotation === 270 ? 'horizontal' : 'vertical'
      const log = this.getLog()
      log.debug(`[agora-player] rotation: ${rotation}, orientation: ${orientation}, uid: ${this.data.uid}`)
      this.setData({ orientation })
    },

    playerStateChange(e) {
      const log = this.getLog()
      this.triggerEvent('statechange', e)
      log.debug(`[agora-player] state code: ${e.detail.code}`)

      if (e.detail.code === 2004) {
        log.debug(`[agora-player] ${this.data.uid} started playing`)
        if (this.data.status === 'loading') {
          this.setData({ status: 'ok' })
        }
      } else if (e.detail.code === -2301) {
        log.error(`[agora-player] ${this.data.uid} stopped`)
        this.setData({ status: 'error' })
      }
    },

    playerNetStatus(e) {
      this.triggerEvent('netstatus', e)
    }
  },

  ready() {
    const log = this.getLog()
    log.debug(`[agora-player] ready ${this.data.uid}`)
    if (!this.data.playContext) {
      this.data.playContext = wx.createLivePlayerContext(`player-${this.data.uid}`, this)
    }
    if (this.data.url) {
      this.start()
    }
  },

  detached() {
    const log = this.getLog()
    log.debug(`[agora-player] detached ${this.data.uid}`)
    if (this.data.playContext) {
      this.data.playContext.stop()
    }
    this.data.detached = true
  }
})
