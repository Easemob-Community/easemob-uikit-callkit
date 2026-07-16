/**
 * 插件入口
 *
 * 为什么需要这个文件：
 * HBuilderX 解析 `@/uni_modules/easemob-callkit-mp-weixin` 时，会定位到插件根目录。
 * 如果没有 index.ts/index.js，UniApp 无法确定从哪个文件导入，会报 Cannot find module。
 */
export * from './src/index.ts'
