const api = window.torr

const els = {
  form: document.getElementById('add-form'),
  input: document.getElementById('magnet-input'),
  pickFile: document.getElementById('pick-file'),
  globalDown: document.getElementById('global-down'),
  globalUp: document.getElementById('global-up'),
  count: document.getElementById('torrent-count'),
  list: document.getElementById('torrent-list'),
  details: document.getElementById('details'),
  downloadPath: document.getElementById('download-path'),
  changeDir: document.getElementById('change-dir'),
  toasts: document.getElementById('toasts'),
  dropZone: document.getElementById('drop-zone'),
  player: document.getElementById('player'),
  playerBox: document.querySelector('.player-box'),
  playerTitle: document.getElementById('player-title'),
  playerClose: document.getElementById('player-close'),
  video: document.getElementById('player-video'),
  audio: document.getElementById('player-audio'),
  image: document.getElementById('player-image'),
  removeDialog: document.getElementById('remove-dialog'),
  removeName: document.getElementById('remove-name'),
  removeFiles: document.getElementById('remove-files'),
  removeConfirm: document.getElementById('remove-confirm'),
  removeCancel: document.getElementById('remove-cancel')
}

const state = {
  snapshot: { torrents: [], stats: {}, downloadPath: '' },
  selectedHash: null,
  removeTarget: null
}

/* ---------------- форматирование ---------------- */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

function fmtBytes (bytes) {
  let value = Number(bytes) || 0
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}

function fmtSpeed (bytes) {
  return `${fmtBytes(bytes)}/s`
}

function fmtPercent (value) {
  return `${Math.min(100, Math.max(0, (Number(value) || 0) * 100)).toFixed(1)}%`
}

function fmtEta (ms) {
  if (!ms || !Number.isFinite(ms) || ms < 0) return '—'
  let seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.floor(seconds / 60)
  seconds %= 60
  if (minutes < 60) return `${minutes} мин ${seconds} с`
  const hours = Math.floor(minutes / 60)
  return `${hours} ч ${minutes % 60} мин`
}

function plural (count, one, few, many) {
  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return many
  if (n1 === 1) return one
  if (n1 >= 2 && n1 <= 4) return few
  return many
}

