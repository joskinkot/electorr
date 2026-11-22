import { spawn } from 'node:child_process'
import path from 'node:path'

const electron = path.resolve('node_modules/electron/dist/electron.exe')
const args = process.argv.slice(2)

const child = spawn(electron, args, { stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', d => { out += d })
child.stderr.on('data', d => { out += d })

const timer = setTimeout(() => {
  console.log('TIMEOUT')
  child.kill()
  process.exit(1)
}, 40000)

child.on('exit', code => {
  clearTimeout(timer)
  console.log('exit code:', code)
  console.log('output:', out.trim())
  process.exit(0)
})
