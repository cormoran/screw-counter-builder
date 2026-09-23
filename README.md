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

The funnel leaves a vertical drop space equal to the target screw length + 3 mm below the base before its internal slope begins. **Funnel height** in Advanced settings → Storage & operation controls the total height: leave it automatic for screw length + 14 mm (19 mm by default), or choose screw length + 8 mm through 160 mm. The rounded-square outlet (R2, 5–24 mm wide, default 10 mm) remains offset away from the tab. Changing height changes the slope; actual screw flow still needs a print test.

Choose **Screws** under Funnel attachment to fasten the funnel, base, and tray together from underneath. Four M2 screws pass through deep access bores in the funnel and clearance holes in the base into blind 1.7 mm pilots in the tray. The head seat is 2.3 mm below the base; a 45-degree internal transition closes from the 4.6 mm access bore to a 2.4 mm clearance hole. Approximately M2 × 10 mm screws suit this mode; check head size, thread engagement, and tip clearance on the print. Magnet and split-peg attachment remain available; these retain the separate M2 × 5 mm base/tray screws. Their base pockets are now at most 0.9 mm deep, retaining at least 0.7 mm of base roof above the head seat after the old corner bosses are removed.

Registration is separate from the corner fasteners: four small 45-degree lands on the long-side frame, at one-third and two-thirds of the length, are 0.8 mm high with 2.4 mm roots. Base-top lands enter tray-bottom sockets; matching funnel-top lands enter base-bottom sockets at the same XY positions. Sockets allow 0.2 mm radial/axial clearance. Print the updated base, tray, and funnel together. The funnel screw bores have support-free 45-degree roofs; inspect the remaining geometry in the slicer and test physical fit and retention.

Under Advanced settings → Storage & operation, choose Full cover or Cutout cover. The cutout cover closes the frame discharge cutout and covers only a narrow strip at the front of the top, using two magnets (two pairs with the tray) or pegs. The rest of the top remains open. Magnet dimensions are shared by the lid and funnel. Existing settings files remain importable.

### Tray style and screw length

Set the target **Screw length** (default 5 mm) and **Tray style** in the basic settings. Auto chooses square holes for lengths up to and including 5 mm, and an open cutout for longer screws. You can force either style regardless of length. The square-hole tray restores the individual openings with a 0.3 mm entry flare (3.5 mm straight opening with default M2 dimensions). Both styles keep the current square holes in the base. Storage height remains a separate setting.

Length and style are included in settings files and restored across reloads. Older files without these fields use 5 mm and Auto. The preview and exports use the resolved style; changing style changes only the tray geometry.

The live preview and model generation display each finished part in this order: base → slider → tray → funnel → lid. You can inspect the available parts while the remainder is building. The camera keeps the same assembly framing as parts arrive; downloadable files become ready after the complete model passes export validation.

Unchanged parts remain visible from the start of a new generation; only parts whose geometry settings changed wait for their replacement. This also applies when restarting a CAD worker or starting from the default preview.
