<#
  Nure Asmir - field test for "the site does not open on the first try".
  Run on a computer on the AFFECTED connection (Windows 10/11, PowerShell 5.1 or 7). No install needed for the quick test.

    .\field-test.ps1                    quick test (about 4 minutes)
    .\field-test.ps1 -Idle              adds the "first query after silence" test (about +4 minutes)
    .\field-test.ps1 -Watch -Minutes 30 timeline: every 15 s asks for a never-seen name through the router and writes down stalls
    .\field-test.ps1 -Capture           (run PowerShell as Administrator) also records the DNS packets with Windows' built-in pktmon

  Everything is written to a folder "field-report-<date>" next to this script. Send that folder back (a zip is fine).
  The script only asks DNS questions and fetches our own website; it changes nothing on the computer or the router.
#>
param(
  [switch]$Idle,
  [switch]$Watch,
  [int]$Minutes = 30,
  [switch]$Capture
)

$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $PSScriptRoot "field-report-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null
$log = Join-Path $out "report.txt"
function Say([string]$text) { Write-Host $text; Add-Content -Path $log -Value $text -Encoding UTF8 }
function Section([string]$title) { Say ""; Say ("=" * 78); Say $title; Say ("=" * 78) }

# ---- helpers -------------------------------------------------------------------------------------------------------------------
function RandomName([string]$domain) { "t" + [guid]::NewGuid().ToString("N").Substring(0, 8) + "." + $domain }

# One DNS question; returns milliseconds, or $null when it failed or timed out.
function AskDns([string]$name, [string]$type = "A", [string]$server = "") {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    if ($server) { Resolve-DnsName -Name $name -Type $type -Server $server -DnsOnly -NoHostsFile -ErrorAction Stop | Out-Null }
    else { Resolve-DnsName -Name $name -Type $type -DnsOnly -NoHostsFile -ErrorAction Stop | Out-Null }
    $sw.Stop(); return [int]$sw.ElapsedMilliseconds
  } catch {
    $sw.Stop()
    # a name that does not exist (NXDOMAIN) is still a real answer from the server; only count timeouts / server failures as failures
    if ($_.Exception.Message -match "DNS name does not exist|does not exist") { return [int]$sw.ElapsedMilliseconds }
    return $null
  }
}

function Summarise($values) {
  $ok = @($values | Where-Object { $null -ne $_ } | Sort-Object)
  $failed = @($values | Where-Object { $null -eq $_ }).Count
  if ($ok.Count -eq 0) { return "all $($values.Count) FAILED" }
  $median = $ok[[int][math]::Floor($ok.Count / 2)]
  $p90 = $ok[[int][math]::Min($ok.Count - 1, [math]::Floor($ok.Count * 0.9))]
  $slow = @($ok | Where-Object { $_ -ge 1000 }).Count
  "n={0}  median={1} ms  p90={2} ms  max={3} ms  failed={4}  slow(>=1s)={5}" -f $values.Count, $median, $p90, $ok[-1], $failed, $slow
}

function Series([string]$label, [string]$domain, [string]$server, [int]$count = 12, [string]$type = "A") {
  $vals = 1..$count | ForEach-Object { AskDns (RandomName $domain) $type $server }
  Say ("{0,-34} {1}" -f $label, (Summarise $vals))
  return $vals
}

