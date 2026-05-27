# Radio Photos — Attribution

Marketing photos retrieved from **quansheng.store**, a Quansheng-branded
retailer, on **2026-05-25** for use in this open-source configuration
tool. Used for product identification only (helping users disambiguate
which physical radio they have when EEPROM-level detection is
ambiguous). Not redistributed for resale, not modified for marketing.

If you are the rights holder and would like these removed or replaced
with properly-licensed versions, please open an issue on the repo.

## Files

| File | Source product page | Listing name | CDN image URL |
| --- | --- | --- | --- |
| `uv-k5.jpg` | [link](https://quansheng.store/products/quansheng-uv-k5-ham-radio-handheld-5w-dual-band-two-way-radio-air-band-receive-am-fm-noaa-weather-alert-usb-type-c-rechargeable-walkie-talkies-long-range-for-adults-survival-gear-black) | UV-K5 | `cdn/shop/files/image_1_abb06a1b-5818-4e96-ba0e-4901eb7c74af_600x600.jpg` |
| `uv-k5-8.png` | [link](https://quansheng.store/products/quansheng-uv-k58-5w-ham-radio-handheld-multi-band-vhf-uhf-two-way-radio-air-band-reception-noaa-weather-usb-c-walkie-talkie-for-emergency-communication-camping-k6-gen) | UV-K5(8) | `cdn/shop/files/1_600x600.png?v=1774789629` |
| `uv-k5-99.jpg` | [link](https://quansheng.store/products/quansheng-uvk599-am-fm-dtmf-walkie-talkie-200ch-20-1000mhz-walkie-talkie-noaa-weather-forecast-with-flash-copy-frequency-tpye-c-lcd-display-for-hiking-camping-travel-two-way-radio) | UV-K5(99) | `cdn/shop/files/image_1_6f6a4864-1e5f-4037-86a3-dd05392d8cfa_600x600.jpg` |
| `uv-k1.jpg` | [link](https://quansheng.store/products/quansheng-uv-k1-2500mah-extended-battery-walkie-talkie-air-band-aviation-receive-handheld-two-way-radio-with-usb-type-c-charging-noaa-weather-alert-one-key-frequency-match-wireless-copy-long-range) | UV-K1 | `cdn/shop/files/image_1_7f77e5c3-4ad5-48d4-8f46-3dce7e5f0499_600x600.jpg` |
| `uv-k1-8.jpg` | [link](https://quansheng.store/products/quansheng-uv-k1-8-ham-radio-handheld-2500mah-battery-multi-band-walkie-talkie-with-air-band-receive-noaa-weather-wireless-frequency-copy-type-c-charging-200-channels-long-range-two-way-radio) | UV-K1(8) | `cdn/shop/files/image_1_400x400.jpg?v=1775021598` |

## Filename → internal RadioModelId mapping (provisional)

Retailer marketing names don't map cleanly to the V1/V2/V3 distinctions
we care about (which are MCU-revision-driven: V1 uses DP32G030, V3/K1
use PY32F071). Best guess based on visible features:

| File | Likely `RadioModelId` | Evidence | Confidence |
| --- | --- | --- | --- |
| `uv-k5.jpg` | `uv-k5-v1` | Classic K5 body, monochrome LCD, no USB-C visible | medium |
| `uv-k5-99.jpg` | `uv-k5-v3` | "VERSION V3" badge in product graphic, color LCD | high |
| `uv-k1.jpg` | `uv-k1` | "Mini Kong" branding on body | high |
| `uv-k5-8.png` | *suspect — see below* | Body shows "Mini Kong" (K1 form), not K5 | low |
| `uv-k1-8.jpg` | *suspect — see below* | Body is K5 form, not Mini Kong K1 | low |

## Known issues

**Two listings appear to use the wrong product photo:**

- `uv-k5-8.png`: filed under the "UV-K5(8)" listing but the photographed
  unit is clearly branded "Mini Kong" on the body — i.e. a UV-K1.
- `uv-k1-8.jpg`: filed under the "UV-K1(8)" listing but the photographed
  unit has the K5 form factor, not the Mini Kong form factor.

These look swapped on the retailer's site. We've kept the source-named
filenames so the mismatch stays auditable, but DO NOT wire `uv-k5-8.png`
or `uv-k1-8.jpg` into a disambiguation picker without first verifying
against physical hardware or sourcing a corrected image.

**No UV-K6 image.** quansheng.store does not list a separate UV-K6
product. In some markets UV-K6 is the same hardware as UV-K5(8). When
this is verified we may symlink or copy.

**Bundle shots, not clean.** All images include the charging dock,
earpiece, battery, manual etc. A real disambiguation UI may want
isolated radio-only crops; the current images are usable as thumbnails
but not as full-bleed hero shots.
