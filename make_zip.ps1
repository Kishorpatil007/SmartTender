$src = "C:\Users\HP\.gemini\antigravity\scratch\smart-tender-system"
$dst = "C:\Users\HP\smart-tender-system.zip"
$tempDir = Join-Path $env:TEMP "mit-tender-build-$(Get-Random)"

if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Get-ChildItem -Path $src | Where-Object { $_.Name -notin @('node_modules', '.git', 'smart-tender-system.zip') } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force
}

Compress-Archive -Path "$tempDir\*" -DestinationPath $dst -Force
Copy-Item -Path $dst -Destination "$src\smart-tender-system.zip" -Force
Remove-Item -Recurse -Force $tempDir

Write-Host "ZIP_SUCCESSFULLY_GENERATED"