# ---- 1. who and where -----------------------------------------------------------------------------------------------------------
Section "1. This computer and this connection"
Say "Started: $(Get-Date -Format o)   Computer: $env:COMPUTERNAME   Windows: $([Environment]::OSVersion.VersionString)"
$cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1
$gw = $null
if ($cfg) {
  $gw = $cfg.IPv4DefaultGateway.NextHop
  Say "Adapter: $($cfg.InterfaceAlias)   IPv4: $($cfg.IPv4Address.IPAddress)   Gateway (router): $gw"
  Say "DNS servers this computer asks: $((($cfg.DnsServer | Where-Object AddressFamily -eq 2).ServerAddresses) -join ', ')"
}
$wifi = netsh wlan show interfaces 2>$null | Select-String -Pattern "SSID|Signal|Radio type|Channel|Receive rate|Transmit rate|BSSID" | ForEach-Object { $_.Line.Trim() }
if ($wifi) { Say "Wi-Fi:"; $wifi | ForEach-Object { Say "   $_" } } else { Say "Wi-Fi: not connected by Wi-Fi (cable?)" }
$mac = (arp -a $gw 2>$null | Select-String $gw | Select-Object -First 1)
if ($mac) { Say "Router MAC (first 3 bytes tell the maker): $($mac.Line.Trim())" }
try {
  $info = Invoke-RestMethod -Uri "https://ipinfo.io/json" -TimeoutSec 10
  Say "Public address / provider (as seen by the internet): $($info.ip)  $($info.org)  $($info.city), $($info.country)"
  Add-Content -Path (Join-Path $out "public-ip.json") -Value ($info | ConvertTo-Json) -Encoding UTF8
} catch { Say "Public address: could not be read ($($_.Exception.Message))" }
Say "IPv6 on this connection: $(if ((Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -notlike 'fe80*' -and $_.IPAddress -ne '::1' })) { 'yes (global address present)' } else { 'no global IPv6 address' })"

if ($Capture) {
  try {
    pktmon filter remove 2>&1 | Out-Null
    pktmon filter add DNS -p 53 2>&1 | Out-Null
    pktmon start --capture --pkt-size 0 --file-name (Join-Path $out "dns.etl") 2>&1 | Out-Null
    Say "pktmon: capturing DNS packets (port 53) to dns.etl"
  } catch { Say "pktmon could not start (run PowerShell as Administrator): $($_.Exception.Message)" }
}

