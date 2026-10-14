<#
  Compares what Gcore's nameserver answers for nureasmir.com with what the live nameserver (Vercel) answers, name by name.
  Run it after importing the zone into Gcore and BEFORE changing the nameservers at the registrar. Every line must say "ok" (A records: only Vercel's addresses; other records: identical to the live answer).
  Only asks DNS questions; changes nothing.
#>
$gcore = "92.223.100.253"      # ns1.gcorelabs.net
$live  = "198.51.44.13"        # ns1.vercel-dns.com
$checks = @(
  @("nureasmir.com","A"), @("www.nureasmir.com","A"), @("admin.nureasmir.com","A"), @("training.nureasmir.com","A"), @("probe.nureasmir.com","A"),
  @("nureasmir.com","TXT"), @("_dmarc.nureasmir.com","TXT"), @("resend._domainkey.nureasmir.com","TXT"),
  @("brevo1._domainkey.nureasmir.com","CNAME"), @("brevo2._domainkey.nureasmir.com","CNAME"), @("orders.nureasmir.com","CNAME"),
  @("img.orders.nureasmir.com","CNAME"), @("r.orders.nureasmir.com","CNAME"), @("send.nureasmir.com","CNAME"), @("rsend.nureasmir.com","CNAME")
)
function Answer([string]$name, [string]$type, [string]$server) {
  try {
    $r = Resolve-DnsName $name -Type $type -Server $server -DnsOnly -NoHostsFile -ErrorAction Stop | Where-Object { $_.QueryType -eq $type }
    $v = foreach ($x in $r) { switch ($type) { "A" { $x.IPAddress } "TXT" { ($x.Strings -join "") } "CNAME" { $x.NameHost.TrimEnd(".").ToLower() } } }
    return @($v | Sort-Object)
  } catch { return @("(none: " + $_.Exception.Message.Split("`n")[0] + ")") }
}
$bad = 0
foreach ($c in $checks) {
  $g = Answer $c[0] $c[1] $gcore; $l = Answer $c[0] $c[1] $live
  if ($c[1] -eq "A") {
    # Vercel answers some names from a pool of its own addresses, so "same" means: only Vercel addresses, and at least one.
    $allowed = @("216.198.79.1", "64.29.17.1", "216.198.79.65", "64.29.17.65")
    $same = ($g.Count -gt 0) -and (@($g | Where-Object { $allowed -notcontains $_ }).Count -eq 0)
  } else {
    $same = (($g -join "|") -eq ($l -join "|"))
  }
  if (-not $same) { $bad++ }
  "{0,-6} {1,-34} {2}" -f $c[1], $c[0], $(if ($same) { "ok ($($g -join ', '))" } else { "DIFFERENT`n         gcore: $($g -join ', ')`n         live : $($l -join ', ')" })
}
""
if ($bad -eq 0) { "All records match: safe to switch the nameservers." } else { "$bad record(s) differ: fix them in Gcore first (do NOT switch the nameservers yet)." }
