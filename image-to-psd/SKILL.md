---
name: image-to-psd
description: Convert PNG poster or marketing images into layered PSD deliverables after visual quality inspection. Use when Codex receives a PNG/JPEG/WebP image and the user wants text stroke defects, smear marks, incomplete/cropped image material, or layout artifacts checked and repaired before exporting a Photoshop-compatible layered PSD with separated text/decoration/image layers.
---

# Image to PSD

## Workflow

1. Inspect the source image visually before conversion.
   - Use image viewing tools at original resolution when available.
   - Check text strokes for blurry edges, smeared brush marks, warped glyphs, broken strokes, wrong characters, and low-contrast halos.
   - Check image material for clipped subjects, cut-off decorations, missing edges, malformed icons, distorted photos, or accidental overpainting.
   - For detailed criteria, read `references/quality-checklist.md`.
2. Repair first when quality issues are visible.
   - Use image editing/generation tools for visual defects, not the PSD splitter script.
   - Preserve exact text content, layout, aspect ratio, colors, food/product/photo areas, and all intentional decorations.
   - Save the repaired PNG separately from the original.
3. Convert the approved PNG to layered PSD with `scripts/png-to-layered-psd.js`.
   - Run from any workspace:
     ```bash
     node /path/to/image-to-psd/scripts/png-to-layered-psd.js --input /path/to/image.png --out /path/to/output-dir
     ```
   - If dependencies are missing, install them in the skill script folder:
     ```bash
     npm install --prefix /path/to/image-to-psd/scripts
     ```
4. Inspect the generated outputs.
   - Open `composite-check.png` to confirm the PSD layers visually reconstruct the source well.
   - Open `quality-report.md` for crop/smear warnings and layer counts.
   - If layer extraction grabs photo material or misses text, rerun with tuned options.
5. Deliver the PSD and supporting layer folder.

## Script Outputs

The converter creates:

- `<name>-layered.psd`: Photoshop-compatible PSD with named layers.
- `layers/00_clean_background.png`: background with extracted text/graphics inpainted.
- `layers/layer-*.png`: separated movable pixel layers.
- `composite-check.png`: rebuilt preview from generated layers.
- `quality-report.md` and `quality-report.json`: inspection and layer metadata.

PSD structure:

- Hidden `Reference original` layer for comparison.
- `Separated foreground layers` group containing extracted text, icons, underlines, and small decorative marks.
- `Clean background` bottom layer.

The script produces movable/editable pixel layers, not live font text layers. If the user requires live editable text, rebuild text manually in Photoshop/Canva/Figma after extraction.

## Conversion Options

Use these options when the default split is not right:

- `--max-layers 32`: keep more separated groups.
- `--min-area 80`: ignore more tiny specks.
- `--merge-gap 24`: merge nearby characters/marks into larger text-line layers.
- `--dilate 3`: preserve more edge antialiasing around extracted strokes.
- `--no-clean-background`: keep the original image as the background instead of inpainting extracted areas.

Prefer a clean, slightly larger layer over an over-trimmed layer. Cropped strokes are worse than extra transparent padding.

## Repair Prompt Pattern

When repairing a PNG before PSD conversion, use a precise edit prompt:

```text
Edit the provided image. Preserve the exact composition, aspect ratio, lighting, colors, subject/photo areas, background texture, and all intentional decorations. Only repair text stroke quality and obvious image-material defects.

Keep all text exactly unchanged: <list every visible text string>.

Make the text strokes crisp, clean, readable, and intentional. Remove smeared, muddy, overpainted, broken, or blurry brush marks. Do not add words, remove decorations, crop subjects, change product/photo content, or alter the layout.
```

After repair, inspect the new image again before converting.