function escapeHtml (value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/* ---------------- уведомления ---------------- */

function toast (message, kind = 'info') {
  const node = document.createElement('div')
  node.className = `toast ${kind}`
  node.textContent = message
  els.toasts.append(node)
  setTimeout(() => {
    node.style.opacity = '0'
    node.style.transition = 'opacity .25s'
    setTimeout(() => node.remove(), 260)
  }, 4200)
}

/* ---------------- состояние ---------------- */

function selectedTorrent () {
  if (!state.selectedHash) return null
  return state.snapshot.torrents.find(torrent => torrent.infoHash === state.selectedHash) || null
}

function statusOf (torrent) {
  if (!torrent.ready) return { label: 'Получение метаданных…', kind: 'wait' }
  if (torrent.paused) return { label: 'Пауза', kind: 'paused' }
  if (torrent.done) return { label: 'Раздача', kind: 'done' }
  return { label: 'Загрузка', kind: 'down' }
}

/* ---------------- рендер списка ---------------- */

function renderList () {
  const torrents = state.snapshot.torrents
  els.count.textContent = String(torrents.length)

  if (!torrents.length) {
    els.list.innerHTML = '<li class="torrent-item" style="cursor:default;color:#8b96ad;font-size:13px;padding:14px">' +
      'Список пуст. Добавьте magnet-ссылку или .torrent файл.</li>'
    return
  }

  els.list.innerHTML = torrents.map(torrent => {
    const active = torrent.infoHash === state.selectedHash ? ' active' : ''
    const barClass = torrent.done ? 'done' : (torrent.paused ? 'paused' : '')
    const status = statusOf(torrent)
    return `
      <li class="torrent-item${active}" data-hash="${escapeHtml(torrent.infoHash || '')}">
        <div class="row">
          <span class="title">${escapeHtml(torrent.name)}</span>
          <span class="pct">${fmtPercent(torrent.progress)}</span>
        </div>
        <div class="bar ${barClass}"><span style="width:${(torrent.progress * 100).toFixed(1)}%"></span></div>
        <div class="sub">
          <span>${status.label}</span>
          <span>↓ ${fmtSpeed(torrent.downloadSpeed)}</span>
          <span>${torrent.numPeers} пир.</span>
        </div>
      </li>`
  }).join('')
}

/* ---------------- рендер деталей ---------------- */

function renderDetails () {
  const torrent = selectedTorrent()
  if (!torrent) {
    els.details.innerHTML = `
      <div class="empty">
        <div class="big">↓</div>
        <div>Выберите торрент слева или добавьте новый</div>
        <div>Поддерживаются <code>magnet:</code> ссылки, <code>.torrent</code> файлы и drag &amp; drop</div>
      </div>`
    return
  }

  const status = statusOf(torrent)
  const selectedCount = torrent.files.filter(file => file.selected).length
  const allSelected = torrent.files.length > 0 && selectedCount === torrent.files.length
  const filesRows = torrent.files.map(file => `
    <tr>
      <td class="col-check">
        <input type="checkbox" data-file-index="${file.index}" ${file.selected ? 'checked' : ''}>
      </td>
      <td>
        <div class="file-name">
          ${file.media || file.image
            ? `<button class="play-btn" data-play="${file.index}" title="Открыть в плеере">▶</button>`
            : '<span style="width:26px;flex-shrink:0"></span>'}
          <span class="txt${file.selected ? '' : ' dim'}" title="${escapeHtml(file.displayPath || file.path)}">${escapeHtml(file.displayPath || file.path)}</span>
        </div>
      </td>
      <td class="num">${fmtBytes(file.length)}</td>
      <td class="num">${fmtPercent(file.progress)}</td>
    </tr>`).join('')

  const filesBlock = torrent.files.length
    ? `<table class="file-table">
         <thead>
           <tr>
             <th class="col-check"><input type="checkbox" id="files-all" title="Выбрать все" ${allSelected ? 'checked' : ''}></th>
             <th>Файл</th>
             <th style="text-align:right">Размер</th>
             <th style="text-align:right">Готово</th>
           </tr>
         </thead>
         <tbody>${filesRows}</tbody>
       </table>`
    : '<div style="color:#8b96ad;font-size:13px">Метаданные ещё не получены — список файлов появится после обмена с пирами.</div>'

  els.details.innerHTML = `
    <div class="detail-head">
      <div style="min-width:0">
        <div class="detail-title">${escapeHtml(torrent.name)}</div>
        <div class="detail-sub">
          <span>${status.label}</span>
          ${torrent.infoHash ? `<span><code>${escapeHtml(torrent.infoHash)}</code></span>` : ''}
          <span>${torrent.files.length} ${plural(torrent.files.length, 'файл', 'файла', 'файлов')}</span>
          ${torrent.comment ? `<span>${escapeHtml(torrent.comment)}</span>` : ''}
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn small" data-action="pause">${torrent.paused ? 'Продолжить' : 'Пауза'}</button>
        <button class="btn small" data-action="folder">Папка</button>
        <button class="btn small" data-action="copy">Magnet</button>
        <button class="btn small danger" data-action="remove">Удалить</button>
      </div>
    </div>

    <div class="progress-row">
      <div class="bar ${torrent.done ? 'done' : ''}"><span style="width:${(torrent.progress * 100).toFixed(1)}%"></span></div>
      <div class="pct">${fmtPercent(torrent.progress)}</div>
    </div>

    <div class="meta-grid">
      ${metaCard('Размер', fmtBytes(torrent.length))}
      ${metaCard('Скачано', fmtBytes(torrent.downloaded))}
      ${metaCard('Загрузка', fmtSpeed(torrent.downloadSpeed))}
      ${metaCard('Отдача', fmtSpeed(torrent.uploadSpeed))}
      ${metaCard('Пиры', String(torrent.numPeers))}
      ${metaCard('Осталось', torrent.done ? '—' : fmtEta(torrent.timeRemaining))}
    </div>

    <div class="section-title">
      <span>Файлы</span>
      <span>${selectedCount} из ${torrent.files.length} выбрано</span>
    </div>
    ${filesBlock}
  `

  const allBox = els.details.querySelector('#files-all')
  if (allBox) allBox.indeterminate = selectedCount > 0 && selectedCount < torrent.files.length
}

function metaCard (key, value) {
  return `<div class="meta-card"><div class="k">${key}</div><div class="v">${value}</div></div>`
}

/* ---------------- общий рендер ---------------- */

function render () {
  const scrollDetails = els.details.scrollTop
  const scrollList = els.list.scrollTop

  if (state.selectedHash && !state.snapshot.torrents.some(t => t.infoHash === state.selectedHash)) {
    state.selectedHash = null
  }
  if (!state.selectedHash && state.snapshot.torrents.length) {
    state.selectedHash = state.snapshot.torrents[0].infoHash
  }

  els.globalDown.textContent = fmtSpeed(state.snapshot.stats.downloadSpeed)
  els.globalUp.textContent = fmtSpeed(state.snapshot.stats.uploadSpeed)
  els.downloadPath.textContent = state.snapshot.downloadPath || '—'
  els.downloadPath.title = state.snapshot.downloadPath || ''

  renderList()
  renderDetails()

  els.details.scrollTop = scrollDetails
  els.list.scrollTop = scrollList
}

/* ---------------- действия ---------------- */

async function addTorrent (payload) {
  const result = await api.add(payload)
  if (!result.ok) {
    toast(result.error || 'Не удалось добавить торрент', 'error')
    return
  }
  toast('Торрент добавлен', 'success')
  if (result.infoHash) state.selectedHash = result.infoHash
  await refresh()
}

async function refresh () {
  state.snapshot = await api.snapshot()
  render()
}

async function addFromInput () {
  const value = els.input.value.trim()
  if (!value) return
  els.input.value = ''

  if (/\.torrent$/i.test(value) && !value.startsWith('magnet:')) {
    await addTorrent({ filePath: value })
    return
  }
  await addTorrent({ magnet: value })
}

/* ---------------- события ---------------- */

els.form.addEventListener('submit', event => {
  event.preventDefault()
  addFromInput()
})

els.pickFile.addEventListener('click', async () => {
  const result = await api.pickTorrentFile()
  if (!result.ok) return
  for (const filePath of result.filePaths) {
    await addTorrent({ filePath })
  }
})

els.changeDir.addEventListener('click', async () => {
  const result = await api.pickDownloadDir()
  if (result.ok) {
    toast(`Папка загрузок: ${result.downloadPath}`, 'success')
    await refresh()
  }
})

els.list.addEventListener('click', event => {
  const item = event.target.closest('.torrent-item[data-hash]')
  if (!item) return
  state.selectedHash = item.dataset.hash || null
  render()
})

els.details.addEventListener('click', async event => {
  const torrent = selectedTorrent()
  if (!torrent) return

  const playButton = event.target.closest('[data-play]')
  if (playButton) {
    const file = torrent.files[Number(playButton.dataset.play)]
    if (file) openPlayer(file, torrent)
    return
  }

  const actionButton = event.target.closest('[data-action]')
  if (!actionButton) return

  const action = actionButton.dataset.action

  if (action === 'pause') {
    await api.setPaused({ infoHash: torrent.infoHash, paused: !torrent.paused })
    await refresh()
  }

  if (action === 'folder') {
    const result = await api.openFolder(torrent.infoHash)
    if (!result.ok) toast(result.error || 'Не удалось открыть папку', 'error')
  }

  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(torrent.magnetURI)
      toast('Magnet-ссылка скопирована', 'success')
    } catch {
      toast('Не удалось скопировать ссылку', 'error')
    }
  }

  if (action === 'remove') {
    state.removeTarget = torrent
    els.removeName.textContent = torrent.name
    els.removeFiles.checked = false
    els.removeDialog.showModal()
  }
})

