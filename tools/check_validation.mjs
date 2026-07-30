import assert from 'node:assert/strict';
import fs from 'node:fs';
import LZString from '../vendor/lz-string.js';

import { CONFIG } from '../js/config.js';
import {
  applyMatchReward, computeMatchReward, localDate, isNewDay,
  BASE_REWARD, WIN_REWARD, FRIEND_BONUS, FRIEND_DAILY_LIMIT,
} from '../js/economy.js';
import { decompressURIComponentBounded } from '../js/lz-bounded.js';
import {
  VALIDATION_LIMITS,
  validateCustomMap,
  validateReplayData,
  validateShareEntry,
} from '../js/validation.js';

const ghost = JSON.parse(fs.readFileSync(new URL('../ghosts/arena01_d1.json', import.meta.url), 'utf8'));
const canonical = validateShareEntry(ghost);
assert.equal(canonical.ok, true);
const replayDuration = canonical.value.durationSec;
assert.ok(replayDuration > 0.05);

const canonicalJson = JSON.stringify(canonical.value);
const canonicalCode = LZString.compressToEncodedURIComponent(canonicalJson);
assert.equal(decompressURIComponentBounded(canonicalCode, VALIDATION_LIMITS.shareJsonChars), canonicalJson);
const bombJson = JSON.stringify({ padding: 'A'.repeat(VALIDATION_LIMITS.shareJsonChars + 1) });
const bombCode = LZString.compressToEncodedURIComponent(bombJson);
assert.ok(bombCode.length < VALIDATION_LIMITS.shareCodeChars);
assert.equal(decompressURIComponentBounded(bombCode, VALIDATION_LIMITS.shareJsonChars), null);

// A separately forged short wall time cannot undercut a valid replay timeline.
const shortened = validateShareEntry({ ...ghost, durationSec: 0.05 });
assert.equal(shortened.ok, true);
assert.equal(shortened.value.durationSec, replayDuration);

// Real wall time may be longer than frames/tickRate when capped physics dt
// intentionally falls behind on a slow device.
const wallDuration = replayDuration + 3.25;
const stalled = validateShareEntry({ ...ghost, durationSec: wallDuration });
assert.equal(stalled.ok, true);
assert.equal(stalled.value.durationSec, wallDuration);

const privileged = validateShareEntry({ ...ghost, _builtin: true, _diffMult: 3, _rewardClass: 'self' });
assert.equal(privileged.ok, true);
assert.equal('_builtin' in privileged.value, false);
assert.equal('_diffMult' in privileged.value, false);
assert.equal('_rewardClass' in privileged.value, false);

// Суммы выводятся из констант: перекалибровка экономики не должна ломать
// проверку смысла — множитель сложности к чужому призраку не применяется.
const rewardWallet = { coins: 0, lastWinDate: localDate() };
const ownReward = computeMatchReward(true, 1, { ...canonical.value, _rewardClass: 'self' }, rewardWallet);
assert.equal(ownReward.isFriend, false);
assert.equal(ownReward.total, BASE_REWARD + WIN_REWARD);
const incomingReward = computeMatchReward(true, 1, privileged.value, rewardWallet);
assert.equal(incomingReward.isFriend, true);
assert.equal(incomingReward.total, BASE_REWARD + WIN_REWARD + FRIEND_BONUS);

// Граница суток идёт по часовому поясу устройства при доверенном времени.
const midnightUTC = Date.UTC(2026, 0, 2, 0, 0, 1);
assert.equal(localDate(midnightUTC, 0), '2026-01-02');
assert.equal(localDate(midnightUTC, -180), '2026-01-02');  // МСК: 03:00 того же дня
assert.equal(localDate(midnightUTC, 300), '2026-01-01');   // EST: сутки ещё не сменились
assert.equal(localDate(midnightUTC, 99_999), localDate(midnightUTC, 840)); // offset зажат

const trustedNow = Date.UTC(2026, 0, 2, 12, 0, 0);
const todayLocal = localDate(trustedNow);
const yesterdayLocal = localDate(trustedNow - 86_400_000);
assert.ok(isNewDay(todayLocal, yesterdayLocal));
assert.equal(isNewDay(yesterdayLocal, todayLocal), false);
const datedReward = computeMatchReward(true, 1, { ...canonical.value, _rewardClass: 'self' },
  { coins: 0, lastWinDate: yesterdayLocal }, trustedNow);
assert.equal(datedReward.firstWin, true);
const datedWallet = { coins: 0, lastWinDate: yesterdayLocal };
applyMatchReward(datedWallet, datedReward, true, trustedNow);
assert.equal(datedWallet.lastWinDate, todayLocal);

// Перевод часов назад не открывает новый день: ни второго ×2, ни сброса лимита.
const rewound = trustedNow - 3 * 86_400_000;
const rewoundReward = computeMatchReward(true, 1, { ...canonical.value, _rewardClass: 'self' },
  datedWallet, rewound);
assert.equal(rewoundReward.firstWin, false);
applyMatchReward(datedWallet, rewoundReward, true, rewound);
assert.equal(datedWallet.lastWinDate, todayLocal);

const farmWallet = { coins: 0 };
for (let i = 0; i < FRIEND_DAILY_LIMIT; i++) {
  const reward = computeMatchReward(true, 1, privileged.value, farmWallet, trustedNow);
  assert.equal(reward.limited, false);
  applyMatchReward(farmWallet, reward, true, trustedNow);
}
const cappedNow = computeMatchReward(true, 1, privileged.value, farmWallet, trustedNow);
assert.equal(cappedNow.limited, true);
const cappedRewound = computeMatchReward(true, 1, privileged.value, farmWallet, rewound);
assert.equal(cappedRewound.limited, true);

