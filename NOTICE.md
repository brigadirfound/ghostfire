# Ghostfire notices and provenance

This file records the facts currently available in the repository and from the
identified upstream project pages. It does not assert ownership of material or
create a license for first-party Ghostfire code and art. The project-wide
status is in `LICENSE`.

## three.js r164

Bundled files: `vendor/three.module.js` and the modules under `vendor/addons/`.
The bundle header identifies revision 164 and SPDX license `MIT`.
Upstream: <https://github.com/mrdoob/three.js/tree/r164>

The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## lz-string 1.5.0

Bundled file: `vendor/lz-string.js`. Its jsDelivr header identifies the
upstream package and version. Upstream: <https://github.com/pieroxy/lz-string/tree/1.5.0>

MIT License

Copyright (c) 2013 pieroxy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Quaternius Sci-Fi Modular Gun Pack

Bundled files: the six glTF models under `assets/weapons/`. Project source
comments identify these as models from Quaternius' Sci-Fi Modular Gun Pack.
The creator's pack page identifies the pack as CC0 and provides glTF among the
available formats: <https://quaternius.com/packs/scifimodularguns.html>.

The individual glTF files do not embed a license or a source-package checksum.
The upstream page is therefore the provenance evidence currently available in
the repository; no additional authorship or chain-of-custody claim is made.

## Generated and other visual assets

The six current sky panoramas and their processing workflow are documented in
`assets/skybox_candidates/PROVENANCE.md`. That document records generation
with the Codex built-in image generation tool on 2026-07-29, the shared prompt,
scene variants, and post-processing. Despite their historical `candidate_*`
filenames, the five JPEGs are now referenced by the five built-in maps and are
therefore runtime files. The provenance document is shipped beside them.

`tools/gen_skybox.mjs` is an optional, separate workflow for future Visionary
API generations. It writes hashes and generation metadata when run. The mere
presence of a generated file or provenance record does not itself establish a
copyright license.

No embedded provenance record was found for `assets/menu_bg.jpg` or for any
other raster asset not covered above. Their redistribution rights should be
confirmed by the applicable rights holder before a public release.
