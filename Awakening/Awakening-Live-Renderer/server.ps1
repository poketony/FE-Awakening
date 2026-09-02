param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [int]$Port = 8765
)

$resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$server = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$server.Start()

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.xml'  = 'application/xml; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.bin'  = 'application/octet-stream'
    '.mp3'  = 'audio/mpeg'
}

try {
    while ($true) {
        $client = $server.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            while (($header = $reader.ReadLine()) -ne $null -and $header.Length -gt 0) { }

            $requestTarget = if ($requestLine -match '^GET\s+(\S+)\s+HTTP/') { $Matches[1] } else { '/' }
            $pathOnly = $requestTarget.Split('?')[0]
            $relative = [Uri]::UnescapeDataString($pathOnly.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
            $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)))
            if ([IO.Directory]::Exists($candidate)) { $candidate = [IO.Path]::Combine($candidate, 'index.html') }
            $isAllowed = $candidate.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)

            if (-not $isAllowed -or -not [IO.File]::Exists($candidate)) {
                $status = '404 Not Found'
                $contentType = 'text/plain; charset=utf-8'
                $body = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
            } else {
                $status = '200 OK'
                $extension = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
                $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
                $body = [IO.File]::ReadAllBytes($candidate)
            }

            $headers = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n")
            $stream.Write($headers, 0, $headers.Length)
            $stream.Write($body, 0, $body.Length)
        } catch {
            Write-Warning $_.Exception.Message
        } finally {
            if ($reader) { $reader.Dispose() }
            if ($stream) { $stream.Dispose() }
            $client.Close()
        }
    }
} finally {
    $server.Stop()
}
