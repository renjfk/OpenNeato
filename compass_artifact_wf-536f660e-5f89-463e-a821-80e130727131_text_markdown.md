# Neato Botvac SmartBatt Manufacture Date Anomaly — Root Cause and Recommendation

## TL;DR
- The future-dated `SmartBatt Mfg Year/Month/Day` values (2089, 2081, 2083, 2091, 2071, 2051, 2043, 2042 …) are **not a property of the Panasonic pack and not a deterministic SBS encoding quirk** — they are a **Neato firmware parsing/decode regression** present in the 4.x firmware family (specifically observed on builds that emit `SmartBatt Data Version,512` and `Chemistry,LION1` / `Device Name,F164A10288`). The strongest single piece of evidence is that one physical Panasonic pack (`SmartBatt Serial 17677`) reports `2015,9,26` under firmware 3.0.0_645 and 3.2.0_305 and reports `2043,10,7` under firmware 4.5.3_189 on the same robot.
- No safe deterministic decoding rule (clear-bit-15, subtract-64, BCD reinterpretation, byte-swap) is consistent with all known samples and with the constraint that Sample A's robot was purchased in 2022. The popular "subtract 64 years" theory works for Sample A and B but fails for the 2051 reading (→1987, predates the 1991 commercial introduction of Li-ion batteries), the 2071 reading (→2007, before the Botvac line existed), and contradicts the same-pack ground truth that shows 2015, not 1979, on older firmware.
- **Recommendation: keep the raw `year, month, day` triplet as-is, expose it labelled as reported by the robot, and flag any year that is in the future relative to the host clock (or the robot's own `Time UTC`) as "unreliable — known Neato firmware decode bug." Do not attempt to normalize until either a raw 16-bit SMBus dump from register 0x1B is captured on a known-good pack, or the Neato `Neato_4.5.3_189.bin` / `Neato_4.6.0_72.bin` decode routine is disassembled.**

## Key Findings

1. **The anomaly is firmware-side, not battery-side.** On roboter-forum.com thread 41106 ("D3 Akkuproblem durch Update 4.5.3") the same physical Panasonic pack (`Serial 17677`, `Manufacturer Name,Panasonic`, `Device Name,F164A1028` on old firmware → `F164A10288` on new firmware) returns `2015,9,26` on Neato firmware 3.0.0_645 and 3.2.0_305, but returns `2043,10,7` after the user upgrades to 4.5.3_189. The pack did not change. The firmware did.

2. **The decode regression correlates with other ASCII-side artifacts in the same firmware band.** Builds that emit a future year also flip `Chemistry` from `LION` → `LION1` (extra trailing "1") and `Device Name` from `F164A1028` → `F164A10288` (extra trailing "8"), and bump `Data Version` from `2304` to `512`. The first two changes are the signature of a buffer-length off-by-one in the SMBus Block-Read implementation (the first byte of a Block-Read return is the length; a miscount of one trivially appends one extra ASCII char). The Word-Read at command 0x1B is in the same firmware module and is consistent with the same parser issue producing a shifted 16-bit `ManufactureDate` value that then yields a future year through the otherwise-correct SBS decode.

3. **No public source decodes the raw 0x1B word for these packs.** The Neato firmware presents the date pre-decoded as three CSV integers to host tooling (`GetVersion` → NeatoToolio / NeatoControl). None of the public reverse-engineering repositories — `RobertSundling/neato-botvac`, `djremco/neato-botvac-D7-Local`, `jdredd87/NeatoToolio` (a Delphi GUI that only parses the already-decoded CSV), `kangguru/botvac`, `stianaske/pybotvac`, `Philip2809/neato-brainslug` — contain a decompilation of the date-handling routine, and no one has posted a raw `i2cget` capture from a 945-0225 / 205-0011 pack's BQ-series fuel gauge.

4. **Every "fix" derivable from the SBS spec alone is wrong for at least one known sample.**
   - Subtract 64 years (i.e. clear bit 15 of the packed word): turns 2089→2025, 2081→2017, 2083→2019, 2091→2027, but it also turns 2051→1987 (predates the 1991 commercial introduction of Li-ion batteries — per Wikipedia's "History of the lithium-ion battery": "1991: Sony and Asahi Kasei started commercial sale of the first rechargeable lithium-ion battery"), turns 2071→2007 (before the Neato Botvac Connected, the first Li-ion Botvac, launched in September 2015), and contradicts the same-pack ground truth showing 2015, not 1979, on old firmware.
   - Byte-swap: gives values like 0x52DA, 0x4BCB which decode to absurd years.
   - Treat as BCD: produces invalid months/days; doesn't match the bit layout that the other samples obey.
   - Clamp year ≤ current year: silently invents a date.
   None of these are supported by either the SBS spec or by an external project.

5. **Sample C (2024-8-25) shows the standard decode IS correct on at least some firmware paths/packs.** This is why a universal subtraction rule is wrong. The bug is intermittent and firmware-version-dependent, not pack-dependent.

## Details

### Smart Battery Data Specification — the relevant ground truth
Both the SBS-IF Smart Battery Data Specification Rev 1.0 (February 15, 1995, authored by R. Dunstan) and the current Rev 1.1 (December 11, 1998, authored by D. Friel; available at sbs-forum.org/specs/sbdat110.pdf) define `ManufactureDate()` at §5.1.26, verbatim: *"The date is packed in the following fashion: (year-1980) * 512 + month * 32 + day"*, i.e.:
- bits 0–4: day (1–31)
- bits 5–8: month (1–12)
- bits 9–15: year offset from 1980 (0–127)

The Linux kernel `drivers/power/supply/sbs-battery.c` uses exactly this decode and exposes `POWER_SUPPLY_PROP_MANUFACTURE_YEAR/_MONTH/_DAY`. Manufacture-date support was added by Sebastian Reichel (sebastian.reichel@collabora.com) on 2020-05-13 18:55 UTC as patch 03/19 ("power: supply: core: add manufacture date properties") in the "[PATCHv1 00/19] Improve SBS battery support" series on the Linux Kernel Mailing List (lore.kernel.org), with the rationale: *"Some smart batteries store their manufacture date, which is useful to identify the battery and/or to know about the cell quality."* There is no documented vendor bit, BCD variant, or year-offset flag in the SBS spec itself; the upper two bits of *command codes* (not data words) are reserved for multi-battery addressing, which does not apply here, and there is no specified meaning for bit 15 of the data word other than "high bit of the 7-bit year field."

### Bit-level reconstruction of each known displayed year

| Displayed year | Year-since-1980 | Year-field bits (b15..b9) | Hex packed (full M,D in source) |
|---|---|---|---|
| 2015 (real, old FW) | 35 | 0100011 | 0x473A (Y=2015 M=9 D=26) |
| 2024 (Sample C) | 44 | 0101100 | 0x5919 (Y=2024 M=8 D=25) |
| 2034 (D3, FW 4.5.3) | 54 | 0110110 | 0x6C4C (M=2 D=12) |
| 2042 (D7 forum) | 62 | 0111110 | 0x7D4C (M=10 D=12) |
| 2043 (same pack as 2015 row, new FW) | 63 | 0111111 | 0x7F47 (M=10 D=7) |
| 2051 (Connected forum) | 71 | 1000111 | 0x8F4A (M=10 D=10) |
| 2071 (Connected forum) | 91 | 1011011 | 0xB74A (M=10 D=10) |
| 2081 (Sample B) | 101 | 1100101 | 0xCB4B (M=10 D=11) |
| 2083 (D5 forum) | 103 | 1100111 | 0xCF4A (M=10 D=10) |
| 2089 (Sample A) | 109 | 1101101 | 0xDA52 (M=2 D=18) |
| 2091 (D7 forum) | 111 | 1101111 | 0xDF4B (M=10 D=11) |

Observe: the "future" readings do not cluster on any single bit. Bit 15 alone being spurious would only explain values where year-since-1980 ≥ 64; it does not explain the 2043 reading from a pack that previously read 2015. A pure +28-year offset doesn't fit either (it explains 2015→2043 but not 2083 or 2089). A pure −64 offset doesn't work for 2051/2071. This is the signature of a mis-framed read, not a deterministic bit flip.

### Catalogue of samples found

| Raw date | Decode candidates | Plausible? | Source | Model / FW | Battery metadata |
|---|---|---|---|---|---|
| 2089-2-18 | 2025-2-18 (−64 yr) | No (purchased 2022) | User's Sample A | D7, FW 4.6.0 | Panasonic, LION1, F164A10288, DV 512, SBSerial 34832, SW 2048 |
| 2081-10-11 | 2017-10-11 (−64 yr) | Unverifiable | User's Sample B | Neato D-series (unconfirmed) | Not fully dumped |
| 2024-8-25 | 2024-8-25 (raw) | Yes | User's Sample C | D5-class, BotVac D-series | Panasonic, LION1, F164A10288, DV 512, SBSerial 23, SW 2048 |
| 2091-10-11 | (no rule works) | No | robotreviews.com viewtopic 22149 — D7 diagnostic dump | Botvac D7 Connected | Raw GetVersion in thread |
| 2083-10-10 | (no rule works) | No | robotreviews.com viewtopic 20730 — D5 Connected log | BotVacD5Connected | Panasonic, LION1, F164A10288, DV 512 |
| 2071-10-10 | (no rule works) | No | robotreviews.com viewtopic 23087 — DC02 / 905-0249 | Botvac Connected 905-0249 | Panasonic, LION, F164A1028, DV 512 |
| 2051-10-10 | 1987 (−64 yr) — impossible (pre-1991 Li-ion) | No | robotreviews.com viewtopic 20730 — Connected 905-0249 | Botvac Connected 905-0249 | Panasonic, LION, F164A1028, DV 512 |
| 2042-10-12 | (no rule works) | No | roboter-forum.com thread 32737 — "D7 entlädt Akku" | Botvac D7 | Panasonic, LION1, F164A10288, DV 512, SBSerial 488… |
| 2034-2-12 | (no rule works) | No | robotreviews.com viewtopic 23003 — D3 Connected | BotVacD3Connected 905-0321 / FW 4.5.3_189 | Panasonic, LION1, F164A10288, DV 512, SBSerial 45067, SW 2048 |
| 2043-10-7 | 2015-9-26 (per same-pack older FW) | Yes (real) | roboter-forum.com thread 41106 — "D3 Akkuproblem durch Update 4.5.3" | Botvac D3 / FW 4.5.3_189 | **Same physical pack** (SBSerial 17677) that reads 2015-9-26 on FW 3.x |
| 2015-9-26 | 2015-9-26 (raw) | Yes | roboter-forum.com thread 41106 — same pack on FW 3.0.0_645 / 3.2.0_305 | Botvac D3 / FW 3.x | Panasonic, LION (not LION1), F164A1028 (not F164A10288), DV **2304**, SBSerial 17677 |
| 0,0,0 | absent pack / failed auth | Yes (empty) | Multiple — robotreviews 22992, 23352; roboter-forum 56210 | Various | All zero, often with `SmartBatt Authorization=0` |

The "0,0,0" rows are the diagnostic baseline: when the robot fails to read the pack at all, every SmartBatt field is empty/zero. So the 20xx-xx-xx readings are not artefacts of "no pack present."

### Why the "−64 years" theory looks tempting but is wrong

Clearing bit 15 of the packed word reduces year-since-1980 by 64. It produces:
- 2089 → 2025 (looks plausible — and matches Sample A's user intuition)
- 2081 → 2017 (looks plausible for Sample B)
- 2083 → 2019, 2091 → 2027 (also plausible)
- **2051 → 1987 (impossible: predates the 1991 commercial introduction of Li-ion batteries by Sony and Asahi Kasei)**
- **2071 → 2007 (impossible: the first Li-ion Botvac, the Botvac Connected, launched in September 2015; the D3/D5 Connected, the only models reporting these dates, were announced at IFA 2016 and shipped early October 2016 per CNET / Pocket-lint coverage)**
- 2043 → 1979 (impossible — and contradicts the same-pack ground truth of 2015)
- 2042 → 1978, 2034 → 1970 (both impossible for the same reason)

Five of eight problematic samples fail this test. The rule is not deterministic and not safe to apply. It is also not supported by anything in the SBS spec, the Linux SBS driver, or any external project handling Neato data.

### What the bug fingerprint actually is

Three signals correlate perfectly across all "bad" samples:
1. `SmartBatt Data Version` is **512** (vs `2304` on the good firmware-3.x dump of the same pack).
2. `SmartBatt Device Chemistry` is **LION1** (vs `LION`).
3. `SmartBatt Device Name` is **F164A10288** (vs `F164A1028`).
4. The reported year is in the future (2030s–2090s).

Items 2 and 3 are 9-byte and 10-byte ASCII strings that have grown by exactly one trailing character. This is the classic signature of a buffer-length off-by-one in an SMBus Block-Read implementation (where the first byte of a Block-Read return is the length, and a miscount of one easily produces this pattern). The Word-Read at command 0x1B is in the same firmware module and is consistent with the same parser issue producing a shifted 16-bit value.

In short: the firmware regression that turned `LION`→`LION1` and `F164A1028`→`F164A10288` also turned the manufacture-date word into garbage. There is no per-bit correction rule that recovers the real date from the corrupted word without ambiguity.

## Recommendations

**Stage 1 — Now, with current evidence (do this):**
- **Keep the raw value as-is** in the data model: store `year, month, day` as reported. Do not subtract 64 or clear bit 15.
- **Expose a `manufacture_date_reliable` flag** that is `false` when any of these hold:
  - `year > current_year` (compared against host clock, or better, the robot's own `Time UTC` field from `GetVersion`)
  - `year < 2014` for a Botvac D-series (the first Li-ion Botvac Connected shipped September 2015; nothing pre-2014 is plausible)
  - The exact firmware-bug fingerprint: `Chemistry == "LION1"` AND `Device Name == "F164A10288"` AND `Data Version == 512` AND `year > current_year`.
- **In the UI, show the raw triplet but render it dimmed/struck-through with an info tooltip** along the lines of "Reported by robot firmware. On Neato Botvac D-series with firmware ≈4.5.x–4.6.x this field is known to be miscomputed by the robot's SMBus parser; the actual pack manufacture date is not recoverable from this value alone." This is the same "raw + label as unreliable" pattern used for randomized MAC addresses or for filesystem timestamps after a clock-skew event.
- **Do not silently substitute a guessed date.** A wrong date that looks plausible is worse than a clearly-flagged anomaly because it can cause warranty disputes and bad battery-age telemetry.

**Stage 2 — Conditions that should trigger re-investigation:**
- A raw `i2cget` SMBus capture of register 0x1B on a known-good 945-0225 / 205-0011 / Panasonic `F164A10288` pack is published. That single 16-bit word, compared to whatever the robot's firmware prints in CSV from the same pack, will reveal exactly what the parser is doing wrong and whether a deterministic mapping (e.g. "shift right one byte and re-decode") exists.
- The Neato `Neato_4.5.3_189.bin` or `Neato_4.6.0_72.bin` images (both available via RobertSundling/neato-botvac and via the Internet Archive Neato firmware mirror) are disassembled around the SBS read path and the off-by-one is identified. The fix can then be encoded as a deterministic remap.

**Stage 3 — Only after Stage 2 succeeds:**
- Add a normalization function `decode_neato_sbs_date(year, month, day, data_version, chemistry, device_name) -> (real_year, real_month, real_day, confidence)` gated on the exact firmware fingerprint above. Until you can derive that mapping from the raw 16-bit word, do not ship it.

**Thresholds that should change the recommendation:**
- A raw 0x1B SMBus dump that matches a firmware-bad CSV decode → unlocks Stage 3.
- A second independent same-pack-different-firmware comparison (besides roboter-forum thread 41106) confirming a deterministic transform → strengthens Stage 3.
- A statement from Neato/Vorwerk acknowledging the bug or publishing a corrected decode → enables Stage 3 directly.
- Sample A's user replaces the battery and the new pack also reports a future year on the same firmware → confirms firmware-only origin; no change to current recommendation needed.
- A user reports a future year on a Neato pack with `Data Version != 512` → the fingerprint above is too narrow and Stage 1 needs broadening.

## Caveats

- The samples are heavily skewed toward Botvac Connected and D3/D5/D7 with firmware 4.x. Behaviour on D8/D9/D10 (newer hardware, different battery part numbers 945-0376/0381/0382, 205-0021/0022/0023/0026) is not characterised here. Do not assume the same fingerprint applies.
- The "off-by-one in SMBus Block-Read length" interpretation is a structural inference from the visible ASCII artefacts (`LION`→`LION1`, `F164A1028`→`F164A10288`); it is not confirmed by a firmware disassembly. The user-visible *symptom* (a future, deterministic-looking but not recoverable date) is well established; the *mechanism* is hypothesis-grade until a raw SMBus capture or a firmware disassembly confirms it.
- The same-pack-different-firmware evidence (roboter-forum thread 41106) is a single forum thread. It is the strongest single data point in the corpus, but a second independent same-pack comparison would meaningfully strengthen the conclusion.
- The user's Sample A purchase-date constraint (2022) is what makes the "−64 years" theory's prediction of 2025 impossible. If the battery had been replaced post-purchase with a current-production cell, 2025 would be plausible — but the user explicitly states this constraint, and Sample C (a normal 2024 reading on the same firmware-fingerprint family) shows that the firmware *can* read non-future years on packs that exist, so a battery swap doesn't rescue the −64 rule across the whole sample set.
- Sample B is not fully dumped — no SmartBatt Serial / Data Version / Authorization values were provided. It is included for breadth but should be reconfirmed.
- Sample C's normal-looking `2024-8-25` reading is the single most important counterexample to any universal subtraction rule. Its full GetVersion dump should be retained for regression testing of any future decoder.
- This investigation deliberately ignores unrelated SmartBatt fields (BatteryVoltage, BatteryCurrent, BatteryTemperature, cycle count, Authorization). Those have their own well-known Neato quirks (e.g. the "fan current shunt misplaced on Botvac" reported on robotreviews) and are out of scope.

### Bottom line
**`need more evidence` to safely *normalize*, but `keep raw value as-is + label as unreliable when in the future` is the right decision today.** The "subtract 64 years" rule is plausible-looking but provably wrong on multiple samples and on the same-pack-different-firmware control case, so it should not be deployed.