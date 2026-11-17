# Image credits (Harbour Dip concept mockup)

All photos were downloaded on 21 Oct 2026 (AEDT) and stored locally in `assets/photos/`. They are used as **generic mood imagery only**. None of them shows, or is presented as, any real hotel; every listing on the site is labelled "Example listing". I avoided photos tagged with a named hotel and any with visible hotel branding.

On 17 Nov 2026 (AEDT) listing gallery masters in `photos/*.jpg` (except `restaurant-view.jpg`) were centre-cropped to landscape **3:2** and resized to **1600×1067**. Matching **800×533** WebP copies in `golden/img/cards/` and gallery WebPs beside each JPEG were regenerated from those masters. The verified coastal set in `/cursor/stores/bot/photoset/manifest.md` replaced tropical and duplicated rooftop heroes.

## Pexels: free under the Pexels License (https://www.pexels.com/license/). Attribution isn't required but is given here.
| File | Photo | Photographer |
|---|---|---|
| photos/rooftop-city.jpg | https://www.pexels.com/photo/lounge-chairs-by-the-pool-1870774/ | Jacoby Clarke |
| photos/rooftop-deck.jpg | https://www.pexels.com/photo/a-rooftop-swimming-pool-15088502/ | Chandan Agents |
| photos/infinity-ocean.jpg | https://www.pexels.com/photo/infinity-pool-near-a-body-of-water-under-a-cloudy-sky-13711854/ | John Kong |
| photos/clifftop-ocean.jpg | https://www.pexels.com/photo/infinity-pool-overlooking-ocean-at-luxury-resort-30615183/ | Vinícius Vieira ft |
| photos/hero-loungers.jpg | https://www.pexels.com/photo/modern-outdoor-pool-with-lounge-chairs-in-summer-38127493/ | panumas nikhomkhai |
| photos/indoor-spa-pool.jpg | https://www.pexels.com/photo/waterfall-in-the-swimming-pool-6667430/ | Pavel Danilyuk |
| photos/spa-loungers.jpg | https://www.pexels.com/photo/comfortable-tiled-loungers-in-contemporary-wellness-center-in-daylight-7031707/ | Max Vakhtbovych |
| photos/hotel-gym.jpg | https://www.pexels.com/photo/modern-gym-with-dumbbells-and-benches-40371837/ | 大 董 |
| photos/glass-roof-pool.jpg | https://www.pexels.com/photo/interior-of-empty-pool-in-building-7174400/ | Max Vakhtbovych |
| photos/restaurant-view.jpg (downloaded 16 Nov 2026 (AEDT), cropped to 2:3 and resized to 1000x1500) | https://www.pexels.com/photo/chairs-and-table-on-terrace-under-mesh-roof-18030810/ | Matteo Milan |

**Before launch:** re-check each licence and replace these photos with images supplied by the hotel that is listed. Stock photos must never be shown as a real hotel's property. `kids-float.jpg` (Pexels 8094751, Roxanne Minnish) showed an identifiable child and has been removed. On startup the app drops that filename from every hotel's photos list and clears it on any pass that still points at it.

## Other assets
- `hdc-lockup-*.svg`, `hdc-icon*.svg`, the favicon set and `og-image-1200x630.png`: the approved H Lane Monogram. `ph-*.svg` and the inline UI icons are original artwork made for this mockup.
- Fonts: Fraunces, Inter and Caveat (SIL Open Font License), self-hosted in `public/golden/fonts/` from Google Fonts. DM Sans is no longer requested.

## Golden Hour homepage media
Checked 23 October 2026. These files are generic stock. They are not photographs of the fictional example hotels.

WebP copies of the same files sit beside the JPEGs. Example-listing cards use resized WebP copies in `golden/img/cards/`, made from the licensed listing photos above. Pass photos in `photos/seats/` are smaller WebP crops of those same credited files (lounger, daybed, cabana, chair, glass-roof pool, infinity pool). They are example photos, not the fictional hotels.

### Pexels License
https://www.pexels.com/license/ was readable: photos and videos are free to use, including commercially; attribution is not required; you may modify them. You may not sell unaltered copies, imply endorsement, or redistribute them on another stock platform.

Homepage hero stills, cropped to 16:9. They are example photos, not partner venues.

| File | Photo | Photographer |
|---|---|---|
| golden/img/hero-swim.jpg (8:00 Swim & gym) | https://www.pexels.com/photo/30975492/ | Yulius Santoso |
| golden/img/gym-sm.jpg (8 am gym) | https://www.pexels.com/photo/modern-gym-with-dumbbells-and-benches-40371837/ | 大 董 |
| golden/img/3-sm.jpg (spa afternoon) | https://www.pexels.com/photo/comfortable-tiled-loungers-in-contemporary-wellness-center-in-daylight-7031707/ | Max Vakhtbovych |
| golden/img/hero-lunch.jpg (resort pool still, not used on the homepage) | https://www.pexels.com/photo/38188725/ | Relaxing Journeys |

| File | Photo page |
|---|---|
| golden/img/1-sm.jpg (dusk pool, Golden hour) | https://unsplash.com/photos/photo-1571896349842-33c89424de2d |
| golden/img/4-sm.jpg (daybed by the pool) | https://unsplash.com/photos/photo-1566073771259-6a8506099945 |

WebP and smaller mobile copies sit beside those JPEGs. The on-page chip says "Stock media · example only". Attribution is optional under the Pexels licence. The footer photographer credit was removed on 26 Oct 2026.

## For hotels page

| File | Source | Notes |
|---|---|---|
| golden/img/fh-loungers.jpg, fh-loungers-sm.jpg (and .webp) | Cropped from photos/hero-loungers.jpg (Pexels, panumas nikhomkhai, link above) | Also used in the homepage hotels banner. |
| golden/img/fh-dashboard.jpg (and .webp) | Screenshot of `/hotel` as demo-saltwater, captured 17 Nov 2026 | Sample data only. Cropped to `.dash-main`. Labelled as sample data on the page. |
| golden/img/fh-checkin.jpg (and .webp) | Screenshot of `/hotel/checkin` as demo-saltwater, captured 17 Nov 2026 | Sample data only. Cropped to `.checkin-page`. |
| golden/img/fh-guestlist.jpg (and .webp) | Viewport crop of `/hotel` Today's guests as demo-saltwater, captured 17 Nov 2026 | 1600×735. Multi-guest headline (B1-40 sample names). Today's guests shown as not checked in for a consistent capture. |