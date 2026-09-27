<#
.SYNOPSIS
  Packages the Tauri release build as an MSIX for the Microsoft Store.

.DESCRIPTION
  A Tauri release build is one self-contained exe (the frontend is embedded), so the package is
  just that exe, the tile images and a manifest carrying the Store identity. No MSI and no MSIX
  Packaging Tool capture are needed.

  Run `npx tauri build --bundles nsis` (or `--no-bundle`) first. The version comes from
  src-tauri/tauri.conf.json; the Store needs the fourth part to be 0.

  The Store signs what you upload, so a Store package is left unsigned. Pass -Sign to sign with
  the Store-publisher certificate for installing the package locally.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\package-msix.ps1
  powershell -ExecutionPolicy Bypass -File scripts\package-msix.ps1 -Sign
#>
param(
  [switch]$Sign,
  [string]$PfxPath = (Join-Path $PSScriptRoot '..\certs\Amply-Store-CNOnly.pfx'),
  [string]$PfxPassword = ''
)

$ErrorActionPreference = 'Stop'

# Store identity (Partner Center > Product identity). Must match exactly.
$IdentityName = 'AdithyaKV.AmplyMusicPlayer'
$Publisher = 'CN=30ED0224-8255-4781-8ACD-EE3EF146115F'
$PublisherDisplayName = 'PaperKite'
$DisplayName = 'Amply Music Player'
$Description = 'Amply is a smart offline music player for local libraries.'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$tauri = Get-Content (Join-Path $root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = "$($tauri.version).0"
$exe = Join-Path $root 'src-tauri\target\release\amply.exe'
$icons = Join-Path $root 'src-tauri\icons'
$outDir = Join-Path $root 'src-tauri\target\release\bundle\msix'
$layout = Join-Path $outDir 'layout'
$package = Join-Path $outDir "Amply_${version}_x64.msix"

if (-not (Test-Path $exe)) {
  throw "No release build at $exe. Run 'npx tauri build --bundles nsis' first."
}
$built = (Get-Item $exe).LastWriteTime
$head = [datetime]::Parse((git -C $root log -1 --format=%cI))
if ($built -lt $head) {
  Write-Warning "amply.exe ($built) is older than the last commit ($head); rebuild to package current code."
}

# The newest SDK makeappx/signtool on this machine.
$sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\makeappx.exe" |
  Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
if (-not $sdkBin) { throw 'makeappx.exe not found: install the Windows 10/11 SDK.' }
$makeappx = $sdkBin.FullName
$signtool = Join-Path $sdkBin.DirectoryName 'signtool.exe'

if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $layout 'Assets') | Out-Null
Copy-Item $exe $layout
foreach ($asset in 'StoreLogo', 'Square44x44Logo', 'Square71x71Logo', 'Square150x150Logo') {
  Copy-Item (Join-Path $icons "$asset.png") (Join-Path $layout 'Assets')
}

# runFullTrust: Tauri is a desktop (Win32) app. The startup task lists Amply under Windows'
# Startup apps; the autostart plugin's Run-key entry is invisible to Windows inside a package.
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap desktop rescap">
  <Identity Name="$IdentityName" Publisher="$Publisher" Version="$version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>$DisplayName</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="Amply" Executable="amply.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="$DisplayName"
        Description="$Description"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Square71x71Logo="Assets\Square71x71Logo.png" ShortName="Amply" />
      </uap:VisualElements>
      <Extensions>
        <!-- "Open with Amply" for audio files; the path arrives as a command-line argument. -->
        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="amplyaudio">
            <uap:DisplayName>Audio file</uap:DisplayName>
            <uap:SupportedFileTypes>
              <uap:FileType>.mp3</uap:FileType>
              <uap:FileType>.flac</uap:FileType>
              <uap:FileType>.wav</uap:FileType>
              <uap:FileType>.ogg</uap:FileType>
              <uap:FileType>.oga</uap:FileType>
              <uap:FileType>.m4a</uap:FileType>
              <uap:FileType>.aac</uap:FileType>
              <uap:FileType>.aif</uap:FileType>
              <uap:FileType>.aiff</uap:FileType>
            </uap:SupportedFileTypes>
          </uap:FileTypeAssociation>
        </uap:Extension>
        <desktop:Extension Category="windows.startupTask" Executable="amply.exe" EntryPoint="Windows.FullTrustApplication">
          <desktop:StartupTask TaskId="AmplyStartup" Enabled="false" DisplayName="$DisplayName" />
        </desktop:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
[System.IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding $false))

if (Test-Path $package) { Remove-Item $package -Force }
& $makeappx pack /o /h SHA256 /d $layout /p $package
if ($LASTEXITCODE -ne 0) { throw "makeappx failed ($LASTEXITCODE)" }

if ($Sign) {
  $signArgs = @('sign', '/fd', 'SHA256', '/f', (Resolve-Path $PfxPath))
  if ($PfxPassword) { $signArgs += @('/p', $PfxPassword) }
  & $signtool @signArgs $package
  if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }
}

Write-Host ''
Write-Host "Package:  $package"
Write-Host "Identity: $IdentityName $version ($Publisher)"
Write-Host ($(if ($Sign) { 'Signed for local install.' } else { 'Unsigned: upload to Partner Center as is.' }))
