// UI: меню, выбор карты/призрака, настройки, межраундовый и финальный экраны,
// HUD, шеринг призрака через LZ-string.
import LZString from 'lz-string';
import { t, setLang, getLang, localizedName } from './i18n.js';
import { synthBotForMap, botNames } from './botgen.js';
import { mapPreviewURL } from './mappreview.js';
import { CONFIG } from './config.js';
import { Platform } from './platform.js';
import { VALIDATION_LIMITS, validateShareEntry } from './validation.js';
import { decompressURIComponentBounded } from './lz-bounded.js';
import { BUILTIN_MULTS, CUSTOM_BOT_MULTS } from './economy.js';

const BUILTIN_MAPS = ['arena01', 'arena02', 'arena03', 'arena04', 'arena05'];
const BUILTIN_GHOSTS = ['shadow', 'smoke', 'phantom', 'mirage', 'inferno'];
const TIP_COUNT = 8; // строки tip1…tip8 в i18n
// Палитра стандартного скина для превью в магазине: сам skins/default.json
// грузит игра, а магазину нужны только цвета.
const DEFAULT_SKIN_PREVIEW = Object.freeze({
  body: { head: '#ffcc88', torso: '#2277dd', legs: '#1b3a5c' }, tracer: '#ffdd55',
});
const safeColor = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : fallback);

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = String(text);
  return e;
};

const clear = (node) => node.replaceChildren();
const finiteNumber = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const translatedOr = (key, fallback) => {
  const value = t(key);
  return value === key ? fallback : value;
};

const paymentMessage = (error) => {
  if (error?.code === 'purchase_consume_pending') return t('purchasePending');
  if (error?.code === 'product_unavailable' || error?.code === 'unknown_product') return t('productUnavailable');
  return t('purchaseFailed');
};

