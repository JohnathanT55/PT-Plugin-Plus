[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [DateTimeOffset]$PreparedAt,
  [DateTimeOffset]$CheckedAt = [DateTimeOffset]::Now
)

$ErrorActionPreference = 'Stop'
$start = $PreparedAt.LocalDateTime
$end = $CheckedAt.LocalDateTime
$kernelEvents = Get-WinEvent -FilterHashtable @{
  LogName = 'System'
  ProviderName = 'Microsoft-Windows-Kernel-Power'
  StartTime = $start
  EndTime = $end
} -ErrorAction SilentlyContinue | Where-Object { $_.Id -in 42, 107, 506, 507 }
$resumeEvents = Get-WinEvent -FilterHashtable @{
  LogName = 'System'
  ProviderName = 'Microsoft-Windows-Power-Troubleshooter'
  StartTime = $start
  EndTime = $end
} -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq 1 }

$sleepEvent = $kernelEvents | Where-Object { $_.Id -in 42, 506 } | Sort-Object TimeCreated | Select-Object -First 1
$wakeEvent = @(
  $kernelEvents | Where-Object { $_.Id -in 107, 507 }
  $resumeEvents
) | Where-Object { $_.TimeCreated -ge $sleepEvent.TimeCreated } | Sort-Object TimeCreated | Select-Object -Last 1
$passed = $null -ne $sleepEvent -and $null -ne $wakeEvent -and $wakeEvent.TimeCreated -ge $sleepEvent.TimeCreated

[ordered]@{
  passed = $passed
  preparedAt = $PreparedAt.ToString('o')
  checkedAt = $CheckedAt.ToString('o')
  sleepEvent = if ($sleepEvent) { [ordered]@{ time = $sleepEvent.TimeCreated.ToString('o'); id = $sleepEvent.Id } } else { $null }
  wakeEvent = if ($wakeEvent) { [ordered]@{ time = $wakeEvent.TimeCreated.ToString('o'); id = $wakeEvent.Id } } else { $null }
} | ConvertTo-Json -Depth 4

if (-not $passed) { exit 1 }
