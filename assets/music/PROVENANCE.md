# Провенанс музыки

Треки сгенерированы через Suno API (`tools/gen_music.mjs`), модель `suno-v5-5`.
Оригиналы — стерео ~3 МБ; в игру попадает обрезанная до 72 с моно-версия 72k.

| файл | item_id | название Suno | SHA-256 | КБ |
| --- | --- | --- | --- | --- |
| menu.mp3 | 06ebefa7-570f-4cee-b130-643404d86bef | Neon Loadout | e6a598587ef6e514… | 563 |
| arena01.mp3 | b0ae45a0-b99e-4cb7-bf9c-4ba7182690b2 | ![Song Cover](https://cdn2.suno.ai/image_b0ae45a0-b99e-4cb7-bf9c-4ba7182690b2.jpeg) | 239d5761f93566b8… | 563 |
| arena02.mp3 | 5cef69ae-1fbf-4afc-ae8d-0fd99f70225e | Arena Vector | bacf3e1e92be9d54… | 563 |
| arena03.mp3 | 86948990-3b68-49c4-a73a-9778a62514c5 | Blockline Showdown | 7b0a3c6d2323e385… | 563 |
| arena04.mp3 | aa93458d-0543-4b36-85b8-7edbb838d5c7 | Arena Overdrive Loop | 40e01bd9bebb4c56… | 563 |
| arena05.mp3 | 75a7ec89-42e8-45ff-9587-4594ab5689d0 | Chasm Run | 466155e92cbb5e75… | 563 |

## Промпты

### menu.mp3

```
instrumental only, no vocals, no lyrics, seamless loop, retro arcade FPS soundtrack, punchy drums, analog synths, mixed dry without long reverb tails, main menu theme, mid-tempo 100 bpm dark synthwave, confident and roomy, restrained melody that can play under UI clicks
```

### arena01.mp3

```
instrumental only, no vocals, no lyrics, seamless loop, retro arcade FPS soundtrack, punchy drums, analog synths, mixed dry without long reverb tails, tight close-quarters arena, fast 140 bpm industrial breakbeat, tense and claustrophobic, short stabs
```

### arena02.mp3

```
instrumental only, no vocals, no lyrics, seamless loop, retro arcade FPS soundtrack, punchy drums, analog synths, mixed dry without long reverb tails, two-level arena, driving 128 bpm electro with vertical arpeggios, alert and mobile
```

### arena03.mp3

```
instrumental only, no vocals, no lyrics, seamless loop, retro arcade FPS soundtrack, punchy drums, analog synths, mixed dry without long reverb tails, sniper duel on open blocks, slow 96 bpm brooding pulse, sparse and patient, long low drones
```

### arena04.mp3

```
instrumental only, no vocals, no lyrics, seamless loop, retro arcade FPS soundtrack, punchy drums, analog synths, mixed dry without long reverb tails, small circular arena, relentless 150 bpm drum and bass, aggressive and non-stop
```

### arena05.mp3

```
instrumental only, no vocals, no lyrics, seamless loop, retro arcade FPS soundtrack, punchy drums, analog synths, mixed dry without long reverb tails, bridges over a chasm, 118 bpm airy synth with wide pads and a steady kick, risky and open
```
