// UI: меню, выбор карты/призрака, настройки, межраундовый и финальный экраны,
// HUD, шеринг призрака через LZ-string.
import LZString from 'lz-string';
import { t, setLang, getLang } from './i18n.js';
import { synthBotForMap, botNames } from './botgen.js';

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
    this.builtinGhosts = [];   // [{name, wrapper}]
  }

  async loadBuiltinGhosts() {
    for (let i = 1; i <= 5; i++) {
      try {
        const res = await fetch(`ghosts/ghost${i}.json`);
        if (res.ok) this.builtinGhosts.push(await res.json());
      } catch { /* нет файла — пропускаем */ }
    }
  }

  show(name) {
    for (const s of this.screens) $(`screen-${s}`).classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', name !== null);
  }

  hideAll() {
    for (const s of this.screens) $(`screen-${s}`).classList.add('hidden');
    $('hud').classList.remove('hidden');
  }

  // ---------- экраны ----------

  buildMenu() {
    const s = $('screen-menu');
    s.innerHTML = '';
    s.append(
      el('div', 'logo', 'GHOST<span>FIRE</span>'),
      el('div', 'subtitle', '1v1 · voxel duel'),
    );
    s.append(
      this._btn(t('play'), 'primary', () => this.buildMaps()),
      this._btn(t('challenges'), '', () => this.buildChallenge()),
      this._btn(t('shop') + ' 👻', '', () => this.buildShop()),
      this._btn(t('editor'), '', () => { location.href = 'editor.html'; }),
      this._btn(t('settings'), '', () => this.buildSettings()),
    );
    this.show('menu');
  }

  buildMaps() {
    const s = $('screen-maps');
    s.innerHTML = '';
    s.append(el('h2', '', t('chooseMap')));
    const row = el('div', 'row');
    const ids = ['arena01', 'arena02'];
    if (this.a.getCustomMap()) ids.push('custom');
    for (const id of ids) {
      const card = el('div', 'map-card' + (id === this.selectedMap ? ' selected' : ''));
      card.append(el('div', 'map-name', t(`map_${id}`)), el('div', 'map-desc', t(`map_${id}_desc`)));
      card.onclick = () => { this.selectedMap = id === 'custom' ? '__custom' : id; this.buildGhosts(); };
      row.append(card);
    }
    s.append(row, this._btn(t('back'), 'small', () => this.show('menu')));
    this.show('maps');
  }

  buildGhosts() {
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
        card.onclick = () => {
          const entry = synthBotForMap(this.a.getCustomMap(), i);
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
        card.onclick = () => this.a.startMatch('__custom', mine);
        s.append(card);
      }
      s.append(this._btn(t('back'), 'small', () => this.buildMaps()));
      this.show('ghosts');
      return;
    }
    this.builtinGhosts.forEach((g, i) => {
      const card = el('div', 'ghost-card');
      card.append(
        el('div', '', `<div class="gname">${t('bot')} ${i + 1} · ${g.name}</div>`),
        el('div', 'gdiff', '★'.repeat(i + 1)),
      );
      card.onclick = () => this.a.startMatch(this.selectedMap, g);
      s.append(card);
    });
    const mine = this.a.getPlayerGhost();
    const card = el('div', 'ghost-card');
    if (mine) {
      card.append(
        el('div', '', `<div class="gname">${t('yourGhost')}</div><div class="gdesc">${t('yourGhostDesc')}</div>`),
        el('div', 'gdiff', '👻'),
      );
      card.onclick = () => this.a.startMatch(mine.map ?? this.selectedMap, mine);
    } else {
      card.style.opacity = 0.5;
      card.append(el('div', 'gdesc', t('noGhostYet')));
    }
    s.append(card, this._btn(t('back'), 'small', () => this.buildMaps()));
    this.show('ghosts');
  }

  buildChallenge(prefill = '') {
    const s = $('screen-challenge');
    s.innerHTML = '';
    s.append(el('h2', '', t('challenges')));
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
    s.append(ta, fightBtn, status);
    const mine = this.a.getPlayerGhost();
    if (mine) {
      s.append(this._btn(t('inviteFriend'), '', async () => {
        await this.shareGhost(mine, mine.score ?? '5:0');
        status.textContent = t('copied');
      }));
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
    // паки коинов за Яны (заглушка Яндекс Payments)
    const packs = el('div', 'row');
    for (const p of shop.packs) {
      packs.append(this._btn(`+${p.coins} 👻 · ${p.priceYan} ${t('yan')}`, 'small', async () => {
        await this.a.buyCoins(p);
        this.buildShop();
      }));
    }
    s.append(packs);
    // скины
    const grid = el('div', 'row');
    const dot = (c) => `<span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:${c};margin-right:4px;vertical-align:middle"></span>`;
    const items = [{ id: 'default', name: t('skinDefault'), price: 0, skin: null }, ...shop.skins];
    for (const item of items) {
      const card = el('div', 'map-card');
      const sk = item.skin;
      const dots = sk
        ? dot(sk.body.head) + dot(sk.body.torso) + dot(sk.weapons.railgun.accent) + dot(sk.tracer)
        : dot('#ffcc88') + dot('#2277dd') + dot('#33ddff') + dot('#ffdd55');
      const owned = wallet.owned.includes(item.id);
      const equipped = (wallet.equipped ?? 'default') === item.id;
      const state = equipped ? t('equipped') : owned ? t('equip') : `${item.price} 👻`;
      card.append(
        el('div', 'map-name', item.name),
        el('div', '', dots),
        el('div', 'map-desc', state),
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

  showMatchScreen(playerScore, ghostScore, accuracy, won, ghostEntry) {
    const s = $('screen-match');
    s.innerHTML = '';
    s.append(
      el('h2', '', won ? t('matchWin') : t('matchLose')),
      el('div', 'bigscore', `<span class="me">${playerScore}</span> : <span class="foe">${ghostScore}</span>`),
      el('div', '', `${t('accuracy')}: ${Math.round(accuracy * 100)}%`),
    );
    const status = el('div', 'gdesc', '');
    const row = el('div', 'row');
    row.append(this._btn(t('playAgain'), 'primary', () => this.a.startMatch(this.selectedMap, ghostEntry)));
    const mine = this.a.getPlayerGhost();
    if (won && mine) {
      row.append(this._btn(t('inviteFriend'), '', async () => {
        await this.shareGhost(mine, `${playerScore}:${ghostScore}`);
        status.textContent = t('copied');
      }));
    }
    if (!won) {
      // rewarded-хук: реванш с того же счёта
      row.append(this._btn(t('rematchAd') + ' 📺', '', () => this.a.rematchRewarded()));
    }
    row.append(this._btn(t('back'), '', () => this.show('menu')));
    s.append(row, status);
    this.show('match');
  }

  async shareGhost(entry, score) {
    const code = encodeShareCode(entry);
    const url = `${location.origin}${location.pathname}?ghost=${code}`;
    const text = t('shareText', score, url);
    try { await navigator.clipboard.writeText(text); }
    catch { window.prompt('Copy:', text); }
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
