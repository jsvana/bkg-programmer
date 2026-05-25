# 01. Protocol

The Quansheng UV-K5/UV-K1 serial protocol. Every claim in this document
is verified against firmware source — citations are inline.

## Wire format

```
┌──────┬──────┬─────────┬─────────┬──── obfuscated body ────┬─────────┬─────────┬──────┬──────┐
│ 0xAB │ 0xCD │ size_lo │ size_hi │   N bytes (XOR with key)  │ crc_lo  │ crc_hi  │ 0xDC │ 0xBA │
└──────┴──────┴─────────┴─────────┴───────────────────────────┴─────────┴─────────┴──────┴──────┘
```

- Length is little-endian, covers only the obfuscated body (`N` bytes), not
  the header, length field, CRC, or footer.
- The CRC bytes are themselves obfuscated. Total obfuscated region is
  `N + 2` bytes starting after the length field.
- Baud rate: **38400 8N1**, no flow control.
  - Source: `App/driver/uart.c:102` (`USART_InitStruct.BaudRate = 38400`)
  - Source: `tools/serialtool/cli.py:281`
    (`serial.Serial(port, baudrate=38400, ...)`)

## Obfuscation

The body is XOR'd byte-by-byte with this 16-byte rolling key:

```
16 6C 14 E6 2E 91 0D 40 21 35 D5 40 13 03 E9 80
```

Indexed by position within the body, modulo 16. Same operation in both
directions. Source: `App/app/uart.c:163`.

## CRC

CRC-16/XMODEM (poly 0x1021, init 0x0000, no input/output reflection, no
XOR-out). Computed over the **deobfuscated** body bytes excluding the CRC
itself, then the CRC is obfuscated alongside the body.

**Important asymmetry:**
- The firmware **does** validate inbound CRCs (`App/app/uart.c:782`). Your
  outgoing CRCs must be correct.
- The firmware emits outbound frames with CRC bytes set to `0xFF 0xFF`. Your
  receiver must **not** validate inbound CRCs from the radio.

## Body structure

After deobfuscation:

```
┌─────────┬─────────┬─────────┬─────────┬──── payload ────┐
│ cmd_lo  │ cmd_hi  │ plen_lo │ plen_hi │  plen bytes     │
└─────────┴─────────┴─────────┴─────────┴─────────────────┘
```

- `cmd` is u16 LE: the command ID.
- `plen` is u16 LE: the length of the payload that follows.
- `payload` is `plen` bytes of command-specific data.

The CRC (after the payload) is computed over this entire body — cmd, plen,
and payload.

## Sessions

The radio is stateful. Every read or write operation must include a
**session timestamp** that was established at the start of the connection
with a hello (`0x0514`) command. The radio stores this timestamp and
rejects subsequent reads/writes that don't echo it.

- Source for hello handler: `App/app/uart.c:809` (case `0x0514`)
- Source for session check: `App/app/uart.c:384, 438` (read/write reject
  on session mismatch)

Pick a 32-bit random value, send it in the hello, echo it in every
subsequent command. One handshake per WebSerial session.

## Command reference

All verified against the V3/K1 source (`briand/uv-k1-k5v3-firmware-custom`)
and confirmed in the Python reference implementation
(`tools/serialtool/msg.py` in that repo).

### `0x0514` — Hello (request)

Payload (16 bytes):
```
offset  size  field
0x00    4     timestamp (u32 LE) — pick a random value
0x04   12     padding (zero)
```

Reply: `0x0515`.

### `0x0515` — Hello reply

Payload (28 bytes):
```
offset  size  field
0x00   16     firmware version string, null-padded
0x10    1     bHasCustomAesKey
0x11    1     bIsInLockScreen
0x12    2     padding
0x14   16     4× u32 AES challenge values (only meaningful if bHasCustomAesKey)
```

The version string is the only fingerprint for which firmware is running.
There is no MCU type, no hardware revision, no model number returned by
the protocol. **All radio identification must come from the version
string plus EEPROM reads.**

### `0x051B` — Read EEPROM

Payload (8 bytes):
```
offset  size  field
0x00    2     address (u16 LE)
0x02    1     size (u8, max 0x80 = 128 bytes per command)
0x03    1     padding
0x04    4     session timestamp (echoed from hello)
```

Reply: `0x051C` containing the requested bytes.

### `0x051C` — Read EEPROM reply

Payload (4 + size bytes):
```
offset  size  field
0x00    2     address (echoed)
0x02    1     size (echoed)
0x03    1     padding
0x04   size   data
```

### `0x051D` — Write EEPROM

Payload (8 + size bytes):
```
offset  size  field
0x00    2     address (u16 LE)
0x02    1     size (u8, MUST be multiple of 8)
0x03    1     bAllowPassword — set to 1 to write to lockscreen-protected ranges
0x04    4     session timestamp
0x08   size   data
```

