# IMG to SVG

Client-side tool that converts raster images (PNG, JPG, WebP, BMP) into clean, scalable SVG, aimed at logos, icons, and flat artwork.

No external tracing libraries and no network APIs for conversion. Everything runs in the browser.

## Run

Serve the folder over HTTP (ES modules require it):

```bash
npm start
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

Or any static server from the project root, e.g. `npx serve .`

## Tests

```bash
npm test
```

## Features

- Drag-and-drop or file picker (single image)
- Side-by-side original vs vector preview, with expand per pane
- Color modes: black & white, grayscale, full color
- Adjustable smoothing, corners, detail, speckles, path overlap, background removal
- Live re-trace (debounced) when settings change
- Export: download SVG, copy code, optional minify
- Stats: file size, path count, node count

## Pipeline

Implemented from scratch in `js/`:

1. **Preprocess**, optional blur, background removal by color distance  
2. **Quantize**, palette by frequency + color distance (or B&W / grayscale)  
3. **Layers**, one bitmap per color, speckle filter, slight dilate for seam fill  
4. **Trace**, Moore-neighborhood contour following (outers + holes)  
5. **Smooth**, Chaikin / Laplacian to reduce pixel staircasing  
6. **Simplify**, Ramer-Douglas-Peucker  
7. **Fit curves**, recursive cubic Bézier fitting  
8. **SVG**, compound paths with `fill-rule="evenodd"`, optional minify  

## Project layout

```
index.html      UI shell
styles.css      Drafting-bench styles
app.js          UI + conversion orchestration
js/             Vectorization stages
tests/          Synthetic image / coverage tests
```

## Notes

- Best for flat graphics; photographs will not vectorize cleanly.
- Large images are capped (~1200px max edge) for responsiveness.
- Path overlap + seam stroke help close hairline gaps between color layers.
