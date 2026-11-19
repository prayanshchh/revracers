# Hill Country Circuit

A circuit near Austin, Texas, generated from open data by the tools
in `tools/track`. Every visible object and the Speed Dreams physics track come
from the same sources, so they stay aligned.

## Sources

- Track surface, centreline, widths, guard rails, pit lane, timing line,
  grandstands, bleachers, buildings and land use: OpenStreetMap,
  © OpenStreetMap contributors, ODbL. Saved in `source/osm.json`; see
  `source/LICENSE.md`.
- Ground height: USGS 3D Elevation Program 1 m lidar DEM (public domain),
  saved as `source/dem.png`.
- Corner identification and sector lines: published circuit sector maps.
- Race lap length: published circuit guides.
- Aerial photography: USGS National Agriculture Imagery Program at 0.3 m
  (`source/aerial.jpg`, public domain) gives the kerb positions, paint and
  run-off bands, ground colour and tree positions. Its near-infrared band
  (`source/aerial-nir.png`, public domain) separates growing grass from bare
  ground, which together with the colour finds the gravel beds. USGS National
  Map imagery and 3DEP elevation (`source/region-*`, public domain) give the
  horizon.
- Ground colour: USDA National Agriculture Imagery Program, Texas, flown
  21 August 2024 at 0.6 m (`source/aerial-2024.jpg` colour and
  `source/aerial-2024-nir.png` near infrared, public domain, served by the
  Microsoft Planetary Computer data API, fetched by `tools/track/fetch.py`).
  `tools/track/aerial.py` grades it into the October terrain albedo: dry grass
  becomes straw and olive by its vegetation index, leafy trees stay green and
  bare ground keeps its own colour.
- Run-off paint layout: `source/runoff.json` lists the paint designs measured
  from real race broadcasts and onboard laps of the 2024 to 2026 races at the
  real circuit (not in the repo): sponsor-coloured bands, areas, stripes, stars
  and REVRACERS wordmarks by track distance and side, plus the paint palette
  the shader uses. `tools/track/runoff.py` draws them into
  `textures/baked/apron_c.png` over the aerial paint classes; it only changes
  the baked textures, never the sealed or gravel spans the engine drives on.
- Trackside dressing: `dressing.json` lists sponsor banners by distance and
  side, gantries, added grandstands, cranes, spectator banks, distance
  boards, parked cars, tents, screens and where fences are left out;
  `structures.json` (written by `tools/track/track.py`) holds the suites
  and the front line of every grandstand footprint.
- Surface textures: Poly Haven, CC0 (`textures/source`, `TEXTURE-SOURCES.json`).
- Skies: Poly Haven, CC0 (`sky/`): Kloofendal 48d Partly Cloudy Pure Sky for the
  circuit's own time of day, and Qwantani Dawn, Mid Morning, Noon, Afternoon,
  Dusk 2 and Night Pure Sky for the other time-of-day settings.
- Trees: `tools/scenery/grow.py` grows the Central Texas species of the
  Blackland Prairie around the circuit (plateau live oak, Ashe juniper, honey
  mesquite, cedar elm; the oak, elm, ash, shrub and palm are kept for other
  circuits) branch by branch and leaf by leaf; they are rendered to the
  pictures in `content/scenery/trees`, which every circuit shares. Where each
  tree stands and how tall it is comes from `source/canopy.png`
  (`tools/scenery/canopy.py`): USGS 3D Elevation Program 2017 lidar canopy
  heights (StratMap 50 cm, public domain) where the USDA NAIP 2024 aerial
  (0.6 m, public domain, Planetary Computer items
  tx_m_3009751_se/3009752_sw/3009759_ne/3009760_nw_14_060_20240821) still shows
  vegetation, and outside the lidar cells that are canopy in both the 2022 and
  2024 aerials. `source/scenery.json` holds the crown detection, growth since
  2017, species by height, the clearances from the track, pit lane, buildings,
  roads and stands, and plots kept clear for grandstands and the theme park.
- Car parks: `tools/scenery/lots.py` fills the OpenStreetMap parking areas
  (`circuit-map.json`) along their mapped parking aisles, or in rows where
  none are mapped, with race-day cars, pickups and school buses
  (`cars.bin`); the rules are in `source/scenery.json` under `lots`.
- Downtown skyline, water towers, high-voltage lines and large far buildings
  (warehouses, schools, industrial roofs): OpenStreetMap footprints, parts,
  heights and power lines, © OpenStreetMap contributors, ODbL, saved in
  `source/skyline.json` by `tools/track/skyline.py`, which writes
  `skyline.json`. The distant woodland edges 1.5-6.5 km out come from the
  regional USGS aerial (`source/region-aerial.jpg`), classified with
  thresholds fitted to the lidar canopy where the two overlap.
- Spectators: pictures of 34 Microsoft Rocketbox adult avatars (MIT) in
  sitting and standing poses, in `content/scenery/crowd`, shared by every
  circuit. Shirts and caps are left white in a mask so each spectator gets a
  fan colour.
