$ErrorActionPreference = 'Stop'
$Port = 8765
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$MimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://localhost:$Port/")
$Listener.Start()

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  SOEMLP FESIMUBO - Agenda de Pagos y Recordatorios" -ForegroundColor Cyan
Write-Host "  Servidor activo en: http://localhost:$Port/" -ForegroundColor Green
Write-Host "  No cierres esta ventana mientras uses la web." -ForegroundColor Yellow
Write-Host "====================================================" -ForegroundColor Cyan

Start-Process "http://localhost:$Port/"

try {
  while ($Listener.IsListening) {
    $Context = $Listener.GetContext()
    $Request = $Context.Request
    $Response = $Context.Response

    $RelPath = $Request.Url.LocalPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($RelPath)) { $RelPath = 'index.html' }
    $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $RelPath))

    if (-not $FullPath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $FullPath -PathType Leaf)) {
      $Response.StatusCode = 404
      $Bytes = [System.Text.Encoding]::UTF8.GetBytes('404 - No encontrado')
      $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
      $Response.Close()
      continue
    }

    $Ext = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
    $Response.ContentType = if ($MimeTypes.ContainsKey($Ext)) { $MimeTypes[$Ext] } else { 'application/octet-stream' }
    $Bytes = [System.IO.File]::ReadAllBytes($FullPath)
    $Response.ContentLength64 = $Bytes.Length
    $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Response.Close()
  }
} finally {
  $Listener.Stop()
}
