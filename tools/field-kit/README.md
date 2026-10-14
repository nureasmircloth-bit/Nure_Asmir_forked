# Field kit: "the site does not open on the first try"

Goal: on the **affected connection**, find out which step stalls: the router's DNS, the provider's DNS, the path to our nameservers, the Wi-Fi link, or the web
connection itself. Run it **when the problem is happening** if you can; the timeline mode (`-Watch`) catches stalls that come and go.

## What we already know (14 Oct 2026, from the developer's own StormFiber line in Lahore)

| Fact | Evidence |
|---|---|
| Our DNS is healthy and complete | intoDNS: all checks pass; every record is in Vercel DNS |
| Vercel's nameservers are **far**: about 210 ms away, routed through the provider's international link (hop 8 jumps from 25 ms to 115 ms) | `tracert 198.51.44.13` and `198.51.45.13` |
| Cloudflare's nameservers are **near**: about 10 ms, 8 hops, inside Pakistan | `tracert 108.162.193.1` |
| Our website's servers are near too (about 40–50 ms) | `ping 216.198.79.1` |
| The **first** query to Vercel `ns1` (198.51.44.13) took 1.5–2.5 s in 4 of 5 separate runs (the fifth, inside the field-test script, did not); `ns2` did not | `Resolve-DnsName ... -Server 198.51.44.13` |
| A router that gives up after about 2 s turns that into "Server failed" / "site not found", then works on the next try (answer cached) | customer paste: first `nslookup` failed, second worked |
| Earlier on Cloudflare DNS the same customer line failed **drastically**, so "just go back to Cloudflare" is not proven to help | ticket notes, 7 Oct measurements |

So the open question is **why the first packet to 198.51.44.13 is slow**, and whether the customer's provider has the same problem (or worse) on the way to
Vercel's, Cloudflare's or Amazon's nameservers.

## What to prepare (before going)

Nothing has to be installed for the main test. Optional, for a deeper look:

* **Windows PowerShell** (built in). If scripts are blocked: `powershell -ExecutionPolicy Bypass -File .\field-test.ps1`.
* **curl.exe** (built into Windows 10/11).
* **pktmon** (built in; needs PowerShell **as Administrator**) records DNS packets: `-Capture`.
* Optional: **Wireshark** with Npcap (read `dns.etl` or capture by hand, filter `dns || icmp`), **WinMTR** (continuous route loss), the **BIND tools**
  (`dig`, to ask for any record type, e.g. `dig @198.51.44.13 nureasmir.com HTTPS`), a **USB Wi-Fi/ethernet cable** to rule out Wi-Fi, and a **phone with mobile data** as a control.
* The router: model and firmware (sticker + web page), and a photo of its **DNS / WAN settings** page. Huawei HG8546M / EG8143A5 menus to look at: *WAN → DNS*,
  *Security → DNS filter / ALG*, *Advanced → DNS relay*. **Do not change anything** until the tests are done.

## Run

```powershell
cd tools\field-kit
.\field-test.ps1                       # about 4 minutes: the whole picture
.\field-test.ps1 -Idle                 # + first question after silence (the stall we saw), about +4 minutes
.\field-test.ps1 -Watch -Minutes 30    # timeline: a never-seen name every 15 s through the router, plus the real site every minute
.\field-test.ps1 -Capture              # Administrator only: also records the DNS packets (dns.etl / dns.txt)
```

`probe.nureasmir.com` exists for this: it is the real website with a **60-second** DNS life (Vercel's minimum), so the lookup is cold every minute. Random names
such as `t3f9a….nureasmir.com` are also always cold (they hit the wildcard record), so nothing the router has seen before can hide a stall. The real names
`nureasmir.com` / `www` have a 6-hour DNS life on purpose; do not shorten those.

Send back the whole `field-report-<date>` folder.

## How to read the result

1. **Section 2, the link to the router.** Lost pings or a 95th percentile over about 50 ms: the Wi-Fi link itself stalls DNS. Repeat on a cable.
2. **Section 3 vs 4.** Compare *through the router* with *1.1.1.1 / 8.8.8.8 / 9.9.9.9 directly* and with *the provider's DNS directly*.
   * Router slow or failing, public resolvers fine: **the router's DNS relay** is the culprit (try its DNS set to 1.1.1.1 / 8.8.8.8, firmware, "DNS relay" off).
   * Router and provider DNS slow, public resolvers fine: **the provider's resolver** is the culprit (cannot be fixed by us; customers can use secure DNS).
   * All slow: the whole line; look at sections 2 and 6.
3. **Section 5, straight to the nameservers.** This is the one we care about most:
   * Vercel ns1/ns2 slow or failing while **Cloudflare and Route 53 are fine**: our DNS provider is the weak link on this provider's network, and moving the
     nameservers (Route 53 is the best candidate, Cloudflare only if it measures well here) is justified.
   * All four slow or failing: it is the line, not the provider.
   * `-Idle`: if the first question after silence is slow only for Vercel ns1 (like on the developer's line), it is the path to that one address.
4. **Section 6, tracert.** Compare the number of hops and where the time jumps. Stars in the middle are normal; stars at the end are not.
5. **Section 7, packet size.** A very small value (under about 1400) means big packets are cut, which breaks large DNS answers.
6. **Section 8, loading the site.** `dns=` should be near 0 after the first run. If `connect` or `tls` is slow while `dns` is fine, the problem is after DNS (firewall, proxy or CGNAT on the line).
7. **Timeline (`-Watch`).** Count the "slow" lines and look at the times: regular spikes (every few minutes) point to the router; a long run of failures to the line.

## After the visit: what each result means for us

| Result | Next step |
|---|---|
| Vercel nameservers slow/failing, Cloudflare and Route 53 fine | Move DNS to Route 53 (about $0.50 a month): create the zone, copy the 21 records, change the nameservers at the registrar, keep Vercel hosting |
| Cloudflare fine, Route 53 slow | Cloudflare **DNS only** (grey cloud), same hosting; verify on the customer line first |
| Router relay is the culprit | Fix on the router; document the setting for other customers; secure DNS advice stays |
| Provider's resolver is the culprit | Nothing on our side; keep the long DNS life; customers can use secure DNS |
| DNS is fine but `connect`/`tls` stall | Look at the provider path (CGNAT/firewall); test from mobile data; check `tracert` to 216.198.79.1 |
