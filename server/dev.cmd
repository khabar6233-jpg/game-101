@echo off
rem A copy of the game server on this computer, for testing: http://127.0.0.1:8787
rem (open the game from localhost with ?srv=http://127.0.0.1:8787)
cd /d %~dp0
"C:\Program Files\nodejs\npx.cmd" wrangler dev --port 8787 --ip 127.0.0.1
