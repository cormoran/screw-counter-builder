import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function latestCommit(format: string) {
  try {
    return execFileSync('git', ['log', '-1', `--format=${format}`], { encoding: 'utf8' }).trim()
  } catch {
    return '不明'
  }
}

export default defineConfig({
  base: '/screw-counter-builder/',
  plugins: [react()],
  define: {
    __BUILD_COMMIT_HASH__: JSON.stringify(latestCommit('%H')),
    __BUILD_COMMIT_DATE__: JSON.stringify(latestCommit('%cI')),
  },
})
