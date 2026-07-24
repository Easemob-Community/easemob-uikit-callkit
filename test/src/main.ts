import { createApp } from 'vue'
import EasemobChatCallKit from '@easemob-community/callkit-vue3'
import App from './App.vue'
import router from './router'
import '@easemob-community/callkit-vue3/style.css'

declare const __CALLKIT_TEST_MODE__: string
declare const __CALLKIT_VERSION__: string
declare const __CALLKIT_VUE3_VERSION__: string | undefined

console.info(
  `%c[CallKit Test] mode=${__CALLKIT_TEST_MODE__}, coreVersion=${__CALLKIT_VERSION__}, vue3Version=${typeof __CALLKIT_VUE3_VERSION__ !== 'undefined' ? __CALLKIT_VUE3_VERSION__ : '(from tgz dist)'}`,
  'color: #f59e0b; font-weight: bold;'
)

const app = createApp(App)
app.use(router)
app.use(EasemobChatCallKit)
app.mount('#app')
