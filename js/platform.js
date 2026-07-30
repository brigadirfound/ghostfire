// Platform boundary: SDK lifecycle, ads, persistence, leaderboards and payments.
// Callers never access YaGames directly; local development uses deterministic
// localStorage fallbacks through the same public API.

import { CONFIG } from './config.js';
import { Sound } from './audio.js';
import { Music } from './music.js';
import {
  VALIDATION_LIMITS,
  isPlainObject,
  normalizePlayerData,
  normalizeWallet,
  serializableObject,
  validateCustomMap,
} from './validation.js';

const LS_PREFIX = 'ghostfire.';
// Локали, где русская версия игры полезнее английской.
const RU_LOCALES = new Set(['ru', 'be', 'uk', 'kk', 'uz', 'ky', 'tg', 'tk']);

let ysdk = null;
let yaPlayer = null;
let payments = null;
let paymentCatalog = null;
let cloud = {};
let platformStats = null;
let initPromise = null;
let writeQueue = Promise.resolve();
let paymentQueue = Promise.resolve();
let gameplayActive = false;
let platformPausePending = false;
let platformPauseAutoResume = false;
let platformPauseDesiredActive = false;
let sdkEventsBound = false;
let lastError = null;

function setError(code, detail = null) {
  lastError = { code, detail: detail ? String(detail?.message ?? detail) : null };
  if (detail) console.warn(`[platform] ${code}`, detail);
}

function tryLoadYandexScript() {
  if (window.YaGames) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const s = document.createElement('script');
    s.src = '/sdk.js';
    s.onload = () => done(true);
    s.onerror = () => done(false);
    const timer = setTimeout(() => done(false), 7000);
    document.head.appendChild(s);
  });
}

function lsRead(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function lsWrite(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); return true; }
  catch (e) { setError('local_save_failed', e); return false; }
}

function cloneSerializable(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return undefined; }
}

function byteLength(value) {
  const json = JSON.stringify(value);
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).byteLength : json.length * 2;
}

function enqueueWrite(job) {
  const task = writeQueue.then(job, job);
  writeQueue = task.catch(() => {});
  return task;
}

function enqueuePayment(job) {
  const task = paymentQueue.then(job, job);
  paymentQueue = task.catch(() => {});
  return task;
}

function dispatchPlatformEvent(name) {
  try { document.dispatchEvent(new CustomEvent(name)); }
  catch { /* DOM may not be ready in a non-browser test harness */ }
}

function bindSDKEvents() {
  if (sdkEventsBound || typeof ysdk?.on !== 'function') return;
  sdkEventsBound = true;
  ysdk.on('game_api_pause', () => {
    // These SDK events already apply GameplayAPI.stop/start themselves. Mirror
    // that transition locally so the game-state listener does not call twice.
    if (!platformPausePending) {
      platformPausePending = true;
      platformPauseAutoResume = gameplayActive;
      platformPauseDesiredActive = gameplayActive;
      gameplayActive = false;
    }
    dispatchPlatformEvent('ghostfire:platform-pause');
  });
  ysdk.on('game_api_resume', () => {
    if (platformPausePending) {
      // The SDK auto-resumes only when the game was active at pause time. If
      // game intent changed while paused, reconcile exactly once afterwards.
      gameplayActive = platformPauseAutoResume;
      if (platformPauseDesiredActive && !platformPauseAutoResume) {
        gameplayActive = true;
        try { ysdk?.features?.GameplayAPI?.start?.(); }
        catch (e) { setError('gameplay_start_failed', e); }
      } else if (!platformPauseDesiredActive && platformPauseAutoResume) {
        gameplayActive = false;
        try { ysdk?.features?.GameplayAPI?.stop?.(); }
        catch (e) { setError('gameplay_stop_failed', e); }
      }
      platformPausePending = false;
      platformPauseAutoResume = false;
      platformPauseDesiredActive = false;
    }
    dispatchPlatformEvent('ghostfire:platform-resume');
  });
}

