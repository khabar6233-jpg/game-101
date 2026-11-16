# 101 — карточная игра

Отвечать коротко, по-русски. В конце каждого ответа — ссылка https://khabar6233-jpg.github.io/game-101/

## Где что
- `www/index.html` — вся игра в одном файле (один IIFE). `const VERSION = N` и `www/version.txt` всегда совпадают; каждая выкладка +1.
- `server/` — Cloudflare Worker «game-101» (https://game-101.game-101-server.workers.dev): `src/index.js` маршруты, `src/relay.js` Durable Object (комнаты, пересылка), `src/admin.html` страница разработчика, D1 база `game101`.
- `android/` — APK-обёртка; сборка `build-apk.ps1`.

## Режимы
- «Короткая» (36 карт) заморожена на v86 (тег `short-v86`) — не менять без отдельного слова пользователя.
- «Длинная» (52 карты, `deckLong`): 7 → +1, 6 → +2, 8 кроет сам (до 3 карт), 10 меняет направление.
- Правила не менять по своему усмотрению — сначала спросить.

## Проверка
- Превью: preview_start `game-101` (порт 8101), вкладки `?pid=tstA`, `?pid=tstB`; ширина 390 и 320.
- После проверки по сети: `cd server && npx wrangler d1 execute game101 --remote --command "DELETE FROM players WHERE pid LIKE 'tst%'"` (Node: `export PATH="/c/Program Files/nodejs:$PATH"`).

## Выкладка (из корня репозитория, Bash)
1. Поднять VERSION в `www/index.html` и `www/version.txt`.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File ./build-apk.ps1` → `cp 101.apk www/101.apk`
3. `git add -A` → коммит от `khabar6233-jpg <khabar6233-jpg@users.noreply.github.com>`
4. `git push origin main` (повторять при сбое сети) → `git subtree push --prefix www origin gh-pages`
5. Ждать, пока https://khabar6233-jpg.github.io/game-101/version.txt покажет новую версию.
