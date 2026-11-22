import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import WebTorrent from 'webtorrent'

const MEDIA_RE = /\.(mp4|m4v|webm|mkv|mov|ogv|ogm|mp3|flac|wav|m4a|aac|opus|oga|weba)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

/**
 * Обёртка над WebTorrent: жизненный цикл торрентов, стриминг-сервер,
 * выбор файлов и сериализация состояния для рендерера.
 */
export class TorrentManager extends EventEmitter {
  constructor ({ downloadPath }) {
    super()
    this.downloadPath = downloadPath
    this.port = null
    this.server = null
    this.client = new WebTorrent({ maxConns: 100, utp: false })    /** @type {Map<string, Set<number>>} выбранные файлы по infoHash */
    this.selections = new Map()
  }

  async init () {
    this.client.on('error', err => this.emit('fatal', err))
    this.client.on('warning', err => this.emit('warning', err))

    // Локальный HTTP-сервер для стриминга файлов в плеер (Range-запросы поддержаны).
    this.server = this.client.createServer({ hostname: '127.0.0.1' })
    await new Promise((resolve, reject) => {
      this.server.server.once('error', reject)
      this.server.server.listen(0, '127.0.0.1', resolve)
    })
    this.port = this.server.server.address().port
  }

  setDownloadPath (dir) {
    this.downloadPath = dir
  }

  async add ({ magnet, filePath, paused = false }) {
    let torrentId
    if (filePath) {
      torrentId = fs.readFileSync(filePath)
    } else {
      torrentId = String(magnet || '').trim()
      if (!torrentId) throw new Error('Пустая ссылка')
    }

    const duplicate = await this.client.get(torrentId).catch(() => null)
    if (duplicate) throw new Error('Этот торрент уже добавлен')

    const torrent = this.client.add(torrentId, { path: this.downloadPath, paused })

    torrent.on('error', err => {
      this.emit('torrent-error', {
        name: torrent.name || torrent.infoHash || 'торрент',
        message: err.message
      })
    })
    torrent.on('ready', () => {
      if (!this.selections.has(torrent.infoHash)) {
        this.selections.set(torrent.infoHash, new Set(torrent.files.map((_, i) => i)))
      }
      this.emit('changed')
    })
    torrent.on('done', () => this.emit('changed'))
    torrent.on('idle', () => this.emit('changed'))

    return { infoHash: torrent.infoHash }
  }

  async remove (infoHash, deleteFiles = false) {
    const torrent = await this.client.get(infoHash)
    if (!torrent) return false
    await new Promise(resolve => torrent.destroy({ destroyStore: !!deleteFiles }, () => resolve()))
    this.selections.delete(infoHash)
    this.emit('changed')
    return true
  }

  async setPaused (infoHash, paused) {
    const torrent = await this.client.get(infoHash)
    if (!torrent) return false
    if (paused) torrent.pause()
    else torrent.resume()
    this.emit('changed')
    return true
  }

  async setFileSelected (infoHash, index, selected) {
    const torrent = await this.client.get(infoHash)
    if (!torrent) return false
    const file = torrent.files[index]
    if (!file) return false

    const set = new Set(this.selections.get(infoHash) || torrent.files.map((_, i) => i))
    if (selected) set.add(index)
    else set.delete(index)

    this.applySelection(torrent, set)
    this.selections.set(infoHash, set)
    this.emit('changed')
    return true
  }

  async setAllFilesSelected (infoHash, selected) {
    const torrent = await this.client.get(infoHash)
    if (!torrent) return false
    const set = selected ? new Set(torrent.files.map((_, i) => i)) : new Set()
    this.applySelection(torrent, set)
    this.selections.set(infoHash, set)
    this.emit('changed')
    return true
  }

  /**
   * Пересобирает выбор файлов. Куски на границах файлов общие, поэтому
   * простой `file.deselect()` у соседа отрезает нужные выбранным файлам
   * куски — сбрасываем всё и выбираем заново.
   */
  applySelection (torrent, set) {
    torrent.files.forEach(file => file.deselect())
    torrent.files.forEach((file, index) => {
      if (set.has(index)) file.select()
    })
  }

  /** Каталог, в который торрент реально пишет файлы. */
  async folderFor (infoHash) {
    const torrent = await this.client.get(infoHash)
    if (!torrent) return null
    const first = torrent.files?.[0]
    if (!first) return this.downloadPath
    const dir = path.dirname(first.path)
    return dir === '.' ? this.downloadPath : path.join(this.downloadPath, dir)
  }

  /** Список торрентов для восстановления после перезапуска. */
  persisted () {
    return this.client.torrents
      .filter(torrent => torrent.magnetURI && !torrent.destroyed)
      .map(torrent => ({ torrentId: torrent.magnetURI, paused: !!torrent.paused }))
  }

  snapshot () {
    return {
      port: this.port,
      downloadPath: this.downloadPath,
      stats: {
        downloadSpeed: this.client.downloadSpeed,
        uploadSpeed: this.client.uploadSpeed,
        progress: this.client.progress,
        ratio: this.client.ratio
      },
      torrents: this.client.torrents
        .filter(torrent => !torrent.destroyed)
        .map(torrent => this.serialize(torrent))
    }
  }

  serialize (torrent) {
    const selected = this.selections.get(torrent.infoHash)
    const files = (torrent.files || []).map((file, index) => ({
      index,
      name: file.name,
      path: file.path,
      displayPath: String(file.path).replace(/\\/g, '/'),
      length: file.length,
      downloaded: file.downloaded || 0,
      progress: file.progress || 0,
      selected: selected ? selected.has(index) : true,
      media: MEDIA_RE.test(file.name),
      image: IMAGE_RE.test(file.name),
      streamUrl: this.streamUrlFor(file)
    }))

    return {
      infoHash: torrent.infoHash || null,
      name: torrent.name || (torrent.infoHash ? torrent.infoHash.slice(0, 16) : 'Получение метаданных…'),
      magnetURI: torrent.magnetURI || null,
      ready: !!torrent.ready,
      progress: torrent.progress || 0,
      downloaded: torrent.downloaded || 0,
      uploaded: torrent.uploaded || 0,
      downloadSpeed: torrent.downloadSpeed || 0,
      uploadSpeed: torrent.uploadSpeed || 0,
      numPeers: torrent.numPeers || 0,
      length: torrent.length || 0,
      ratio: torrent.ratio || 0,
      done: !!torrent.done,
      paused: !!torrent.paused,
      timeRemaining: torrent.timeRemaining ?? null,
      path: torrent.path || this.downloadPath,
      announce: torrent.announce || [],
      created: torrent.created ? new Date(torrent.created).toISOString() : null,
      comment: torrent.comment || null,
      files
    }
  }

  streamUrlFor (file) {
    try {
      return `http://127.0.0.1:${this.port}${file.streamURL}`
    } catch {
      return null
    }
  }

  async destroy () {
    if (this.server) {
      try { this.server.close() } catch {}
    }
    await new Promise(resolve => this.client.destroy(() => resolve()))
  }
}
