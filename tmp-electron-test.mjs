import { app } from 'electron'

const mode = process.argv.find(a => a.startsWith('--mode='))?.slice(7) || 'e'
const MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337'

const options = {
  e: {},
  f: { dht: false, tracker: false, lsd: false, utp: false },
  g: { dht: false, lsd: false, utp: false },
  h: { tracker: false, lsd: false, utp: false },
  i: { dht: false, tracker: false, lsd: false }
}

app.whenReady().then(async () => {
  console.log('mode', mode)
  const { default: WebTorrent } = await import('webtorrent')
  const client = new WebTorrent(options[mode] || {})
  client.add(MAGNET)
  console.log('torrent added, waiting')

  setTimeout(() => {
    if (mode === 'j') return
    if (mode === 'k') {
      client.destroy(() => {
        console.log('destroyed')
        setTimeout(() => app.exit(0), 300)
      })
      return
    }
    console.log('exiting')
    app.exit(0)
  }, 6000)
})
