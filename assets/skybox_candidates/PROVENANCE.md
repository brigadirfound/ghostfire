# Ghostfire sky panoramas

The five arena panoramas in this directory, plus `../skybox.jpg`, were generated
on 2026-07-29 with the Codex built-in image generation tool and then prepared
for Ghostfire's spherical sky-dome renderer.

The previous project images were supplied only as visual-language references.
Each scene was redesigned rather than edited in place.

## Shared final prompt

> Use case: stylized-concept. Asset type: production game sky-dome panorama for
> Ghostfire. Create a polished, seamless-feeling 360-degree voxel horizon
> panorama with a perfectly straight low horizon, distant architecture, broad
> calm sky, comparable color and skyline density at both outer edges, and no
> single central landmark. Premium stylized voxel environment art with crisp
> silhouettes and restrained detail, readable during fast FPS play. Designed
> specifically for spherical sky-dome wrapping. No close foreground, camera
> platform, characters, weapons, readable signs, text, logos, or watermark.
> Avoid Minecraft branding, random floating blocks, giant celestial objects,
> fisheye curvature, tilted horizon, photographic realism, and noisy detail.

Scene variants:

1. `candidate_1.jpg` — grassy eco-industrial megacity at blue hour; wind
   turbines, cyan utility lights, indigo/coral twilight.
2. `candidate_2.jpg` — terraced desert megastructure city; sandstone,
   terracotta, aqueduct silhouettes, amber/mauve dusk.
3. `candidate_3.jpg` — experimental modular neon district; indigo night,
   restrained primary-color towers, cyan energy lines, soft aurora haze.
4. `candidate_4.jpg` — brutalist industrial city; concrete, factories,
   retaining walls, slate-violet storm clouds and muted amber light.
5. `candidate_5.jpg` — bridge-and-pylon infrastructure city over a misty chasm;
   steel blue predawn, cyan beacons and a faint rose horizon.
6. `../skybox.jpg` — neutral frontier city for custom maps and loading fallback;
   concrete/stone/metal districts, low hills, violet-blue dusk.

## Post-processing

Each generated 1792×1024 source was cropped to its lower 4:1 horizon belt,
resampled to 2048×512 with Lanczos filtering, given a 96-pixel edge crossfade
to make the horizontal wrap continuous, and saved as an optimized progressive
JPEG at quality 88. The generated source files remain in the local Codex image
generation store and are not runtime dependencies.
