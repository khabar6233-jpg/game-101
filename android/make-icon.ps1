# Builds every icon (Android launcher, web, home screen) from android\icon-source.png:
# the card is centred on a black square with a soft golden glow, so nothing of it is cut off.
Add-Type -AssemblyName System.Drawing
$root = $PSScriptRoot
$src = [System.Drawing.Image]::FromFile("$root\icon-source.png")

function Render([int]$n) {
    $b = New-Object System.Drawing.Bitmap $n, $n
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Black)
    # a warm glow behind the card
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddEllipse([float](-0.1 * $n), [float](-0.1 * $n), [float](1.2 * $n), [float](1.2 * $n))
    $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush $p
    $glow.CenterColor = [System.Drawing.Color]::FromArgb(255, 58, 40, 8)
    $glow.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
    $g.FillRectangle($glow, 0, 0, $n, $n)
    # the card: the source without its empty black margins, as tall as the square allows
    $crop = New-Object System.Drawing.Rectangle 20, 130, ($src.Width - 40), ($src.Height - 230)
    $h = [float]($n * 0.96); $w = [float]($h * $crop.Width / $crop.Height)
    $dst = New-Object System.Drawing.RectangleF ([float](($n - $w) / 2)), ([float](($n - $h) / 2)), $w, $h
    $g.DrawImage($src, $dst, $crop, [System.Drawing.GraphicsUnit]::Pixel)
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
"OK"
