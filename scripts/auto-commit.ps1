param(
  [int]$IntervalSeconds = 120,
  [int]$HeartbeatMinutes = 30
)

$startDir = Get-Location
try {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  if (Test-Path $scriptDir) { Set-Location $scriptDir | Out-Null }
} catch {}

while ($true) {
  try {
    $status = git status --porcelain
    if ($LASTEXITCODE -ne 0) { Start-Sleep -Seconds $IntervalSeconds; continue }
    if (![string]::IsNullOrWhiteSpace(($status | Out-String))) {
      git add -A
      $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
      $lines = ($status -split "`n" | ForEach-Object { $_.Trim() })
      $summary = ($lines | Where-Object { $_ -ne "" } | Select-Object -First 20) -join "; "
      $msg = "Auto-commit: sync changes [$ts] — $summary"
      git commit -m $msg
      git push
      Write-Host "Auto-commit pushed at $ts"
    } else {
      $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
      $lastTsEpoch = (git log -1 --format=%ct)
      if ($LASTEXITCODE -eq 0 -and [int]::TryParse($lastTsEpoch, [ref]([int]$null))) {
        $nowEpoch = [int]([double](Get-Date -UFormat %s))
        $ageSec = $nowEpoch - [int]$lastTsEpoch
        if ($ageSec -ge ($HeartbeatMinutes * 60)) {
          git commit --allow-empty -m "Auto-commit: heartbeat [$ts]"
          git push
          Write-Host "Heartbeat auto-commit pushed at $ts"
        } else {
          Write-Host ("No changes at {0}" -f (Get-Date -Format 'HH:mm:ss'))
        }
      } else {
        Write-Host ("No changes at {0}" -f (Get-Date -Format 'HH:mm:ss'))
      }
    }
  } catch {
    Write-Host ("Auto-commit error: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds $IntervalSeconds
}

Set-Location $startDir | Out-Null
