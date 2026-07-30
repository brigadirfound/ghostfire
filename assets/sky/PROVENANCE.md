# Провенанс купола

Панорамы — HDRI с [Poly Haven](https://polyhaven.com/hdris) под лицензией
CC0 (общественное достояние, коммерческое использование разрешено).
`tools/fetch_sky.mjs` скачивает 2k HDR, считает экспозицию по медиане
яркости неба, применяет ACES-тонмаппинг и сохраняет jpg 2048×1024 —
честную 360°-развёртку.

| файл | источник | автор | экспозиция | КБ | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| skybox.jpg | [kloppenheim_06_puresky](https://polyhaven.com/a/kloppenheim_06_puresky) | Greg Zaal, Jarod Guest | — | 79 | 1dd1f5a6aa07aa31… |
| arena01.jpg | [rosendal_park_sunset_puresky](https://polyhaven.com/a/rosendal_park_sunset_puresky) | Dimitrios Savva, Jarod Guest | — | 43 | e01dbea27f1d0cd1… |
| arena02.jpg | [kloppenheim_02_puresky](https://polyhaven.com/a/kloppenheim_02_puresky) | Greg Zaal, Jarod Guest | — | 95 | 251c05639672581e… |
| arena03.jpg | [qwantani_night_puresky](https://polyhaven.com/a/qwantani_night_puresky) | Greg Zaal, Jarod Guest | 0.074 | 54 | fa4175882f6c89ad… |
| arena04.jpg | [industrial_sunset_02_puresky](https://polyhaven.com/a/industrial_sunset_02_puresky) | Jarod Guest, Sergej Majboroda | — | 52 | 53fc468b013b61c8… |
| arena05.jpg | [kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | Greg Zaal, Jarod Guest | — | 95 | d571608ae1b8fdbc… |

## Назначение

- `skybox.jpg` — общий фолбэк: облачный день с солнцем
- `arena01.jpg` — тесная арена: закат
- `arena02.jpg` — два уровня: ясный день с облаками
- `arena03.jpg` — блоки: глубокая ночь со звёздами
- `arena04.jpg` — пятак: сумеречное зарево
- `arena05.jpg` — мосты: светлый день
