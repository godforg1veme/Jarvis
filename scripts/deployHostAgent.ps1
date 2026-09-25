param(
  [string]$HostName = 'jarvis-vps',
  [string]$RemoteAppRoot = '/home/deploy/apps/jarvis'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$guardScript = Join-Path $repositoryRoot 'deploy/scripts/verify-source-checkout.py'
$hostAgentPath = Join-Path $repositoryRoot 'host-agent'
$hostAgentTestsPath = Join-Path $hostAgentPath 'tests'
$deployScriptPath = Join-Path $repositoryRoot 'deploy/host-agent/deploy.sh'

Write-Host "==> Verifying local source checkout..."
& py $guardScript source $repositoryRoot
if ($LASTEXITCODE -ne 0) {
  throw "Local source checkout is not ready. Deployment aborted."
}

$remotePreflight = "python3 '$RemoteAppRoot/deploy/scripts/verify-source-checkout.py' source '$RemoteAppRoot'"
Write-Host "==> Verifying source checkout on $HostName..."
& ssh $HostName $remotePreflight
if ($LASTEXITCODE -ne 0) {
  throw "Remote source checkout is not ready. Deployment aborted before upload."
}

Write-Host "==> Running local Host Agent unit tests..."
$env:PYTHONPATH = $hostAgentPath
$testProcess = Start-Process -FilePath "py" -ArgumentList @("-m", "unittest", "discover", "-s", $hostAgentTestsPath) -WorkingDirectory $repositoryRoot -Wait -PassThru -NoNewWindow
if ($testProcess.ExitCode -ne 0) {
  throw "Local Host Agent unit tests failed. Deployment aborted."
}
Write-Host "Local tests passed."

Write-Host "==> Packaging host-agent directory into archive..."
$tempTar = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "host-agent-$([guid]::NewGuid().ToString('N')).tar.gz")
$remoteArchive = "/tmp/host-agent-$([guid]::NewGuid().ToString('N')).tar.gz"

try {
  & tar --exclude='*__pycache__*' --exclude='*.pyc' -czf $tempTar -C $hostAgentPath .
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create host-agent archive."
  }

  Write-Host "==> Ensuring remote directories exist on $HostName..."
  & ssh $HostName "mkdir -p '$RemoteAppRoot/deploy/host-agent' '$RemoteAppRoot/host-agent'"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create remote directories on VPS."
  }

  Write-Host "==> Uploading archive to $HostName..."
  & scp $tempTar "$($HostName):$remoteArchive"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to upload archive to VPS."
  }

  # Also ensure deploy/host-agent/deploy.sh is uploaded
  & scp $deployScriptPath "$($HostName):$RemoteAppRoot/deploy/host-agent/deploy.sh"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to upload deploy.sh to VPS."
  }

  Write-Host "==> Unpacking archive on VPS and executing deployment..."
  $remoteCmd = "tar -xzf '$remoteArchive' -C '$RemoteAppRoot/host-agent' && rm -f '$remoteArchive' && chmod +x '$RemoteAppRoot/deploy/host-agent/deploy.sh' && bash '$RemoteAppRoot/deploy/host-agent/deploy.sh' '$RemoteAppRoot'"
  & ssh $HostName $remoteCmd
  if ($LASTEXITCODE -ne 0) {
    throw "Remote deployment failed."
  }

  Write-Host "==> Host Agent deployed and verified successfully!"
} finally {
  if (Test-Path $tempTar) {
    Remove-Item $tempTar -Force -ErrorAction SilentlyContinue
  }
}
