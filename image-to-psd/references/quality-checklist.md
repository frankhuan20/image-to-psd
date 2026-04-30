# Quality Checklist

Use this checklist before running `scripts/png-to-layered-psd.js`.

## Text Stroke Inspection

- Verify every visible word/character against the user's source or intended copy.
- Zoom into headline strokes and handwritten/script text.
- Look for muddy joins, duplicated strokes, warped glyphs, broken radicals, malformed punctuation, accidental paint blobs, and colored smears around edges.
- Check antialiasing: edges should be clean and intentional, not soft from motion blur or AI overpaint.
- Check small English copy separately; thin serif/script text often keeps hidden blur after large headlines look repaired.

## Image Material Inspection

- Check all objects that touch a crop boundary. Subject edges should not be unintentionally cut unless the design clearly intends it.
- Check icons, decorative marks, underlines, sparkles, logos, food/product edges, and bowls/plates for missing pieces or overpaint artifacts.
- Check repaired backgrounds behind moved/extracted text. Inpainted areas may be imperfect, but they should not visibly damage important photo material.

## PSD Acceptance

- `composite-check.png` should match the approved source closely.
- PSD should contain a hidden reference layer, a clean background layer, and named separated foreground layers.
- Foreground layers should include enough transparent padding to avoid clipped antialiasing.
- Quality report warnings are not automatic failures; they are prompts for visual review.

## Escalation Guidance

- If text recognition matters, ask the user for exact copy or transcribe it before repair.
- If a live editable text PSD is required, use the PSD output as a reconstruction guide and create native text layers manually.
- If the script repeatedly extracts photo regions, increase `--min-area`, reduce `--max-layers`, or accept the photo as part of the clean background layer.
