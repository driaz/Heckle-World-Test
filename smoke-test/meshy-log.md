# Meshy call log

Credit cap for the whole smoke test: **500**. Starting balance **4000** (2026-11-23 21:01 UTC).
"Actual" = `consumed_credits` reported by each task, cross-checked against balance deltas
(4000 → 3900 after batch 1–3, 3900 → 3864 after the retries). Times are UTC, ±30 s.
Free calls (balance, status, download) are not listed.

| # | Time | What | Tool / mode | Model + params | Task id | Expected | Actual | Result |
|---|------|------|-------------|----------------|---------|---------:|-------:|--------|
| 1 | 21:02 | Pine crop → clean white-bg image | image_to_image | nano-banana, 1:1 | 01a20a37-ba41-73c0-a323-83f4d6cfd30e | 3 | 3 | OK → `ref-crops/pine_clean.png` |
| 2 | 21:02 | Bush crop → clean image | image_to_image | nano-banana, 1:1 | 01a20a37-c036-740b-a0e7-56992856065a | 3 | 3 | OK → `ref-crops/bush_clean.png` (side nubs later caused a bad mesh, see #11) |
| 3 | 21:02 | Coin crop → clean image | image_to_image | nano-banana, 1:1 | 01a20a37-c47d-7297-8808-9c6b48a83aec | 3 | 3 | OK → `ref-crops/coin_clean.png` |
| 4 | 21:02 | Spring pad crop → clean image | image_to_image | nano-banana, 1:1 | 01a20a37-c8a1-72b6-b281-0bf6ed3af8a2 | 3 | 3 | OK → `ref-crops/spring_clean.png` |
| 5 | 21:02 | Flag crop → clean image | image_to_image | nano-banana, 3:4 | 01a20a37-cc9d-7294-8356-e075dfae9e7a | 3 | 3 | OK → `ref-crops/flag_clean.png` |
| 6 | 21:03 | Pine tree | image_to_3d, smart-topology | meshy-t2.5 + meshy-n1 texture, target 4000 tris, glb | 01a20a38-8de3-75e1-bda6-7979ef113487 | 15 | 15 | **Kept** → `public/models/pine.glb` (4165 tris) |
| 7 | 21:03 | Bush v1 | image_to_3d, smart-topology | meshy-t2.5 + meshy-n1, target 3000, glb | 01a20a38-917b-7606-914b-4cf4b28f6fee | 15 | 15 | **Rejected**: large orange lump hallucinated on the back side |
| 8 | 21:03 | Coin | image_to_3d, smart-topology | meshy-t2.5 + meshy-n1, target 1500, glb | 01a20a38-97c0-7533-a631-79a3084eadf4 | 15 | 15 | **Kept** → `public/models/coin.glb` (1433 tris; "?" on one face only, flat non-metallic colour) |
| 9 | 21:03 | Spring pad v1 | image_to_3d, smart-topology | meshy-t2.5 + meshy-n1, target 4000, glb | 01a20a38-9ca9-76dc-9d21-45d6adf70df9 | 15 | 15 | **Rejected**: star on top came out as a broken arrow shape |
| 10 | 21:03 | Goal flag | image_to_3d, smart-topology | meshy-t2.5 + meshy-n1, target 2500, glb | 01a20a38-a06c-705a-9f15-9e7012216c49 | 15 | 15 | **Kept** → `public/models/flag.glb` (2600 tris) |
| 11 | 21:04 | Grass-topped stone block retexture (the one allowed try) | retexture, text prompt | latest (meshy-7), enable_pbr, original UVs, 2K, input = hand-made 12-tri unit cube GLB (data URI) | 01a20a39-5f5e-7480-b74e-3e92d2548eb8 | 10 | 10 | Ran OK → `public/models/grass_block.glb`. Quality poor, **dropped from the scene**: see notes |
| 12 | 21:06 | Bush cleanup retry (remove side nubs) | image_to_image | nano-banana, 1:1, ref = bush_clean.png | 01a20a3b-5aaa-77fc-b9b1-f2870da91469 | 3 | 3 | OK → `ref-crops/bush_clean2.png` |
| 13 | 21:06 | Spring cleanup retry (full star, higher angle) | image_to_image | nano-banana, 1:1, ref = spring_clean.png | 01a20a3b-c0df-715e-96c2-6d065eaec7f6 | 3 | 3 | OK → `ref-crops/spring_clean2.png` |
| 14 | 21:07 | Bush v2 | image_to_3d, smart-topology | meshy-t2.5 + meshy-n1, target 3000, glb | 01a20a3c-1f9f-71f1-8065-cfd66f13d320 | 15 | 15 | **Kept** → `public/models/bush.glb` (2428 tris) |
| 15 | 21:07 | Spring pad v2 | image_to_3d, smart-topology | meshy-t2.5 + meshy-n1, target 4000, glb | 01a20a3c-5295-736a-8370-7590a9fde58b | 15 | 15 | **Kept** → `public/models/spring.glb` (4134 tris; star is clean but 6-pointed, not 5) |

## Totals

| Group | Credits |
|-------|--------:|
| Image cleanups (7 × 3) | 21 |
| Image-to-3D, kept (pine, bush v2, coin, spring v2, flag: 5 × 15) | 75 |
| Image-to-3D, rejected (bush v1, spring v1: 2 × 15) | 30 |
| Retexture experiment | 10 |
| **Total used** | **136** |

Credits by final asset (cleanup + every 3D attempt): pine 18, bush 36, coin 18, spring pad 36, flag 18, grass block retexture 10.

Balance: 4000 → **3864**. Remaining under the 500 cap: **364**.

## Notes

- Post-processing (free, local): every GLB's 2048² PNG texture was resized to 1024² JPEG with
  gltf-transform + sharp (2–3 MB → 0.3–0.45 MB each). No Draco/meshopt/KTX2, so plain `GLTFLoader` works.
- All image-to-3D outputs are Y-up, one mesh / one material / base-colour texture only, normalised to
  ~0.96 on the longest axis, with the origin at the bounding-box **centre** (not the base).
- Retexture: Meshy kept the cube's UVs but painted every face as a "side" (stone with a grass fringe).
  The top face has no grass surface, two of the four side panels show double-exposed (ghosted) brick
  patterns, and the style is flat orange 2D-cartoon rather than the chunky mossy look of the reference.
- Visual check of the final GLBs (front/back renders in headless Chromium): `ref-crops/meshy_props_check.png`.

## Verification by the orchestrating session (after the delegated run)

- Ending balance re-checked with `meshy_check_balance` at 21:45 UTC: **3864** (4000 − 136). No Meshy calls were made after the delegated run.
- All five prop GLBs load in the scene and were checked in the iteration screenshots (first in `shots/iter-1/`, final in `shots/iter-8/`).
- Retexture A/B: `shots/iter-4/ref-block-meshy.jpg` builds every island from the retextured block (`?block=meshy`).
  It looks worse than the procedural bricks + grass tiles (orange stone on every face, no grass top, obvious repetition),
  so the procedural material is used. `grass_block.glb` is kept only so the A/B stays reproducible; the extracted
  texture maps were deleted because nothing references them.
