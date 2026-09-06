import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const backend = spawn(process.execPath, [join(root, 'backend', 'server', 'index.mjs')], {
  cwd: join(root, 'backend'),
  env: { ...process.env, QUANT_PORT: '8810', QUANT_DB_PATH: join(root, 'data', 'quant.db') },
  stdio: 'inherit',
})
const frontend = spawn('npm', ['run', 'dev', '--', '--hostname', '0.0.0.0', '--port', '4180'], {
  cwd: join(root, 'frontend'),
  env: { ...process.env, NODE_ENV: 'development', QUANT_WORKER_URL: 'http://127.0.0.1:8810' },
  stdio: 'inherit',
})
const stop = () => { backend.kill(); frontend.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
backend.on('exit', (code) => { if (code && code !== 0) console.error(`[recovered backend] exited ${code}`) })
frontend.on('exit', (code) => { if (code && code !== 0) console.error(`[recovered frontend] exited ${code}`) })
