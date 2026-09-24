param(
  [Parameter(Mandatory = $true)][string]$SharePath,
  [Parameter(Mandatory = $true)][string]$ExpectedExitIp
)

$ErrorActionPreference = 'Stop'
$version = '26.6.22'
$archiveSha256 = 'da8629b945a70dd7e967ecc007d08154705c011568885935a7a0ac9688107488'
$probeDir = Join-Path ([System.IO.Path]::GetTempPath()) ('jarvis-xray-probe-' + [guid]::NewGuid().ToString('N'))
$process = $null
New-Item -ItemType Directory -Path $probeDir | Out-Null

try {
  $archive = Join-Path $probeDir 'xray.zip'
  $releaseUrl = "https://github.com/XTLS/Xray-core/releases/download/v$version/Xray-windows-64.zip"
  Invoke-WebRequest -UseBasicParsing -Uri $releaseUrl -OutFile $archive
  $actualHash = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
  if ($actualHash -ne $archiveSha256) { throw 'Official Xray archive checksum mismatch' }
  Expand-Archive -LiteralPath $archive -DestinationPath $probeDir

  $share = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $SharePath)).Trim()
  $match = [regex]::Match($share, '^vless://(?<id>[0-9a-f-]+)@(?<host>[^:]+):(?<port>\d+)\?(?<query>[^#]+)#', 'IgnoreCase')
  if (-not $match.Success) { throw 'VLESS URI parse failed' }
  $query = @{}
  foreach ($pair in $match.Groups['query'].Value.Split('&')) {
    $parts = $pair.Split('=', 2)
    if ($parts.Count -eq 2) { $query[$parts[0]] = [uri]::UnescapeDataString($parts[1]) }
  }
  foreach ($required in @('sni', 'pbk', 'sid')) {
    if (-not $query.ContainsKey($required)) { throw "Missing VLESS field: $required" }
  }

  $config = @{
    log = @{ loglevel = 'warning' }
    inbounds = @(@{ listen = '127.0.0.1'; port = 18080; protocol = 'socks'; settings = @{ udp = $true } })
    outbounds = @(@{
      protocol = 'vless'
      settings = @{ vnext = @(@{
        address = $match.Groups['host'].Value
        port = [int]$match.Groups['port'].Value
        users = @(@{ id = $match.Groups['id'].Value; encryption = 'none'; flow = 'xtls-rprx-vision' })
      }) }
      streamSettings = @{
        network = 'raw'
        security = 'reality'
        realitySettings = @{ fingerprint = 'chrome'; serverName = $query.sni; publicKey = $query.pbk; shortId = $query.sid }
      }
    })
  }
  $configPath = Join-Path $probeDir 'client.json'
  [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 12), [System.Text.UTF8Encoding]::new($false))

  $process = Start-Process -FilePath (Join-Path $probeDir 'xray.exe') -ArgumentList @('run', '-c', $configPath) -WindowStyle Hidden -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 18080 -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
    if ($process.HasExited) { break }
  }
  if (-not $ready) { throw 'Local Xray acceptance client did not start' }

  $exitIp = (& curl.exe --silent --show-error --fail --max-time 20 --proxy socks5h://127.0.0.1:18080 https://api.ipify.org).Trim()
  if ($exitIp -ne $ExpectedExitIp) { throw "Unexpected VPN exit IP: $exitIp" }
  $httpCode = (& curl.exe --silent --output NUL --write-out '%{http_code}' --max-time 20 --proxy socks5h://127.0.0.1:18080 https://cp.cloudflare.com/generate_204).Trim()
  if ($httpCode -ne '204') { throw "VPN HTTP probe failed: $httpCode" }

  Write-Output 'official_xray_checksum=verified'
  Write-Output "vpn_exit_ip=$exitIp"
  Write-Output "vpn_http_probe=$httpCode"
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit()
  }
  $resolved = [System.IO.Path]::GetFullPath($probeDir)
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $safeName = (Split-Path $resolved -Leaf).StartsWith('jarvis-xray-probe-')
  if ($safeName -and $resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
