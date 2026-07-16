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
    status: {
      type: String,
      value: 'loading',
      observer: function (newVal, oldVal) {
        console.log(`[agora-player] status changed from ${oldVal} to ${newVal}`)
      }
    },
    url: {
      type: String,
      value: '',
      observer: function (newVal, oldVal) {
        console.log(`[agora-player] url changed from ${oldVal} to ${newVal}`)
      }
    }
  },

  data: {
    playContext: null,
    detached: false
  },

  methods: {
    start() {
      const uid = this.data.uid
      console.log(`[agora-player] start ${uid}`)
      if (this.data.detached) {
        console.warn('[agora-player] try to start while detached')
        return
      }
      if (this.data.status === 'ok') {
        console.log(`[agora-player] ${uid} already started`)
        return
      }
      if (this.data.playContext) {
        this.data.playContext.play()
      }
    },

    stop() {
      const uid = this.data.uid
      console.log(`[agora-player] stop ${uid}`)
      if (this.data.playContext) {
        this.data.playContext.stop()
      }
    },

    rotate(rotation) {
      const orientation = rotation === 90 || rotation === 270 ? 'horizontal' : 'vertical'
      console.log(`[agora-player] rotation: ${rotation}, orientation: ${orientation}, uid: ${this.data.uid}`)
      this.setData({ orientation })
    },

    playerStateChange(e) {
      this.triggerEvent('statechange', e)
      console.log(`[agora-player] state code: ${e.detail.code}`)

      if (e.detail.code === 2004) {
        console.log(`[agora-player] ${this.data.uid} started playing`)
        if (this.data.status === 'loading') {
          this.setData({ status: 'ok' })
        }
      } else if (e.detail.code === -2301) {
        console.error(`[agora-player] ${this.data.uid} stopped`)
        this.setData({ status: 'error' })
      }
    },

    playerNetStatus(e) {
      this.triggerEvent('netstatus', e)
    }
  },

  ready() {
    console.log(`[agora-player] ready ${this.data.uid}`)
    if (!this.data.playContext) {
      this.data.playContext = wx.createLivePlayerContext(`player-${this.data.uid}`, this)
    }
    if (this.data.url) {
      this.start()
    }
  },

  detached() {
    console.log(`[agora-player] detached ${this.data.uid}`)
    if (this.data.playContext) {
      this.data.playContext.stop()
    }
    this.data.detached = true
  }
})