Reply: `0x051E` (acknowledgment, no useful payload).

**Constraints:**
- `size` must be a multiple of 8. The firmware writes in 8-byte chunks
  (`App/app/uart.c:458`). Non-multiples are rejected or partially
  processed; don't rely on partial.
- Writes to `[0x0E98, 0x0EA0)` (V1 lockscreen guard) require
  `bAllowPassword = 1`.
- Writes to `[0x0F30, 0x0F40)` trigger `SETTINGS_InitEEPROM()`
  immediately after the write completes — the firmware reloads settings
  from EEPROM into RAM. Order such writes LAST in a batch sequence so
  prior writes are observed.

### `0x05DD` — Reboot

Payload: empty (4 bytes total including cmd + plen).

The radio reboots immediately. No reply. Wait ~2-4 seconds before
attempting to reconnect.

### `0x0527`, `0x0529` — RSSI / battery read

Only built into the firmware when `ENABLE_EXTRA_UART_CMD` is defined.
**Not always available.** Your detection layer must probe for these and
fall back gracefully if absent.

### `0x0601`, `0x0602` — BK4819 register read/write

Only built with `ENABLE_UART_RW_BK_REGS`. Not relevant for normal
programming; useful for debugging RF behavior.

## Bootloader vs running firmware

When the radio is in DFU/bootloader mode (entered by power-on + side
key 1 + PTT, or after a flash failure), it does **not** respond to
`0x0514`. The bootloader emits unsolicited `0x0518` (NOTIFY_DEV_INFO) or
responds to `0x0530` (NOTIFY_BL_VER). These IDs and exact byte layouts
are documented in `tools/serialtool/msg.py` and used during flashing.

Detection should probe for the running firmware first; if no response,
listen for bootloader frames; if neither, it's a port/cable problem.

## EEPROM virtual address space

### V1 (DP32G030)

True contiguous EEPROM, 8 KB. Addresses `0x0000` through `0x1FFF`. No
mapping layer.

### V3/K1 (PY32F071)

Virtual address space up to 64 KB, mapped onto external PY25Q16 SPI flash
via the firmware's `EEPROM_ReadBuffer` / `EEPROM_WriteBuffer` functions.

See `App/driver/eeprom_compat.c:39-72` for the full mapping table. Key
ranges:

| EEPROM addr | Size | Purpose |
| --- | --- | --- |
| 0x0000–0x3FFF | 16 KB | 1024 channel records × 16 B |
| 0x4000–0x7FFF | 16 KB | 1024 channel names × 16 B |
| 0x8000–0x880D | ~2 KB | Channel + VFO attribute bytes (×2 B each) |
| 0x880E–0x886D | 96 B | Scan list names |
| 0x9000–0x90D5 | 214 B | VFO records |
| 0xA000–0xA16F | 368 B | Settings blocks (egzumer, F4HWN, AES, etc.) |
| 0xA158–0xA15F | 8 B | **F4HWN bit-packed settings region (V3/K1)** |
| 0xB000–0xB1FF | 512 B | Calibration |
| 0xC000–0xCFFF | 4 KB | Boot logo |

**Unmapped addresses behave silently:** reads return `0xFF`, writes are
discarded. This means write-verify is the only reliable confirmation.

### Address differences between V1 and V3/K1

| Region | V1 | V3/K1 |
| --- | --- | --- |
| Channel records | 0x0000 (200 channels) | 0x0000 (1024 channels) |
| Channel attrs | 0x0D60 (1 byte each) | 0x8000 (2 bytes each) |
| Channel names | 0x0F50 (200 entries) | 0x4000 (1024 entries) |
| Lockscreen-protected | 0x0E98–0x0EA0 | (different — verify) |
| Settings reload trigger | 0x0F30–0x0F40 | (verify; may differ on V3/K1) |
| F4HWN settings | 0x1FF0 | 0xA158 |
| Calibration | 0x1E00–0x1FFF | 0xB000–0xB1FF |

## Critical pitfalls

1. **F4HWN settings address.** Do NOT assume `0x1FF0` on V3/K1.
   The V3/K1 address is `0xA158`. Mix this up and you corrupt the
   calibration region. Source: `App/settings.c:470` (reads from PY25Q16
   flash `0x00A158`).

2. **Multiple of 8 for writes.** Always. Pad with current bytes from a
   prior read if your "real" write is shorter.

3. **Session timestamp.** Must match what you sent in hello. Reconnecting
   the serial port = new session = new hello required.

4. **The radio caches some EEPROM in RAM.** V3/K1 specifically caches
   channel attributes. A read-back after write may report success even
   if the EEPROM wasn't actually touched. Run the self-test (see
   `docs/09-self-test.md`) to confirm persistence before trusting verify.
