# Draws the launcher icon (green felt, two cards, "101") and saves it in every screen density.
Add-Type -AssemblyName System.Drawing
$root = $PSScriptRoot

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

$S = 512
$bmp = New-Object System.Drawing.Bitmap $S, $S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)

# felt
$bg = RoundRect 0 0 $S $S 112
$rect = New-Object System.Drawing.RectangleF 0, 0, $S, $S
$felt = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 25, 122, 72)), ([System.Drawing.Color]::FromArgb(255, 9, 58, 34)), 90
$g.FillPath($felt, $bg)

function Card([float]$cx, [float]$cy, [float]$angle, [System.Drawing.Brush]$fill) {
    $st = $g.Save()
    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform($angle)
    $shadow = RoundRect -122 -164 252 344 30
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 0, 0, 0))), $shadow)
    $card = RoundRect -126 -172 252 344 30
    $g.FillPath($fill, $card)
    $g.Restore($st)
}

# a card back behind, a white card in front
$back = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 148, 40, 54))
Card 200 262 -14 $back
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 253, 253, 248))
Card 288 262 8 $white

# "101" across the front card
$st = $g.Save()
$g.TranslateTransform(288, 262)
$g.RotateTransform(8)
$font = New-Object System.Drawing.Font 'Arial', 104, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 200, 35, 44))
$g.DrawString('101', $font, $red, 0, -34, $fmt)
$suit = New-Object System.Drawing.Font 'Segoe UI Symbol', 92, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 27, 27, 27))
$g.DrawString([string][char]0x2660, $suit, $ink, 0, 84, $fmt)
$g.Restore($st)
$g.Dispose()

$sizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($k in $sizes.Keys) {
    $n = $sizes[$k]
    $dir = "$root\res\mipmap-$k"
    New-Item -ItemType Directory -Force $dir | Out-Null
    $small = New-Object System.Drawing.Bitmap $n, $n
    $sg = [System.Drawing.Graphics]::FromImage($small)
    $sg.InterpolationMode = 'HighQualityBicubic'
    $sg.PixelOffsetMode = 'HighQuality'
    $sg.DrawImage($bmp, 0, 0, $n, $n)
    $sg.Dispose()
    $small.Save("$dir\ic_launcher.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $small.Dispose()
}
$bmp.Save("$root\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)
"OK: icons in $root\res"
