# 101 — карточная игра

Отвечать коротко, по-русски. В конце каждого ответа — ссылка https://khabar6233-jpg.github.io/game-101/

## Где что
- `www/index.html` — вся игра в одном файле (один IIFE). `const VERSION = N` и `www/version.txt` всегда совпадают; каждая выкладка +1. `const PROTO` — язык телефон↔сервер для комнат: поднимать только при несовместимом изменении сообщений.
- `server/` — Cloudflare Worker «game-101» (https://game-101.game-101-server.workers.dev): `src/index.js` маршруты, `src/relay.js` Durable Object (пересылка + столы комнат), `src/admin.html` страница разработчика, D1 база `game101`.
- Сетевые комнаты (с v110) играются на сервере: телефон только показывает свой вид и шлёт нажатия. Стол = `server/src/table-pre.js` + правила + `server/src/table-post.js`. Правила НЕ копируются: `server/build-engine.mjs` вырезает их из `www/index.html` между метками `@engine-begin/@engine-end` в `src/engine.gen.js` (сам, перед каждым `wrangler deploy`). Игра с ботами — на телефоне, тем же кодом правил.
- `android/` — APK-обёртка; сборка `build-apk.ps1` (versionCode = VERSION; подпись ключом из `Desktop/101-keys`, не в git — без него отладочный ключ). Пакет для RuStore: `Desktop/101-rustore`. Иконки: `android/icon.svg` → `android/make-icon.ps1`.
- Резервная копия v109 (до переноса на сервер): тег `backup-v109`, папка `Desktop/101-backup-v109`.

## Режимы
- «Короткая» (36 карт) заморожена на v86 (тег `short-v86`) — не менять без отдельного слова пользователя.
- «Длинная» (52 карты, `deckLong`): 7 → +1, 6 → +2, 8 кроет сам (до 3 карт), 10 меняет направление.
- Правила не менять по своему усмотрению — сначала спросить.

## Проверка
- Сервер без сервера: `cd server && npm test` (сотни партий через настоящий серверный стол; должно быть «ALL OK»). Гонять после любой правки правил или `table-*.js`.
- Превью: preview_start `game-101` (порт 8101), вкладки `?pid=tstA`, `?pid=tstB`; ширина 390 и 320.
- Локальная копия сервера: preview_start `game-101-server` (`server/dev.cmd`, порт 8787), игру открыть с `?srv=http://127.0.0.1:8787` (работает только на localhost).
- После проверки по сети: `cd server && npx wrangler d1 execute game101 --remote --command "DELETE FROM players WHERE pid LIKE 'tst%'"` (Node: `export PATH="/c/Program Files/nodejs:$PATH"`).

## Выкладка (из корня репозитория, Bash)
1. Поднять VERSION в `www/index.html` и `www/version.txt`.
2. Если менялись правила или `server/`: `cd server && npm test && npx wrangler deploy` (узел связи переключается на новый код за 2–5 минут).
3. `powershell -NoProfile -ExecutionPolicy Bypass -File ./build-apk.ps1` → `cp 101.apk www/101.apk`
4. `git add -A` → коммит от `khabar6233-jpg <khabar6233-jpg@users.noreply.github.com>`
5. `git push origin main` (повторять при сбое сети) → `git subtree push --prefix www origin gh-pages`
6. Ждать, пока https://khabar6233-jpg.github.io/game-101/version.txt покажет новую версию.
