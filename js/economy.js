// Экономика матча: расчёт награды в госткоинах.
// Награда ТОЛЬКО за завершённый матч. Анти-абьюз: бонусы за одного и того же
// призрака друга — не чаще 3 раз в день (по хешу записи).

export const BASE_REWARD = 8;
export const WIN_REWARD = 25;
export const SWEEP_BONUS = 15;
export const FRIEND_BONUS = 40;
export const FRIEND_DAILY_LIMIT = 3;
const BUILTIN_MULTS = new Set([1, 1.5, 2, 2.5, 3]);
const MAX_WALLET_COINS = 1_000_000_000;

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

export function localDate(nowMs = Date.now()) {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const d = new Date(safeNow);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Расчёт награды. entry._builtin — встроенный бот, entry._diffMult — множитель
 * сложности (1/1.5/2/2.5/3). Не мутирует кошелёк.
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
      const gr = wallet.ghostRewards;
      const count = (gr && gr.date === today && gr.counts && Number.isFinite(gr.counts[hash]))
        ? gr.counts[hash] : 0;
      limited = count >= FRIEND_DAILY_LIMIT;
    }
    const requestedMult = Number(entry?._diffMult);
    const mult = isBuiltin && BUILTIN_MULTS.has(requestedMult) ? requestedMult : 1;
    lines.push({ key: 'rewardWin', amount: Math.round(WIN_REWARD * mult), suffix: mult !== 1 ? ` ×${mult}` : '' });
    if (foeScore === 0) lines.push({ key: 'rewardSweep', amount: SWEEP_BONUS });
    if (isFriend && limited) lines.push({ key: 'rewardLimit', amount: 0 });
    else if (isFriend) lines.push({ key: 'rewardFriend', amount: FRIEND_BONUS });
  }

  let total = lines.reduce((s, l) => s + l.amount, 0);
  let firstWin = false;
  if (won && wallet.lastWinDate !== today) {
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
    wallet.lastWinDate = today;
    if (reward.isFriend && !reward.limited) {
      if (!wallet.ghostRewards || wallet.ghostRewards.date !== today) {
        wallet.ghostRewards = { date: today, counts: {} };
      }
      wallet.ghostRewards.counts[reward.hash] = (wallet.ghostRewards.counts[reward.hash] ?? 0) + 1;
    }
  }
}