// Decoder and boundary validator agree that every event tick is < frameCount.
const bytes = Buffer.from(ghost.data, 'base64');
const frames = bytes.readUInt32LE(6);
const shots = bytes.readUInt32LE(10);
assert.ok(shots > 0);
bytes.writeUInt32LE(frames, 18 + frames * 21);
assert.equal(validateReplayData(bytes.toString('base64')).ok, false);

for (const file of fs.readdirSync(new URL('../maps/', import.meta.url))) {
  if (!file.endsWith('.json')) continue;
  const map = JSON.parse(fs.readFileSync(new URL(`../maps/${file}`, import.meta.url), 'utf8'));
  assert.equal(validateCustomMap(map).ok, true, file);
}

// Enabling products without an initialized SDK must never become a free-pack
// development fallback.
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en' }, configurable: true });
}
const { Platform } = await import('../js/platform.js');
assert.equal(await Platform.saveWallet({ coins: 777, owned: ['default'], equipped: 'default' }), true);
CONFIG.paymentsEnabled = true;
try {
  const wallet = await Platform.buyCoinsPack('pack_s', 999_999_999);
  assert.equal(wallet.coins, 777);
  assert.equal(Platform.consumeLastError()?.code, 'payments_unavailable');
} finally {
  CONFIG.paymentsEnabled = false;
}

// On-platform UI must not report success when only local cache persisted.
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {};
}
globalThis.document = new EventTarget();
const sdkCallbacks = {};
let gameplayStarts = 0, gameplayStops = 0;
let rewardedCallbacks = null;
globalThis.window = { YaGames: { init: async () => ({
  environment: { i18n: { lang: 'en' } },
  serverTime: () => trustedNow,
  on: (name, callback) => { sdkCallbacks[name] = callback; },
  features: { GameplayAPI: {
    start: () => { gameplayStarts++; },
    stop: () => { gameplayStops++; },
  } },
  adv: {
    showRewardedVideo: ({ callbacks }) => { rewardedCallbacks = callbacks; },
  },
  getPlayer: async () => ({
    getData: async () => ({}),
    getStats: async () => ({ wins: 0 }),
    setData: async () => { throw new Error('cloud unavailable'); },
  }),
}) } };
const { Platform: CloudPlatform } = await import('../js/platform.js?cloud-failure-check');
await CloudPlatform.initSDK();
assert.equal(CloudPlatform.serverTime(), trustedNow);
assert.equal(CloudPlatform.gameplayStart(), true);
assert.equal(CloudPlatform.gameplayStart(), false);
assert.equal(gameplayStarts, 1);
let pauseEvents = 0, resumeEvents = 0;
document.addEventListener('ghostfire:platform-pause', () => { pauseEvents++; });
document.addEventListener('ghostfire:platform-resume', () => { resumeEvents++; });
sdkCallbacks.game_api_pause();
sdkCallbacks.game_api_resume();
assert.equal(pauseEvents, 1);
assert.equal(resumeEvents, 1);
assert.equal(CloudPlatform.gameplayStart(), false);
assert.equal(gameplayStarts, 1);
assert.equal(gameplayStops, 0);
assert.equal(CloudPlatform.gameplayStop(), true);
assert.equal(CloudPlatform.gameplayStop(), false);
assert.equal(gameplayStops, 1);

// Ad ordering 1: SDK pause -> ad close -> SDK resume. Because the ad stopped
// gameplay before the SDK pause, resume must issue one explicit start.
assert.equal(CloudPlatform.gameplayStart(), true);
assert.equal(gameplayStarts, 2);
const adCloseFirst = CloudPlatform.showRewardedAd('ordering_close_first');
assert.equal(gameplayStops, 2);
sdkCallbacks.game_api_pause();
rewardedCallbacks.onRewarded();
rewardedCallbacks.onClose();
assert.equal(await adCloseFirst, true);
assert.equal(gameplayStarts, 2);
sdkCallbacks.game_api_resume();
assert.equal(gameplayStarts, 3);
assert.equal(CloudPlatform.gameplayStart(), false);

// Ad ordering 2: SDK resume -> ad close. The close callback performs the one
// explicit start after the pending platform pause has already completed.
const adResumeFirst = CloudPlatform.showRewardedAd('ordering_resume_first');
assert.equal(gameplayStops, 3);
sdkCallbacks.game_api_pause();
sdkCallbacks.game_api_resume();
rewardedCallbacks.onRewarded();
rewardedCallbacks.onClose();
assert.equal(await adResumeFirst, true);
assert.equal(gameplayStarts, 4);

// A manual stop requested during an automatic tab pause cancels desired
// resume; after the SDK auto-start, Platform reconciles with one stop.
sdkCallbacks.game_api_pause();
assert.equal(CloudPlatform.gameplayStop(), true);
sdkCallbacks.game_api_resume();
assert.equal(gameplayStops, 4);
assert.equal(CloudPlatform.gameplayStop(), false);
const originalWarn = console.warn;
console.warn = () => {};
try {
  assert.equal(await CloudPlatform.saveWallet({ coins: 888, owned: ['default'], equipped: 'default' }), false);
  assert.equal(CloudPlatform.consumeLastError()?.code, 'cloud_save_failed');
  assert.equal(JSON.parse(storage.get('ghostfire.wallet')).coins, 888);
} finally {
  console.warn = originalWarn;
}

console.log('Validation, bounded decompression, timing, rewards, platform events, cloud and payment checks passed');
