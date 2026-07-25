# MyHaut — Shopify theme

The `MyHaut Landing` design from Claude Design, rebuilt as a complete Shopify
**Online Store 2.0** theme. Upload the zip, pick your product, done — every
image, video, headline, price note and FAQ answer is editable in the theme
editor.

- Theme source: `shopify-theme/`
- Installable file: `myhaut-shopify-theme.zip`

---

## 1. Install

1. Shopify admin → **Online Store → Themes**
2. **Add theme → Upload zip file** → choose `myhaut-shopify-theme.zip`
3. **Customize** to open the theme editor, or **Publish** when you're ready.

The theme has no app dependencies and no build step.

---

## 2. Set up the product (5 minutes)

The landing page is one product with one option and four variants. Create it
under **Products → Add product**:

| Setting | Value |
| --- | --- |
| Title | MyHaut Hair Removal Spray |
| Option name | Menge |

Then add the variants **in this order** — the bundle cards refer to variants by
position:

| # | Variant name | Price | Compare-at price |
| --- | --- | --- | --- |
| 1 | `1× 100 ml` | 18,90 € | 21,90 € |
| 2 | `2× 100 ml` | 39,90 € | 43,80 € |
| 3 | `3× 100 ml` | 49,90 € | 65,70 € |
| 4 | `5× 100 ml` | 79,90 € | 109,50 € |

Two things depend on how you name the variants:

- **The compare-at price** drives the `−14 %` badge and the "spare 24 %" flags.
  Leave it empty on a variant and those badges simply disappear.
- **The leading number** (`3×`) drives the "16,63 € pro Flasche" line. Keep the
  `N× …` naming and it is calculated for you; otherwise set *Bottles in this
  bundle* on the bundle card by hand.

Set inventory to **Continue selling when out of stock** (or keep stock up to
date) — sold-out variants render as disabled buttons.

---

## 3. Point the page at the product

- **Product page** — nothing to do. `templates/product.json` is the landing
  page, so your product URL already renders the full design.
- **Homepage** — the sections fall back to the first product in the store. If
  you sell more than one product, open the theme editor and set **Product** in
  the *Hero*, *Sticky add to cart*, *Bundles* and *Closing CTA* sections.
- Any other product uses the plain **`product.simple`** template. Assign it per
  product under *Theme template* in the product admin.

---

## 4. Images and video

Every image area in the design is an image picker in the theme editor. Suggested
sizes:

| Section | Slot | Suggested size |
| --- | --- | --- |
| Hero | Background image / video | 2400 × 1400 (desktop), 1200 × 1600 (mobile) |
| Hero | Background video | Shopify-hosted MP4, or a YouTube/Vimeo URL |
| Sticky bar | Thumbnail | 200 × 200 |
| How it works | Step 1–3 | 1200 × 1200 |
| Before / after | Before, After | 1200 × 1200, same crop and lighting |
| Facts | Product image | 1200 × 1400 |
| Closing CTA | Background image | 2400 × 1200 |

The hero takes a **video with an image fallback**: set a video *and* an image —
the video autoplays muted and loops, the image shows on slow connections and
where autoplay is blocked.

Two demo images ship with the theme (`mh-demo-hero.webp`, the pink bathroom
scene, and `mh-demo-product.png`, your bottle render) and fill empty slots so
the theme never looks broken. Turn them off under **Theme settings → Brand →
Show the bundled demo images** once your own photos are in.

---

## 5. Navigation

Create a menu (**Content → Menus**) with anchor links so the header matches the
design:

| Label | Link |
| --- | --- |
| So funktioniert's | `#mh-steps` |
| Ergebnisse | `#mh-results` |
| Inhaltsstoffe | `#mh-ingredients` |
| FAQ | `#mh-faq` |

Add it under **Header → Menu**. Those anchor ids are section settings, so you
can rename them.

---

## 6. Languages (German + English)

German is the default. All storefront copy lives in `locales/de.default.json`
and `locales/en.json`.

**Every text setting in the theme editor is empty by default, and an empty
setting falls back to the translation for the visitor's language.** So:

- Leave a field empty → the visitor sees German or English automatically.
- Type into a field → your text wins, in every language.

To switch English on: **Settings → Languages → Add language → English**, then
publish it. The language switcher appears in the header by itself once a second
language is published (turn it off under *Header → Show language switcher*).

If you later want per-language versions of text you typed into section
settings, install Shopify's free **Translate & Adapt** app — it picks up theme
settings and locale files.

---

## 7. Editing the copy

Everything from the design is a setting. A few worth knowing:

- **Hero headline** is split in two fields — the second line is the italic rose
  line ("8 Minuten.").
- **Closing CTA button**: write `{price}` anywhere in the label and it is
  replaced with the live price of the selected bundle.
- **Bundle cards**: *Highlight this card* draws the rose "Bestseller · spare
  24 %" flag; the percentage is calculated from the compare-at price.
- **Bundle button behaviour**: select the bundle, select and scroll to the buy
  box, or add to cart straight away (default).
- **Marquee**: comma-separated list, one field.
- **FAQ**: real `<details>` accordions, so they work without JavaScript and are
  readable by search engines.

---

## 8. Before you go live

The design brief flagged these as placeholders — they are **invented numbers**
and must be replaced or removed before launch:

- `4,8 · 2.184 Bewertungen` (hero, reviews)
- `96 %` smoother skin, the `112 Teilnehmerinnen` footnote
- the three customer reviews (Lena M., Sarah K., Tobias R.)
- `3,15 € pro Anwendung`

Also check that the CPSR / "dermatologisch geprüft" / vegan claims match your
actual documentation — those are legal claims in the EU.

---

## What's in the theme

```
assets/      myhaut.css, myhaut.js, two demo images
config/      settings_schema.json, settings_data.json
layout/      theme.liquid, password.liquid
locales/     de.default.json, en.json
sections/    mh-hero, mh-sticky-atc, mh-marquee, mh-steps, mh-before-after,
             mh-facts, mh-reviews, mh-bundles, mh-faq, mh-cta,
             announcement-bar, header, footer, mh-cart-drawer,
             header-group.json, footer-group.json, main-* (cart, product, page,
             collection, search, blog, article, 404, list-collections)
snippets/    mh-media, mh-price, mh-product-data, mh-stars
templates/   index.json, product.json, product.simple.json, cart, page,
             collection, list-collections, search, 404, blog, article,
             password, gift_card, customers/*
```

Cart adds are AJAX and open a slide-in drawer; the drawer is re-rendered
through Shopify's Section Rendering API, so prices always come from Liquid.
Without JavaScript the buttons fall back to normal form posts.
