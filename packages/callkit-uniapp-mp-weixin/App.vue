<script setup>
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app'

function requestPermissions() {
  const scopes = ['scope.record', 'scope.camera']
  scopes.forEach((scope) => {
    uni.authorize({
      scope,
      success: () => console.log(`[callkit] authorize ${scope} success`),
      fail: () => console.warn(`[callkit] authorize ${scope} fail, user may need manual grant`)
    })
  })
}

onLaunch(() => {
  console.log('[callkit-uniapp-mp-weixin] App Launch')
  requestPermissions()
})

onShow(() => {
  console.log('[callkit-uniapp-mp-weixin] App Show')
})

onHide(() => {
  console.log('[callkit-uniapp-mp-weixin] App Hide')
})
</script>

<style>
/* 全局样式 */
</style>
