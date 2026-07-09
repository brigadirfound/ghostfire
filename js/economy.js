// Экономика матча: расчёт награды в госткоинах.
// Награда ТОЛЬКО за завершённый матч. Анти-абьюз: бонусы за одного и того же
// призрака друга — не чаще 3 раз в день (по хешу записи).

export const BASE_REWARD = 8;
export const WIN_REWARD = 25;
export const SWEEP_BONUS = 15;
export const FRIEND_BONUS = 40;
export const FRIEND_DAILY_LIMIT = 3;

/** Быстрый хеш записи призрака — ключ анти-абьюза. */
export function ghostHash(data) {
  let h = 5381;
  for (let i = 0; i < data.length; i += 7) h = ((h * 33) ^ data.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + data.length;
}

export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Расчёт награды. entry._builtin — встроенный бот, entry._diffMult — множитель
 * сложности (1/1.5/2/2.5/3). Не мутирует кошелёк.
 * @returns { lines: [{key, amount, suffix?}], total, firstWin, hash, isFriend, limited }
 */
export function computeMatchReward(won, foeScore, entry, wallet) {
  const lines = [{ key: 'rewardBase', amount: BASE_REWARD }];
  const today = localDate();
  const hash = ghostHash(entry.data ?? '');
  const isFriend = !entry._builtin;
  let limited = false;

  if (won) {
    if (isFriend) {
      const gr = wallet.ghostRewards;
      const count = (gr && gr.date === today && gr.counts[hash]) || 0;
      limited = count >= FRIEND_DAILY_LIMIT;
    }
    if (limited) {
      lines.push({ key: 'rewardLimit', amount: 0 });
    } else {
      const mult = entry._diffMult ?? 1;
      lines.push({ key: 'rewardWin', amount: Math.round(WIN_REWARD * mult), suffix: mult !== 1 ? ` ×${mult}` : '' });
      if (foeScore === 0) lines.push({ key: 'rewardSweep', amount: SWEEP_BONUS });
      if (isFriend) lines.push({ key: 'rewardFriend', amount: FRIEND_BONUS });
    }
  }

  let total = lines.reduce((s, l) => s + l.amount, 0);
  let firstWin = false;
  if (won && !limited && wallet.lastWinDate !== today) {
    firstWin = true;
    total *= 2; // первая победа дня — ×2 на всю награду матча
  }
  return { lines, total, firstWin, hash, isFriend, limited, doubled: false };
}

/** Начисляет награду и обновляет счётчики анти-абьюза/даты в кошельке. */
export function applyMatchReward(wallet, reward, won) {
  const today = localDate();
  wallet.coins += reward.total;
  if (won && !reward.limited) {
    wallet.lastWinDate = today;
    if (reward.isFriend) {
      if (!wallet.ghostRewards || wallet.ghostRewards.date !== today) {
        wallet.ghostRewards = { date: today, counts: {} };
      }
      wallet.ghostRewards.counts[reward.hash] = (wallet.ghostRewards.counts[reward.hash] ?? 0) + 1;
    }
  }
}
