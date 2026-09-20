# Omni channel icons

Collected on 2026-09-20 from the official brand websites.

## Ready to use

The six PNG files in this directory are 512 x 512 pixels:

- `telegram.png` — official blue circular logo.
- `instagram.png` — official gradient glyph.
- `facebook.png` — official blue primary logo.
- `whatsapp.png` — official green glyph, 2026 pack.
- `viber.png` — official purple gradient icon, 2026 pack.
- `sms-fly.png` — official SMS-fly icon; this is the `flysms` provider used by Omni.

Telegram, Instagram, Facebook, WhatsApp and Viber have transparent backgrounds. SMS-fly uses the background supplied by the official website. PNGs were resized proportionally and centered where needed; logo shapes and colors were preserved.

`preview.png` shows the complete set. Use the individual PNGs for integration.

## SVG alternatives

- `svg/telegram.svg` — official blue circular Telegram logo.
- `svg/instagram-black.svg` and `svg/instagram-white.svg` — monochrome Instagram glyphs.
- `svg/whatsapp.svg` — green WhatsApp glyph.
- `svg/viber.svg` — purple gradient Viber icon.
- `svg/sms-fly-black.svg` — monochrome SMS-fly icon.
- `svg/sms-fly-logo.svg` — full color SMS-fly logo with wordmark.

SVG files are copied from their sources without artwork changes. The Facebook pack supplies PNG and Illustrator files, so no Facebook SVG is included. Instagram's gradient SVG contains a large embedded bitmap; use the compact gradient PNG instead.

## Sources

| Brand | Official source | Selected original |
| --- | --- | --- |
| Telegram | [Telegram Press Info](https://telegram.org/press#telegram-logos) | [Official logo archive](https://telegram.org/file/464001088/1/bI7AJLo7oX4.287931.zip/374fe3b0a59dc60005) / `Logo.png`, `Logo.svg` |
| Instagram | [Meta Brand Resource Center](https://www.meta.com/brand/resources/instagram/instagram-brand/) | `IG_brand_asset_pack_2023.zip` / `Instagram_Glyph_Gradient.png`, black and white SVG glyphs |
| Facebook | [Meta Brand Resource Center](https://www.meta.com/brand/resources/facebook/logo/) | `Facebook-Brand-Asset-Pack.zip` / `Facebook_Logo_Primary.png` |
| WhatsApp | [Meta Brand Resource Center](https://www.meta.com/brand/resources/whatsapp/whatsapp-brand/) | `WhatsApp-Brand-Resource-Center.zip` / `Digital_Glyph_Green_RGB_2026.png` and `.svg` |
| Viber | [Viber Brand Center](https://www.viber.com/en/brand-center/) | `Rakuten-Viber-Logos-2026.zip` / `Viber Icon Purple.png`, `Viber Icon Gradien.svg` |
| SMS-fly | [Official website](https://sms-fly.ua/) | [512px icon](https://sms-fly.ua/android-chrome-512x512.png), [monochrome SVG](https://sms-fly.ua/images/favicon/safari-pinned-tab.svg), [full logo](https://sms-fly.ua/images/landing/logo.svg) |

Brand assets remain subject to their owners' brand guidelines; this collection does not grant a separate license.

## Integration example

```html
<img src="/images/omni-icons/instagram.png" width="24" height="24" alt="Instagram">
```

These files are collected for later integration. No Omni application code was changed.
