// Экономика матча: расчёт награды в госткоинах.
// Награда ТОЛЬКО за завершённый матч. Анти-абьюз: бонусы за одного и того же
// призрака друга — не чаще 3 раз в день (по хешу записи).

// Калибровка: первый скин магазина должен стоить 30–60 минут игры, а не
// пары матчей. Проверяется симуляцией — node tools/sim_economy.mjs.
export const BASE_REWARD = 8;
export const WIN_REWARD = 8;
export const SWEEP_BONUS = 4;
export const FRIEND_BONUS = 12;
export const FRIEND_DAILY_LIMIT = 3;

// Множители награды по сложности. Единственный источник и для UI, и для
// allow-list: раньше эти списки жили в трёх файлах независимо.
export const BUILTIN_MULTS = Object.freeze([1, 1.25, 1.5, 1.75, 2]);
export const CUSTOM_BOT_MULTS = Object.freeze([1, 1.5, 2]);
const ALLOWED_MULTS = new Set([...BUILTIN_MULTS, ...CUSTOM_BOT_MULTS]);
const MAX_WALLET_COINS = 1_000_000_000;

// Правила и темп матча. Награда выдаётся за матч, поэтому симулятор экономики
// (tools/sim_economy.mjs) считает время по этим же константам, что и игра.
export const WINS_TO_TAKE_MATCH = 5;
export const ROUND_COUNTDOWN_SEC = 3;    // отсчёт перед раундом
export const ROUND_TEARDOWN_SEC = 1.1;   // разлёт кубиков после смерти
export const ROUND_SCREEN_SEC = 2;       // межраундовый экран со счётом

/**
 * Полный двойной 32-bit хеш записи. Это не серверная защита от читов, но в
 * отличие от старой выборки каждого 7-го символа не даёт тривиальных коллизий.
 */
export function ghostHash(data) {
  const value = typeof data === 'string' ? data : '';
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + ':' + value.length;
}

/**
 * Календарная дата игрока: время берём доверенное (serverTime платформы),
 * а границу суток — по часовому поясу устройства, иначе «первая победа дня»
 * сбрасывалась бы в 03:00 МСК. Подкрутка пояса даёт максимум одну лишнюю дату:
 * даты сравниваются только вперёд (см. isNewDay).
 */
export function localDate(nowMs = Date.now(), tzOffsetMinutes = undefined) {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const rawOffset = Number.isFinite(tzOffsetMinutes)
    ? tzOffsetMinutes
    : new Date(safeNow).getTimezoneOffset();
  const offset = Math.max(-840, Math.min(840, Math.trunc(rawOffset)));
  const d = new Date(safeNow - offset * 60_000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** ISO-даты сравнимы лексикографически. Часы «назад» новый день не открывают. */
export function isNewDay(today, storedDate) {
  return typeof storedDate !== 'string' || !storedDate || storedDate < today;
}

/**
 * Расчёт награды. entry._builtin — встроенный бот, entry._diffMult — множитель
 * сложности из BUILTIN_MULTS/CUSTOM_BOT_MULTS. Не мутирует кошелёк.
 * @returns { lines: [{key, amount, suffix?}], total, firstWin, hash, isFriend, limited }
 */
export function computeMatchReward(won, foeScore, entry, wallet, nowMs = Date.now()) {
  const lines = [{ key: 'rewardBase', amount: BASE_REWARD }];
  const today = localDate(nowMs);
  const hash = ghostHash(entry?.data ?? '');
  // _builtin появляется только у записей, загруженных самой игрой. Share decoder
  // удаляет это поле. Даже для внутренней записи множитель проходит allow-list.
  const isBuiltin = entry?._builtin === true;
  // UI adds this marker only after loading the player's own validated save.
  // Share validation drops it, so an incoming challenge cannot self-classify.
  const isSelf = entry?._rewardClass === 'self';
  const isFriend = !isBuiltin && !isSelf;
  let limited = false;

  if (won) {
    if (isFriend) {
      // Счётчик действует, пока его дата не в прошлом: перевод часов назад
      // не обнуляет дневной лимит.
      const gr = wallet.ghostRewards;
      const active = gr && !isNewDay(today, gr.date);
      const count = active && gr.counts && Number.isFinite(gr.counts[hash]) ? gr.counts[hash] : 0;
      limited = count >= FRIEND_DAILY_LIMIT;
    }
    const requestedMult = Number(entry?._diffMult);
    const mult = isBuiltin && ALLOWED_MULTS.has(requestedMult) ? requestedMult : 1;
    lines.push({ key: 'rewardWin', amount: Math.round(WIN_REWARD * mult), suffix: mult !== 1 ? ` ×${mult}` : '' });
    if (foeScore === 0) lines.push({ key: 'rewardSweep', amount: SWEEP_BONUS });
    if (isFriend && limited) lines.push({ key: 'rewardLimit', amount: 0 });
    else if (isFriend) lines.push({ key: 'rewardFriend', amount: FRIEND_BONUS });
  }

  let total = lines.reduce((s, l) => s + l.amount, 0);
  let firstWin = false;
  if (won && isNewDay(today, wallet.lastWinDate)) {
    firstWin = true;
    total *= 2; // первая победа дня — ×2 на всю награду матча
  }
  return { lines, total, firstWin, hash, isFriend, limited, doubled: false };
}

/** Начисляет награду и обновляет счётчики анти-абьюза/даты в кошельке. */
export function applyMatchReward(wallet, reward, won, nowMs = Date.now()) {
  const today = localDate(nowMs);
  const current = Number.isFinite(wallet.coins) ? wallet.coins : 0;
  const amount = Number.isFinite(reward?.total) ? Math.max(0, Math.round(reward.total)) : 0;
  wallet.coins = Math.min(MAX_WALLET_COINS, current + amount);
  if (won) {
    // Дата победы двигается только вперёд, иначе перевод часов назад
    // выдавал бы «первую победу дня» ×2 повторно.
    if (isNewDay(today, wallet.lastWinDate)) wallet.lastWinDate = today;
    if (reward.isFriend && !reward.limited) {
      if (!wallet.ghostRewards || isNewDay(today, wallet.ghostRewards.date)) {
        wallet.ghostRewards = { date: today, counts: {} };
      }
      wallet.ghostRewards.counts[reward.hash] = (wallet.ghostRewards.counts[reward.hash] ?? 0) + 1;
    }
  }
}
