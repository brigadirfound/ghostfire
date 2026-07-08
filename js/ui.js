// UI: меню, выбор карты/призрака, настройки, межраундовый и финальный экраны,
// HUD, шеринг призрака через LZ-string.
import LZString from 'lz-string';
import { t, setLang, getLang } from './i18n.js';

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
    this.screens = ['menu', 'maps', 'ghosts', 'challenge', 'settings', 'pause', 'round', 'match'];
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
      this._btn(t('settings'), '', () => this.buildSettings()),
    );
    this.show('menu');
  }

  buildMaps() {
    const s = $('screen-maps');
    s.innerHTML = '';
    s.append(el('h2', '', t('chooseMap')));
    const row = el('div', 'row');
    for (const id of ['arena01', 'arena02']) {
      const card = el('div', 'map-card' + (id === this.selectedMap ? ' selected' : ''));
      card.append(el('div', 'map-name', t(`map_${id}`)), el('div', 'map-desc', t(`map_${id}_desc`)));
      card.onclick = () => { this.selectedMap = id; this.buildGhosts(); };
      row.append(card);
    }
    s.append(row, this._btn(t('back'), 'small', () => this.show('menu')));
    this.show('maps');
  }

  buildGhosts() {
    const s = $('screen-ghosts');
    s.innerHTML = '';
    s.append(el('h2', '', t('chooseGhost')));
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
