# Builds 101.apk from www/index.html using only the Android SDK and Android Studio's Java.
$ErrorActionPreference = 'Stop'
$root  = $PSScriptRoot
$sdk   = "$env:LOCALAPPDATA\Android\Sdk"
$bt    = "$sdk\build-tools\36.0.0"
$jar   = "$sdk\platforms\android-37.0\android.jar"
$jbr   = "$env:ProgramFiles\Android\Android Studio\jbr"
$env:JAVA_HOME = $jbr
$env:Path = "$jbr\bin;$env:Path"

$out = "$root\android\build"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force "$out\assets", "$out\classes", "$out\dex" | Out-Null
Copy-Item "$root\www\index.html" "$out\assets\index.html"
if (Test-Path "$out\assets\cards") { Remove-Item "$out\assets\cards" -Recurse -Force }
Copy-Item "$root\www\cards" "$out\assets\cards" -Recurse -Force
Copy-Item "$root\www\backs" "$out\assets\backs" -Recurse -Force

function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed" } }

# the launcher icon (android\res, drawn by android\make-icon.ps1)
& "$bt\aapt2.exe" compile --dir "$root\android\res" -o "$out\res.zip"
Check 'aapt2 compile'

& "$bt\aapt2.exe" link -o "$out\base.apk" -I $jar --manifest "$root\android\AndroidManifest.xml" -A "$out\assets" "$out\res.zip" `
    --min-sdk-version 24 --target-sdk-version 35 --version-code 2 --version-name 2.0
Check 'aapt2'

& "$jbr\bin\javac.exe" -source 11 -target 11 -nowarn -classpath $jar -d "$out\classes" "$root\android\src\com\game101\app\MainActivity.java"
Check 'javac'

$classes = Get-ChildItem -Recurse "$out\classes" -Filter *.class | ForEach-Object { $_.FullName }
& "$bt\d8.bat" --lib $jar --min-api 24 --output "$out\dex" $classes
Check 'd8'

Push-Location "$out\dex"
& "$jbr\bin\jar.exe" uf "$out\base.apk" classes.dex
Pop-Location
Check 'jar'

& "$bt\zipalign.exe" -f -p 4 "$out\base.apk" "$out\aligned.apk"
Check 'zipalign'

# signed with the standard Android debug key: fine for installing by hand, not for Google Play
& "$bt\apksigner.bat" sign --ks "$env:USERPROFILE\.android\debug.keystore" --ks-pass pass:android --key-pass pass:android `
    --out "$root\101.apk" "$out\aligned.apk"
Check 'apksigner'

& "$bt\apksigner.bat" verify "$root\101.apk"
Check 'verify'
"OK: $root\101.apk ($([math]::Round((Get-Item "$root\101.apk").Length/1KB)) KB)"