- Advertising boards use twelve fictional brands (Northwind, Voltara, Aurenne,
  Kestrel, Marlowe Outfitters, Torqua, Cordave Rail, Verdale, Albaren Air,
  Nimbara Cloud, Maison Luce, Halden) set in Anton, Oswald, Playfair Display,
  Montserrat, Cinzel and Barlow Condensed (SIL Open Font License); no real
  sponsor artwork is used.
- `textures/boards/boards.webp` is the trackside board atlas drawn by
  `tools/track/realboards.py` (`uv run --project tools/track python
tools/track/realboards.py build/hill-country/fonts
content/tracks/hill-country/textures/boards`): one row per board style seen
  at the real circuit, each copying only colour, layout and lettering style and
  reading REVRACERS. Fonts: the ones above plus Nunito, Great Vibes, Pacifico
  and Archivo Black (SIL Open Font License), fetched by `fetch.py`; emblems
  are drawn shapes.

## Pipeline

1. `uv run --project tools/track python tools/track/fetch.py` downloads the OSM
   extract and DEM.
2. `uv run --project tools/track python tools/track/track.py` writes `track.json`
   (centreline, width, camber, walls, kerbs, pit lane, grid),
   `crowd.bin`, the road-space paint masks and ground colour in
   `textures/baked`, and the build files for the ground surface, horizon and
   venue layout.
3. `node tools/sd-track.mjs` writes the Speed Dreams track `hill-country.xml`.
4. `uv run --project tools/track python tools/track/textures.py` builds derived
   textures.
5. `blender -b --factory-startup -P tools/track/road.py -- content/tracks/hill-country build/hill-country`
   builds `road.glb`: road, paint, kerbs, ground, terrain, horizon, pit lane,
   walls, fences, boards, grandstands, pit building, buildings, observation
   tower, start gantry, tents, cranes, masts and screens.
6. `tools/track/sky.py` crops a sky and bakes its environment.
7. `blender -b --factory-startup -P tools/track/scan.py -- content/tracks/hill-country build/hill-country`
   checks the whole lap for trackside and ground problems.
8. `uv run --project tools/track python tools/scenery/canopy.py content/tracks/hill-country <naip 2024 dir> <lidar dsm.npz>`
   rebuilds `source/canopy.png` (only when the canopy sources change), then
   `uv run --project tools/track python tools/scenery/trees.py content/tracks/hill-country build/hill-country`
   writes `trees.bin`: position, height, kind and shadow flag of every tree,
   from `source/scenery.json`, the aerial photograph and the venue layout.

`uv run --project tools/track python tools/scenery/lots.py content/tracks/hill-country build/hill-country`
writes `cars.bin`.

`uv run --project tools/track python tools/track/skyline.py content/tracks/hill-country build/hill-country [--fetch]`
writes `skyline.json` from `source/skyline.json` (`--fetch` refreshes it from OpenStreetMap).

The tree pictures are shared by all circuits and only need rebuilding when a
tree changes: `uv run --project tools/track python tools/scenery/grow.py <dir>`
grows the trees (name them to grow only some),
`blender -b --factory-startup -P tools/scenery/impostor.py -- <dir>/<tree>.npz <bake dir>/<tree> 512`
renders one from twelve directions at two heights, with its colour and the
sunlight it receives from three sides, and
`uv run --project tools/track python tools/scenery/pack.py <bake dir> content/scenery/trees`
packs the renders and writes `trees.json` (name species to repack only those).

The spectator pictures are shared too.
`blender -b --factory-startup -P tools/scenery/crowd.py -- <rocketbox dir> <bake dir>`
renders the 64 people from a download of the Rocketbox `Adults` avatars
(`avatars/<name>/`) and animations (`anims/`), and
`uv run --project tools/track python tools/scenery/crowd_pack.py <bake dir> content/scenery/crowd`
packs them.

## Accuracy

Walls and physics barriers follow OpenStreetMap guard rails out to 110 m from
the road, with synthetic walls elsewhere. Kerbs come from the aerial photo,
where they show as a 5 m red and white cycle. Gravel beds are pale, unpainted
ground with no growing grass in the near-infrared band, between the road edge
and the walls; Speed Dreams drives them as a separate gravel surface. Ground
within the
drivable area follows the road's camber plane, which is what Speed Dreams
simulates; beyond it the lidar terrain is blended in smoothly. Building
heights come from OSM tags where present. The observation tower position
comes from OpenStreetMap; its form is an approximation. Grandstand seating,
roofs and the pit building facade are generated, not surveyed.

## Landmarks

`landmarks.glb` and `landmarks.json` are generated by `tools/track/landmarks.py` (Blender) from OpenStreetMap
footprints in `source/osm.json`, the road.glb terrain and measured heights from the USGS 3DEP 2017 lidar
(public domain) and public 2025-2026 race footage used only as measurement reference. Every texture in it is
synthesised by `tools/track/landmark_textures.py`; no photo or third-party image is embedded. Lettering uses
the OFL fonts listed above (Montserrat, Barlow Condensed, Playfair Display). Building and ride names are
generic or fictional.

## Pit crew

- Character models, hair and animations in `source/crew/` are the Standard versions of [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) and [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) by Quaternius, CC0 1.0. The licence files are alongside them.
