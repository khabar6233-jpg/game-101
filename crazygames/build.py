# The CrazyGames archive: the same game as www/, with the CrazyGames SDK v3 and window.PLATFORM_101 = 'crazygames'
# (index.html then keeps to the platform's rules: no links out, no voice chat, gameplay start/stop, invitations by their links).
#   python crazygames/build.py   ->  crazygames/101-crazygames.zip  (index.html at the root)
import io, os, re, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WWW = os.path.join(ROOT, 'www')
OUT = os.path.join(ROOT, 'crazygames', '101-crazygames.zip')
SKIP = {'101.apk', 'privacy.html', 'version.txt', 'vk-bridge.js'}

html = io.open(os.path.join(WWW, 'index.html'), encoding='utf-8').read()
html = re.sub(r'<meta property="og:[^"]+" content="[^"]*">\n', '', html)
assert '</head>' in html
html = html.replace('</head>', '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n'
                    '<script>window.PLATFORM_101 = \'crazygames\';</script>\n</head>', 1)
ver = re.search(r'const VERSION = (\d+)', html).group(1)

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('index.html', html)
    for base, dirs, files in os.walk(WWW):
        for f in files:
            rel = os.path.relpath(os.path.join(base, f), WWW).replace(os.sep, '/')
            if rel in SKIP or rel == 'index.html':
                continue
            assert re.fullmatch(r'[A-Za-z0-9_./-]+', rel), rel
            z.write(os.path.join(base, f), rel)
infos = zipfile.ZipFile(OUT).infolist()
print(f'OK: {OUT} (version {ver}, {len(infos)} files, {sum(i.file_size for i in infos) // 1024} KB unpacked)')
