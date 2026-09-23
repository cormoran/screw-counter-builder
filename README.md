# Screw Counter Builder

> 日本語版はこちら: [README_日本語](README_ja.md)

A browser-based generator for a 3D-printable tray that dispenses screws in repeatable batches. Configure the screw and batch dimensions, inspect the model, then generate files without sending the design to a server.

[Open Screw Counter Builder](https://cormoran.github.io/screw-counter-builder/)

## What it generates

- Print-oriented STL files for the base, tray, slider, lid, and funnel.
- An assembly-position STEP file.
- A ZIP containing the CAD files, dimensions, and validation results.
- A Bambu Studio 3MF with the five parts placed on a selected print plate.

The generator runs in the browser with Replicad and OpenCascade WebAssembly. The CAD engine and generated model stay on your device.

## Use the web app

1. Select the target screw, pieces per batch, and number of batches.
2. Review the live 2D or 3D preview. Advanced settings let you enter measured screw, magnet, and clearance dimensions.
3. Select **Generate model** to run full CAD generation and download the STL, STEP, or ZIP files.
4. For Bambu Studio, select a supported plate size, generate a 3MF, then choose the printer, material, and slicing settings in Bambu Studio.

The app has English and Japanese interfaces. It uses the browser language only until you choose a language in the app; the explicit choice is saved for future visits.

## Printing and assembly

The output is a five-part assembly: base, tray, slider, lid, and funnel. Print each STL in its exported orientation. To assemble, place the slider into the base from above, then secure the tray. The default screw joint uses four M2 × 5 screws; the lid can be aligned with magnets or printed pegs.

Preset dimensions are design starting points, not guarantees for a screw standard. Measure the actual screws, make a small test print, and verify fit, slider operation, click stops, magnet retention, and strength before production use.

## Local development

Node.js and npm are required.

```sh
cd web
npm ci
npm test
npm run build
```

Run `npm run dev` to start a local development server. If you change the default CAD geometry, refresh the checked-in initial preview before committing:

```sh
npm run generate:default-preview
```

## Repository layout

- `web/` — Vite, React, and TypeScript application, including browser-side CAD generation and tests.
- `.github/workflows/web.yml` — test, build, and GitHub Pages deployment workflow.

## Verification boundary

Automated tests cover settings, CAD generation, exports, preview behavior, and print-plate layout. CAD files still need to be opened in the intended slicer or CAD tool, and physical print, fit, durability, and dispensing behavior need validation on the actual printer and hardware.

### Funnel and cutout lid

The detachable funnel is a 14 mm tall rectangular block with a sloped internal cavity. Its rounded-square outlet (R2; 5–24 mm wide, default 10 mm) is offset toward the side opposite the tab. Four magnet pairs or split snap pegs attach at the base screw corners, within the rectangular footprint. Corner centers sit 4.5 mm from the outer walls by default (1 mm farther outward), with at least 1.35 mm from magnet pocket to straight outer wall. The funnel has R4 exterior corners, R0.6 outer edge rounds, R2 cavity and mounting-land corners, and R0.4 rounds on the mouth and outlet rims. The base underside remains flat, with no printed mounting bosses below it. Shallow pockets (at most 1.5 mm deep) let the magnets project below the base, and the funnel receives the projection (0.65 mm with the default 2 mm magnets and clearances). Assembly screw heads are recessed farther inside the base, with matching deeper tray pilots; install the assembly screws before inserting the magnets. Screw joints require magnet/peg diameters of at least 5 mm; smaller sizes remain available with glue joints. Print the funnel outlet down and inspect support needs under its corner mounts. The shallow slopes no longer guarantee 45 degrees: test actual screw flow, magnet retention, and snap fit with your print material. Use the updated base, tray, lid, and funnel together because their mounting positions have changed.

Under Advanced settings → Storage & operation, choose Full cover or Cutout cover. The cutout cover closes the frame discharge cutout and covers only a narrow strip at the front of the top, using two magnets (two pairs with the tray) or pegs. The rest of the top remains open. Magnet dimensions are shared by the lid and funnel. Existing settings files remain importable.

### Tray style and screw length

Set the target **Screw length** (default 5 mm) and **Tray style** in the basic settings. Auto chooses square holes for lengths up to and including 5 mm, and an open cutout for longer screws. You can force either style regardless of length. The square-hole tray restores the individual openings with a 0.3 mm entry flare (3.5 mm straight opening with default M2 dimensions). Both styles keep the current square holes in the base. Storage height remains a separate setting.

Length and style are included in settings files and restored across reloads. Older files without these fields use 5 mm and Auto. The preview and exports use the resolved style; changing style changes only the tray geometry.

The live preview and model generation display each finished part in this order: base → slider → tray → funnel → lid. You can inspect the available parts while the remainder is building. The camera keeps the same assembly framing as parts arrive; downloadable files become ready after the complete model passes export validation.
