import { spawn } from 'node:child_process'
import path from 'node:path'

const port = '9233'
const electron = path.resolve('node_modules/electron/dist/electron.exe')

const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe']
})
let stderr = ''
child.stdout.on('data', d => { stderr += d })
child.stderr.on('data', d => { stderr += d })
child.on('exit', (code, signal) => {
  console.log('child exited early:', code, signal, stderr.trim())
})

const sleep = ms => new Promise(r => setTimeout(r, ms))

let target
for (let i = 0; i < 60 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find(t => t.type === 'page')
  } catch {}
  if (!target) await sleep(250)
}
if (!target) {
  console.log('no target; stderr:', stderr.trim())
  child.kill()
  process.exit(1)
}
console.log('target url:', target.url)

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id)
    pending.delete(msg.id)
    resolve(msg.result)
  }
})
const send = (method, params = {}) => new Promise(resolve => {
  const msgId = ++id
  pending.set(msgId, { resolve })
  ws.send(JSON.stringify({ id: msgId, method, params }))
})
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')
await sleep(4000)

const count = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".torrent-item[data-hash]").length', returnByValue: true })
console.log('torrents:', count.result.value)

if (process.argv.includes('--add')) {
  const MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337'
  const added = await send('Runtime.evaluate', {
    expression: `window.torr.add({ magnet: ${JSON.stringify(MAGNET)} })`,
    awaitPromise: true,
    returnByValue: true
  })
  console.log('add:', added.result.value)
  await sleep(2000)
  const after = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".torrent-item[data-hash]").length', returnByValue: true })
  console.log('torrents after add:', after.result.value)
}

await send('Runtime.evaluate', { expression: 'window.close()', returnByValue: true })

const result = await new Promise(resolve => {
  const timer = setTimeout(() => resolve({ code: 'TIMEOUT', signal: null }), 30000)
  child.on('exit', (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signal })
  })
})

console.log('exit:', JSON.stringify(result))
console.log('stderr:', stderr.trim() || '(empty)')
process.exit(0)
