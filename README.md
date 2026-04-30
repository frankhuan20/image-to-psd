# skills

skill to anything

## Available skills

- `image-to-psd`: Inspect PNG poster/marketing images for text stroke defects, smear marks, cropped material, and layout artifacts, then convert the approved image into a layered PSD with separated foreground pixel layers and a clean background layer.

## Structure

Each skill lives in its own top-level folder. A valid skill folder contains `SKILL.md`; optional `scripts/`, `references/`, and `agents/` folders provide reusable automation, detailed guidance, and UI metadata.

## Notes

`image-to-psd` creates movable/editable pixel layers in PSD format. It does not create live Photoshop text layers automatically; if live font editing is required, use the generated PSD as a reconstruction guide.
