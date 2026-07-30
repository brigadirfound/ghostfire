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

Sky panoramas in `assets/sky/` are drawn by `tools/gen_skydome.mjs` and contain
no third-party source material. The earlier Visionary-generated backdrops were
removed together with their tooling: they were ordinary wide frames rather than
sphere unwraps, and produced a visible seam on the dome.

Interface icons (`assets/icons/`) and shop skin cards (`assets/skins/`) are
generated through the Visionary API; each directory carries a PROVENANCE.md with
prompts, request ids and hashes. The mere presence of a generated file or a
provenance record does not itself establish a copyright license.

No embedded provenance record was found for `assets/menu_bg.jpg` or for any
other raster asset not covered above. Their redistribution rights should be
confirmed by the applicable rights holder before a public release.

## Музыка

`assets/music/*.mp3` — шесть треков (меню и пять арен), сгенерированы через
Suno API моделью `suno-v5-5` инструментом `tools/gen_music.mjs`. Промпты,
`item_id` каждой генерации и SHA-256 итоговых файлов записаны в
`assets/music/PROVENANCE.md`. В игру попадают обрезанные до 72 секунд моно-версии
72 kbps; оригиналы (стерео, ~2–5 МБ) не хранятся в репозитории.

## Шрифты

`assets/fonts/*.woff2` — **Russo One** (заголовки, кнопки, HUD) и **Exo 2**
(текст и цифры), оба под SIL Open Font License 1.1. Тексты лицензий лежат
рядом: `OFL-RussoOne.txt`, `OFL-Exo2.txt`. Файлы взяты из пакетов
`@fontsource/russo-one` и `@fontsource/exo-2` и раздаются self-host — внешних
запросов к Google Fonts в игре нет.

## Иконки интерфейса

`assets/icons/*.png` — сгенерированы через Visionary (`nano-banana-pro`)
инструментом `tools/gen_icons.mjs`. Промпты, request id и SHA-256 записаны в
`assets/icons/PROVENANCE.md`.

`assets/skins/*.jpg` — карточки скинов для магазина, тот же провайдер,
`tools/gen_skin_cards.mjs`; палитра каждой карточки берётся из `skins/shop.json`.
Промпты и SHA-256 — в `assets/skins/PROVENANCE.md`.

`assets/hud/*.png` — силуэты пушек для HUD, отрендерены из тех же GLTF-моделей
(Quaternius, CC0), что игрок держит в руках; генератор — `tools/viewmodel_bench.html`
в режиме `?mode=icon`. Отдельной лицензии не требуют, наследуют CC0 моделей.

## Небо

`assets/sky/*.jpg` — панорамы построены кодом (`tools/gen_skydome.mjs`),
внешних исходников не содержат. Прежние фоны, сгенерированные через Visionary,
из репозитория удалены: они не были развёртками сферы и давали шов на куполе.
