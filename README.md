# torr

Десктопный торрент-клиент на Electron + [WebTorrent](https://webtorrent.io/docs).
Качает по magnet-ссылкам и `.torrent` файлам, раздаёт скачанное и умеет
проигрывать видео/аудио прямо во время загрузки.

## Запуск

```bash
npm install
npm start        # обычный запуск
npm run dev      # + DevTools и логи рендерера в консоли
```

Требуется Node.js 22+ (у WebTorrent 3 такой engines). Electron ставится
как devDependency, отдельно ничего устанавливать не нужно.

## Возможности

- добавление по `magnet:`, по `.torrent` файлу (кнопка «Файл…») и drag & drop;
- список торрентов с прогрессом, скоростями и числом пиров;
- пауза/продолжение, удаление из списка или вместе с файлами;
- выбор отдельных файлов внутри торрента (в т.ч. «выбрать все»);
- встроенный плеер: видео/аудио стримится с локального HTTP-сервера
  (Range-запросы, перемотка) без ожидания полной загрузки;
- «Папка» — открывает каталог торрента в проводнике;
- копирование magnet-ссылки;
- автовосстановление списка торрентов после перезапуска (magnet-ссылки и
  состояние «пауза» хранятся в `%APPDATA%\torr\settings.json`);
- папка загрузок по умолчанию `%USERPROFILE%\Downloads\torr`, меняется в
  интерфейсе.

## Структура

```
src/
  main/
    main.js            — окно, IPC, настройки, восстановление торрентов
    torrent-manager.js — обёртка над WebTorrent, стриминг-сервер, снапшоты
  preload/
    preload.cjs        — contextBridge API (window.torr)
  renderer/
    index.html
    styles.css
    app.js             — интерфейс, рендер, плеер
```

## Как устроено

- WebTorrent живёт в main-процессе (полный TCP/uTP/DHT + WebRTC через
  `node-datachannel`), поэтому доступны обычные торренты, а не только
  WebRTC-пиры.
- Для стриминга поднимается `client.createServer({ hostname: '127.0.0.1' })`
  на случайном порту; рендерер получает готовые `streamUrl` вида
  `http://127.0.0.1:<port>/webtorrent/<infoHash>/<path>` и отдаёт их в
  `<video>`/`<audio>`.
- Раз в секунду main присылает рендереру снапшот состояния
  (`torrents:update`), плюс внеочередные обновления на события торрентов.
- Рендерер изолирован: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, CSP в `index.html`.

## Заметки

- `npm install` сам собирает нативные модули (`node-datachannel`,
  `bufferutil`, `utp-native`) — разрешения прописаны в поле `allowScripts`
  в `package.json` (npm 12 блокирует install-скрипты по умолчанию).
- F12 — DevTools, F5 / Ctrl+R — перезагрузка окна.
- Сборку инсталлятора можно добавить через `electron-builder`; сейчас
  приложение запускается из исходников.
