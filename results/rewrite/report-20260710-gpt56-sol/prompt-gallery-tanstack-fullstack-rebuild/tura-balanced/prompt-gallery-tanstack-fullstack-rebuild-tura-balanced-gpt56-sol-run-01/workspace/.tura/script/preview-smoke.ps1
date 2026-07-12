$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '../..')
$stdout = Join-Path $PSScriptRoot 'preview.stdout.log'
$stderr = Join-Path $PSScriptRoot 'preview.stderr.log'
$wrapper = Join-Path $PSScriptRoot 'start-preview.cmd'
$process = Start-Process -FilePath $wrapper -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($process.HasExited) {
      throw "Preview exited with code $($process.ExitCode): $(Get-Content $stderr -Tail 20 -ErrorAction SilentlyContinue)"
    }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:43128/' -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw 'Preview did not become ready within 30 seconds.' }
  $catalog = Invoke-RestMethod -Uri 'http://127.0.0.1:43128/api/catalog?model=Flux&sort=popular' -TimeoutSec 5
  if ($catalog.data.Count -lt 1 -or ($catalog.data | Where-Object model -ne 'Flux')) { throw 'Catalog API preview check failed.' }
  Write-Output "Preview smoke passed: HTML 200, Flux prompts $($catalog.data.Count)."
} finally {
  if (-not $process.HasExited) { taskkill /PID $process.Id /T /F | Out-Null }
}
