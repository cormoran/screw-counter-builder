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

The detachable funnel covers every base outlet and directs screws down four slopes to a central square outlet (10–24 mm, default 16 mm). Depth is automatic to keep the slopes at least 45 degrees. Two outside mounts clear the assembly screws; choose magnets (two pairs) or split snap pegs. Print the funnel outlet down and inspect support needs below its mounting ears. Test actual screw flow and snap retention with your print material. The new base includes the receiving mounts; older bases need reprinting.

Under Advanced settings → Storage & operation, choose Full cover or Cutout cover. The cutout cover closes the frame discharge cutout and covers only a narrow strip at the front of the top, using two magnets (two pairs with the tray) or pegs. The rest of the top remains open. Magnet dimensions are shared by the lid and funnel. Existing settings files remain importable.
