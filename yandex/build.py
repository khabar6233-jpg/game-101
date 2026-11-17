# The Yandex Games archive: the same game as www/, with the platform's SDK and window.PLATFORM_101 = 'yandex'
# (index.html then keeps to the platform's rules: no links out, the language from the SDK, no voice chat).
#   python yandex/build.py   ->  yandex/101-yandex.zip  (index.html at the root, as Yandex Games wants)
import io, os, re, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WWW = os.path.join(ROOT, 'www')
OUT = os.path.join(ROOT, 'yandex', '101-yandex.zip')
SKIP = {'101.apk', 'privacy.html', 'version.txt', 'vk-bridge.js'}           # nothing that leads away from the platform

html = io.open(os.path.join(WWW, 'index.html'), encoding='utf-8').read()
# link previews for messengers point at the game's site: not needed there
html = re.sub(r'<meta property="og:[^"]+" content="[^"]*">\n', '', html)
assert '</head>' in html
html = html.replace('</head>', '<script src="/sdk.js"></script>\n<script>window.PLATFORM_101 = \'yandex\';</script>\n</head>', 1)
ver = re.search(r'const VERSION = (\d+)', html).group(1)

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('index.html', html)
    for base, dirs, files in os.walk(WWW):
        for f in files:
            rel = os.path.relpath(os.path.join(base, f), WWW).replace(os.sep, '/')
            if rel in SKIP or rel == 'index.html':
                continue
            assert re.fullmatch(r'[A-Za-z0-9_./-]+', rel), rel     # no spaces or Cyrillic in names
            z.write(os.path.join(base, f), rel)
size = sum(i.file_size for i in zipfile.ZipFile(OUT).infolist())
print(f'OK: {OUT} (version {ver}, {size // 1024} KB unpacked)')
