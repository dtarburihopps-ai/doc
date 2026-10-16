@echo off
chcp 65001 >nul
setlocal
set "CONTRACT_APP_ROOT=%~dp0"
set "CONTRACT_LAUNCHER=%~f0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -Command "$source = Get-Content -Encoding UTF8 -Raw -LiteralPath $env:CONTRACT_LAUNCHER; & ([ScriptBlock]::Create(($source -split '(?m)^# CONTRACT_POWERSHELL\r?$',2)[1]))"
if errorlevel 1 (
  echo Не удалось запустить приложение. Проверьте, что архив полностью распакован.
  pause
)
exit /b
# CONTRACT_POWERSHELL
param([string]$Root = $env:CONTRACT_APP_ROOT, [switch]$NoBrowser)
# Windows PowerShell 5.1 and .NET, built into Windows 10/11. Read-only loopback server.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { throw 'Не найдена папка приложения.' }
$Root = [IO.Path]::GetFullPath($Root)
$htmlPath = Join-Path $Root 'Договор рассрочки.html'
if (-not (Test-Path -LiteralPath $htmlPath -PathType Leaf)) { throw 'HTML не найден. Сначала полностью распакуйте архив в папку.' }

function Get-SourceTemplate {
    $files = @(Get-ChildItem -LiteralPath $Root -Filter '*.docx' -File | Where-Object { $_.Name -notmatch '^~\$' -and $_.Name -notlike 'Заполненный_*' })
    $preferred = @($files | Where-Object { $_.Name -eq 'Шаблон рассрочки.docx' })
    if ($preferred.Count -eq 1) { return $preferred[0] }
    if ($files.Count -eq 1) { return $files[0] }
    if ($files.Count -eq 0) { throw 'В папке с HTML нет исходного Word. Положите сюда «Шаблон рассрочки.docx».' }
    throw 'В папке несколько Word-файлов. Назовите нужный «Шаблон рассрочки.docx».'
}
function Get-Stamp($File) { return ('{0}:{1}:{2}' -f $File.Name, $File.LastWriteTimeUtc.Ticks, $File.Length) }
function Read-SharedBytes([string]$Path) {
    $file = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $memory = New-Object IO.MemoryStream
    try { $file.CopyTo($memory); return ,$memory.ToArray() }
    finally { $file.Dispose(); $memory.Dispose() }
}
function Send-Reply($Stream, [int]$Code, [string]$Type, [byte[]]$Body, [string]$Stamp = '') {
    $reason = switch ($Code) { 200 {'OK'} 400 {'Bad Request'} 403 {'Forbidden'} 404 {'Not Found'} 405 {'Method Not Allowed'} 408 {'Request Timeout'} default {'Service Unavailable'} }
    $header = "HTTP/1.1 $Code $reason`r`nContent-Type: $Type`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`nX-Content-Type-Options: nosniff`r`nCross-Origin-Resource-Policy: same-origin`r`nReferrer-Policy: no-referrer`r`n"
    if ($Stamp) {
        # UTF-8 names belong in JSON, not ASCII HTTP headers. The header contains ticks and size only.
        $version = ($Stamp -split ':')[-2..-1] -join ':'
        $header += "X-Template-Version: $version`r`n"
    }
    $bytes = [Text.Encoding]::ASCII.GetBytes($header + "`r`n")
    $Stream.Write($bytes, 0, $bytes.Length)
    $Stream.Write($Body, 0, $Body.Length)
    $Stream.Flush()
}
function Send-Json($Stream, [int]$Code, $Value) {
    $body = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Compress -Depth 4))
    Send-Reply $Stream $Code 'application/json; charset=utf-8' $body
}
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$token = [Guid]::NewGuid().ToString('N')
$prefix = '/' + $token + '/'
$url = "http://127.0.0.1:$port$prefix"
Write-Output ('Адрес приложения: ' + $url)
Write-Host 'Договор открывается в браузере. Word из этой папки подставляется автоматически.'
Write-Host 'Оставьте это окно открытым на время работы. Интернет не используется.'
if (-not $NoBrowser) { Start-Process $url }
try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $client.ReceiveTimeout = 4000
        $client.SendTimeout = 4000
        $stream = $client.GetStream()
        try {
            $header = New-Object Text.StringBuilder
            while ($header.Length -lt 8192) {
                $b = $stream.ReadByte()
                if ($b -lt 0) { break }
                [void]$header.Append([char]$b)
                if ($header.Length -ge 4 -and $header.ToString().EndsWith("`r`n`r`n")) { break }
            }
            $request = $header.ToString()
            if (-not $request.EndsWith("`r`n`r`n")) { Send-Json $stream 400 @{error='Некорректный запрос.'}; continue }
            $firstLine = ($request -split "`r`n")[0] -split ' '
            if ($firstLine.Count -ne 3) { Send-Json $stream 400 @{error='Некорректный запрос.'}; continue }
            if ($firstLine[0] -ne 'GET') { Send-Json $stream 405 @{error='Доступно только чтение.'}; continue }
            if ($request -notmatch "(?im)^Host:\s*127\.0\.0\.1:$port\s*$") { Send-Json $stream 403 @{error='Недопустимый адрес.'}; continue }
            if ($request -match '(?im)^Origin:\s*([^\r\n]+)' -and $Matches[1].Trim() -ne "http://127.0.0.1:$port") { Send-Json $stream 403 @{error='Недопустимый источник.'}; continue }
            $path = ($firstLine[1] -split '\?')[0]
            if ($path -eq $prefix -or $path -eq ($prefix + 'index.html')) {
                Send-Reply $stream 200 'text/html; charset=utf-8' (Read-SharedBytes $htmlPath)
            } elseif ($path -eq ($prefix + 'template-info')) {
                $file = Get-SourceTemplate
                Send-Json $stream 200 @{name=$file.Name; stamp=(Get-Stamp $file); version=('{0}:{1}' -f $file.LastWriteTimeUtc.Ticks,$file.Length)}
            } elseif ($path -eq ($prefix + 'template.docx')) {
                $file = Get-SourceTemplate
                if ($file.Length -gt 20MB) { throw 'Исходный Word слишком большой (более 20 МБ).' }
                $before = Get-Stamp $file
                $bytes = Read-SharedBytes $file.FullName
                $after = Get-Stamp (Get-Item -LiteralPath $file.FullName)
                if ($before -ne $after) { throw 'Word сейчас сохраняется. Приложение повторит чтение.' }
                Send-Reply $stream 200 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' $bytes $after
            } else {
                Send-Json $stream 404 @{error='Файл не найден.'}
            }
        } catch {
            try { Send-Json $stream 503 @{error=$_.Exception.Message} } catch { }
        } finally { $stream.Dispose(); $client.Dispose() }
    }
} finally { $listener.Stop() }
