# Security Policy

## Supported versions

Only the latest release of OpenNeato receives security fixes. Pre-release
builds (`vX.Y-prN.<sha>`, `vX.Y-<branch>.<sha>`) are tracking builds for testing
and are not supported.

## Reporting a vulnerability

Please report security issues privately through GitHub's private vulnerability
reporting:

**[Report a vulnerability](https://github.com/renjfk/OpenNeato/security/advisories/new)**

Do not open a public issue for a vulnerability. Please include the affected
version or commit, the steps to reproduce, and the impact you observed. A
failing test or a patch is welcome but not required.

You will get an acknowledgement as soon as possible, usually within a few days.
Once a fix is ready it ships with the next release, and the advisory is
published with credit unless you prefer to stay anonymous.

Reports produced with the help of AI coding agents are welcome. Please make
sure every finding is checked against the source and, where possible, tested on
real hardware before reporting it.

## Security model

OpenNeato assumes a trusted local network:

- The API and web UI are served on the local network only. There is no
  authentication and no TLS, so anyone who can reach the bridge can control the
  robot.
- The firmware exposes `/api/serial`, which sends raw commands to the robot
  without safety checks. Treat access to the device as access to the robot.
- State-changing requests (POST, PUT, DELETE, PATCH) are only accepted when the
  browser reports them as same-origin, so a web page opened on the same network
  cannot drive the API. The check uses `Sec-Fetch-Site`, which browsers only
  send to HTTPS or localhost URLs, and otherwise compares `Origin` with `Host`.
- Requests from non-browser clients carry no origin information and cannot be
  told apart from a legitimate LAN client. Restrict the network the bridge runs
  on if that is not acceptable.
- A plain-HTTP reverse proxy that rewrites the `Host` header will have its
  state-changing requests rejected. Keep the original host, or serve the bridge
  over HTTPS, which also makes browsers send `Sec-Fetch-Site`.

Reports about missing authentication or TLS on the LAN are not treated as
vulnerabilities. Reports about ways to reach the API from outside the local
network are.

## Known limits

- **DNS rebinding.** A domain the attacker controls, re-resolved to the bridge's
  address, produces requests the browser treats as same-origin, so both the
  `Sec-Fetch-Site` check and the `Origin` comparison pass. Rejecting it means
  validating `Host` against the device's own names and addresses, which breaks
  custom DNS names and reverse proxies. That trade-off is not taken today; run
  the bridge behind a resolver that drops private addresses from public DNS
  answers (for example dnsmasq `stop-dns-rebind` or pfSense's default) to block
  it.
- **Older browsers.** Requests from non-browser clients and from browsers that
  send no origin information are accepted, because they cannot be told apart
  from a legitimate client.

## Dependencies

Firmware and frontend dependencies are pinned. Dependency updates are applied
through the regular review process; report a vulnerable dependency privately as
described above.