async function persistDetailed(key, value, flush = false) {
  const safe = cloneSerializable(value);
  if (safe === undefined) {
    setError('invalid_save_data');
    return { ok: false, local: false, cloud: false };
  }
  const localOK = lsWrite(key, safe);
  if (!yaPlayer) return { ok: localOK, local: localOK, cloud: false };

  const next = { ...(isPlainObject(cloud) ? cloud : {}), [key]: safe };
  if (byteLength(next) > VALIDATION_LIMITS.cloudBytes) {
    setError('cloud_data_too_large');
    return { ok: false, local: localOK, cloud: false };
  }
  // Session reads see the newest value immediately. Snapshots are serialized so
  // an older request can never finish after and overwrite a newer request.
  cloud = next;
  let cloudOK = false;
  try {
    await enqueueWrite(() => yaPlayer.setData(next, flush));
    cloudOK = true;
  } catch (e) { setError('cloud_save_failed', e); }
  // On-platform callers must not display "saved" when only the browser cache
  // succeeded. If getPlayer was unavailable, the earlier local-only branch is
  // the intentional offline fallback.
  return { ok: cloudOK, local: localOK, cloud: cloudOK };
}

async function store(key, value, flush = false) {
  return (await persistDetailed(key, value, flush)).ok;
}

function read(key) {
  if (isPlainObject(cloud) && cloud[key] !== undefined && cloud[key] !== null) return cloud[key];
  return lsRead(key);
}

/**
 * Политика языка: RU для локалей RU_LOCALES, EN для остальных известных.
 * Если язык не сообщили вовсе — RU внутри Яндекс.Игр (каталог русскоязычный)
 * и EN на прочих площадках, где сборка публикуется международной.
 * Явный выбор игрока в настройках приоритетнее любого автоопределения.
 */
function normalizeLang(value, unknownFallback = 'en') {
  const lang = String(value || '').toLowerCase().split('-')[0];
  if (!lang) return unknownFallback;
  return RU_LOCALES.has(lang) ? 'ru' : 'en';
}

function detectLang(sdk) {
  const reported = sdk?.environment?.i18n?.lang;
  if (reported) return normalizeLang(reported);
  return normalizeLang(typeof navigator !== 'undefined' ? navigator.language : '', sdk ? 'ru' : 'en');
}

function normalizeStats(raw) {
  const wins = Number(raw?.wins);
  return { wins: Number.isSafeInteger(wins) && wins >= 0 ? wins : 0 };
}