els.details.addEventListener('change', async event => {
  const torrent = selectedTorrent()
  if (!torrent) return

  if (event.target.id === 'files-all') {
    const result = await api.setAllFilesSelected({ infoHash: torrent.infoHash, selected: event.target.checked })
    if (!result.ok) toast(result.error || 'Не удалось изменить выбор файлов', 'error')
    await refresh()
    return
  }

  const checkbox = event.target.closest('input[data-file-index]')
  if (!checkbox) return
  const index = Number(checkbox.dataset.fileIndex)
  const result = await api.setFileSelected({ infoHash: torrent.infoHash, index, selected: checkbox.checked })
  if (!result.ok) toast(result.error || 'Не удалось изменить выбор файла', 'error')
  await refresh()
})

els.removeCancel.addEventListener('click', () => {
  els.removeDialog.close()
  state.removeTarget = null
})

els.removeConfirm.addEventListener('click', async () => {
  const target = state.removeTarget
  els.removeDialog.close()
  state.removeTarget = null
  if (!target) return
  const result = await api.remove({ infoHash: target.infoHash, deleteFiles: els.removeFiles.checked })
  if (!result.ok) {
    toast(result.error || 'Не удалось удалить торрент', 'error')
    return
  }
  toast(els.removeFiles.checked ? 'Торрент и файлы удалены' : 'Торрент удалён из списка', 'success')
  await refresh()
})

