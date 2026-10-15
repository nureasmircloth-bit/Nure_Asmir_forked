<#
  Checks the nureasmir.com zone that Gcore serves, record by record, against what we INTEND (the zone file gcore-zone-nureasmir.com.txt)
  and against the live nameserver (Vercel) for the records that must not change. Run it after importing the zone into Gcore and BEFORE
  changing the nameservers at the registrar (and again afterwards). Every line must say "ok".
  It only asks DNS questions; it changes nothing.
#>
$gcoreServers = @(@("ns1.gcorelabs.net", "92.223.100.253"), @("ns2.gcdn.services", "92.223.77.53"))
$live = "198.51.44.13"   # ns1.vercel-dns.com

# --- what the zone file says (the intended answers) -----------------------------------------------------------------------------
$V1 = @("216.198.79.1", "64.29.17.1"); $V65 = @("216.198.79.65", "64.29.17.65")
$expectA = [ordered]@{
  "nureasmir.com" = $V1; "www.nureasmir.com" = $V65; "admin.nureasmir.com" = $V65; "training.nureasmir.com" = $V65; "probe.nureasmir.com" = $V1
  "anything-random.nureasmir.com" = $V1     # the wildcard record (*): a never-configured name must resolve
}
$expectCname = [ordered]@{
  "brevo1._domainkey.nureasmir.com" = "b1.nureasmir-com.dkim.brevo.com"; "brevo2._domainkey.nureasmir.com" = "b2.nureasmir-com.dkim.brevo.com"
  "orders.nureasmir.com" = "orders-nureasmir-com.brand.brevosend.com"; "img.orders.nureasmir.com" = "orders-nureasmir-com.img.brand.brevosend.com"
  "r.orders.nureasmir.com" = "orders-nureasmir-com.r.brand.brevosend.com"; "send.nureasmir.com" = "send.forge.rmta.net"; "rsend.nureasmir.com" = "rsend-apne1.forge.rmta.net"
}
$expectNs = @("ns1.gcorelabs.net", "ns2.gcdn.services")
$expectCaa = 3   # pki.goog, sectigo.com, letsencrypt.org

# --- helpers ---------------------------------------------------------------------------------------------------------------------
function Names([string]$name, [string]$type, [string]$server) {
  try {
    $r = Resolve-DnsName $name -Type $type -Server $server -DnsOnly -NoHostsFile -ErrorAction Stop | Where-Object { $_.QueryType -eq $type }
    $v = foreach ($x in $r) { switch ($type) { "A" { $x.IPAddress } "TXT" { ($x.Strings -join "") } "CNAME" { $x.NameHost.TrimEnd(".").ToLower() } "NS" { $x.NameHost.TrimEnd(".").ToLower() } "MX" { $x.NameExchange } } }
    return @($v | Sort-Object)
  } catch { return @() }
}
# A raw UDP query, because Windows PowerShell 5.1 cannot ask for CAA records. Returns the answer count, or -1 when it failed.
function RawCount([string]$server, [string]$name, [int]$qtype) {
  foreach ($attempt in 1..3) {  # UDP can lose a packet; a real failure fails three times
  try {
    $b0 = [byte](Get-Random -Maximum 255); $b1 = [byte](Get-Random -Maximum 255)
    $q = New-Object 'System.Collections.Generic.List[byte]'
    $q.AddRange([byte[]]@($b0, $b1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0))
    foreach ($label in $name.Split(".")) { $b = [Text.Encoding]::ASCII.GetBytes($label); $q.Add([byte]$b.Length); $q.AddRange($b) }
    $q.AddRange([byte[]]@(0, [byte]($qtype -shr 8), [byte]($qtype -band 255), 0, 1))
    $udp = New-Object Net.Sockets.UdpClient; $udp.Client.ReceiveTimeout = 3000
    $udp.Connect($server, 53); [void]$udp.Send($q.ToArray(), $q.Count)
    $ep = New-Object Net.IPEndPoint ([Net.IPAddress]::Any, 0); $resp = $udp.Receive([ref]$ep); $udp.Close()
    if (($resp[3] -band 0x0F) -ne 0) { return -1 }
    return ($resp[6] * 256 + $resp[7])
  } catch { }
  }
  return -1
}
$script:bad = 0
function Line([string]$kind, [string]$name, [bool]$ok, [string]$detail) {
  if (-not $ok) { $script:bad++ }
  "{0,-6} {1,-36} {2}" -f $kind, $name, $(if ($ok) { "ok  $detail" } else { "PROBLEM  $detail" })
}

foreach ($srv in $gcoreServers) {
  ""; "=== $($srv[0]) ($($srv[1]))"
  foreach ($n in $expectA.Keys) {
    $want = @($expectA[$n] | Sort-Object); $got = Names $n "A" $srv[1]
    Line "A" $n (($got -join "|") -eq ($want -join "|")) "got [$($got -join ', ')] want [$($want -join ', ')]"
  }
  foreach ($n in $expectCname.Keys) { $got = Names $n "CNAME" $srv[1]; Line "CNAME" $n (($got -join "|") -eq $expectCname[$n]) "got [$($got -join ', ')]" }
  # TXT records must be identical to what the live zone serves
  foreach ($n in "nureasmir.com", "_dmarc.nureasmir.com", "resend._domainkey.nureasmir.com") {
    $g = Names $n "TXT" $srv[1]; $l = Names $n "TXT" $live
    Line "TXT" $n ($g.Count -gt 0 -and (($g -join "|") -eq ($l -join "|"))) "$($g.Count) record(s), same as live"
  }
  $ns = Names "nureasmir.com" "NS" $srv[1]
  Line "NS" "nureasmir.com" (($ns -join "|") -eq (($expectNs | Sort-Object) -join "|")) "got [$($ns -join ', ')]"
  $caa = RawCount $srv[1] "nureasmir.com" 257
  Line "CAA" "nureasmir.com" ($caa -eq $expectCaa) "answers: $caa (want ${expectCaa}: pki.goog, sectigo.com, letsencrypt.org; Vercel renews certificates through these)"
  $soa = RawCount $srv[1] "nureasmir.com" 6
  Line "SOA" "nureasmir.com" ($soa -ge 1) "answers: $soa"
}
""
if ($script:bad -eq 0) { "Every check passed on both Gcore nameservers: the zone matches the zone file. Safe to switch the nameservers." }
else { "$script:bad check(s) failed: fix them in Gcore first (do NOT switch the nameservers until this says everything passed)." }
