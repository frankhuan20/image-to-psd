#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let PNG;
let writePsdBuffer;
let readPsd;
try {
  ({ PNG } = require('pngjs'));
  ({ writePsdBuffer, readPsd } = require('ag-psd'));
} catch (error) {
  console.error('Missing dependencies. Run: npm install --prefix ' + JSON.stringify(__dirname));
  console.error(error.message);
  process.exit(2);
}

function usage() {
  console.log(`Usage:
  node png-to-layered-psd.js --input image.png --out output-dir [options]

Options:
  --name NAME               Base filename for outputs
  --max-layers N            Maximum foreground groups to keep (default: 28)
  --min-area N              Minimum connected component area (default: auto)
  --merge-gap N             Merge nearby foreground components (default: auto)
  --dilate N                Expand layer alpha edge in pixels (default: 2)
  --no-clean-background     Use the original PNG as the background layer
`);
}

function parseArgs(argv) {
  const args = {
    maxLayers: 28,
    minArea: null,
    mergeGap: null,
    dilate: 2,
    cleanBackground: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--help' || key === '-h') {
      usage();
      process.exit(0);
    } else if (key === '--input') {
      args.input = next;
      i++;
    } else if (key === '--out') {
      args.out = next;
      i++;
    } else if (key === '--name') {
      args.name = next;
      i++;
    } else if (key === '--max-layers') {
      args.maxLayers = Number(next);
      i++;
    } else if (key === '--min-area') {
      args.minArea = Number(next);
      i++;
    } else if (key === '--merge-gap') {
      args.mergeGap = Number(next);
      i++;
    } else if (key === '--dilate') {
      args.dilate = Number(next);
      i++;
    } else if (key === '--no-clean-background') {
      args.cleanBackground = false;
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
  }
  if (!args.input) throw new Error('Missing --input');
  if (!args.out) {
    const parsed = path.parse(args.input);
    args.out = path.join(parsed.dir, `${parsed.name}-psd`);
  }
  if (!args.name) args.name = path.parse(args.input).name;
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function writePng(file, png) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, PNG.sync.write(png));
}

function idx(width, x, y) {
  return (y * width + x) * 4;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function colorAt(img, x, y) {
  const i = idx(img.width, x, y);
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max ? (max - min) / max : 0;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function estimateBackground(img) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 80));
  const add = (x, y) => {
    const [r, g, b, a] = colorAt(img, clamp(x, 0, img.width - 1), clamp(y, 0, img.height - 1));
    if (a > 200) samples.push([r, g, b]);
  };
  for (let x = 0; x < img.width; x += step) {
    add(x, 0);
    add(x, img.height - 1);
  }
  for (let y = 0; y < img.height; y += step) {
    add(0, y);
    add(img.width - 1, y);
  }
  if (!samples.length) return [245, 245, 245];
  return [
    median(samples.map((s) => s[0])),
    median(samples.map((s) => s[1])),
    median(samples.map((s) => s[2])),
  ];
}

function makeForegroundMask(img, background) {
  const mask = new Uint8Array(img.width * img.height);
  const bgLum = luminance(background[0], background[1], background[2]);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = idx(img.width, x, y);
      const r = img.data[p];
      const g = img.data[p + 1];
      const b = img.data[p + 2];
      const a = img.data[p + 3];
      if (a < 24) continue;

      const dist = colorDistance([r, g, b], background);
      const lum = luminance(r, g, b);
      const sat = saturation(r, g, b);
      const darkInk = bgLum > 170 && lum < bgLum - 36 && lum < 190;
      const saturatedInk = sat > 0.18 && dist > 34 && lum < 230;
      const transparentInk = a < 240 && dist > 22;
      const coloredOnDark = bgLum < 120 && dist > 55 && sat > 0.12;

      if (darkInk || saturatedInk || transparentInk || coloredOnDark) {
        mask[y * img.width + x] = 255;
      }
    }
  }
  return mask;
}

function dilate(mask, width, height, radius) {
  if (radius <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        out[y * width + x] = 255;
        continue;
      }
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let hit = false;
      for (let yy = y0; yy <= y1 && !hit; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (mask[yy * width + xx]) {
            hit = true;
            break;
          }
        }
      }
      if (hit) out[y * width + x] = 255;
    }
  }
  return out;
}

function unionMasks(masks, length) {
  const out = new Uint8Array(length);
  for (const mask of masks) {
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) out[i] = 255;
    }
  }
  return out;
}

