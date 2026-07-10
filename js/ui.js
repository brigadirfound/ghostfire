// UI: меню, выбор карты/призрака, настройки, межраундовый и финальный экраны,
// HUD, шеринг призрака через LZ-string.
import LZString from 'lz-string';
import { t, setLang, getLang } from './i18n.js';
import { synthBotForMap, botNames } from './botgen.js';
import { mapPreviewURL } from './mappreview.js';
import { CONFIG } from './config.js';

const BUILTIN_MAPS = ['arena01', 'arena02', 'arena03', 'arena04', 'arena05'];

const BUILTIN_MULTS = [1, 1.5, 2, 2.5, 3]; // множители награды по сложности

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class UI {
  /**
   * @param {*} actions { startMatch(mapId, ghostEntry), settings, saveSettings(),
   *                      getPlayerGhost(), rematchRewarded() }
   */
  constructor(actions) {
    this.a = actions;
    this.screens = ['menu', 'maps', 'ghosts', 'challenge', 'shop', 'settings', 'pause', 'round', 'match'];
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
          if (res.ok) list.push(await res.json());
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
    s.innerHTML = '';
    s.append(
      el('div', 'logo', 'GHOST<span>FIRE</span>'),
      el('div', 'subtitle', '1v1 · voxel duel'),
    );
    // "Быстрый матч" повторяет последний выбор карта+противник в один тап
    if (this._quickPickValid()) {
      s.append(this._btn(t('quickMatch') + ' ⚡', 'primary', () => this.quickMatch()));
    }
    s.append(
      this._btn(t('play'), this._quickPickValid() ? '' : 'primary', () => {
        // первый запуск — туториал вместо выбора карты
        if (this.a.shouldTutorial()) this.a.startTutorial();
        else this.buildMaps();
      }),
      this._btn(t('haveCode'), '', () => this.buildChallenge()),
      this._btn(t('shop') + ' 👻', '', () => this.buildShop()),
      this._btn(t('editor'), '', () => { location.href = 'editor.html'; }),
      this._btn(t('settings'), '', () => this.buildSettings()),
    );
    this.show('menu');
    this._inBuildMenu = false;
  }

  buildMaps() {
    const s = $('screen-maps');
    s.innerHTML = '';
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
    s.innerHTML = '';
    s.append(el('h2', '', t('chooseGhost')));
    if (this.selectedMap === '__custom') {
      // пользовательская карта: боты синтезируются под неё на месте
      botNames().forEach((name, i) => {
        const card = el('div', 'ghost-card');
        card.append(
          el('div', '', `<div class="gname">${t('botOnMap')} · ${name}</div>`),
          el('div', 'gdiff', '★'.repeat(i + 1)),
        );
        card.append(el('div', 'gdesc', t('rewardMult', [1, 2, 3][i])));
        card.onclick = () => {
          this._rememberPick('__custom', { type: 'custombot', index: i });
          const entry = synthBotForMap(this.a.getCustomMap(), i);
          entry._builtin = true;
          entry._diffMult = [1, 2, 3][i];
          this.a.startMatch('__custom', entry);
        };
        s.append(card);
      });
      const mine = this.a.getPlayerGhost();
      if (mine && mine.map === '__custom') {
        const card = el('div', 'ghost-card');
        card.append(
          el('div', '', `<div class="gname">${t('yourGhost')}</div><div class="gdesc">${t('yourGhostDesc')}</div>`),
          el('div', 'gdiff', '👻'),
        );
        card.onclick = () => {
          this._rememberPick('__custom', { type: 'mine' });
          this.a.startMatch('__custom', mine);
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
        el('div', '', `<div class="gname">${g.name}</div>` +
          `<div class="gdesc">${t(`bot${i + 1}desc`)} · ${t('rewardMult', mult)}</div>`),
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
        el('div', '', `<div class="gname">${t('yourGhost')}</div><div class="gdesc">${t('yourGhostDesc')}</div>`),
        el('div', 'gdiff', '👻'),
      );
      card.onclick = () => {
        this._rememberPick(mine.map ?? this.selectedMap, { type: 'mine' });
        this.a.startMatch(mine.map ?? this.selectedMap, mine);
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
    if (!lp) return false;
    if (lp.ghost.type === 'builtin') return lp.ghost.index >= 0 && lp.ghost.index < 5;
    if (lp.ghost.type === 'custombot') return !!this.a.getCustomMap();
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
      entry._diffMult = [1, 2, 3][lp.ghost.index];
      this.a.startMatch('__custom', entry);
    } else {
      const mine = this.a.getPlayerGhost();
      this.a.startMatch(lp.map, mine);
    }
  }

  buildChallenge(prefill = '') {
    const s = $('screen-challenge');
    s.innerHTML = '';
    s.append(el('h2', '', t('acceptChallenge')));
    const ta = el('textarea');
    ta.id = 'challenge-input';
    ta.placeholder = t('pasteCode');
    ta.value = prefill;
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
    const s = $('screen-shop');
    const shop = this.a.getShop();
    const wallet = this.a.getWallet();
    s.innerHTML = '';
    s.append(el('h2', '', t('shop')));
    s.append(el('div', 'bigscore', `👻 <span class="me">${wallet.coins}</span>`));
    // паки коинов за Яны — скрыты, пока товары не заведены в консоли
    if (CONFIG.paymentsEnabled) {
      const packs = el('div', 'row');
      for (const p of shop.packs) {
        packs.append(this._btn(`+${p.coins} 👻 · ${p.priceYan} ${t('yan')}`, 'small', async () => {
          await this.a.buyCoins(p);
          this.buildShop();
        }));
      }
      s.append(packs);
    }
    // скины: дефолт + магазинные + слот "Свой скин" (редактор)
    const grid = el('div', 'row');
    const dot = (c) => `<span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:${c};margin-right:4px;vertical-align:middle"></span>`;
    const items = [
      { id: 'default', name: t('skinDefault'), price: 0, skin: null },
      ...shop.skins,
      { id: 'custom', name: t('customSkin'), price: 300, skin: null, isCustom: true },
    ];
    for (const item of items) {
      const card = el('div', 'map-card');
      const sk = item.skin;
      const dots = item.isCustom ? '🎨✏️👻'
        : sk
          ? dot(sk.body.head) + dot(sk.body.torso) + dot(sk.weapons.railgun.accent) + dot(sk.tracer)
          : dot('#ffcc88') + dot('#2277dd') + dot('#33ddff') + dot('#ffdd55');
      const owned = wallet.owned.includes(item.id);
      const equipped = (wallet.equipped ?? 'default') === item.id;
      const state = equipped ? t('equipped') : owned ? t('equip') : `${owned ? '' : item.isCustom ? '🔒 ' : ''}${item.price} 👻`;
      card.append(
        el('div', 'map-name', item.name),
        el('div', '', dots),
        el('div', 'map-desc', state + (item.isCustom ? `<br>${t('customSkinDesc')}` : '')),
      );
      if (equipped) card.classList.add('selected');
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
  }

  /** Пауза посреди матча: продолжить / настройки / выход. */
  buildPause() {
    const s = $('screen-pause');
    s.innerHTML = '';
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
    s.innerHTML = '';
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
    s.innerHTML = '';
    s.append(
      el('h2', '', playerWon ? t('roundWin') : t('roundLose')),
      el('div', 'bigscore', `<span class="me">${playerScore}</span> : <span class="foe">${ghostScore}</span>`),
    );
    this.show('round');
  }

  showMatchScreen(playerScore, ghostScore, accuracy, won, ghostEntry, reward = null) {
    const s = $('screen-match');
    s.innerHTML = '';
    s.append(
      el('h2', '', won ? t('matchWin') : t('matchLose')),
      el('div', 'bigscore', `<span class="me">${playerScore}</span> : <span class="foe">${ghostScore}</span>`),
      el('div', '', `${t('accuracy')}: ${Math.round(accuracy * 100)}%`),
    );
    // разбивка награды за матч
    if (reward) {
      const box = el('div', 'reward-box');
      for (const l of reward.lines) {
        box.append(el('div', 'reward-row',
          `<span>${t(l.key)}${l.suffix ?? ''}</span><b>+${l.amount}</b>`));
      }
      if (reward.firstWin) {
        box.append(el('div', 'reward-row bonus', `<span>${t('rewardFirstWin')}</span><b></b>`));
      }
      box.append(el('div', 'reward-row total',
        `<span>${t('rewardTotal')}</span><b>+${reward.total} 👻</b>`));
      s.append(box);
      if (reward.total > 0 && !reward.doubled) {
        const dbl = this._btn(t('rewardDouble') + ' 📺', 'small', async () => {
          if (await this.a.doubleReward()) {
            dbl.remove();
            this.toast(`+${reward.total} 👻`);
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
      // rewarded-хук: реванш с того же счёта
      row.append(this._btn(t('rematchAd') + ' 📺', '', () => this.a.rematchRewarded()));
    }
    row.append(this._btn(t('back'), '', () => this.show('menu')));
    s.append(row);
    this.show('match');
  }

  /** Вызов другу: готовый текст со ссылкой по окружению; без ссылки — код. */
  async shareChallenge(entry) {
    const code = encodeShareCode(entry);
    const url = this.a.getShareUrl(code);
    if (url) {
      await copyText(t('challengeText', url));
      this.toast(t('copiedToast'));
    } else {
      await copyText(code);
      this.toast(t('codeCopiedToast'));
    }
  }

  /** Только код призрака — для комментариев и площадок без ссылок. */
  async shareCodeOnly(entry) {
    await copyText(encodeShareCode(entry));
    this.toast(t('codeCopiedToast'));
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
    $('hp-num').textContent = Math.max(0, Math.round(hp));
    $('hp-fill').style.width = Math.max(0, hp) + '%';
    $('damage-vignette').style.opacity = hp < 100 ? String(0.2 + (1 - hp / 100) * 0.5) : '0';
  }
  flashDamage() {
    const v = $('damage-vignette');
    v.style.opacity = '1';
    setTimeout(() => this.setHP(this._lastHp ?? 100), 120);
  }
  setWeapon(key) { $('weapon-label').textContent = t(key); }
  setScore(a, b) { $('score-mini').textContent = `${a} : ${b}`; }
  hitmarker() {
    const h = $('hitmarker');
    h.classList.remove('pop');
    void h.offsetWidth;
    h.classList.add('pop');
  }
  setCharging(on) { $('crosshair').classList.toggle('charging', on); }
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

  _btn(label, cls, onClick) {
    const b = el('button', 'btn ' + (cls ?? ''), label);
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
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* совсем нечем */ }
    ta.remove();
    return true;
  }
}

export function encodeShareCode(entry) {
  return LZString.compressToEncodedURIComponent(JSON.stringify(entry));
}

export function decodeShareCode(code) {
  try {
    // разрешаем вставить и целый URL с ?ghost=
    const m = code.match(/[?&]ghost=([^&\s]+)/);
    if (m) code = m[1];
    const json = LZString.decompressFromEncodedURIComponent(code);
    const entry = JSON.parse(json);
    if (!entry || typeof entry.data !== 'string') return null;
    return entry;
  } catch {
    return null;
  }
}