function packGrant(packId) {
  const value = CONFIG.coinPackGrants?.[packId];
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function ensurePayments() {
  if (!ysdk || !CONFIG.paymentsEnabled) return null;
  if (!payments) payments = await ysdk.getPayments(); // unsigned client flow
  if (!paymentCatalog) {
    const raw = await payments.getCatalog();
    paymentCatalog = Array.isArray(raw) ? raw : [];
  }
  return payments;
}

function catalogProduct(packId) {
  return paymentCatalog?.find(p => p?.id === packId) ?? null;
}

async function creditAndConsume(purchase, packId, wallet) {
  const token = purchase?.purchaseToken;
  const productID = purchase?.productID;
  const coins = packGrant(packId);
  if (typeof token !== 'string' || token.length < 8 || token.length > 512 ||
      productID !== packId || !coins) {
    setError('invalid_purchase_result');
    return normalizeWallet(wallet);
  }

  let next = normalizeWallet(wallet);
  const alreadyCredited = !!next.processedPurchases?.[token];
  if (!alreadyCredited) {
    next = normalizeWallet({
      ...next,
      coins: Math.min(VALIDATION_LIMITS.walletCoins, next.coins + coins),
      processedPurchases: {
        ...(next.processedPurchases ?? {}),
        [token]: { productID, coins, at: Date.now() },
      },
    });
    // Yandex requires progress to be persisted before a consumable is consumed.
    const saved = await persistDetailed('wallet', next, true);
    const durable = yaPlayer ? saved.cloud : saved.local;
    if (!durable) {
      setError('purchase_save_failed');
      return normalizeWallet(wallet);
    }
  }

  try {
    await payments.consumePurchase(token);
  } catch (e) {
    // Keep the token ledger: recovery will retry consume without crediting twice.
    setError('purchase_consume_pending', e);
  }
  return next;
}

export const Platform = {
  ready: false,
  isYandex: false,
  detectedLang: detectLang(null),

  async initSDK() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        if (await tryLoadYandexScript()) {
          ysdk = await window.YaGames.init();
          this.isYandex = true;
          this.detectedLang = detectLang(ysdk);
          bindSDKEvents();
          if (gameplayActive) {
            try { ysdk.features?.GameplayAPI?.start?.(); }
            catch (e) { setError('gameplay_start_failed', e); }
          }
          try {
            yaPlayer = await ysdk.getPlayer({ scopes: false });
            const loaded = await yaPlayer.getData();
            cloud = isPlainObject(loaded) ? loaded : {};
            if (typeof yaPlayer.getStats === 'function') {
              try { platformStats = normalizeStats(await yaPlayer.getStats(['wins'])); }
              catch { platformStats = normalizeStats(cloud.stats ?? lsRead('stats')); }
            } else platformStats = normalizeStats(cloud.stats ?? lsRead('stats'));
          } catch (e) {
            setError('player_unavailable', e);
            yaPlayer = null;
            cloud = {};
          }
          this.ready = true;
          return true;
        }
      } catch (e) {
        setError('sdk_init_failed', e);
        ysdk = null;
        yaPlayer = null;
      }
      platformStats = normalizeStats(lsRead('stats'));
      this.ready = true;
      return true;
    })();
    return initPromise;
  },

  /**
   * Ссылка для вызова друга. Внутри Яндекса (и в любой сборке, помеченной
   * yandexBuild) допустима ровно одна ссылка — страница игры в каталоге с
   * payload: друг открывает её, и код подставляется сам. Если ID каталога не
   * заполнен или код длиннее лимита payload — ссылки нет вовсе, делимся кодом.
   */
  getShareUrl(code) {
    if (typeof code !== 'string' || !code.length) return null;
    const encoded = encodeURIComponent(code);
    if (this.isYandex || CONFIG.yandexBuild) {
      // ID каталога — только цифры из URL страницы игры. Опечатка здесь дала бы
      // битую ссылку вызова, поэтому лучше молча уйти в шеринг кодом.
      const appId = String(CONFIG.yandexAppId ?? '');
      if (!/^\d{4,12}$/.test(appId) || encoded.length > CONFIG.yandexPayloadLimit) return null;
      return `https://yandex.ru/games/app/${appId}?payload=${encoded}`;
    }
    if (encoded.length > CONFIG.externalShareUrlLimit) return null;
    return `${CONFIG.shareBaseUrl}?ghost=${encoded}`;
  },

  getLaunchPayload() {
    try {
      const payload = ysdk?.environment?.payload;
      if (typeof payload === 'string' && payload) return payload;
    } catch { /* unavailable environment */ }
    const params = new URLSearchParams(location.search);
    return params.get('ghost') || params.get('payload');
  },

  gameReady() {
    try { ysdk?.features?.LoadingAPI?.ready?.(); } catch { /* older SDK */ }
  },

  /** Synchronous trusted clock on Yandex; local clock is the offline fallback. */
  serverTime() {
    try {
      const value = Number(ysdk?.serverTime?.());
      if (Number.isFinite(value) && value >= 946_684_800_000 && value <= 8_640_000_000_000_000) {
        return Math.trunc(value);
      }
    } catch (e) { setError('server_time_unavailable', e); }
    return Date.now();
  },

  /** Gameplay markup. Calls are idempotent; actual game-state policy stays in game.js. */
  gameplayStart() {
    if (platformPausePending) {
      if (platformPauseDesiredActive) return false;
      platformPauseDesiredActive = true;
      return true;
    }
    if (gameplayActive) return false;
    gameplayActive = true;
    try { ysdk?.features?.GameplayAPI?.start?.(); }
    catch (e) { setError('gameplay_start_failed', e); }
    return true;
  },

  gameplayStop() {
    if (platformPausePending) {
      if (!platformPauseDesiredActive) return false;
      platformPauseDesiredActive = false;
      return true;
    }
    if (!gameplayActive) return false;
    gameplayActive = false;
    try { ysdk?.features?.GameplayAPI?.stop?.(); }
    catch (e) { setError('gameplay_stop_failed', e); }
    return true;
  },

  async showRewardedAd(placement) {
    if (!ysdk) return true;
    const resumeGameplay = gameplayActive;
    this.gameplayStop();
    if (resumeGameplay) dispatchPlatformEvent('ghostfire:platform-pause');
    Sound.suspend();
    Music.duck(true);
    return new Promise((resolve) => {
      let settled = false, rewarded = false;
      const timer = setTimeout(() => done(false), 20_000);
      const done = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (resumeGameplay) {
          Sound.resume();
          Music.duck(false);
          this.gameplayStart();
          dispatchPlatformEvent('ghostfire:platform-resume');
        }
        else { Sound.suspend(); Music.duck(true); }
        resolve(value);
      };
      try {
        ysdk.adv.showRewardedVideo({ callbacks: {
          onRewarded: () => { rewarded = true; },
          onClose: () => done(rewarded),
          onError: (e) => { setError(`rewarded_${placement}_failed`, e); done(false); },
        } });
      } catch (e) { setError(`rewarded_${placement}_failed`, e); done(false); }
    });
  },

  async showInterstitialAd(placement) {
    const now = Date.now();
    if (now - (this._lastInterstitialAt ?? 0) < 180000) return false;
    this._lastInterstitialAt = now;
    if (!ysdk) return true;
    const resumeGameplay = gameplayActive;
    this.gameplayStop();
    if (resumeGameplay) dispatchPlatformEvent('ghostfire:platform-pause');
    Sound.suspend();
    Music.duck(true);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => done(false), 20_000);
      const done = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (resumeGameplay) {
          Sound.resume();
          Music.duck(false);
          this.gameplayStart();
          dispatchPlatformEvent('ghostfire:platform-resume');
        }
        else { Sound.suspend(); Music.duck(true); }
        resolve(value);
      };
      try {
        ysdk.adv.showFullscreenAdv({ callbacks: {
          onClose: (wasShown) => done(wasShown !== false),
          onError: (e) => { setError(`interstitial_${placement}_failed`, e); done(false); },
        } });
      } catch (e) { setError(`interstitial_${placement}_failed`, e); done(false); }
    });
  },

  async savePlayer(data) {
    const normalized = normalizePlayerData(data);
    if (!normalized) { setError('invalid_player_data'); return false; }
    return store('player', normalized);
  },
  async loadPlayer() { return normalizePlayerData(read('player')); },

  async submitScore(board, score) {
    if (!ysdk || typeof board !== 'string' || !Number.isSafeInteger(score) || score < 0) return false;
    try {
      const lb = ysdk.leaderboards || await ysdk.getLeaderboards();
      if (ysdk.leaderboards && typeof ysdk.isAvailableMethod === 'function') {
        const available = await ysdk.isAvailableMethod('leaderboards.setScore');
        if (!available) return false; // guest/hidden profile: no forced auth dialog
      }
      const setScore = lb.setScore || lb.setLeaderboardScore;
      if (typeof setScore !== 'function') return false;
      await setScore.call(lb, board, score);
      return true;
    } catch (e) { setError('leaderboard_unavailable', e); return false; }
  },

  /** Atomically increments persistent cumulative wins and submits that value. */
  async recordWinAndSubmit(board = 'wins') {
    let wins = null;
    if (yaPlayer?.incrementStats) {
      try {
        const updated = await yaPlayer.incrementStats({ wins: 1 });
        const reported = Number(updated?.wins);
        wins = Number.isSafeInteger(reported) && reported >= 0
          ? reported
          : normalizeStats(platformStats ?? cloud.stats ?? lsRead('stats')).wins + 1;
        platformStats = { wins };
        lsWrite('stats', platformStats);
      } catch (e) { setError('stats_save_failed', e); }
    }
    if (wins === null) {
      const current = normalizeStats(platformStats ?? lsRead('stats'));
      wins = current.wins + 1;
      platformStats = { wins };
      if (!lsWrite('stats', platformStats)) return null;
      if (yaPlayer && typeof yaPlayer.incrementStats !== 'function' &&
          !(await store('stats', platformStats, true))) return null;
    }
    await this.submitScore(board, wins); // auth-safe; local/cloud win is still kept
    return wins;
  },

  async loadWallet() { return normalizeWallet(read('wallet')); },
  async saveWallet(wallet) { return store('wallet', normalizeWallet(wallet)); },

  /** Localized SDK catalog for future payment UI; never trusts static prices. */
  async loadPaymentCatalog() {
    lastError = null;
    if (!CONFIG.paymentsEnabled || !ysdk) return [];
    try {
      await ensurePayments();
      return paymentCatalog.filter(p => packGrant(p?.id)).map(p => {
        let currencyImage = null;
        try {
          const image = p.getPriceCurrencyImage?.('small');
          if (typeof image === 'string') currencyImage = image.slice(0, 2_048);
        } catch { /* optional SDK asset */ }
        return {
          id: p.id,
          title: typeof p.title === 'string' ? p.title.slice(0, 128) : '',
          description: typeof p.description === 'string' ? p.description.slice(0, 512) : '',
          price: typeof p.price === 'string' ? p.price.slice(0, 64) : '',
          priceValue: typeof p.priceValue === 'string' ? p.priceValue.slice(0, 64) : '',
          priceCurrencyCode: typeof p.priceCurrencyCode === 'string' ? p.priceCurrencyCode.slice(0, 16) : '',
          currencyImage,
        };
      });
    } catch (e) { setError('payment_catalog_failed', e); return []; }
  },

  /** Recover pending consumables, crediting every purchase token at most once. */
  async recoverPurchases(packs, wallet) {
    return enqueuePayment(async () => {
      lastError = null;
      let next = normalizeWallet(wallet);
      if (!CONFIG.paymentsEnabled || !ysdk) return next;
      try {
        await ensurePayments();
        const configured = new Set((Array.isArray(packs) ? packs : [])
          .map(p => p?.id).filter(id => packGrant(id) && catalogProduct(id)));
        const pending = await payments.getPurchases();
        if (!Array.isArray(pending)) return next;
        for (const purchase of pending) {
          if (!configured.has(purchase?.productID)) {
            setError('unknown_pending_purchase');
            continue;
          }
          next = await creditAndConsume(purchase, purchase.productID, next);
        }
        return next;
      } catch (e) { setError('purchase_recovery_failed', e); return next; }
    });
  },

  /** Backward-compatible wallet return; the coins argument is intentionally ignored. */
  async buyCoinsPack(packId, coins) { // eslint-disable-line no-unused-vars
    return enqueuePayment(async () => {
      lastError = null;
      const current = await this.loadWallet();
      const grant = packGrant(packId);
      if (!grant) { setError('unknown_product'); return current; }
      if (!CONFIG.paymentsEnabled) { setError('payments_disabled'); return current; }
      if (!ysdk) { setError('payments_unavailable'); return current; }
      try {
        await ensurePayments();
        if (!catalogProduct(packId)) { setError('product_unavailable'); return current; }
        const resumeGameplay = gameplayActive;
        this.gameplayStop();
        if (resumeGameplay) dispatchPlatformEvent('ghostfire:platform-pause');
        let purchase;
        try { purchase = await payments.purchase({ id: packId }); }
        finally {
          if (resumeGameplay) {
            this.gameplayStart();
            dispatchPlatformEvent('ghostfire:platform-resume');
          }
        }
        return await creditAndConsume(purchase, packId, current);
      } catch (e) { setError('purchase_cancelled', e); return current; }
    });
  },

  async saveSkin(skin) {
    if (!serializableObject(skin, 80_000)) { setError('invalid_skin_data'); return false; }
    return store('skin', cloneSerializable(skin));
  },
  async loadSkin() {
    const skin = read('skin');
    return serializableObject(skin, 80_000) ? cloneSerializable(skin) : null;
  },
  async saveCustomMap(mapData) {
    const checked = validateCustomMap(mapData);
    if (!checked.ok) { setError(checked.code); return false; }
    return store('custommap', checked.value);
  },
  async loadCustomMap() {
    const checked = validateCustomMap(read('custommap'));
    return checked.ok ? checked.value : null;
  },

  getLastError() { return lastError ? { ...lastError } : null; },
  consumeLastError() { const value = this.getLastError(); lastError = null; return value; },
};
