import { createApp } from 'vue'
import EasemobChatCallKit from '@easemob/callkit-vue3'
import App from './App.vue'
import router from './router'
import '@easemob/callkit-vue3/style.css'

const app = createApp(App)
app.use(router)
app.use(EasemobChatCallKit)
app.mount('#app')
