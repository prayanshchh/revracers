# Source data licences

## osm.json

Map data © OpenStreetMap contributors, available under the Open Database
License (ODbL) 1.0: https://www.openstreetmap.org/copyright

Extracted from the OpenStreetMap API for the box -97.650, 30.120, -97.620,
30.145 by `tools/track/fetch.py`. `track.json` is a Produced Work derived from
this database and must keep this attribution.

## dem.png

U.S. Geological Survey, 3D Elevation Program, 1 m digital elevation model,
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
USGS data is in the public domain. Stored as 16-bit centimetres above 100 m,
UTM zone 14N, top-left corner at easting 630053, northing 3335851, 1 m pixels.

## aerial.jpg and aerial-nir.png

U.S. Department of Agriculture National Agriculture Imagery Program, 0.3 m,
served by the USGS National Map NAIP Plus image service,
https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer
USGS data is in the public domain. `aerial.jpg` holds bands 1 to 3 (colour)
and `aerial-nir.png` band 4 (near infrared), both fetched by
`tools/track/fetch.py` on the DEM grid.

## aerial-2024.jpg and aerial-2024-nir.png

U.S. Department of Agriculture National Agriculture Imagery Program, Texas,
21 August 2024, 0.6 m (items tx_m_3009751_se_14_060_20240821,
tx_m_3009752_sw_14_060_20240821, tx_m_3009759_ne_14_060_20240821 and
tx_m_3009760_nw_14_060_20240821), served by the Microsoft Planetary Computer
data API. USDA data is in the public domain. Same UTM zone 14N grid and
top-left corner as `dem.png`; fetched by `tools/track/fetch.py`.
