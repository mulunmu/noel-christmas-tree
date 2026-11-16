import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 相对 base：既能在域名根目录部署，也能放在子路径（如 GitHub Pages /repo/）下
  base: './',
  plugins: [react()],
  server: {
    // 某些编辑器/工具在 src 下写临时文件再重命名，
    // 在 Windows 上会让 Vite 的文件监听报 EBUSY 而直接崩溃，这里忽略这类临时文件；
    // 同时用轮询监听，避免 rename 事件丢失导致 HMR/缓存不更新。
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/*.tmp'],
      usePolling: process.platform === 'win32',
      interval: 300,
    },
  },
})
