# Dune Bay Circuit

A floodlit desert circuit generated from open data by the tools in
`tools/track`. The lap, the walls, the pit lane and the buildings around the
track all come from the same sources, so the scenery and the Speed Dreams
physics track stay aligned.

## Sources

- Lap, pit lane, start line, barriers, buildings, car parks, roads, gardens and
  tree rows: OpenStreetMap, © OpenStreetMap contributors, ODbL. Saved in
  `source/osm.json` by `tools/track/dunebay_fetch.py`; see
  `source/LICENSE.md`.
- Track edges (`source/survey.json`), kerb, gravel and sealed run-off spans
  (`source/surface.json`) and the run-off paint masks
  (`textures/apron_a.png`, `textures/apron_b.png`): measured from aerial
  imagery. The imagery itself is not in the repo; only the measured lines
  and class masks are.
- Run-off paint colours: measured frame by frame from reference onboard
  footage that is not in the repo.
- Corner numbers and sector lines: published circuit maps.

## Pipeline

1. `python3 tools/track/dunebay_fetch.py` writes `source/osm.json`.
2. `python3 tools/track/dunebay.py` builds `track.json` from the survey, OSM
   barriers and the pit lane.
3. `node tools/sd-track.mjs content/tracks/dune-bay` writes `dune-bay.xml`,
   `sd-frame.json` and `circuit-map.json`.
4. `python3 tools/track/dunebay_map.py` writes `venue.json` (stands, paddock,
   buildings, landmarks, service areas) and `python3
tools/track/dunebay_flora.py` writes `trees.bin`.
5. The client builds every visible object at load time from these files
   (`apps/client/src/game/desert-*.ts`), so there is no baked mesh.
