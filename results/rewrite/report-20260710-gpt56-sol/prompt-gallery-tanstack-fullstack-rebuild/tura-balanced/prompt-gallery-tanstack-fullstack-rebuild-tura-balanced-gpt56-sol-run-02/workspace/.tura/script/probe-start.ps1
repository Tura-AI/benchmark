$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '../..')
$stdout = Join-Path $root '.tura/start.stdout.log'
$stderr = Join-Path $root '.tura/start.stderr.log'
$env:PORT = '3107'
$env:POWERPROMPT_DB_PATH = 'data/probe.db'
$process = Start-Process -FilePath node -ArgumentList '.output/server/index.mjs' -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) { throw "Server exited with code $($process.ExitCode)" }
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3107/' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Write-Output $_.Exception.Message }
  }
  if (-not $ready) { throw 'Server did not become healthy' }
  Write-Output "STATUS=$($response.StatusCode) LENGTH=$($response.Content.Length) PID=$($process.Id)"
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  $process.WaitForExit()
  Write-Output 'STDERR:'
  if (Test-Path $stderr) { Get-Content $stderr -Tail 40 }
  Write-Output 'STDOUT:'
  if (Test-Path $stdout) { Get-Content $stdout -Tail 40 }
}
