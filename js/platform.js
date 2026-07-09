// Обёртка платформы. Все обращения игры к SDK/рекламе/сохранениям — ТОЛЬКО отсюда.
// Автоопределение окружения: на Яндекс Играх подключается настоящий SDK,
// на localhost/GitHub Pages — localStorage-заглушки. Игра этого не замечает.

import { CONFIG } from './config.js';
import { Sound } from './audio.js';

const LS_PREFIX = 'ghostfire.';

let ysdk = null;       // экземпляр Яндекс SDK (null = режим заглушек)
let yaPlayer = null;   // игрок Яндекса (облачные сейвы)
let payments = null;   // покупки (Яны)
let cloud = null;      // кеш облачных данных player.getData()

/** Пробуем подключить /sdk.js — он существует только на CDN Яндекс Игр. */
function tryLoadYandexScript() {
  if (window.YaGames) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/sdk.js';
    const done = (ok) => { resolve(ok); };
    s.onload = () => done(true);
    s.onerror = () => done(false);
    setTimeout(() => done(false), 7000);
    document.head.appendChild(s);
  });
}

/** Локальное чтение/запись — работает всегда, облако поверх (если есть). */
function lsRead(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function lsWrite(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** Универсальное хранилище: localStorage всегда + облако Яндекса при наличии. */
async function store(key, value) {
  lsWrite(key, value);
  if (yaPlayer) {
    cloud = { ...(cloud ?? {}), [key]: value };
    try { await yaPlayer.setData(cloud); } catch (e) { console.warn('[platform] cloud save failed', e); }
  }
  return true;
}
function read(key) {
  if (cloud && cloud[key] !== undefined && cloud[key] !== null) return cloud[key];
  return lsRead(key);
}

export const Platform = {
  ready: false,
  isYandex: false,

  async initSDK() {
    try {
      if (await tryLoadYandexScript()) {
        ysdk = await window.YaGames.init();
        this.isYandex = true;
        try {
          yaPlayer = await ysdk.getPlayer();
          cloud = await yaPlayer.getData();
        } catch (e) {
          console.warn('[platform] player unavailable', e);
          yaPlayer = null;
        }
        console.log('[platform] Yandex Games SDK готов');
        this.ready = true;
        return true;
      }
    } catch (e) {
      console.warn('[platform] Yandex init failed → заглушки', e);
      ysdk = null;
    }
    console.log('[platform] initSDK (stub)');
    this.ready = true;
    return true;
  },

  /**
   * Ссылка вызова по окружению. Внутри Яндекса — ТОЛЬКО страница игры
   * в каталоге с payload (внешние домены в шеринге запрещены правилами);
   * null = ссылки нет, шеринг фолбэком через код.
   */
  getShareUrl(code) {
    if (this.isYandex) {
      if (!CONFIG.yandexAppId || code.length > CONFIG.yandexPayloadLimit) return null;
      return `https://yandex.ru/games/app/${CONFIG.yandexAppId}?payload=${code}`;
    }
    return `${CONFIG.shareBaseUrl}?ghost=${code}`;
  },

  /** Код призрака, с которым запустили игру: payload Яндекса или ?ghost=. */
  getLaunchPayload() {
    try {
      const p = ysdk?.environment?.payload;
      if (p) return p;
    } catch { /* нет environment */ }
    return new URLSearchParams(location.search).get('ghost');
  },

  /** Сигнал "игра загружена и играбельна" — обязательное требование Яндекса.
   *  Вызывается в конце boot(), когда меню уже показано. */
  gameReady() {
    try { ysdk?.features?.LoadingAPI?.ready?.(); } catch { /* старые версии SDK */ }
  },

  /**
   * Rewarded-реклама. resolve(true) — награда выдана.
   * Хук уже используется: "реванш с того же счёта" на экране поражения.
   */
  async showRewardedAd(placement) {
    if (ysdk) {
      Sound.suspend(); // глушим игру на время рекламы
      return new Promise((resolve) => {
        let rewarded = false;
        const done = (v) => { Sound.resume(); resolve(v); };
        ysdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => { rewarded = true; },
            onClose: () => done(rewarded),
            onError: (e) => { console.warn('[platform] rewarded error', e); done(false); },
          },
        });
      });
    }
    console.log(`[platform] showRewardedAd("${placement}") (stub) → granted`);
    return true;
  },

  async showInterstitialAd(placement) {
    // не чаще раза в 3 минуты — и на Яндексе, и в заглушке
    const now = Date.now();
    if (now - (this._lastInterstitialAt ?? 0) < 180000) return false;
    this._lastInterstitialAt = now;
    if (ysdk) {
      Sound.suspend();
      return new Promise((resolve) => {
        const done = (v) => { Sound.resume(); resolve(v); };
        ysdk.adv.showFullscreenAdv({
          callbacks: {
            onClose: () => done(true),
            onError: (e) => { console.warn('[platform] interstitial error', e); done(false); },
          },
        });
      });
    }
    console.log(`[platform] showInterstitialAd("${placement}") (stub)`);
    return true;
  },

  /** Профиль игрока (настройки, призрак). Облако + localStorage. */
  async savePlayer(data) { return store('player', data); },
  async loadPlayer() { return read('player'); },

  /** Таблица лидеров. */
  async submitScore(board, score) {
    if (ysdk) {
      try {
        const lb = await ysdk.getLeaderboards();
        await lb.setLeaderboardScore(board, score);
        return true;
      } catch (e) { console.warn('[platform] leaderboard failed', e); return false; }
    }
    console.log(`[platform] submitScore("${board}", ${score}) (stub)`);
    return true;
  },

  // --- Экономика: госткоины ---
  // Яны (Яндекс Payments) конвертируются в госткоины ТОЛЬКО в одну сторону
  // через buyCoinsPack — вся UGC-экономика живёт в коинах, в каталоге
  // покупок Яндекса только паки (id: pack_s / pack_m / pack_l).

  async loadWallet() {
    return read('wallet') ?? { coins: 100, owned: ['default'], equipped: 'default' };
  },

  async saveWallet(wallet) { return store('wallet', wallet); },

  /**
   * Покупка пака госткоинов. На Яндексе — настоящая покупка за Яны
   * с consume после зачисления; в заглушке коины выдаются сразу.
   */
  async buyCoinsPack(packId, coins) {
    if (ysdk) {
      try {
        payments ??= await ysdk.getPayments({ signed: true });
        const purchase = await payments.purchase({ id: packId });
        const w = await this.loadWallet();
        w.coins += coins;
        await this.saveWallet(w);
        await payments.consumePurchase(purchase.purchaseToken);
        return w;
      } catch (e) {
        console.warn('[platform] purchase failed/cancelled', e);
        return await this.loadWallet(); // отмена покупки — баланс не меняется
      }
    }
    console.log(`[platform] buyCoinsPack("${packId}") (stub) → +${coins} coins`);
    const w = await this.loadWallet();
    w.coins += coins;
    await this.saveWallet(w);
    return w;
  },

  // --- UGC: пользовательский скин и карта из редактора ---

  async saveSkin(skin) { return store('skin', skin); },
  async loadSkin() { return read('skin'); },
  async saveCustomMap(mapData) { return store('custommap', mapData); },
  async loadCustomMap() { return read('custommap'); },
};
