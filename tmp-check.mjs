const port = process.env.CDP_PORT || '9224'
const mode = process.argv[2] || 'check'
const MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337'

const sleep = ms => new Promise(r => setTimeout(r, ms))

let target
for (let i = 0; i < 60 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find(t => t.type === 'page' && /index\.html$/.test(t.url))
  } catch {}
  if (!target) await sleep(250)
}
if (!target) throw new Error('no target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
})

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const msgId = ++id
  pending.set(msgId, { resolve, reject })
  ws.send(JSON.stringify({ id: msgId, method, params }))
})

const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')

if (mode === 'add') {
  console.log('add:', await evaluate(`window.torr.add({ magnet: ${JSON.stringify(MAGNET)} })`))
  await sleep(3000)
}
if (mode === 'toggle') {
  await evaluate(`(() => { const c = document.querySelector('input[data-file-index]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(1200)
  console.log('unchecked:', await evaluate('document.querySelector(".section-title span:last-child")?.textContent'))
  await evaluate(`(() => { const c = document.querySelector('input[data-file-index]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(1200)
  console.log('rechecked:', await evaluate('document.querySelector(".section-title span:last-child")?.textContent'))
}

console.log('torrents:', await evaluate('document.querySelectorAll(".torrent-item[data-hash]").length'))
console.log('detail:', await evaluate('document.querySelector(".detail-title")?.textContent'))
console.log('errors:', await evaluate('document.querySelectorAll(".toast.error").length'))

if (mode === 'quit') await evaluate('window.close()')
ws.close()