# ---- 2. link to the router --------------------------------------------------------------------------------------------------
if (-not $Watch) {
  Section "2. The link to the router (50 pings): loss here also stalls DNS"
  if ($gw) {
    $p = Test-Connection -ComputerName $gw -Count 50 -ErrorAction SilentlyContinue
    $got = @($p).Count
    if ($got -gt 0) {
      $rt = @($p | ForEach-Object { if ($_.PSObject.Properties["Latency"]) { $_.Latency } else { $_.ResponseTime } } | Sort-Object)
      Say ("Replies {0}/50 (lost {1}%)   min={2} ms  median={3} ms  p95={4} ms  max={5} ms" -f $got, [int]((50 - $got) * 2), $rt[0], $rt[[int]($rt.Count / 2)], $rt[[int][math]::Min($rt.Count - 1, [math]::Floor($rt.Count * 0.95))], $rt[-1])
    } else { Say "The router did not answer pings." }
  }

  # ---- 3. DNS through the router (what the customer's browser really experiences) -----------------------------------------------
  Section "3. DNS the way a customer's browser sees it (the computer's own DNS = the router), never-seen names so nothing is cached"
  $null = Series "nureasmir.com (our site)" "nureasmir.com" "" 20
  $null = Series "codersden.dev (works for you?)" "codersden.dev" "" 20
  $null = Series "cloudflare.com (control)" "cloudflare.com" "" 20
  $null = Series "amazon.com (control, Route 53)" "amazon.com" "" 20
  Say ""
  Say "Record types a browser asks for at the same time (our real names; first answer may come from cache):"
  foreach ($type in "A", "AAAA") { foreach ($n in "nureasmir.com", "www.nureasmir.com") { $ms = AskDns $n $type ""; Say ("   {0,-6} {1,-22} {2}" -f $type, $n, $(if ($null -eq $ms) { "FAILED" } else { "$ms ms" })) } }
  # The HTTPS record type (65) is what Chrome asks for too; some cheap routers choke on types they do not know.
  $nsl = (cmd /c "nslookup -type=type65 nureasmir.com 2>&1" | Out-String) -replace "\s+", " "
  Say ("   HTTPS(65) nureasmir.com via router: " + $nsl.Trim().Substring(0, [math]::Min(220, $nsl.Trim().Length)))

  # ---- 4. who is slow: router, provider, or public resolvers --------------------------------------------------------------------
  Section "4. Same questions straight to different DNS servers (skips the router's own DNS relay)"
  if ($gw) { $null = Series "router $gw" "nureasmir.com" $gw 12 }
  foreach ($srv in @(@("Cloudflare 1.1.1.1", "1.1.1.1"), @("Google 8.8.8.8", "8.8.8.8"), @("Quad9 9.9.9.9", "9.9.9.9"))) { $null = Series $srv[0] "nureasmir.com" $srv[1] 12 }
  $dnsServers = if ($cfg) { ($cfg.DnsServer | Where-Object AddressFamily -eq 2).ServerAddresses } else { @() }
  foreach ($d in ($dnsServers | Where-Object { $_ -ne $gw } | Select-Object -First 2)) { $null = Series "provider DNS $d" "nureasmir.com" $d 12 }

  # ---- 5. the nameservers that answer for our domain ----------------------------------------------------------------------------
  Section "5. Straight to the servers that own the answer (where our domain's DNS lives)"
  $null = Series "Vercel ns1 198.51.44.13" "nureasmir.com" "198.51.44.13" 12
  $null = Series "Vercel ns2 198.51.45.13" "nureasmir.com" "198.51.45.13" 12
  $null = Series "Cloudflare (for comparison)" "nureasmir.com" "108.162.193.1" 12
  $r53 = try { (Resolve-DnsName "ns-941.awsdns-53.net" -Type A -DnsOnly -ErrorAction Stop | Where-Object QueryType -eq A | Select-Object -First 1).IPAddress } catch { $null }
  if ($r53) { $null = Series "Route 53 ($r53, for comparison)" "outfitters.com.pk" $r53 12 } else { Say "Route 53: could not find an address to test" }
  # Other providers that could host our DNS (each is asked about a name it hosts; the answer content does not matter, the round trip does)
  foreach ($c in @(@("Gcore ns1 (our zone is already there)", "ns1.gcorelabs.net", "nureasmir.com"), @("Gcore ns2 (our zone is already there)", "ns2.gcdn.services", "nureasmir.com"), @("ClouDNS", "ns1.cloudns.net", "cloudns.net"), @("Hurricane Electric", "ns1.he.net", "he.net"), @("deSEC", "ns1.desec.io", "desec.io"))) {
    $cip = try { (Resolve-DnsName $c[1] -Type A -DnsOnly -ErrorAction Stop | Where-Object QueryType -eq A | Select-Object -First 1).IPAddress } catch { $null }
    if ($cip) { $null = Series ("{0} ({1}, candidate)" -f $c[0], $cip) $c[2] $cip 12 } else { Say ("{0}: could not find an address to test" -f $c[0]) }
  }

  if ($Idle) {
    Section "5b. First question after 40 s of silence, 4 rounds (the stall we saw on the developer's own connection)"
    $rows = @{ "Vercel ns1" = @(); "Vercel ns2" = @(); "Cloudflare" = @(); "router" = @() }
    1..4 | ForEach-Object {
      Start-Sleep -Seconds 40
      $rows["Vercel ns1"] += AskDns (RandomName "nureasmir.com") "A" "198.51.44.13"
      $rows["Vercel ns2"] += AskDns (RandomName "nureasmir.com") "A" "198.51.45.13"
      $rows["Cloudflare"] += AskDns (RandomName "nureasmir.com") "A" "108.162.193.1"
      $rows["router"] += AskDns (RandomName "nureasmir.com") "A" ""
    }
    foreach ($k in $rows.Keys) { Say ("{0,-12} {1}" -f $k, (($rows[$k] | ForEach-Object { if ($null -eq $_) { "FAIL" } else { "$_" } }) -join "  ")) }
  }

  # ---- 6. paths and packet size -------------------------------------------------------------------------------------------------
  Section "6. Route to the nameservers and to the site (tracert; stars in the middle are normal, stars at the END are not)"
  foreach ($target in "198.51.44.13", "198.51.45.13", "108.162.193.1", "216.198.79.1") {
    Say "--- tracert $target"
    (tracert -d -h 20 -w 1500 $target 2>&1) | ForEach-Object { Say "   $_" }
  }
  Section "7. Largest packet that passes without being cut (a path that drops big packets breaks large DNS answers)"
  foreach ($target in "1.1.1.1", "198.51.44.13", "216.198.79.1") {
    $best = 0
    foreach ($size in 1472, 1452, 1400, 1300, 1200, 1000, 548) { $r = ping -n 2 -w 1500 -f -l $size $target 2>&1 | Out-String; if ($r -match "TTL=") { $best = $size; break } }
    Say ("{0,-16} biggest payload that passed with 'do not fragment': {1} bytes {2}" -f $target, $best, $(if ($best -ge 1472) { "(normal)" } elseif ($best -ge 1400) { "(a little under 1472: normal on many home lines)" } elseif ($best -gt 0) { "(SMALL: big packets are being cut - tell the developer)" } else { "(NOTHING passed - ping may be blocked)" }))
  }
}

