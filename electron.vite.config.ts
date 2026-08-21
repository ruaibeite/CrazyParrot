import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/preload/index.ts') } }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        // monaco-editor 0.5x 的 exports 字段使子路径（含 worker）无法按包名解析，直接指到物理路径
        'monaco-editor/esm': resolve('node_modules/monaco-editor/esm')
      }
    },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