function safeCurrencyImage(value) {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  if (/^data:image\/(?:png|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  try {
    const url = new URL(value, location.href);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function namedDescription(name, description) {
  const wrap = el('div');
  wrap.append(el('div', 'gname', name));
  if (description) wrap.append(el('div', 'gdesc', description));
  return wrap;
}

function scoreDisplay(playerScore, ghostScore) {
  const score = el('div', 'bigscore');
  score.append(
    el('span', 'me', Math.max(0, Math.round(finiteNumber(playerScore)))),
    document.createTextNode(' : '),
    el('span', 'foe', Math.max(0, Math.round(finiteNumber(ghostScore)))),
  );
  return score;
}

function rewardRow(cls, label, amount = '') {
  const row = el('div', `reward-row${cls ? ` ${cls}` : ''}`);
  row.append(el('span', '', label), el('b', '', amount));
  return row;
}

function durationText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3_600) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${rest}`;
}

// Internal-only reward classification. encode/decode validation never carries
// this field across a share boundary.
const ownGhostEntry = entry => ({ ...entry, _rewardClass: 'self' });

export class UI {
  /**
   * @param {*} actions { startMatch(mapId, ghostEntry), settings, saveSettings(),
   *                      getPlayerGhost(), rematchRewarded() }
   */
  constructor(actions) {
    this.a = actions;
    this.screens = ['menu', 'maps', 'ghosts', 'challenge', 'shop', 'howto', 'settings', 'pause', 'round', 'match'];
    this.selectedMap = 'arena01';
  }

  /** Боты — матрица карта×сложность: ghosts/{mapId}_d{1..5}.json, кеш по карте. */
  async ghostsForMap(mapId) {
    this._ghostCache ??= {};
    if (!this._ghostCache[mapId]) {
      const list = [];
      for (let i = 1; i <= 5; i++) {
        try {
          const res = await fetch(`ghosts/${mapId}_d${i}.json`);
          if (!res.ok) continue;
          const checked = validateShareEntry(await res.json());
          if (checked.ok && checked.value.map === mapId) list.push(checked.value);
        } catch { /* нет файла — пропускаем */ }
      }
      this._ghostCache[mapId] = list;
    }
    return this._ghostCache[mapId];
  }

  show(name) {
    // меню всегда перестраиваем: в нём динамические кнопки (Быстрый матч)
    if (name === 'menu' && !this._inBuildMenu) { this.buildMenu(); return; }
    for (const s of this.screens) $(`screen-${s}`).classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', name !== null);
  }

  hideAll() {
    for (const s of this.screens) $(`screen-${s}`).classList.add('hidden');
    $('hud').classList.remove('hidden');
  }

  // ---------- экраны ----------

  buildMenu() {
    this._inBuildMenu = true;
    const s = $('screen-menu');
    clear(s);
    const logo = el('div', 'logo', 'GHOST');
    logo.append(el('span', '', 'FIRE'));
    // Вместо английского слогана — подсказка на языке игрока, своя на каждый
    // заход в меню: место работает, а не занимает строку.
    s.append(logo, el('div', 'subtitle', t(`tip${1 + Math.floor(Math.random() * TIP_COUNT)}`)));
    // "Быстрый матч" повторяет последний выбор карта+противник в один тап
    if (this._quickPickValid()) {
      s.append(this._btn(t('quickMatch'), 'primary', () => this.quickMatch(), 'play'));
    }
    s.append(
      this._btn(t('play'), this._quickPickValid() ? '' : 'primary', () => {
        // первый запуск — туториал вместо выбора карты
        if (this.a.shouldTutorial()) this.a.startTutorial();
        else this.buildMaps();
      }, 'ghost'),
      this._btn(t('haveCode'), '', () => this.buildChallenge(), 'code'),
      this._btn(t('shop'), '', () => this.buildShop(), 'shop'),
      this._btn(t('editor'), '', () => { location.href = 'editor.html'; }, 'editor'),
      this._btn(t('howTo'), '', () => this.buildHowTo(), 'howto'),
      this._btn(t('settings'), '', () => this.buildSettings(), 'settings'),
    );
    this.show('menu');
    this._inBuildMenu = false;
  }

  /** Короткая справка: цель, призрак, управление, оружие, награда, вызов. */
  buildHowTo() {
    const s = $('screen-howto');
    clear(s);
    s.append(el('h2', '', t('howTo')));
    const sections = [
      ['howToGoal', 'howToGoalText', 'play'],
      ['howToGhost', 'howToGhostText', 'ghost'],
      ['howToControls', 'howToControlsText', 'settings'],
      ['howToWeapons', 'howToWeaponsText', 'ammo'],
      ['howToRewards', 'howToRewardsText', 'shop'],
      ['howToShare', 'howToShareText', 'code'],
    ];
    for (const [title, text, icon] of sections) {
      const card = el('div', 'howto-card');
      const head = el('div', 'howto-head');
      const img = el('img', 'icon');
      img.src = `assets/icons/${icon}.png`;
      img.alt = '';
      head.append(img, el('div', 'howto-title', t(title)));
      card.append(head, el('div', 'howto-text', t(text)));
      s.append(card);
    }
    s.append(this._btn(t('back'), 'small', () => this.show('menu')));
    this.show('howto');
  }

  buildMaps() {
    const s = $('screen-maps');
    clear(s);
    s.append(el('h2', '', t('chooseMap')));
    const row = el('div', 'row');
    const addCard = (id, name, desc, mapData = null) => {
      const card = el('div', 'map-card' + ((id === this.selectedMap ||
        (id === 'custom' && this.selectedMap === '__custom')) ? ' selected' : ''));
      const img = el('img', 'map-thumb');
      mapPreviewURL(id === 'custom' ? '__custom' : id, mapData)
        .then(url => { img.src = url; })
        .catch(() => img.remove());
      card.append(img, el('div', 'map-name', name), el('div', 'map-desc', desc));
      card.onclick = () => { this.selectedMap = id === 'custom' ? '__custom' : id; this.buildGhosts(); };
      return card;
    };
    for (const id of BUILTIN_MAPS) row.append(addCard(id, t(`map_${id}`), t(`map_${id}_desc`)));
    s.append(row);
    // карты из редактора
    const cm = this.a.getCustomMap();
    if (cm) {
      s.append(el('h2', '', t('myMaps')));
      const row2 = el('div', 'row');
      row2.append(addCard('custom', t('map_custom'), t('map_custom_desc'), cm));
      s.append(row2);
    }
    s.append(this._btn(t('back'), 'small', () => this.show('menu')));
    this.show('maps');
  }

  async buildGhosts() {
    // защита от гонки: два быстрых вызова (даблклик по карте) дописывали
    // карточки дважды — доживает только последняя сборка
    const buildId = (this._ghostsBuildId = (this._ghostsBuildId ?? 0) + 1);
    const s = $('screen-ghosts');
    clear(s);
    s.append(el('h2', '', t('chooseGhost')));
    if (this.selectedMap === '__custom') {
      // пользовательская карта: боты синтезируются под неё на месте
      botNames().forEach((name, i) => {
        const card = el('div', 'ghost-card');
        card.append(
          namedDescription(`${t('botOnMap')} · ${t(name)}`),
          el('div', 'gdiff', '★'.repeat(i + 1)),
        );
        card.append(el('div', 'gdesc', t('rewardMult', CUSTOM_BOT_MULTS[i])));
        card.onclick = () => {
          this._rememberPick('__custom', { type: 'custombot', index: i });
          const entry = synthBotForMap(this.a.getCustomMap(), i);
          entry._builtin = true;
          entry._diffMult = CUSTOM_BOT_MULTS[i];
          this.a.startMatch('__custom', entry);
        };
        s.append(card);
      });
      const mine = this.a.getPlayerGhost();
      if (mine && mine.map === '__custom') {
        const card = el('div', 'ghost-card');
        card.append(
          namedDescription(t('yourGhost'), t('yourGhostDesc')),
          el('div', 'gdiff', '👻'),
        );
        card.onclick = () => {
          this._rememberPick('__custom', { type: 'mine' });
          this.a.startMatch('__custom', ownGhostEntry(mine));
        };
        s.append(card);
      }
      s.append(this._btn(t('back'), 'small', () => this.buildMaps()));
      this.show('ghosts');
      return;
    }
    const builtin = await this.ghostsForMap(this.selectedMap);
    if (buildId !== this._ghostsBuildId) return; // пришла более свежая сборка
    builtin.forEach((g, i) => {
      const mult = BUILTIN_MULTS[i];
      const card = el('div', 'ghost-card');
      card.append(
        namedDescription(localizedName('ghost', BUILTIN_GHOSTS[i]),
          `${t(`bot${i + 1}desc`)} · ${t('rewardMult', mult)}`),
        el('div', 'gdiff', '★'.repeat(i + 1)),
      );
      card.onclick = () => {
        this._rememberPick(this.selectedMap, { type: 'builtin', index: i });
        this.a.startMatch(this.selectedMap, { ...g, _builtin: true, _diffMult: mult });
      };
      s.append(card);
    });
    const mine = this.a.getPlayerGhost();
    const card = el('div', 'ghost-card');
    if (mine) {
      card.append(
        namedDescription(t('yourGhost'), t('yourGhostDesc')),
        el('div', 'gdiff', '👻'),
      );
      card.onclick = () => {
        this._rememberPick(mine.map ?? this.selectedMap, { type: 'mine' });
        this.a.startMatch(mine.map ?? this.selectedMap, ownGhostEntry(mine));
      };
    } else {
      card.style.opacity = 0.5;
      card.append(el('div', 'gdesc', t('noGhostYet')));
    }
    s.append(card, this._btn(t('back'), 'small', () => this.buildMaps()));
    this.show('ghosts');
  }

  // ---------- быстрый матч: повтор последнего выбора ----------

  _rememberPick(map, ghost) {
    this.a.settings.lastPick = { map, ghost };
    this.a.saveSettings();
  }

  _quickPickValid() {
    const lp = this.a.settings.lastPick;
    if (!lp || !lp.ghost || (!BUILTIN_MAPS.includes(lp.map) && lp.map !== '__custom')) return false;
    if (lp.ghost.type === 'builtin') {
      return BUILTIN_MAPS.includes(lp.map) && Number.isInteger(lp.ghost.index) && lp.ghost.index >= 0 && lp.ghost.index < 5;
    }
    if (lp.ghost.type === 'custombot') {
      return lp.map === '__custom' && Number.isInteger(lp.ghost.index) && lp.ghost.index >= 0 && lp.ghost.index < 3 &&
        !!this.a.getCustomMap();
    }
    if (lp.ghost.type === 'mine') return !!this.a.getPlayerGhost();
    return false;
  }

  async quickMatch() {
    const lp = this.a.settings.lastPick;
    if (!this._quickPickValid()) return;
    this.selectedMap = lp.map;
    if (lp.ghost.type === 'builtin') {
      const g = (await this.ghostsForMap(lp.map))[lp.ghost.index];
      if (!g) return;
      this.a.startMatch(lp.map, { ...g, _builtin: true, _diffMult: BUILTIN_MULTS[lp.ghost.index] });
    } else if (lp.ghost.type === 'custombot') {
      const entry = synthBotForMap(this.a.getCustomMap(), lp.ghost.index);
      entry._builtin = true;
      entry._diffMult = CUSTOM_BOT_MULTS[lp.ghost.index];
      this.a.startMatch('__custom', entry);
    } else {
      const mine = this.a.getPlayerGhost();
      this.a.startMatch(lp.map, ownGhostEntry(mine));
    }
  }

  buildChallenge(prefill = '') {
    const s = $('screen-challenge');
    clear(s);
    s.append(el('h2', '', t('acceptChallenge')));
    const ta = el('textarea');
    ta.id = 'challenge-input';
    ta.placeholder = t('pasteCode');
    ta.maxLength = VALIDATION_LIMITS.shareCodeChars + 2_048;
    ta.value = typeof prefill === 'string' ? prefill.slice(0, ta.maxLength) : '';
    const status = el('div', 'gdesc', '');
    const fightBtn = this._btn(t('fight'), 'primary', () => {
      const entry = decodeShareCode(ta.value.trim());
      if (!entry) { status.textContent = t('badCode'); return; }
      this.a.startMatch(entry.map ?? 'arena01', entry);
    });
    // вставка из буфера с graceful-фолбэком на ручную вставку в textarea
    const pasteBtn = this._btn(t('pasteClipboard'), 'small', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) ta.value = text.trim();
        else ta.focus();
      } catch { ta.focus(); }
    });
    s.append(ta, el('div', 'row'), pasteBtn, fightBtn, status);
    const mine = this.a.getPlayerGhost();
    if (mine) {
      s.append(this._btn(t('sendChallenge'), '', () => this.shareChallenge(mine)));
    }
    s.append(this._btn(t('back'), 'small', () => this.show('menu')));
    this.show('challenge');
  }

  /** Магазин: баланс госткоинов, паки за Яны (заглушки), скины. */
  async buildShop(statusMsg = '') {
    const buildId = (this._shopBuildId = (this._shopBuildId ?? 0) + 1);
    const s = $('screen-shop');
    const shop = this.a.getShop();
    const wallet = this.a.getWallet();
    clear(s);
    s.append(el('h2', '', t('shop')));
    const balance = el('div', 'bigscore', '👻 ');
    balance.append(el('span', 'me', Math.max(0, Math.round(finiteNumber(wallet?.coins)))));
    s.append(balance);
    // Цена и наличие паков приходят только из SDK catalog.
    let packs = null;
    if (CONFIG.paymentsEnabled) {
      packs = el('div', 'row');
      packs.append(el('div', 'gdesc', translatedOr('paymentLoading', 'Loading products…')));
      s.append(packs);
    }
    // скины: дефолт + магазинные + слот "Свой скин" (редактор)
    const grid = el('div', 'row');
    const items = [
      { id: 'default', name: t('skinDefault'), price: 0, skin: DEFAULT_SKIN_PREVIEW },
      ...shop.skins,
      { id: 'custom', name: t('customSkin'), price: shop.customSkinPrice, skin: null, isCustom: true },
    ];
    for (const item of items) {
      const card = el('div', 'skin-card');
      const owned = wallet.owned.includes(item.id);
      const equipped = (wallet.equipped ?? 'default') === item.id;
      const itemName = item.id === 'default' || item.id === 'custom'
        ? item.name
        : localizedName('skin', item.id);

      // Превью: силуэт призрака в цветах самого скина поверх градиента из его
      // палитры. Четыре цветные точки не давали понять, как скин выглядит.
      const preview = el('div', 'skin-preview');
      const body = item.skin?.body ?? {};
      const torso = safeColor(body.torso, '#2277dd');
      const legs = safeColor(body.legs, '#101820');
      const accent = safeColor(item.skin?.tracer, '#33ddff');
      preview.style.background = item.isCustom
        ? 'conic-gradient(from 210deg, #ff5533, #ffd75e, #33ddff, #a05eff, #ff5533)'
        : `radial-gradient(circle at 50% 120%, ${torso} 0%, ${legs} 70%, #0b0f14 100%)`;
      const figure = el('div', 'skin-figure');
      figure.style.backgroundColor = item.isCustom ? '#ffffff' : safeColor(body.head, '#ffcc88');
      preview.append(figure);
      const stripe = el('div', 'skin-stripe');
      stripe.style.backgroundColor = accent;
      preview.append(stripe);
      // Карточка от генератора, если её уже сгенерировали (tools/gen_skin_cards.mjs).
      const art = el('img', 'skin-art');
      art.alt = '';
      art.src = `assets/skins/${item.id}.jpg`;
      art.onload = () => preview.classList.add('has-art');
      art.onerror = () => art.remove();
      preview.append(art);

      const priceRow = el('div', 'skin-price');
      if (equipped) priceRow.append(el('span', 'skin-state', t('equipped')));
      else if (owned) priceRow.append(el('span', 'skin-state', t('equip')));
      else {
        if (item.isCustom) priceRow.append(el('span', 'skin-lock', '🔒'));
        priceRow.append(el('b', '', item.price), el('span', 'skin-coin', '👻'));
      }

      card.append(preview, el('div', 'skin-name', itemName), priceRow);
      if (item.isCustom) card.append(el('div', 'skin-note', t('customSkinDesc')));
      if (equipped) card.classList.add('selected');
      if (!owned && !equipped && wallet.coins < item.price) card.classList.add('locked');
      card.onclick = async () => {
        if (equipped) return;
        const res = await this.a.buyOrEquipSkin(item);
        this.buildShop(res === 'poor' ? t('notEnoughCoins') : '');
      };
      grid.append(card);
    }
    s.append(grid);
    if (statusMsg) s.append(el('div', 'gdesc', statusMsg));
    s.append(this._btn(t('back'), 'small', () => this.show('menu')));
    this.show('shop');

    if (packs) {
      const catalog = typeof this.a.loadPaymentCatalog === 'function'
        ? await this.a.loadPaymentCatalog() : [];
      if (buildId !== this._shopBuildId) return;
      const error = Platform.consumeLastError?.();
      clear(packs);
      let available = 0;
      if (!error && Array.isArray(catalog)) {
        const byId = new Map(catalog.map(product => [product?.id, product]));
        for (const pack of Array.isArray(shop.packs) ? shop.packs : []) {
          const product = byId.get(pack?.id);
          const grant = CONFIG.coinPackGrants?.[pack?.id];
          if (!product || !Number.isInteger(grant) || grant <= 0 ||
              typeof product.price !== 'string' || !product.price.trim()) continue;
          available++;
          const buy = this._btn(`+${grant} 👻 · ${product.price}`, 'small', async () => {
            buy.disabled = true;
            await this.a.buyCoins(pack);
            const purchaseError = Platform.consumeLastError?.();
            await this.buildShop(purchaseError ? paymentMessage(purchaseError) : '');
          });
          const currencyImage = safeCurrencyImage(product.currencyImage);
          if (currencyImage) {
            const icon = el('img');
            icon.src = currencyImage;
            icon.alt = '';
            icon.width = 20;
            icon.height = 20;
            icon.referrerPolicy = 'no-referrer';
            buy.prepend(icon, document.createTextNode(' '));
          }
          packs.append(buy);
        }
      }
      if (error || available === 0) packs.append(el('div', 'gdesc', error ? t('paymentError') : t('productUnavailable')));
    }
  }

  /** Пауза посреди матча: продолжить / настройки / выход. */
  buildPause() {
    const s = $('screen-pause');
    clear(s);
    s.append(
      el('h2', '', t('pause')),
      this._btn(t('resume'), 'primary', () => this.a.resumeMatch()),
      this._btn(t('settings'), '', () => this.buildSettings(() => this.buildPause())),
      this._btn(t('exitMatch'), '', () => this.a.exitMatch()),
    );
    this.show('pause');
  }

  buildSettings(backFn = null) {
    const s = $('screen-settings');
    const st = this.a.settings;
    clear(s);
    s.append(el('h2', '', t('settings')));
    const row = (label, control) => {
      const r = el('div', 'setting-row');
      r.append(el('div', '', label), control);
      s.append(r);
    };
    row(t('language'), this._toggle(getLang() === 'ru' ? 'RU' : 'EN', () => {
      setLang(getLang() === 'ru' ? 'en' : 'ru');
      st.lang = getLang();
      this.a.saveSettings();
      this.buildSettings(backFn);
    }));
    row(t('fireMode'), this._toggle(st.fireMode === 'auto' ? t('fireAuto') : t('fireBtn'), () => {
      st.fireMode = st.fireMode === 'auto' ? 'button' : 'auto';
      this.a.saveSettings();
      this.buildSettings(backFn);
    }));
    row(t('sound'), this._toggle(st.sound ? t('on') : t('off'), () => {
      st.sound = !st.sound;
      this.a.saveSettings();
      this.buildSettings(backFn);
    }));
    row(t('music'), this._toggle(st.music !== false ? t('on') : t('off'), () => {
      st.music = st.music === false;
      this.a.saveSettings();
      this.buildSettings(backFn);
    }));
    const sens = el('input');
    sens.type = 'range'; sens.min = '0.3'; sens.max = '2.5'; sens.step = '0.1';
    sens.value = st.sensitivity;
    sens.oninput = () => { st.sensitivity = parseFloat(sens.value); this.a.saveSettings(); };
    row(t('sensitivity'), sens);
    s.append(this._btn(t('back'), 'small', () => backFn ? backFn() : this.show('menu')));
    this.show('settings');
  }

  /** Экран между раундами: крупный счёт. Отсчёт рисует HUD. */
  showRoundScreen(playerScore, ghostScore, playerWon) {
    const s = $('screen-round');
    clear(s);
    s.append(
      el('h2', '', playerWon ? t('roundWin') : t('roundLose')),
      scoreDisplay(playerScore, ghostScore),
    );
    this.show('round');
  }

  showMatchScreen(playerScore, ghostScore, accuracy, won, ghostEntry, reward = null, hitStats = null, timing = null) {
    const s = $('screen-match');
    clear(s);
    const safeAccuracy = Math.min(1, Math.max(0, finiteNumber(accuracy)));
    s.append(
      el('h2', '', won ? t('matchWin') : t('matchLose')),
      scoreDisplay(playerScore, ghostScore),
      el('div', '', `${t('accuracy')}: ${Math.round(safeAccuracy * 100)}%`),
    );
    const headshots = Math.max(0, Math.round(finiteNumber(hitStats?.headshots)));
    const bodyshots = Math.max(0, Math.round(finiteNumber(hitStats?.bodyshots)));
    if (headshots + bodyshots > 0) {
      const total = headshots + bodyshots;
      s.append(el('div', '', `${t('headshots')}: ${headshots} (${Math.round(headshots / total * 100)}%)`));
    }
    const ownerTime = durationText(timing?.ownerDurationSec);
    const playerTime = durationText(timing?.playerBestDurationSec);
    if (ownerTime) s.append(el('div', 'gdesc', `${t('ownerTime')}: ${ownerTime}`));
    if (playerTime) s.append(el('div', 'gdesc', `${t('yourBestTime')}: ${playerTime}`));
    if (timing?.beatOwnerTime === true) s.append(el('div', 'gdesc', t('beatOwnerTime')));
    if (reward && Array.isArray(reward.lines)) {
      const box = el('div', 'reward-box');
      for (const line of reward.lines.slice(0, 16)) {
        if (!line || typeof line.key !== 'string' || !Number.isFinite(line.amount)) continue;
        const suffix = typeof line.suffix === 'string' ? line.suffix.slice(0, 24) : '';
        box.append(rewardRow('', `${t(line.key)}${suffix}`, `+${Math.max(0, Math.round(line.amount))}`));
      }
      if (reward.firstWin === true) box.append(rewardRow('bonus', t('rewardFirstWin')));
      const total = Math.max(0, Math.round(finiteNumber(reward.total)));
      box.append(rewardRow('total', t('rewardTotal'), `+${total} 👻`));
      s.append(box);
      if (total > 0 && reward.doubled !== true) {
        const dbl = this._btn(t('rewardDouble') + ' 📺', 'small', async () => {
          if (await this.a.doubleReward()) {
            dbl.remove();
            this.toast(`+${total} 👻`);
          }
        });
        s.append(dbl);
      }
    }
    const row = el('div', 'row');
    const mine = this.a.getPlayerGhost();
    if (won && mine) {
      // главная кнопка виральной петли — вызов другу в один тап
      row.append(this._btn(t('sendChallenge') + ' 👻', 'primary', () => this.shareChallenge(mine)));
      row.append(this._btn(t('playAgain'), '', () => this.a.startMatch(this.selectedMap, ghostEntry)));
      row.append(this._btn(t('ghostCodeBtn'), 'small', () => this.shareCodeOnly(mine)));
    } else {
      row.append(this._btn(t('playAgain'), 'primary', () => this.a.startMatch(this.selectedMap, ghostEntry)));
    }
    if (!won) {
      // rewarded-хук: полный реванш с нового счёта 0:0
      row.append(this._btn(t('rematchAd') + ' 📺', '', () => this.a.rematchRewarded()));
    }
    row.append(this._btn(t('back'), '', () => this.a.exitMatch()));
    s.append(row);
    this.show('match');
  }

  /** Вызов другу: готовый текст со ссылкой по окружению; без ссылки — код. */
  async shareChallenge(entry) {
    const code = encodeShareCode(entry);
    if (!code) { this.toast(t('badCode')); return; }
    const url = this.a.getShareUrl(code);
    let copied;
    if (url) {
      copied = await copyText(t('challengeText', url));
    } else {
      copied = await copyText(code);
    }
    if (copied) {
      this.toast(url ? t('copiedToast') : t('codeCopiedToast'));
    } else {
      this.buildChallenge(code);
      this.toast(translatedOr('copyFailed', 'Automatic copy is unavailable — copy the code manually'));
    }
  }

  /** Только код призрака — для комментариев и площадок без ссылок. */
  async shareCodeOnly(entry) {
    const code = encodeShareCode(entry);
    if (!code) { this.toast(t('badCode')); return; }
    if (await copyText(code)) this.toast(t('codeCopiedToast'));
    else {
      this.buildChallenge(code);
      this.toast(translatedOr('copyFailed', 'Automatic copy is unavailable — copy the code manually'));
    }
  }

  toast(msg) {
    let tdiv = $('toast');
    if (!tdiv) {
      tdiv = el('div');
      tdiv.id = 'toast';
      document.body.append(tdiv);
    }
    tdiv.textContent = msg;
    tdiv.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => tdiv.classList.remove('show'), 2200);
  }

  // ---------- HUD ----------

  setHP(hp) {
    $('hp-value').textContent = Math.max(0, Math.round(hp));
    $('hp-fill').style.width = Math.max(0, hp) + '%';
    $('damage-vignette').style.opacity = hp < 100 ? String(0.2 + (1 - hp / 100) * 0.5) : '0';
  }
  flashDamage() {
    const v = $('damage-vignette');
    v.style.opacity = '1';
    setTimeout(() => this.setHP(this._lastHp ?? 100), 120);
  }
  setWeapon(key) {
    $('weapon-name').textContent = t(key);
    // Силуэт снят с той же GLTF-модели, что игрок держит в руках.
    const silhouette = $('weapon-silhouette');
    const src = `assets/hud/${key}.png`;
    if (silhouette && !silhouette.src.endsWith(src)) silhouette.src = src;
  }

  /** Патроны и полоса перезарядки. Вызывается каждый кадр, поэтому DOM
   *  трогаем только когда что-то реально изменилось. */
  setAmmo(info) {
    const current = Math.max(0, Math.round(finiteNumber(info?.current)));
    const max = Math.max(0, Math.round(finiteNumber(info?.max)));
    const reloading = Boolean(info?.reloading);
    const progress = Math.min(1, Math.max(0, finiteNumber(info?.progress)));
    const prev = this._ammoState;
    if (prev && prev.current === current && prev.max === max && prev.reloading === reloading &&
        (!reloading || Math.abs(prev.progress - progress) < 0.02)) return;
    this._ammoState = { current, max, reloading, progress };

    if (!prev || prev.current !== current) $('ammo-cur').textContent = String(current);
    if (!prev || prev.max !== max) $('ammo-max').textContent = `/${max}`;
    $('ammo').classList.toggle('low', max > 0 && current <= Math.max(1, Math.ceil(max * 0.25)));
    $('reload-note').classList.toggle('hidden', !reloading);
    const reloadButton = $('btn-reload');
    if (reloadButton) reloadButton.classList.toggle('pending', reloading || (max > 0 && current === 0));
    if (!reloading) return;
    if (!prev?.reloading) $('reload-text').textContent = t('reloading');
    $('reload-fill').style.width = `${Math.round(progress * 100)}%`;
  }
  setScore(a, b) { $('score-mini').textContent = `${a} : ${b}`; }
  hitmarker() {
    const h = $('hitmarker');
    h.classList.remove('pop');
    void h.offsetWidth;
    h.classList.add('pop');
  }
  setCharging(on) { $('crosshair').classList.toggle('charging', on); }

  /** Оптика снайперки: перекрестие прицела вместо обычного. */
  setScope(on) {
    if (this._scopeOn === on) return;
    this._scopeOn = on;
    $('scope').classList.toggle('hidden', !on);
    $('crosshair').classList.toggle('hidden', on);
  }
  countdown(n) {
    const c = $('countdown');
    if (n === null) { c.classList.add('hidden'); return; }
    c.classList.remove('hidden');
    c.textContent = n > 0 ? n : 'GO';
  }
  banner(text) {
    const b = $('round-banner');
    if (!text) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.textContent = text;
  }

  /** @param icon — имя файла из assets/icons без расширения. */
  _btn(label, cls, onClick, icon = null) {
    const b = el('button', 'btn ' + (cls ?? ''));
    if (icon) {
      const img = el('img', 'icon');
      img.src = `assets/icons/${icon}.png`;
      img.alt = '';
      b.append(img);
    }
    b.append(el('span', '', label));
    b.onclick = onClick;
    return b;
  }
  _toggle(label, onClick) {
    const b = el('button', 'btn small', label);
    b.onclick = onClick;
    return b;
  }
}