# ---- 8. the website itself, cold every time (probe has a 60 second DNS life) -----------------------------------------------------
function CurlTiming([string]$url) {
  $fmt = "dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s first-byte=%{time_starttransfer}s total=%{time_total}s code=%{http_code}"
  $r = curl.exe -4 -s -o NUL -m 30 -w $fmt $url 2>&1
  return ($r | Out-String).Trim()
}
if (-not $Watch) {
  Section "8. Loading the website (curl timing: dns / connect / tls / first byte); probe.nureasmir.com forgets its address every 60 s"
  1..5 | ForEach-Object { Say ("nureasmir.com        " + (CurlTiming "https://nureasmir.com/api/health")) }
  1..2 | ForEach-Object { Say ("probe.nureasmir.com   " + (CurlTiming "https://probe.nureasmir.com/api/health")); if ($_ -lt 2) { Start-Sleep -Seconds 65 } }
  Say ("plain http (port 80)   " + (CurlTiming "http://nureasmir.com/"))
}

# ---- 9. timeline (stalls come and go; this catches them) ------------------------------------------------------------------------------
if ($Watch) {
  Section "9. Timeline for $Minutes minutes: every 15 s a never-seen name through the router; every minute the real site on probe (cold)"
  $csv = Join-Path $out "timeline.csv"
  "time,what,ms" | Set-Content -Path $csv -Encoding UTF8
  $end = (Get-Date).AddMinutes($Minutes); $n = 0; $slow = 0; $failed = 0; $all = @()
  while ((Get-Date) -lt $end) {
    $ms = AskDns (RandomName "nureasmir.com") "A" ""
    $now = Get-Date -Format "HH:mm:ss"; $n++; $all += $ms
    "$now,dns-router,$(if ($null -eq $ms) { 'FAIL' } else { $ms })" | Add-Content -Path $csv -Encoding UTF8
    if ($null -eq $ms) { $failed++; Say "$now  DNS through the router FAILED" } elseif ($ms -ge 1000) { $slow++; Say "$now  DNS through the router took $ms ms" }
    if ($n % 4 -eq 0) { $t = CurlTiming "https://probe.nureasmir.com/api/health"; "$now,http-probe,$t" | Add-Content -Path $csv -Encoding UTF8; if ($t -match "dns=([0-9.]+)s" -and [double]$Matches[1] -ge 1.0) { Say "$now  website lookup slow: $t" } }
    Start-Sleep -Seconds 15
  }
  Say ("Timeline finished: {0} questions, {1} slow (>=1 s), {2} failed.   {3}" -f $n, $slow, $failed, (Summarise $all))
}

if ($Capture) { try { pktmon stop 2>&1 | Out-Null; pktmon etl2txt (Join-Path $out "dns.etl") --out (Join-Path $out "dns.txt") 2>&1 | Out-Null; pktmon filter remove 2>&1 | Out-Null; Say "pktmon: capture saved (dns.etl, dns.txt)" } catch { Say "pktmon stop failed: $($_.Exception.Message)" } }

Section "Done"
Say "Folder to send back: $out"
