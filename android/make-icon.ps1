# Builds every icon (Android launcher, web, home screen) from android\icon.svg:
# Edge draws the picture at 1024 px, then it is scaled down to each size.
# The square has no rounded corners: phones round them by themselves.
Add-Type -AssemblyName System.Drawing
$root = $PSScriptRoot
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$tmp = Join-Path $env:TEMP 'g101-icon'
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item "$root\icon.svg" "$tmp\icon.svg" -Force
Set-Content "$tmp\icon.html" -Encoding utf8 '<!doctype html><style>html,body{margin:0;background:#000}img{display:block;width:1024px;height:1024px}</style><img src="icon.svg">'
$big = "$tmp\icon-1024.png"
Remove-Item $big -ErrorAction SilentlyContinue
& $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 "--screenshot=$big" "file:///$tmp\icon.html" 2>$null | Out-Null
for ($i = 0; $i -lt 50 -and -not (Test-Path $big); $i++) { Start-Sleep -Milliseconds 200 }
if (-not (Test-Path $big)) { throw "Edge did not draw the icon" }
$src = [System.Drawing.Image]::FromFile($big)

function Render([int]$n) {
    $b = New-Object System.Drawing.Bitmap $n, $n
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'AntiAlias'
    $g.DrawImage($src, 0, 0, $n, $n)
    $g.Dispose()
    return $b
}

$sizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($k in $sizes.Keys) {
    $dir = "$root\res\mipmap-$k"
    New-Item -ItemType Directory -Force $dir | Out-Null
    $b = Render $sizes[$k]; $b.Save("$dir\ic_launcher.png", [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
}
foreach ($n in 180, 192, 512) { $b = Render $n; $b.Save("$root\..\www\icon-$n.png", [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose() }
$b = Render 512; $b.Save("$root\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
$src.Dispose()
"OK"
