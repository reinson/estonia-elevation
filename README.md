# Estonia Elevation — GitHub Pages

Live hypsometric elevation viewer for Estonia, powered by **Maa-amet's 1 m LiDAR DTM** via their public WCS service. No API key required.

**Live demo:** _(add your GitHub Pages URL here once deployed)_

## What it does

- Loads elevation tiles on demand from `https://teenus.maaamet.ee/ows/wcs-dtm`
- Renders a colour-relief (hypsometric tint) and hillshade layer on top of a basemap
- Adapts the colour ramp dynamically to the visible elevation range
- Shows elevation under the cursor in real time
- Falls back to AWS Open Terrain (30 m global) at low zoom, switches to Maa-amet 1 m data at zoom ≥ 15

## Publishing to GitHub Pages

### One-time GitHub setup

1. Create a new GitHub repository named `estonia-elevation-gh-page` (or any name you like)
2. Push this folder:
   ```bash
   cd estonia-elevation-gh-page
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/<your-username>/estonia-elevation-gh-page.git
   git push -u origin main
   ```
3. Go to **Settings → Pages** in your GitHub repo
4. Under **Source**, select **GitHub Actions**
5. That's it — the workflow in `.github/workflows/deploy.yml` will build and deploy automatically on every push to `main`

The live URL will be:
```
https://<your-username>.github.io/estonia-elevation-gh-page/
```

### If you use a custom domain

Set `VITE_BASE_PATH=/` (or remove the env var) in the workflow file and configure your domain in **Settings → Pages**.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Tech stack

| Layer | Library |
|---|---|
| Map renderer | [MapLibre GL JS](https://maplibre.org/) |
| Elevation data (high zoom) | [Maa-amet WCS DTM](https://geoportaal.maaamet.ee/est/teenused/wms-wfs-wcs-teenused-p65.html) |
| Elevation data (low zoom) | [AWS Open Terrain / Tilezen Joerd](https://github.com/tilezen/joerd/blob/master/docs/sources.md) |
| GeoTIFF decoder | [geotiff.js](https://geotiffjs.github.io/) |
| Build tool | [Vite](https://vitejs.dev/) |
| Basemap | [CARTO Voyager](https://carto.com/basemaps/) |

## Data attribution

- Elevation data: © [Maa- ja Ruumiamet](https://geoportaal.maaamet.ee/) (Estonian Land and Spatial Development Board), CC-BY 4.0
- Low-zoom fallback: [Tilezen / Joerd](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) — USGS, NGA, NASA, ETOPO1, SRTM
- Basemap: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © [CARTO](https://carto.com/attributions)
