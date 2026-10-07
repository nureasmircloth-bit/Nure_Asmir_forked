# Run this on ANY network (home Wi-Fi, mobile data hotspot, a customer's router) and compare the results:
#   powershell -ExecutionPolicy Bypass -File scripts\network-check.ps1
# It changes nothing. It asks for the website's address in three ways and times each one.
param([string]$Site = "nureasmir.com", [int]$Tries = 15)

function Fresh([string]$server) {
  $times = @(); $failed = 0
  1..$Tries | ForEach-Object {
    $name = "c$([guid]::NewGuid().ToString('N').Substring(0,8)).$Site"   # a name nobody asked for before, so no saved answer exists
    $t = Measure-Command {
      try { if ($server) { Resolve-DnsName $name -Type A -Server $server -DnsOnly -ErrorAction Stop | Out-Null } else { Resolve-DnsName $name -Type A -DnsOnly -ErrorAction Stop | Out-Null } }
      catch { if ($_.Exception.Message -notmatch "does not exist") { $script:failed++ } }
    }
    $times += [int]$t.TotalMilliseconds
  }
  $s = $times | Sort-Object
  "{0,-22} median {1,5} ms | slowest {2,6} ms | lookups over 1 s: {3} | real failures: {4}" -f $(if ($server) { "DNS $server" } else { "this network's own DNS" }), $s[[int]($Tries / 2)], $s[-1], @($s | Where-Object { $_ -gt 1000 }).Count, $failed
}

Write-Output "== Which DNS does this network use?"
(Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | ForEach-Object { "{0}: {1}" -f $_.InterfaceAlias, ($_.ServerAddresses -join ", ") })
try { $r = Resolve-DnsName "o-o.myaddr.l.google.com" -Type TXT -DnsOnly -ErrorAction Stop; "Resolver that really asks the internet for you: " + (($r | Where-Object Type -eq "TXT").Strings -join " ") } catch { "(could not identify the resolver)" }

Write-Output "`n== Fresh lookups ($Tries each): how fast is it to find the website's address?"
Fresh $null
Fresh "1.1.1.1"
Fresh "8.8.8.8"

Write-Output "`n== Opening the website 10 times (curl): address / connect / first byte / total, in seconds"
1..10 | ForEach-Object { & curl.exe -s -o NUL -m 30 -w "%{http_code} dns=%{time_namelookup} connect=%{time_connect} firstbyte=%{time_starttransfer} total=%{time_total}`n" "https://$Site/?check=$_" }

Write-Output "`n== Lost packets to the router and to Cloudflare (30 pings each)"
$gateway = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4DefaultGateway.NextHop
foreach ($target in @($gateway, "1.1.1.1")) { if (-not $target) { continue }; $p = Test-Connection -ComputerName $target -Count 30 -ErrorAction SilentlyContinue; $ok = @($p).Count; "{0,-16} replies {1}/30  (lost {2}%)" -f $target, $ok, [math]::Round((30 - $ok) / 30 * 100) }
Write-Output "`nSend this whole text back, together with the name of the network (for example: Cybernet home Wi-Fi, Jazz 4G)."