function connectedComponents(mask, img) {
  const width = img.width;
  const height = img.height;
  const seen = new Uint8Array(mask.length);
  const components = [];
  const queue = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (!mask[start] || seen[start]) continue;

      let head = 0;
      queue.length = 0;
      queue.push(start);
      seen[start] = 1;
      let left = x;
      let right = x + 1;
      let top = y;
      let bottom = y + 1;
      let area = 0;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      const pixels = [];

      while (head < queue.length) {
        const pos = queue[head++];
        const px = pos % width;
        const py = Math.floor(pos / width);
        pixels.push(pos);
        area++;
        left = Math.min(left, px);
        right = Math.max(right, px + 1);
        top = Math.min(top, py);
        bottom = Math.max(bottom, py + 1);
        const p = pos * 4;
        rr += img.data[p];
        gg += img.data[p + 1];
        bb += img.data[p + 2];

        for (const [dx, dy] of dirs) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const np = ny * width + nx;
          if (!mask[np] || seen[np]) continue;
          seen[np] = 1;
          queue.push(np);
        }
      }

      components.push({
        left,
        right,
        top,
        bottom,
        area,
        pixels,
        color: [rr / area, gg / area, bb / area],
      });
    }
  }
  return components;
}

function isLikelyPhotoRegion(component, totalPixels) {
  const width = component.right - component.left;
  const height = component.bottom - component.top;
  const bboxArea = width * height;
  const touchesEdge = component.left <= 1 || component.top <= 1;
  const largeEdgeGradient = touchesEdge && (bboxArea > totalPixels * 0.07 || component.area > totalPixels * 0.025);
  return (
    largeEdgeGradient ||
    component.area > totalPixels * 0.08 ||
    bboxArea > totalPixels * 0.18 ||
    (width > 520 && height > 300 && component.area > 12000)
  );
}

function colorFamily(color) {
  const [r, g, b] = color;
  const sat = saturation(r, g, b);
  const lum = luminance(r, g, b);
  if (sat < 0.08) return lum < 120 ? 'dark' : 'neutral';
  if (r >= g && r >= b) return 'red';
  if (g >= r && g >= b) return 'green';
  return 'blue';
}

function boxesNear(a, b, gap) {
  return !(
    a.right + gap < b.left ||
    b.right + gap < a.left ||
    a.bottom + gap < b.top ||
    b.bottom + gap < a.top
  );
}

function mergeComponents(components, gap, maxLayers) {
  const groups = components.map((component, index) => ({
    id: index,
    components: [component],
    left: component.left,
    right: component.right,
    top: component.top,
    bottom: component.bottom,
    area: component.area,
    family: colorFamily(component.color),
  }));

  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        const similar = a.family === b.family || a.family === 'neutral' || b.family === 'neutral';
        const similarLine = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < Math.max(a.bottom - a.top, b.bottom - b.top, 42);
        if (similar && similarLine && boxesNear(a, b, gap)) {
          a.components.push(...b.components);
          a.left = Math.min(a.left, b.left);
          a.right = Math.max(a.right, b.right);
          a.top = Math.min(a.top, b.top);
          a.bottom = Math.max(a.bottom, b.bottom);
          a.area += b.area;
          groups.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  return groups
    .sort((a, b) => b.area - a.area)
    .slice(0, maxLayers)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((group, index) => ({ ...group, name: `Foreground layer ${String(index + 1).padStart(2, '0')}` }));
}

function maskForGroup(group, width, height) {
  const mask = new Uint8Array(width * height);
  for (const component of group.components) {
    for (const pos of component.pixels) mask[pos] = 255;
  }
  return mask;
}

function cropLayer(img, hardMask, softMask, bounds) {
  const pad = 2;
  const left = clamp(bounds.left - pad, 0, img.width);
  const top = clamp(bounds.top - pad, 0, img.height);
  const right = clamp(bounds.right + pad, 0, img.width);
  const bottom = clamp(bounds.bottom + pad, 0, img.height);
  const width = right - left;
  const height = bottom - top;
  const png = new PNG({ width, height });
  png.data.fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = left + x;
      const sy = top + y;
      const pos = sy * img.width + sx;
      let alpha = 0;
      if (hardMask[pos]) alpha = 255;
      else if (softMask[pos]) alpha = 150;
      if (!alpha) continue;
      const src = idx(img.width, sx, sy);
      const dst = idx(width, x, y);
      png.data[dst] = img.data[src];
      png.data[dst + 1] = img.data[src + 1];
      png.data[dst + 2] = img.data[src + 2];
      png.data[dst + 3] = Math.min(alpha, img.data[src + 3]);
    }
  }
  return { png, left, top };
}

