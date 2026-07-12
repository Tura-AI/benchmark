$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '../..')
$stdout = Join-Path $root '.tura/app.stdout.log'
$stderr = Join-Path $root '.tura/app.stderr.log'
$pidFile = Join-Path $root '.tura/app.pid'
$env:PORT = '3000'
$process = Start-Process -FilePath node -ArgumentList '.output/server/index.mjs' -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$process.Id | Set-Content $pidFile
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) {
    Write-Error "App exited with code $($process.ExitCode). $((Get-Content $stderr -Tail 20) -join ' ')"
  }
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Write-Output "READY PID=$($process.Id) URL=http://127.0.0.1:3000/"
      exit 0
    }
  } catch { }
}
if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
Write-Error "App readiness timed out. $((Get-Content $stderr -Tail 20) -join ' ')"