// ---------- шеринг: обёртка призрака → LZ-string код ----------

/** Копирование с фолбэком для окружений без clipboard API (iframe и т.п.). */
async function copyText(text) {
  if (typeof text !== 'string' || !text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    try { return document.execCommand('copy') === true; }
    catch { return false; }
    finally { ta.remove(); }
  }
}

export function encodeShareCode(entry) {
  const checked = validateShareEntry(entry);
  if (!checked.ok) return '';
  const code = LZString.compressToEncodedURIComponent(JSON.stringify(checked.value));
  return code.length <= VALIDATION_LIMITS.shareCodeChars ? code : '';
}

export function decodeShareCodeDetailed(input) {
  if (typeof input !== 'string') return { ok: false, code: 'bad_share_input' };
  try {
    // Разрешаем вставить и целый URL. Общий cap проверяется до распаковки.
    let code = input.trim();
    if (!code || code.length > VALIDATION_LIMITS.shareCodeChars + 2_048) {
      return { ok: false, code: 'bad_share_size' };
    }
    const m = code.match(/[?&](?:ghost|payload)=([^&#\s]+)/);
    if (m) code = decodeURIComponent(m[1]);
    if (!code || code.length > VALIDATION_LIMITS.shareCodeChars) {
      return { ok: false, code: 'bad_share_size' };
    }
    const json = decompressURIComponentBounded(code, VALIDATION_LIMITS.shareJsonChars);
    if (typeof json !== 'string' || !json) {
      return { ok: false, code: 'bad_share_json' };
    }
    return validateShareEntry(JSON.parse(json));
  } catch {
    return { ok: false, code: 'bad_share_parse' };
  }
}

export function decodeShareCode(code) {
  const checked = decodeShareCodeDetailed(code);
  return checked.ok ? checked.value : null;
}
