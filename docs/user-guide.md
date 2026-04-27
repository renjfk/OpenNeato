# User Guide

Everything you need to set up, configure, and troubleshoot OpenNeato.

## Table of Contents

- [Hardware Setup](#hardware-setup)
    - [What You Need](#what-you-need)
    - [Debug Port Pinout](#debug-port-pinout)
    - [Wiring](#wiring)
- [Flashing Firmware](#flashing-firmware)
    - [Download](#download)
    - [Basic Usage](#basic-usage)
    - [What Happens Under the Hood](#what-happens-under-the-hood)
    - [Command Reference](#command-reference)
    - [Manual Flashing with esptool](#manual-flashing-with-esptool)
    - [Troubleshooting Flash Issues](#troubleshooting-flash-issues)
- [First-Time WiFi Setup](#first-time-wifi-setup)
    - [Option A: Fallback Access Point (no serial cable)](#option-a-fallback-access-point-no-serial-cable)
    - [Option B: Serial Monitor](#option-b-serial-monitor)
    - [WiFi Configuration Menu](#wifi-configuration-menu)
    - [Verifying the Connection](#verifying-the-connection)
    - [Quick Commands](#quick-commands)
    - [Reconfiguring WiFi Later](#reconfiguring-wifi-later)
- [Troubleshooting](#troubleshooting)
    - [Enabling Logging](#enabling-logging)
    - [Collecting Logs](#collecting-logs)
    - [Downloading Cleaning Maps](#downloading-cleaning-maps)
    - [Recovering Corrupted Cleaning History](#recovering-corrupted-cleaning-history)
    - [Factory Reset](#factory-reset)
    - [Reporting an Issue](#reporting-an-issue)
- [Multiple Robots](#multiple-robots)
- [Remote Access](#remote-access)
- [Serial API](#serial-api)
    - [Sending Commands](#sending-commands)
    - [Common Commands](#common-commands)

---

## Hardware Setup

> [!NOTE]
> Hardware assembly is not the primary focus of this project. For a comprehensive teardown
> guide covering how to open the robot and reach the debug port, see
> [Philip2809/neato-brainslug](https://github.com/Philip2809/neato-brainslug). This section
> covers the parts list, debug port pinout, and wiring.

### What You Need

| Item                                 | Price | Notes                                                                                                                                                                                                                   |
|--------------------------------------|-------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ESP32-C3 Super Mini (unsoldered)     | ~€3   | Get the variant **without pre-soldered pins**. You only need to solder the 4 pins for the debug port connection, which keeps the board compact. Search "ESP32-C3 Super Mini" on AliExpress — any ESP32-C3 variant works |
| JST XH 2.54mm 4-pin connectors       | ~€4   | Pre-crimped male/female pairs with 100mm wires. Search "Micro JST XH 2.54 4P connector" — comes in packs of 10 pairs, you only need one                                                                                 |
| T10 Torx security bit (tamper-proof) | ~€2   | 150mm long, needed to open the Botvac. Search "T10 tamper proof Torx bit 150mm"                                                                                                                                         |
| Soldering iron                       | ~€7   | Needed to solder the connector wires to the board. I picked up a cheap 80W adjustable-temp kit                                                                                                                          |
| Neato Botvac D3-D7                   |       | D8/D9/D10 are **not** supported (different board, password-locked serial port)                                                                                                                                          |

> [!TIP]
> I bought everything from AliExpress for under €16 total. Specific product listings come and
> go, so search by the descriptions above rather than relying on direct links.

> [!IMPORTANT]
> The ESP32 board must have **4 MB flash** (the standard for most dev boards). Boards with
> 2 MB flash are not supported — the dual OTA partition layout requires 4 MB.

Minimal soldering — just 4 wires to the board. If you're comfortable with a soldering iron,
solder the JST connector wires directly to the board pads for the cleanest result.

> [!TIP]
> If you're not confident in your soldering skills, here's a trick: insert the included header
> pins into the board holes alongside the wire tips so the pin squeezes the wire in place, then
> solder on top. The pin holds the wire steady and gives you a much easier target. The
> protruding pins also help anchor the board into EPE foam padding when you mount it inside the
> robot. That's what I did and it works fine.

The ESP32 is powered directly from the robot's 3.3V debug port — no separate USB power
supply needed during normal operation.

### Debug Port Pinout

The debug port connector on Botvac D3-D7 has four pins (left to right when looking at the
connector):

```
┌──────────────────────────┐
│  RX  │ 3.3V │  TX  │ GND │
└──────────────────────────┘
```

These are the **robot's** RX/TX labels, so you cross-connect to the ESP32:

| Robot Pin | ESP32 Pin | Notes                        |
|-----------|-----------|------------------------------|
| RX        | ESP TX    | Robot receives data from ESP |
| 3.3V      | 3V3       | Powers the ESP32             |
| TX        | ESP RX    | Robot sends data to ESP      |
| GND       | GND       | Common ground                |

The default TX/RX GPIOs depend on the chip (ESP32-C3: GPIO 3/4, ESP32-S3: GPIO 17/18,
original ESP32: GPIO 17/16) but are fully configurable from the web UI in
**Settings -> Robot -> UART Pins** — so wire whichever GPIOs are convenient and update the
setting to match.

### Wiring

Connect the four JST XH wires between the robot's debug port and the ESP32.

> [!WARNING]
> Double-check the TX/RX crossover — swapping TX and RX is the most common wiring mistake.
> Robot RX goes to ESP TX, and Robot TX goes to ESP RX.

|             Wiring — wide angle              |             Wiring — side angle              |
|:--------------------------------------------:|:--------------------------------------------:|
| ![Wiring wide angle](wiring-wide-angle.jpeg) | ![Wiring side angle](wiring-side-angle.jpeg) |

|            Wiring — close-up            |         Wiring — cover closed, bumper removed         |
|:---------------------------------------:|:-----------------------------------------------------:|
| ![Wiring close-up](wiring-closeup.jpeg) | ![Wiring with cover closed](wiring-cover-closed.jpeg) |

I tucked the ESP32 under the mainboard and packed it with leftover EPE foam padding to keep it
from moving around. This means the USB port is no longer accessible — but that's fine since
OpenNeato has OTA updates with SHA-256 and MD5 integrity verification, so you never need
physical USB access again after the initial flash.

---

## Flashing Firmware

The flash tool (`openneato-flash`) is a standalone CLI that handles everything: port detection,
firmware download, integrity verification, and flashing. No Python, no esptool installation,
no manual steps.

### Download

Download the flash tool for your platform from the
[Releases](https://github.com/renjfk/OpenNeato/releases) page:

- `openneato-flash_Darwin_arm64` — macOS (Apple Silicon)
- `openneato-flash_Darwin_x86_64` — macOS (Intel)
- `openneato-flash_Linux_arm64` — Linux (ARM64, e.g. Raspberry Pi)
- `openneato-flash_Linux_x86_64` — Linux (x86_64)
- `openneato-flash_Windows_x86_64.exe` — Windows

These are standalone binaries — no extraction needed. On macOS/Linux you may need to
`chmod +x openneato-flash_*` first.

> [!TIP]
> On macOS, if you get a "cannot be opened because the developer cannot be verified" error,
> remove the quarantine attribute:
> ```bash
> xattr -d com.apple.quarantine ~/Downloads/openneato-flash_Darwin_arm64
> ```

> [!IMPORTANT]
> macOS 11 (Big Sur) is the minimum supported version. This is the floor for the Go toolchain
> the binary is built with — older macOS versions (Catalina, Mojave, and earlier) will fail to
> load the binary or crash on first network request.

> [!WARNING]
> The flash tool has been primarily tested on macOS. Linux and Windows builds are provided but
> not battle-tested — if you run into issues on those platforms, please
> [open an issue](https://github.com/renjfk/OpenNeato/issues).

### Basic Usage

Plug the ESP32 into your computer via USB and run:

```bash
openneato-flash
```

That's it. The tool will:

1. Auto-detect the ESP32's USB serial port
2. Detect the chip type (ESP32-C3, ESP32-S3, etc.)
3. Download the matching firmware from the latest GitHub release
4. Verify the download against `checksums.txt` (SHA-256)
5. Flash all partitions (bootloader, partition table, application) at 921,600 baud
6. Open a serial monitor at 115,200 baud for WiFi setup

### What Happens Under the Hood

**Port detection** — The tool scans USB serial ports by vendor ID. It recognizes Espressif's
native USB (`VID 303A`), plus common USB-UART bridges: CP210x (`VID 10C4`), CH340 (`VID 1A86`),
and FTDI (`VID 0403`). Espressif devices are marked with `*` in the port list.

**esptool** — The tool automatically downloads and caches the official `esptool` binary. You
don't need to install it separately. It's stored in your OS cache directory and reused on
subsequent runs.

**Firmware pack** — The downloaded `.tar.gz` contains everything needed to flash:

- `bootloader.bin` — First-stage bootloader
- `partitions.bin` — Partition table (dual OTA slots, SPIFFS, NVS, coredump)
- `boot_app0.bin` — OTA boot selector
- `firmware.bin` — The application firmware (includes the embedded web UI)
- `offsets.json` — Flash addresses for each binary

**Integrity verification** — Before flashing, the tool downloads `checksums.txt` from the same
GitHub release and verifies the firmware archive's SHA-256 hash. If the hash doesn't match, the
tool refuses to flash.

### Command Reference

| Flag          | Default       | Description                                             |
|---------------|---------------|---------------------------------------------------------|
| `-port`       | auto-detected | Serial port path (e.g. `/dev/ttyUSB0`, `COM3`)          |
| `-chip`       | auto-detected | Chip type (e.g. `esp32-c3`, `esp32-s3`)                 |
| `-firmware`   | —             | Path to a local `.tar.gz` firmware pack; skips download |
| `-list`       | `false`       | List available serial ports and exit                    |
| `-no-monitor` | `false`       | Skip the serial monitor after flashing                  |
| `-monitor`    | `false`       | Open serial monitor only, don't flash                   |

> [!IMPORTANT]
> When using `-firmware` with a local firmware pack, place `checksums.txt` in the same
> directory as the `.tar.gz` file. The tool verifies SHA-256 before extracting and will
> refuse to flash if the checksums file is missing or the hash doesn't match.

### Manual Flashing with esptool

If `openneato-flash` does not run on your system, you can flash the same firmware pack manually
with Espressif's prebuilt `esptool` binary. This path does not require Python and uses the same
files, offsets, baud rate, compression, and reset behavior as `openneato-flash`.

1. Download the matching prebuilt `esptool` binary for your platform from
   [Espressif's esptool releases](https://github.com/espressif/esptool/releases), then extract
   it. To use the same version as `openneato-flash`, check `ESPTOOL_VERSION` in
   [`.goreleaser.yml`](../.goreleaser.yml).

2. Plug in the ESP32. If only one ESP device is connected, you can let `esptool` find the serial
   port automatically by omitting `-p`.

   If you have multiple serial devices connected, pass the port explicitly with `-p`. Common port
   names are `/dev/cu.usbmodem*` on macOS, `/dev/ttyUSB*` or `/dev/ttyACM*` on Linux, and `COM3`
   or similar on Windows.

3. Detect the chip name:

   ```bash
   ./esptool chip-id
   ```

   Look for a line like `Detecting chip type... ESP32-C3`, then use the lowercase chip name in
   the firmware filename: `esp32-c3`, `esp32-s3`, or `esp32`.

4. Download the full firmware pack and `checksums.txt` from the
   [OpenNeato Releases](https://github.com/renjfk/OpenNeato/releases) page.

   For example, for an ESP32-C3 on the latest release:

   ```bash
   curl -LO https://github.com/renjfk/OpenNeato/releases/latest/download/openneato-esp32-c3-full.tar.gz
   curl -LO https://github.com/renjfk/OpenNeato/releases/latest/download/checksums.txt
   ```

5. Verify the firmware pack checksum before extracting it.

   macOS:

   ```bash
   shasum -a 256 -c checksums.txt --ignore-missing
   ```

   Linux:

   ```bash
   sha256sum -c checksums.txt --ignore-missing
   ```

   Windows PowerShell:

   ```powershell
   Select-String "openneato-esp32-c3-full.tar.gz" checksums.txt
   Get-FileHash .\openneato-esp32-c3-full.tar.gz -Algorithm SHA256
   ```

   The hash printed by PowerShell must match the hash from `checksums.txt`.

6. Extract the firmware pack and open `offsets.json`.

   macOS/Linux:

   ```bash
   tar -xzf openneato-esp32-c3-full.tar.gz
   ```

   Windows PowerShell:

   ```powershell
   tar -xzf .\openneato-esp32-c3-full.tar.gz
   ```

7. Flash all images using the offsets from `offsets.json`.

   macOS/Linux:

   ```bash
   ./esptool -b 921600 --before default-reset --after hard-reset write-flash -z \
     BOOTLOADER_OFFSET bootloader.bin \
     PARTITIONS_OFFSET partitions.bin \
     OTADATA_OFFSET boot_app0.bin \
     APP_OFFSET firmware.bin
   ```

   Windows PowerShell:

   ```powershell
   .\esptool.exe -b 921600 --before default-reset --after hard-reset write-flash -z `
     BOOTLOADER_OFFSET .\bootloader.bin `
     PARTITIONS_OFFSET .\partitions.bin `
     OTADATA_OFFSET .\boot_app0.bin `
     APP_OFFSET .\firmware.bin
   ```

   Replace the `*_OFFSET` placeholders with the values from `offsets.json`, and replace the
   firmware pack name to match your chip. If auto-detection picks the wrong serial device or you
   have multiple ESP devices connected, add `-p <port>` before `-b 921600`. Do not hard-code the
   flash offsets from another source; `offsets.json` is generated with the release and is the
   source of truth for the manual command.

### Troubleshooting Flash Issues

**"No USB serial ports found"** — Make sure the ESP32 is plugged in and your OS recognizes
it. Run `openneato-flash -list` to see what's detected.

**"Failed to detect chip"** — The ESP32 may not be in download mode. Try holding the BOOT
button while plugging in USB. If the issue persists, use `-chip` to skip detection
(e.g. `-chip esp32-c3` or `-chip esp32`).

**"Checksum mismatch"** — The downloaded firmware is corrupted. Re-run the tool to download
again. If using `-firmware`, make sure `checksums.txt` matches the archive.

**Permission denied on serial port** — On macOS, no extra permissions are usually needed. On
Windows, close any other serial monitor that might have the port open.

---

## First-Time WiFi Setup

After flashing, the device has no saved WiFi credentials and won't be on your network yet.
You have two ways to provision it: a browser via the fallback access point (no serial cable
needed), or the serial menu that the flash tool opens for you.

### Option A: Fallback Access Point (no serial cable)

When the device has no saved credentials, it broadcasts an open WiFi network so you can
configure it from any phone or laptop browser. This works even after you've unplugged the
USB cable and tucked the ESP32 inside the robot.

1. From your phone or laptop, connect to the WiFi network named **`neato-ap`** (or
   `<hostname>-ap` if you've changed the hostname). It's an open network , no password.
2. Open a browser and go to `http://192.168.4.1`. You'll land on the OpenNeato dashboard.
3. Open **Settings -> WiFi**, tap **Scan**, pick your home network from the dropdown, and
   enter the password.
4. After confirming, the device joins your home network and reboots. The `neato-ap` network
   disappears at that point , reconnect your phone/laptop to your home WiFi to keep using
   the web UI at `http://neato.local` (or the IP shown on the dashboard).

> [!NOTE]
> The fallback AP is unencrypted because there's no way to display a password to a user
> who hasn't set one up yet. It only runs while the device has no saved credentials or
> cannot reach your home network. Once connected, it shuts down automatically.

### Option B: Serial Monitor

The serial monitor connects at 115,200 baud and shows the ESP32's boot output. You'll see
the boot banner. With no credentials saved, the fallback AP comes up automatically and the
banner reflects that:

```
========================================
  OpenNeato v0.1
========================================
  WiFi: AP mode, connect to neato-ap and open http://192.168.4.1
  Press 'm' for menu, 's' for status
========================================
```

You can finish provisioning either by joining `neato-ap` from a browser (Option A above) or
by pressing `m` to open the WiFi configuration menu over serial , both end up in the same
place.

### WiFi Configuration Menu

```
WiFi Configuration:
  [1] Scan WiFi networks
  [2] Enter SSID manually
  [3] Show current status
  [4] Reset all settings
```

**Option 1 — Scan WiFi networks**: Scans for up to 20 nearby networks and displays them
with signal strength (RSSI) and encryption type. Pick a network by number, then enter the
password (input is masked with `*`).

**Option 2 — Enter SSID manually**: Type the SSID and password directly. Useful for hidden
networks.

**Option 3 — Show current status**: Displays the current WiFi state — connected SSID, IP
address, MAC address, and signal strength.

**Option 4 — Reset all settings**: Factory reset — erases all saved settings including WiFi
credentials. Requires typing `YES` to confirm.

On successful connection, the ESP32 saves the credentials and restarts automatically. After
restart, the banner shows:

```
========================================
  OpenNeato v0.1
========================================
  WiFi: MyNetwork (192.168.1.42)
  Press 'm' for menu, 's' for status
========================================
```

### Verifying the Connection

Open a browser and navigate to:

- `http://neato.local` — mDNS hostname (configurable in Settings -> Network)
- `http://192.168.1.42` — use the IP shown in the serial monitor

You should see the OpenNeato dashboard. The robot status will show once the ESP32 is wired
to the debug port.

> [!NOTE]
> mDNS (`.local`) doesn't work on all networks — some routers block multicast traffic or
> resolve it differently. If `neato.local` doesn't work, use the IP address directly. You can
> find it in the serial monitor output or in your router's DHCP client list.

### Quick Commands

Once connected, you can type single-key commands in the serial monitor at any time:

| Key | Action                                  |
|-----|-----------------------------------------|
| `m` | Open WiFi configuration menu            |
| `s` | Print WiFi status (SSID, IP, MAC, RSSI) |

### Reconfiguring WiFi Later

Once the device is on your home network you can change networks from the web UI directly:
**Settings -> WiFi -> Scan**, pick a new network, enter the password.

If your home network goes down or you've moved house, the bridge falls back to the
`<hostname>-ap` access point automatically so you can re-provision it from a browser without
opening up the robot. This behavior is controlled by the **Fallback AP on disconnect** toggle
in the WiFi section , it's on by default. If you turn it off, recovery from a broken WiFi
config requires the serial menu.

To wipe credentials entirely and force the device back into first-time setup mode (always-on
AP, no auto-reconnect), use **Settings -> WiFi -> Forget current network**. The device will
broadcast `<hostname>-ap` until you provision a new network.

---

## Troubleshooting

If something isn't working as expected, use the built-in diagnostics tools to collect
information before creating an issue.

### Enabling Logging

Go to **Settings -> Diagnostics** and set **Log Level**:

- **Off** (default) — no events written to storage, zero flash wear
- **Info** — logs errors, timeouts, state transitions, boot, WiFi, OTA, NTP, cleaning events,
  and notifications. Auto-reverts to off after 1 hour.
- **Debug** — everything in Info plus all serial commands with raw responses. Auto-reverts to
  off after 10 minutes.

For long-running diagnostics (e.g. catching an intermittent error that only appears after
hours of idling), enable **Remote Syslog** in the same section. This sends all log output
over UDP (port 514) to a syslog receiver on your network instead of writing to flash. The
auto-expire timer is disabled when remote syslog is active, so logging continues until you
turn it off. Enter the IPv4 address of your syslog receiver (e.g. a machine running
`rsyslog`, `syslog-ng`, or any UDP syslog listener).

> [!NOTE]
> When remote syslog is off, logging writes to flash storage (SPIFFS). Higher levels generate
> more writes, which increases flash wear. Use Info or Debug only when actively diagnosing an
> issue.

### Collecting Logs

Go to **Settings -> Diagnostics -> Logs** to view all log files. The current session log
(`current.jsonl`) is listed first, followed by archived logs (newest first).

For each log file you can:

- **View** — tap the filename to see the contents in-browser
- **Download** — tap the download icon to save the `.jsonl` file
- **Delete** — tap the delete icon to remove individual files

To download all logs: use the individual download buttons for each file you need. When
reporting an issue, include at least the `current.jsonl` and any archived log files from the
time the problem occurred.

### Downloading Cleaning Maps

If a cleaning session produced unexpected results (missed areas, strange paths, early
termination), download the cleaning history session from **History**. Each session includes
the robot's recorded path rendered as a coverage map, along with stats like duration, distance,
area covered, and battery usage.

### Recovering Corrupted Cleaning History

If the History page shows a "Cleaning history is corrupted" message, one of the stored sessions
has malformed data and is preventing the list from loading. This can happen if a cleaning was
interrupted by a power loss or unexpected reset. The following steps let you find and remove
the bad session(s) without losing the rest. Replace `YOUR_ROBOT` with your bridge's hostname
or IP address.

1. **Fetch the session list** and inspect it visually:

    ```sh
    curl "http://YOUR_ROBOT/api/history"
    ```

   Paste the response into a JSON validator (for example
   [jsonlint.com](https://jsonlint.com) or [jsonformatter.org](https://jsonformatter.org)).
   The validator will flag the position of the malformed entry. Note the `name` field of the
   bad session (e.g. `1776667071.jsonl.hs`).

2. **Delete the bad session**:

    ```sh
    curl -X DELETE "http://YOUR_ROBOT/api/history/<filename>"
    ```

3. **Reload the History page**. If multiple sessions are corrupted, repeat steps 1-2 until the
   list loads.

If you'd rather not investigate, the History page also offers a **Delete all history** button
that wipes every session in one go and restores the list view.

### Factory Reset

Two ways to factory reset:

1. **From the web UI**: Settings -> Device -> Factory Reset. Type `RESET` to confirm.
2. **Hardware button**: Hold the BOOT button for 5 seconds (GPIO9 on ESP32-C3, GPIO0 on
   ESP32-S3 and original ESP32). The ESP32 will erase all settings and restart.

> [!CAUTION]
> Both methods erase everything — WiFi credentials, settings, logs, and cleaning history.

> [!TIP]
> If you just need to clear logs and maps, use **Settings -> Device -> Format Storage** instead.
> This erases logs and cleaning maps but keeps your WiFi and settings intact.

### Reporting an Issue

Before creating an issue on GitHub:

1. **Set log level to Debug** (Settings -> Diagnostics -> Log Level -> Debug). For intermittent
   issues, enable **Remote Syslog** so logging persists without flash wear or auto-expire.
2. **Reproduce the problem** while logging is active
3. **Download the logs** (Settings -> Diagnostics -> Logs), or copy the relevant lines from
   your syslog receiver if using remote syslog
4. **If the issue involves cleaning**: download the relevant cleaning session from History
5. Create an issue at [github.com/renjfk/OpenNeato/issues](https://github.com/renjfk/OpenNeato/issues)
   and attach the log files

Include in your issue:

- Firmware version (visible on the Dashboard or Settings -> Firmware)
- Robot model (D3, D4, D5, D6, or D7)
- What you expected vs. what happened
- The log files from the time of the incident

---

## Multiple Robots

If you have more than one Botvac, flash a separate ESP32 for each robot and give them
unique hostnames via **Settings -> Network -> Hostname** (e.g. `neato-upstairs`,
`neato-downstairs`). Each device will be reachable at `http://<hostname>.local`.

> [!TIP]
> Add each robot's web UI to your phone's home screen for quick access. Since each has a
> different hostname, they'll show up as separate bookmarks.

---

## Remote Access

OpenNeato is a local-only device — it has no cloud component and doesn't expose anything to
the internet. If you want to access your robot while away from home, the simplest and most
secure approach is to set up a VPN to your home network.

I use a personal [WireGuard](https://www.wireguard.com/) VPN, which lets me reach the robot
(and everything else on my LAN) as if I were home. WireGuard is lightweight, fast, and easy to
set up on most routers or a Raspberry Pi.

> [!TIP]
> A home VPN solves remote access not just for OpenNeato but for all your local devices and
> services — NAS, printers, cameras, etc.

---

## Serial API

OpenNeato exposes a serial passthrough endpoint that lets you send any command directly to
the robot over HTTP. This is useful for advanced diagnostics, maintenance tasks, and
automation workflows that go beyond what the web UI provides.

> [!CAUTION]
> This API sends commands directly to the robot with no safety checks or confirmation
> prompts. Incorrect commands can reset settings, erase data, or interfere with an active
> cleaning session.
>
> The firmware uses optimized caching and priority queues for serial communication - raw commands bypass this and can
> interfere with normal operation. Only use this if you know what you're doing. If you think a command should be exposed
> through the web UI instead, please [open an issue](https://github.com/renjfk/OpenNeato/issues).

### Sending Commands

Send a `POST` request to `/api/serial` with the command in the `cmd` query parameter:

```bash
curl -X POST 'http://neato.local/api/serial?cmd=NewBattery'
```

The response is the raw text output from the robot, exactly as it would appear over a direct
serial connection. Replace `neato.local` with your device's IP address if mDNS isn't working
on your network.

**Response codes:**

| Status | Meaning                                           |
|--------|---------------------------------------------------|
| 200    | Command sent, robot response in body (plain text) |
| 400    | Missing or empty `cmd` parameter                  |
| 503    | Robot communication busy or unavailable           |

Commands with spaces must be URL-encoded (`%20`), or use `--data-urlencode` with `curl`:

```bash
curl -X POST -G 'http://neato.local/api/serial' --data-urlencode 'cmd=SetUserSettings Reset'
```

### Common Commands

A few typical maintenance tasks:

> [!WARNING]
> Some commands (like `NewBattery`) require TestMode. Leaving TestMode enabled bypasses the robot's safety
> checks and can cause unexpected behavior - no scheduled cleanings, charging issues, and unpredictable
> button responses. Always disable it immediately after use.

```bash
# New battery installed (resets fuel gauge calibration, requires TestMode)
curl -X POST 'http://neato.local/api/testmode?enable=1'
curl -X POST 'http://neato.local/api/serial?cmd=NewBattery'
curl -X POST 'http://neato.local/api/testmode?enable=0'

# Reset robot user settings to factory defaults
curl -X POST 'http://neato.local/api/serial?cmd=SetUserSettings%20Reset'

# Clear all robot log files
curl -X POST 'http://neato.local/api/serial?cmd=ClearFiles%20All'
```

Any command the robot supports can be sent this way.