/* ---------------- плеер ---------------- */

function openPlayer (file, torrent) {
  els.playerTitle.textContent = `${torrent.name} — ${file.name}`
  els.video.classList.add('hidden')
  els.audio.classList.add('hidden')
  els.image.classList.add('hidden')

  const target = file.media && /\.(mp3|flac|wav|m4a|aac|opus|oga|weba)$/i.test(file.name)
    ? els.audio
    : (file.image ? els.image : els.video)

  target.classList.remove('hidden')
  target.src = file.streamUrl
  els.player.classList.remove('hidden')
}

function closePlayer () {
  els.player.classList.add('hidden')
  for (const media of [els.video, els.audio, els.image]) {
    media.pause?.()
    media.removeAttribute('src')
    media.load?.()
  }
}

els.playerClose.addEventListener('click', closePlayer)
els.player.addEventListener('click', event => {
  if (!els.playerBox.contains(event.target)) closePlayer()
})
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !els.player.classList.contains('hidden')) closePlayer()
})

/* ---------------- drag & drop ---------------- */

let dragDepth = 0

window.addEventListener('dragenter', event => {
  event.preventDefault()
  dragDepth++
  els.dropZone.classList.remove('hidden')
})

window.addEventListener('dragover', event => {
  event.preventDefault()
})

window.addEventListener('dragleave', event => {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) els.dropZone.classList.add('hidden')
})

window.addEventListener('drop', async event => {
  event.preventDefault()
  dragDepth = 0
  els.dropZone.classList.add('hidden')

  const files = [...(event.dataTransfer?.files || [])]
  if (!files.length) return

  for (const file of files) {
    const filePath = api.pathForFile(file)
    if (!filePath) continue
    if (!/\.torrent$/i.test(filePath)) {
      toast(`Пропущен ${file.name}: поддерживаются только .torrent`, 'error')
      continue
    }
    await addTorrent({ filePath })
  }
})

/* ---------------- подписки ---------------- */

api.onUpdate(snapshot => {
  state.snapshot = snapshot
  render()
})

api.onToast(({ message, kind }) => toast(message, kind))

/* ---------------- старт ---------------- */

;(async () => {
  const info = await api.getState()
  state.snapshot.downloadPath = info.downloadPath
  await refresh()
})()
