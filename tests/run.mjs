import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STRINGS, localizedName, resolveLanguage, setLang } from '../js/i18n.js';
import { Sound } from '../js/audio.js';
import { createSeededRandom } from '../tools/lib/prng.mjs';
import { PROFILES, simulate } from '../tools/sim_economy.mjs';
import {
  applyMatchReward, computeMatchReward, BASE_REWARD, WIN_REWARD, BUILTIN_MULTS,
} from '../js/economy.js';
import { STARTING_COINS, VALIDATION_LIMITS, normalizePlayerData, normalizeWallet } from '../js/validation.js';
import { collectRuntimeFiles, createRuntimeManifest, isRuntimePath } from '../tools/lib/runtime.mjs';
import { createDeterministicZip } from '../tools/lib/zip.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('RU and EN expose the same translation keys', () => {
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  for (const key of Object.keys(STRINGS.ru)) assert.equal(typeof STRINGS.ru[key], typeof STRINGS.en[key], key);
});

test('shop rendering selects localized skin names by stable id', () => {
  const shop = JSON.parse(readFileSync(new URL('../skins/shop.json', import.meta.url), 'utf8'));
  setLang('en-US');
  for (const item of shop.skins) {
    assert.equal(localizedName('skin', item.id), STRINGS.en[`skin_${item.id}`], item.id);
    assert.notEqual(localizedName('skin', item.id), item.name, `${item.id} fell back to raw catalog name`);
  }
  assert.equal(localizedName('ghost', 'ghost_inferno'), 'Inferno');
  const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(uiSource, /localizedName\(\s*['"]skin['"]\s*,\s*item\.id\s*\)/);
  assert.doesNotMatch(uiSource, /translatedOr\(\s*`skin_\$\{item\.id\}`\s*,\s*item\.name\s*\)/);
  setLang('ru');
});

test('opponent cards localize stable ghost ids and map cards use locale keys', () => {
  const ghostIds = ['shadow', 'smoke', 'phantom', 'mirage', 'inferno'];
  setLang('en');
  for (const id of ghostIds) assert.equal(localizedName('ghost', id), STRINGS.en[`ghost_${id}`], id);
  const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(uiSource, /localizedName\(\s*['"]ghost['"]\s*,\s*BUILTIN_GHOSTS\[i\]\s*\)/);
  assert.match(uiSource, /addCard\(id,\s*t\(`map_\$\{id\}`\),\s*t\(`map_\$\{id\}_desc`\)\)/);
  setLang('ru');
});

test('editor language resolution includes the persisted player setting', () => {
  assert.equal(resolveLanguage(null, 'en', 'ru'), 'en');
  assert.equal(resolveLanguage(undefined, 'en-US'), 'en');
  assert.equal(resolveLanguage('xx', 'ru-RU'), 'ru');
  const editorSource = readFileSync(new URL('../js/editor.js', import.meta.url), 'utf8');
  assert.match(editorSource, /await Platform\.loadPlayer\(\)/);
  assert.match(editorSource, /resolveLanguage\(savedPlayerLanguage, savedLanguage, Platform\.detectedLang\)/);
  assert.match(editorSource, /Platform\.savePlayer\(nextPlayer\)/);
});

test('editor flex layout keeps controls clickable beside the WebGL canvas', () => {
  const html = readFileSync(new URL('../editor.html', import.meta.url), 'utf8');
  assert.match(html, /\.tools\s*\{[^}]*min-width:\s*var\(--tools-width\)[^}]*flex:\s*0 0 var\(--tools-width\)/s);
  assert.match(html, /canvas\.view\s*\{[^}]*width:\s*0[^}]*min-width:\s*0[^}]*flex:\s*1 1 0/s);
});

test('editor built-in buttons are wired and boot cannot overwrite a user map action', () => {
  const source = readFileSync(new URL('../js/editor.js', import.meta.url), 'utf8');
  assert.match(source, /btn-load1[^\n]+loadBuiltin\(['"]arena01['"]\)/);
  assert.match(source, /const revision = \+\+mapRevision/);
  assert.match(source, /revision !== mapRevision/);
  assert.match(source, /const initialMapRevision = mapRevision/);
  assert.match(source, /initialMapRevision === mapRevision/);
});

test('seeded generator is repeatable and seed-sensitive', () => {
  const first = createSeededRandom('arena01:d1');
  const second = createSeededRandom('arena01:d1');
  const different = createSeededRandom('arena01:d2');
  const a = Array.from({ length: 16 }, first);
  assert.deepEqual(a, Array.from({ length: 16 }, second));
  assert.notDeepEqual(a, Array.from({ length: 16 }, different));
  assert.ok(a.every((value) => value >= 0 && value < 1));
});

test('ghost generator has no ambient Math.random calls', () => {
  const source = readFileSync(new URL('../tools/gen_ghosts.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('Math.random'), false);
});

test('audio stopAll cancels active sources without replacing the context', () => {
  const sources = [];
  let contexts = 0;
  class Param {
    constructor() { this.value = 0; }
    setValueAtTime(value) { this.value = value; }
    exponentialRampToValueAtTime(value) { this.value = value; }
  }
  class Node {
    connect(next) { return next; }
    disconnect() { this.disconnects = (this.disconnects ?? 0) + 1; }
  }
  class Source extends Node {
    constructor() {
      super();
      this.frequency = new Param();
      this.stopCalls = 0;
      sources.push(this);
    }
    addEventListener() {}
    start() {}
    stop() { this.stopCalls++; }
  }
  class FakeAudioContext {
    constructor() {
      contexts++;
      this.currentTime = 0; this.sampleRate = 8_000; this.state = 'running'; this.destination = new Node();
    }
    createGain() { const node = new Node(); node.gain = new Param(); return node; }
    createOscillator() { return new Source(); }
    createBufferSource() { return new Source(); }
    createBiquadFilter() { const node = new Node(); node.frequency = new Param(); return node; }
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    suspend() { this.state = 'suspended'; }
    resume() { this.state = 'running'; }
  }
  globalThis.window = { AudioContext: FakeAudioContext };
  Sound.init();
  Sound.pistol();
  Sound.smg();
  Sound.assault();
  Sound.sniper();
  // Выстрел собирается из слоёв: crack + thump (+ mech у пистолета и автомата).
  assert.equal(sources.length, 11); // 3 + 2 + 3 + 3
  Sound.stopAll();
  assert.ok(sources.every((source) => source.stopCalls >= 1 && source.disconnects === 1));
  Sound.init();
  assert.equal(contexts, 1);
  const stops = sources.map((source) => source.stopCalls);
  Sound.stopAll();
  assert.deepEqual(sources.map((source) => source.stopCalls), stops);
  delete globalThis.window;
});

test('runtime whitelist excludes tools and includes referenced arena skies', () => {
  assert.equal(isRuntimePath('js/game.js'), true);
  assert.equal(isRuntimePath('tools/pack_release.mjs'), false);
  assert.equal(isRuntimePath('assets/sky/arena01.jpg'), true);
  assert.equal(isRuntimePath('assets/sky/PROVENANCE.md'), true);
  const files = collectRuntimeFiles(root);
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('LICENSE'));
  assert.equal(files.some((file) => file.startsWith('tools/')), false);
});

test('runtime manifest carries exact file checksums', () => {
  const manifest = createRuntimeManifest(root, {
    version: 'test', commit: 'abc', dirty: false, sourceDateEpoch: 1_700_000_000,
  });
  assert.equal(manifest.files.length, collectRuntimeFiles(root).length);
  assert.ok(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256) && file.bytes > 0));
});

test('every weapon carries a magazine, reload time and a left-hand pose', () => {
  // weapons.js тянет three, поэтому таблица разбирается из исходника.
  const source = readFileSync(new URL('../js/weapons.js', import.meta.url), 'utf8');
  const rows = source.match(/^\s*\{ id: [A-Z]+,[^\n]+\},$/gm) ?? [];
  assert.equal(rows.length, 6, 'ожидалось шесть пушек в таблице');
  const field = (row, name) => {
    const found = row.match(new RegExp(`${name}:\\s*([\\d.]+)`));
    return found ? Number(found[1]) : null;
  };
  const hands = source.match(/LEFT_HAND_FORWARD = Object\.freeze\(\{([^}]+)\}\)/s)?.[1] ?? '';
  const viewPoses = source.match(/VIEW_POSE = Object\.freeze\(\{(.+?)\n\}\)/s)?.[1] ?? '';
  for (const row of rows) {
    const key = row.match(/key: '([a-z]+)'/)?.[1];
    assert.ok(key, `не разобран key: ${row}`);
    assert.ok(field(row, 'mag') >= 1, `${key}: магазин не задан`);
    assert.ok(field(row, 'reload') > 0, `${key}: время перезарядки не задано`);
    assert.ok(field(row, 'viewKick') >= 0, `${key}: нет визуальной отдачи`);
    assert.match(hands, new RegExp(`\\b${key}:`), `${key}: нет смещения левой руки`);
    const view = viewPoses.match(new RegExp(`\\b${key}:\\s*\\{ length: ([\\d.]+)`));
    assert.ok(view, `${key}: нет позы вьюмодели`);
    // Пушка в кадре — от пистолета до снайперки. Выход за рамки означает
    // опечатку в длине: модель либо займёт пол-экрана, либо потеряется.
    const viewLength = Number(view[1]);
    assert.ok(viewLength >= 0.24 && viewLength <= 1, `${key}: длина в кадре ${viewLength} м вне разумного`);
    // Оптика только у снайперки: временная отладочная выдача её другой пушке
    // не должна уехать в релиз.
    const zoom = field(row, 'zoomFov');
    if (key === 'sniper') assert.ok(zoom > 0 && zoom < 60, 'у снайперки нет рабочего zoomFov');
    else assert.equal(zoom, null, `${key}: оптика должна быть только у снайперки`);
    // Рейл и снайперка бьют в точку: подброс прицела почти нулевой, удар
    // отдаётся только моделью.
    if (key === 'railgun' || key === 'sniper') {
      assert.ok(field(row, 'recoil') <= 0.02, `${key}: слишком большой подброс прицела`);
      assert.ok(field(row, 'viewKick') >= 0.1, `${key}: выстрел должен ощущаться моделью`);
    }
  }
});

test('every arena has its own music track and none of them is oversized', () => {
  const maps = ['arena01', 'arena02', 'arena03', 'arena04', 'arena05'];
  for (const track of ['menu', ...maps]) {
    const file = new URL(`../assets/music/${track}.mp3`, import.meta.url);
    const bytes = readFileSync(file);
    assert.ok(bytes.length > 50_000, `${track}.mp3 подозрительно мал`);
    // Больше мегабайта на трек — игра начнёт грузиться заметно дольше.
    assert.ok(bytes.length < 1_000_000, `${track}.mp3 весит ${Math.round(bytes.length / 1024)} КБ`);
    assert.equal(bytes.subarray(0, 3).toString('ascii'), 'ID3', `${track}.mp3 не mp3`);
  }
  // Ключ Suno живёт вне репозитория и не должен попасть ни в код, ни в провенанс.
  const generator = readFileSync(new URL('../tools/gen_music.mjs', import.meta.url), 'utf8');
  const provenance = readFileSync(new URL('../assets/music/PROVENANCE.md', import.meta.url), 'utf8');
  for (const text of [generator, provenance]) assert.doesNotMatch(text, /sk-[A-Za-z0-9]{20,}/);
  assert.match(generator, /process\.env\.SUNO_API_KEY/);
});

test('every map points at a real 2:1 panorama', () => {
  const maps = ['arena01', 'arena02', 'arena03', 'arena04', 'arena05'];
  for (const id of [...maps, 'skybox']) {
    const file = maps.includes(id) ? `../assets/sky/${id}.jpg` : '../assets/sky/skybox.jpg';
    const bytes = readFileSync(new URL(file, import.meta.url));
    assert.ok(bytes.length > 20_000 && bytes.length < 400_000, `${id}: ${bytes.length} Б`);
    // Размеры лежат в SOF0 JPEG: панорама обязана быть ровно 2:1, иначе
    // купол получит шов и «воронку» у полюсов.
    let offset = 2, size = null;
    while (offset < bytes.length - 9) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        size = { h: bytes.readUInt16BE(offset + 5), w: bytes.readUInt16BE(offset + 7) };
        break;
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
    assert.ok(size, `${id}: не разобран размер jpeg`);
    assert.equal(size.w, size.h * 2, `${id}: ${size.w}×${size.h} — не 2:1`);
  }
  for (const id of maps) {
    const map = JSON.parse(readFileSync(new URL(`../maps/${id}.json`, import.meta.url), 'utf8'));
    assert.equal(map.skybox, `assets/sky/${id}.jpg`, `${id}: карта смотрит на ${map.skybox}`);
  }
  const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
  assert.match(game, /const isEquirect = Math\.abs\(img\.width \/ img\.height - 2\)/);
});

test('tracers start at the muzzle and editor drops pickups above the block', () => {
  const player = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
  // Хитскан остаётся из центра камеры, трасса — от ствола.
  assert.match(player, /getMuzzlePoint\(out = new THREE\.Vector3\(\)\)/);
  assert.match(player, /pose\.pos\[2\] - pose\.length \* 0\.5/);
  const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
  assert.match(game, /const muzzle = G\.player\.getMuzzlePoint\(_muzzle\)/);
  assert.doesNotMatch(game, /const from = origin\.clone\(\)\.addScaledVector/);

  // Блок [x,y,z] занимает y…y+1, поэтому точка оружия ставится на y+1.6 —
  // как в готовых картах. На y+0.6 пикап оказывался внутри блока.
  const editor = readFileSync(new URL('../js/editor.js', import.meta.url), 'utf8');
  assert.match(editor, /pos: \[cellOn\.x \+ 0\.5, cellOn\.y \+ 1\.6, cellOn\.z \+ 0\.5\]/);
  const maps = ['arena01', 'arena02', 'arena03', 'arena04', 'arena05'];
  for (const id of maps) {
    const map = JSON.parse(readFileSync(new URL(`../maps/${id}.json`, import.meta.url), 'utf8'));
    const solid = new Set(map.blocks.map(([x, y, z]) => `${x}|${y}|${z}`));
    for (const spot of map.weapons) {
      const [x, y, z] = spot.pos;
      const inside = solid.has(`${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`);
      assert.equal(inside, false, `${id}: точка оружия ${spot.pos.join(',')} внутри блока`);
    }
  }
});

test('paid packs stay disabled and skin prices never come from the UI', () => {
  const config = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
  // Задел на покупки: код готов, но в этом релизе флаг обязан быть выключен.
  assert.match(config, /paymentsEnabled:\s*false/);
  assert.match(config, /coinPackGrants:\s*Object\.freeze/);
  const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
  assert.match(game, /function catalogSkinPrice/);
  assert.match(game, /const price = catalogSkinPrice\(id\)/);
  const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /if \(CONFIG\.paymentsEnabled\)/);
});

test('release packer locks sharing to the platform', () => {
  const packer = readFileSync(new URL('../tools/pack_release.mjs', import.meta.url), 'utf8');
  assert.match(packer, /function lockToYandexBuild/);
  assert.match(packer, /yandexBuild:\s*true/);
  // В репозитории флаг остаётся выключенным: локально и на Pages ссылка нужна.
  const config = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
  assert.match(config, /yandexBuild:\s*false/);
  const platform = readFileSync(new URL('../js/platform.js', import.meta.url), 'utf8');
  assert.match(platform, /if \(this\.isYandex \|\| CONFIG\.yandexBuild\)/);
});

test('UI assets are present, light and self-hosted', () => {
  const icons = ['play', 'code', 'shop', 'editor', 'settings', 'heart', 'ammo', 'reload', 'ghost'];
  for (const icon of icons) {
    const bytes = readFileSync(new URL(`../assets/icons/${icon}.png`, import.meta.url));
    assert.ok(bytes.length > 500 && bytes.length < 120_000, `${icon}.png весит ${bytes.length} Б`);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${icon}.png не png`);
  }
  // Силуэт в HUD должен быть у каждой пушки, иначе после подбора остаётся чужой.
  for (const key of ['pistol', 'shotgun', 'railgun', 'smg', 'ar', 'sniper']) {
    const bytes = readFileSync(new URL(`../assets/hud/${key}.png`, import.meta.url));
    assert.ok(bytes.length > 500, `hud/${key}.png пуст`);
  }
  const fonts = ['russo-one-latin', 'russo-one-cyrillic', 'exo2-latin-600', 'exo2-cyrillic-600',
    'exo2-latin-800i', 'exo2-cyrillic-800i'];
  let fontBytes = 0;
  for (const font of fonts) {
    const bytes = readFileSync(new URL(`../assets/fonts/${font}.woff2`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2', `${font} не woff2`);
    fontBytes += bytes.length;
  }
  assert.ok(fontBytes < 120_000, `шрифты весят ${Math.round(fontBytes / 1024)} КБ`);
  // Лицензии рядом со шрифтами — обязательное условие OFL.
  for (const license of ['OFL-RussoOne.txt', 'OFL-Exo2.txt']) {
    assert.match(readFileSync(new URL(`../assets/fonts/${license}`, import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE/i);
  }
  // Шрифты и иконки только локальные: внешние домены в UI запрещены модерацией.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/);
  assert.match(html, /assets\/fonts\/russo-one-cyrillic\.woff2/);
});

test('platform locale decides the language only when the player never chose one', () => {
  assert.equal(normalizePlayerData({ settings: {} }).settings.lang, null);
  assert.equal(normalizePlayerData({ settings: { lang: 'xx' } }).settings.lang, null);
  assert.equal(normalizePlayerData({ settings: { lang: 'en' } }).settings.lang, 'en');
  assert.equal(resolveLanguage(null, 'en'), 'en');
  assert.equal(resolveLanguage('ru', 'en'), 'ru');
  const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
  assert.match(gameSource, /resolveLanguage\(saved\?\.settings\?\.lang, Platform\.detectedLang\)/);
  const platformSource = readFileSync(new URL('../js/platform.js', import.meta.url), 'utf8');
  // RU-локали и правило «язык не сообщили → RU только внутри Яндекс.Игр».
  assert.match(platformSource, /RU_LOCALES = new Set\(\['ru', 'be', 'uk', 'kk', 'uz', 'ky', 'tg', 'tk'\]\)/);
  assert.match(platformSource, /normalizeLang\([^)]*navigator\.language[^)]*sdk \? 'ru' : 'en'\)/s);
});

test('first shop skin costs 20+ minutes of play for every profile', () => {
  const shop = JSON.parse(readFileSync(new URL('../skins/shop.json', import.meta.url), 'utf8'));
  const cheapest = Math.min(...shop.skins.map(s => s.price));
  assert.ok(STARTING_COINS < cheapest / 2, 'стартовый баланс не должен покрывать половину скина');
  for (const profile of PROFILES) {
    const result = simulate(profile, { matches: 200 });
    assert.ok(result.firstSkin, `${profile.id}: скин недостижим за 200 матчей`);
    // Нижняя граница: даже сильный игрок без рекламы играет минимум 20 минут.
    assert.ok(result.firstSkin.minutes >= 20,
      `${profile.id}: первый скин за ${result.firstSkin.minutes.toFixed(1)} мин — слишком быстро`);
    // Верхняя: средний профиль не должен упираться в стену дольше часа с четвертью.
    if (profile.id !== 'newbie') {
      assert.ok(result.firstSkin.minutes <= 75,
        `${profile.id}: первый скин за ${result.firstSkin.minutes.toFixed(1)} мин — слишком долго`);
    }
  }
});

test('rewards stay inside a bounded wallet and only builtin bots get a multiplier', () => {
  const wallet = normalizeWallet({});
  assert.equal(wallet.coins, STARTING_COINS);
  const now = Date.UTC(2026, 5, 10, 12, 0, 0);
  const hostile = { data: 'x', _builtin: true, _diffMult: 999 };
  const clamped = computeMatchReward(true, 1, hostile, wallet, now);
  assert.equal(clamped.total, (BASE_REWARD + WIN_REWARD) * 2); // ×2 за первую победу дня
  const best = computeMatchReward(true, 1, { data: 'x', _builtin: true, _diffMult: Math.max(...BUILTIN_MULTS) },
    { coins: 0, lastWinDate: '2999-01-01' }, now);
  assert.equal(best.firstWin, false);
  assert.equal(best.total, BASE_REWARD + Math.round(WIN_REWARD * Math.max(...BUILTIN_MULTS)));
  const overflow = { coins: VALIDATION_LIMITS.walletCoins - 1 };
  applyMatchReward(overflow, { total: 10_000, isFriend: false }, true, now);
  assert.equal(overflow.coins, VALIDATION_LIMITS.walletCoins);
});

test('ZIP output is deterministic for normalized inputs', () => {
  const entries = [
    { path: 'b.txt', data: Buffer.from('second') },
    { path: 'a.txt', data: Buffer.from('first') },
  ];
  const first = createDeterministicZip(entries, 1_700_000_000);
  const second = createDeterministicZip([...entries].reverse(), 1_700_000_000);
  assert.deepEqual(first, second);
  assert.equal(first.readUInt32LE(0), 0x04034b50);
  assert.equal(first.readUInt32LE(first.length - 22), 0x06054b50);
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}
if (failures) process.exit(1);
console.log(`${tests.length} unit checks passed`);
