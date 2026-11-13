# Web icons from android\icon-512.png: a square one for the iPhone home screen and two for browsers.
Add-Type -AssemblyName System.Drawing
$root = $PSScriptRoot
$src = [System.Drawing.Image]::FromFile("$root\icon-512.png")
function Save([int]$n, [bool]$square, [string]$to) {
    $b = New-Object System.Drawing.Bitmap $n, $n
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
    if ($square) {
        $r = New-Object System.Drawing.RectangleF 0, 0, $n, $n
        $felt = New-Object System.Drawing.Drawing2D.LinearGradientBrush $r, ([System.Drawing.Color]::FromArgb(255, 25, 122, 72)), ([System.Drawing.Color]::FromArgb(255, 9, 58, 34)), 90
        $g.FillRectangle($felt, $r)
    }
    $g.DrawImage($src, 0, 0, $n, $n)
    $g.Dispose(); $b.Save($to, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
}
Save 180 $true  "$root\..\www\icon-180.png"
Save 192 $false "$root\..\www\icon-192.png"
Save 512 $false "$root\..\www\icon-512.png"
"OK"
