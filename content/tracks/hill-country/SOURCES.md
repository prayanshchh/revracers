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
- Run-off paint layout: `source/paint.png` is a map, measured frame by frame
  from reference onboard footage that is not in the repo, of which colour
  each patch of run-off has (asphalt, grass, green, red, white, blue,
  burgundy, painted kerb), one row per 2 m of track and one column per
  0.5 m across. `tools/track/aerial.py` recolours the aerial classes with
  it, paints the kerbs it lists and stamps our sponsor wordmarks; it only
  changes the baked textures, never the sealed or gravel spans the engine
  drives on.
- Trackside dressing: `dressing.json` lists sponsor banners by distance and
  side, gantries, added grandstands, cranes, spectator banks, distance
  boards, parked cars, tents, screens and where fences are left out;
  `structures.json` (written by `tools/track/track.py`) holds the suites
  and the front line of every grandstand footprint.
- Surface textures: Poly Haven, CC0 (`textures/source`, `TEXTURE-SOURCES.json`).
- Skies: Poly Haven, CC0 (`sky/`): Kloofendal 48d Partly Cloudy Pure Sky for the
  circuit's own time of day, and Qwantani Dawn, Mid Morning, Noon, Afternoon,
  Dusk 2 and Night Pure Sky for the other time-of-day settings.
- Trees: `tools/scenery/grow.py` grows an oak, an elm, an ash and a shrub
  (and a feather palm for street circuits) branch by branch and leaf by leaf;
  they are rendered to the pictures in `content/scenery/trees`, which every
  circuit shares. Where each tree stands comes from the aerial photograph:
  growing canopy is where near-infrared is well above red, and
  `source/scenery.json` holds the thresholds, the planted groves and the
  clearances from the track, pit lane, buildings, roads and stands.
- Spectators: pictures of 34 Microsoft Rocketbox adult avatars (MIT) in
  sitting and standing poses, in `content/scenery/crowd`, shared by every
  circuit. Shirts and caps are left white in a mask so each spectator gets a
  fan colour.
- Advertising boards use twelve fictional brands (Northwind, Voltara, Aurenne,
  Kestrel, Marlowe Outfitters, Torqua, Cordave Rail, Verdale, Albaren Air,
  Nimbara Cloud, Maison Luce, Halden) set in Anton, Oswald, Playfair Display,
  Montserrat, Cinzel and Barlow Condensed (SIL Open Font License); no real
  sponsor artwork is used.

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
   tower, start gantry, tents, cranes, masts, screens and the Austin skyline.
6. `tools/track/sky.py` crops a sky and bakes its environment.
7. `blender -b --factory-startup -P tools/track/scan.py -- content/tracks/hill-country build/hill-country`
   checks the whole lap for trackside and ground problems.
8. `uv run --project tools/track python tools/scenery/trees.py content/tracks/hill-country build/hill-country`
   writes `trees.bin`: position, height, kind and shadow flag of every tree,
   from `source/scenery.json`, the aerial photograph and the venue layout.

The tree pictures are shared by all circuits and only need rebuilding when a
tree changes: `uv run --project tools/track python tools/scenery/grow.py <dir>`
grows the five trees,
`blender -b --factory-startup -P tools/scenery/impostor.py -- <dir>/<tree>.npz <bake dir>/<tree> 512`
renders one from twelve directions at two heights, with its colour and the
sunlight it receives from three sides, and
`uv run --project tools/track python tools/scenery/pack.py <bake dir> content/scenery/trees`
packs the renders and writes `trees.json`.

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

## Pit crew

- Character models, hair and animations in `source/crew/` are the Standard versions of [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) and [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) by Quaternius, CC0 1.0. The licence files are alongside them.