function inpaintBackground(img, mask, fallbackColor) {
  const width = img.width;
  const height = img.height;
  const out = new PNG({ width, height });
  out.data.set(img.data);
  const unresolved = new Uint8Array(mask);
  const dirs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

  for (let pass = 0; pass < 120; pass++) {
    const updates = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pos = y * width + x;
        if (!unresolved[pos]) continue;
        let count = 0;
        let rr = 0;
        let gg = 0;
        let bb = 0;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const npos = ny * width + nx;
          if (unresolved[npos]) continue;
          const p = idx(width, nx, ny);
          rr += out.data[p];
          gg += out.data[p + 1];
          bb += out.data[p + 2];
          count++;
        }
        if (count) updates.push([pos, rr / count, gg / count, bb / count]);
      }
    }
    if (!updates.length) break;
    for (const [pos, r, g, b] of updates) {
      const p = pos * 4;
      out.data[p] = Math.round(r);
      out.data[p + 1] = Math.round(g);
      out.data[p + 2] = Math.round(b);
      out.data[p + 3] = 255;
      unresolved[pos] = 0;
    }
  }

  for (let i = 0; i < unresolved.length; i++) {
    if (!unresolved[i]) continue;
    const p = i * 4;
    out.data[p] = fallbackColor[0];
    out.data[p + 1] = fallbackColor[1];
    out.data[p + 2] = fallbackColor[2];
    out.data[p + 3] = 255;
  }
  return out;
}

function imageDataFromPng(png) {
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}

function over(base, layer, left, top) {
  for (let y = 0; y < layer.height; y++) {
    const by = top + y;
    if (by < 0 || by >= base.height) continue;
    for (let x = 0; x < layer.width; x++) {
      const bx = left + x;
      if (bx < 0 || bx >= base.width) continue;
      const src = idx(layer.width, x, y);
      const alpha = layer.data[src + 3] / 255;
      if (!alpha) continue;
      const dst = idx(base.width, bx, by);
      base.data[dst] = Math.round(layer.data[src] * alpha + base.data[dst] * (1 - alpha));
      base.data[dst + 1] = Math.round(layer.data[src + 1] * alpha + base.data[dst + 1] * (1 - alpha));
      base.data[dst + 2] = Math.round(layer.data[src + 2] * alpha + base.data[dst + 2] * (1 - alpha));
      base.data[dst + 3] = 255;
    }
  }
}

function edgeTouchWarnings(components, width, height) {
  return components
    .filter((component) => component.area > 80 && (component.left <= 1 || component.top <= 1 || component.right >= width - 1 || component.bottom >= height - 1))
    .slice(0, 12)
    .map((component) => ({
      bbox: [component.left, component.top, component.right, component.bottom],
      area: component.area,
      warning: 'Foreground reaches canvas edge; inspect for accidental cropping.',
    }));
}

function softHaloRatio(groupMask, softMask) {
  let hard = 0;
  let halo = 0;
  for (let i = 0; i < groupMask.length; i++) {
    if (groupMask[i]) hard++;
    else if (softMask[i]) halo++;
  }
  return hard ? halo / hard : 0;
}

function reportMarkdown(report) {
  const warnings = [];
  if (report.edgeTouchWarnings.length) warnings.push(`- ${report.edgeTouchWarnings.length} foreground components touch the canvas edge; inspect for cropping.`);
  if (report.highHaloLayers.length) warnings.push(`- ${report.highHaloLayers.length} extracted layers have large soft halos; inspect for smeared/blurred text edges.`);
  if (report.layerCount === 0) warnings.push('- No foreground layers were extracted. Tune --min-area/--merge-gap or use a repaired source with clearer contrast.');
  if (!warnings.length) warnings.push('- No automatic warnings. Still inspect the PSD visually.');

  return `# Image to PSD Quality Report

- Source: ${report.source}
- Size: ${report.width} x ${report.height}
- Background estimate: rgb(${report.background.join(', ')})
- Extracted layers: ${report.layerCount}
- PSD: ${report.psd}

## Warnings

${warnings.join('\n')}

## Layers

${report.layers.map((layer) => `- ${layer.name}: ${layer.width}x${layer.height} at (${layer.left}, ${layer.top}), area ${layer.area}`).join('\n')}
`;
}

