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
    status: {
      type: String,
      value: 'loading',
      observer: function (newVal, oldVal) {
        console.log(`[agora-pusher] status changed from ${oldVal} to ${newVal}`)
      }
    },
    url: {
      type: String,
      value: '',
      observer: function (newVal, oldVal) {
        console.log(`[agora-pusher] url changed from ${oldVal} to ${newVal}`)
      }
    }
  },

  data: {
    pusherContext: null,
    detached: false
  },

  methods: {
    start() {
      console.log('[agora-pusher] start')
      if (this.data.detached) {
        console.warn('[agora-pusher] try to start while detached')
        return
      }
      if (this.data.pusherContext) {
        this.data.pusherContext.stop()
        this.data.pusherContext.start()
      }
    },

    stop() {
      console.log('[agora-pusher] stop')
      if (this.data.pusherContext) {
        this.data.pusherContext.stop()
      }
    },

    switchCamera() {
      console.log('[agora-pusher] switchCamera')
      if (this.data.pusherContext) {
        this.data.pusherContext.switchCamera()
      }
    },

    recorderStateChange(e) {
      this.triggerEvent('statechange', e)
      console.log(`[agora-pusher] state code: ${e.detail.code} - ${e.detail.message}`)

      if (e.detail.code === -1307) {
        console.error('[agora-pusher] push failed')
        this.setData({ status: 'error' })
        this.triggerEvent('pushfailed')
      } else if (e.detail.code === 1008) {
        console.log('[agora-pusher] started')
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
    console.log('[agora-pusher] ready')
    if (!this.data.pusherContext) {
      this.data.pusherContext = wx.createLivePusherContext(this)
    }
  },

  detached() {
    console.log('[agora-pusher] detached')
    if (this.data.pusherContext) {
      this.data.pusherContext.stop()
    }
    this.data.detached = true
  }
})