function main() {
  const args = parseArgs(process.argv);
  const input = path.resolve(args.input);
  const outDir = path.resolve(args.out);
  const layerDir = path.join(outDir, 'layers');
  ensureDir(layerDir);

  const img = readPng(input);
  const totalPixels = img.width * img.height;
  const minArea = args.minArea == null ? Math.max(24, Math.round(totalPixels / 90000)) : args.minArea;
  const mergeGap = args.mergeGap == null ? Math.max(10, Math.round(Math.min(img.width, img.height) / 45)) : args.mergeGap;
  const background = estimateBackground(img);
  const foregroundMask = makeForegroundMask(img, background);
  const components = connectedComponents(foregroundMask, img)
    .filter((component) => component.area >= minArea)
    .filter((component) => !isLikelyPhotoRegion(component, totalPixels));

  const groups = mergeComponents(components, mergeGap, args.maxLayers);
  const layerItems = [];
  const layerMasks = [];
  const highHaloLayers = [];

  for (const group of groups) {
    const hard = maskForGroup(group, img.width, img.height);
    const soft = dilate(hard, img.width, img.height, args.dilate);
    const cropped = cropLayer(img, hard, soft, group);
    const safeName = group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const file = path.join(layerDir, `${safeName}.png`);
    writePng(file, cropped.png);
    const haloRatio = softHaloRatio(hard, soft);
    if (haloRatio > 1.8) highHaloLayers.push(group.name);
    layerItems.push({
      ...group,
      ...cropped,
      file,
      width: cropped.png.width,
      height: cropped.png.height,
      haloRatio,
    });
    layerMasks.push(soft);
  }

  const cleanMask = layerMasks.length ? dilate(unionMasks(layerMasks, foregroundMask.length), img.width, img.height, 3) : new Uint8Array(foregroundMask.length);
  const backgroundPng = args.cleanBackground ? inpaintBackground(img, cleanMask, background) : img;
  const backgroundFile = path.join(layerDir, '00_clean_background.png');
  writePng(backgroundFile, backgroundPng);

  const check = new PNG({ width: img.width, height: img.height });
  check.data.set(backgroundPng.data);
  for (const layer of [...layerItems].reverse()) over(check, layer.png, layer.left, layer.top);
  const checkFile = path.join(outDir, 'composite-check.png');
  writePng(checkFile, check);

  const psdFile = path.join(outDir, `${args.name}-layered.psd`);
  const psd = {
    width: img.width,
    height: img.height,
    imageData: imageDataFromPng(img),
    children: [
      {
        name: 'Reference original (hidden)',
        hidden: true,
        imageData: imageDataFromPng(img),
        left: 0,
        top: 0,
      },
      {
        name: 'Separated foreground layers',
        opened: true,
        children: layerItems.map((layer) => ({
          name: layer.name,
          imageData: imageDataFromPng(layer.png),
          left: layer.left,
          top: layer.top,
          blendMode: 'normal',
          opacity: 1,
        })),
      },
      {
        name: 'Clean background',
        imageData: imageDataFromPng(backgroundPng),
        left: 0,
        top: 0,
        blendMode: 'normal',
        opacity: 1,
      },
    ],
  };

  const buffer = writePsdBuffer(psd, { trimImageData: false, generateThumbnail: false, compress: false });
  fs.writeFileSync(psdFile, buffer);
  const parsed = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });

  const report = {
    source: input,
    width: img.width,
    height: img.height,
    background,
    minArea,
    mergeGap,
    psd: psdFile,
    compositeCheck: checkFile,
    backgroundLayer: backgroundFile,
    layerCount: layerItems.length,
    rootLayers: parsed.children ? parsed.children.map((layer) => layer.name) : [],
    edgeTouchWarnings: edgeTouchWarnings(components, img.width, img.height),
    highHaloLayers,
    layers: layerItems.map((layer) => ({
      name: layer.name,
      file: layer.file,
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      area: layer.area,
      haloRatio: Number(layer.haloRatio.toFixed(2)),
    })),
  };

  fs.writeFileSync(path.join(outDir, 'quality-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'quality-report.md'), reportMarkdown(report));
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
