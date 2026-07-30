// Симуляция экономики: сколько реального времени игрок тратит до первого скина
// и до полной коллекции. Награда считается настоящими функциями js/economy.js,
// цены читаются из skins/shop.json — расхождение кода и данных исключено.
//
// Запуск: node tools/sim_economy.mjs [--matches=N] [--seed=строка]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSeededRandom } from './lib/prng.mjs';
import {
  computeMatchReward,
  applyMatchReward,
  WINS_TO_TAKE_MATCH,
  ROUND_COUNTDOWN_SEC,
  ROUND_TEARDOWN_SEC,
  ROUND_SCREEN_SEC,
} from '../js/economy.js';
import { normalizeWallet } from '../js/validation.js';

// Экран результата, выбор соперника и загрузка арены между матчами. Это не
// игровая константа, а допущение симуляции — держим его явным.
const MATCH_OVERHEAD_SEC = 20;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shop = JSON.parse(readFileSync(resolve(ROOT, 'skins/shop.json'), 'utf8'));
const PRICES = shop.skins.map(s => s.price).sort((a, b) => a - b);

// Профили — не «идеальный игрок», а три реальных манеры игры. roundWinRate
// измеряется в раундах: матч идёт до 5 побед, поэтому серия из них выводится.
// activeRoundSec — сколько длится сам раунд до чьей-то смерти (запись призрака
// обрывается на 45 с, значит это верхняя граница).
export const PROFILES = [
  { id: 'newbie', label: 'новичок, лёгкий бот', diffMult: 1, roundWinRate: 0.42, activeRoundSec: 22 },
  { id: 'casual', label: 'средний, бот d2–d3', diffMult: 1.5, roundWinRate: 0.52, activeRoundSec: 17 },
  { id: 'regular', label: 'уверенный, бот d3–d4', diffMult: 2, roundWinRate: 0.58, activeRoundSec: 15 },
  { id: 'strong', label: 'сильный, бот d5', diffMult: 3, roundWinRate: 0.66, activeRoundSec: 12 },
];

/** Одна серия до WINS_TO_TAKE_MATCH побед. Возвращает счёт и длительность. */
function playMatch(rand, profile) {
  let me = 0, foe = 0, rounds = 0;
  while (me < WINS_TO_TAKE_MATCH && foe < WINS_TO_TAKE_MATCH) {
    rounds++;
    if (rand() < profile.roundWinRate) me++; else foe++;
  }
  const perRound = profile.activeRoundSec + ROUND_COUNTDOWN_SEC + ROUND_TEARDOWN_SEC;
  const seconds = rounds * perRound + (rounds - 1) * ROUND_SCREEN_SEC + MATCH_OVERHEAD_SEC;
  return { me, foe, rounds, seconds, won: me >= WINS_TO_TAKE_MATCH };
}

/**
 * Прогон одного профиля. Игрок бьёт встроенных ботов (isFriend=false), реклама
 * не смотрится — это нижняя граница дохода, «удвоить награду» ускоряет вдвое.
 */
export function simulate(profile, { matches = 400, seed = 'ghostfire' } = {}) {
  const rand = createSeededRandom(`${seed}:${profile.id}`);
  const wallet = normalizeWallet({});
  const start = Date.UTC(2026, 0, 1, 9, 0, 0);
  const milestones = new Map();
  let seconds = 0, wins = 0, played = 0, earned = 0;

  for (let i = 0; i < matches; i++) {
    const match = playMatch(rand, profile);
    played++;
    seconds += match.seconds;
    if (match.won) wins++;
    const entry = { data: 'sim', _builtin: true, _diffMult: profile.diffMult };
    const now = start + seconds * 1000;
    const before = wallet.coins;
    const reward = computeMatchReward(match.won, match.foe, entry, wallet, now);
    applyMatchReward(wallet, reward, match.won, now);
    earned += wallet.coins - before;
    for (let k = 0; k < PRICES.length; k++) {
      const need = PRICES.slice(0, k + 1).reduce((s, p) => s + p, 0);
      if (!milestones.has(k) && wallet.coins >= need) {
        milestones.set(k, { minutes: seconds / 60, matches: played, need });
      }
    }
  }
  return {
    profile,
    matches: played,
    wins,
    minutes: seconds / 60,
    coins: wallet.coins,
    coinsPerMinute: earned / (seconds / 60),
    avgMatchMinutes: seconds / 60 / played,
    firstSkin: milestones.get(0) ?? null,
    fullSet: milestones.get(PRICES.length - 1) ?? null,
  };
}

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function main() {
  const args = new Map(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  const matches = Number(args.get('matches') ?? 400);
  const seed = args.get('seed') ?? 'ghostfire';

  console.log(`Цены скинов: ${PRICES.join(', ')} (вся коллекция ${PRICES.reduce((s, p) => s + p, 0)})`);
  console.log(`Старт кошелька: ${normalizeWallet({}).coins}\n`);
  const rows = [];
  for (const profile of PROFILES) {
    const r = simulate(profile, { matches, seed });
    rows.push(r);
    console.log(`${profile.label}`);
    console.log(`  матч ~${fmt(r.avgMatchMinutes)} мин, побед ${Math.round(r.wins / r.matches * 100)}%, доход ${fmt(r.coinsPerMinute)} монет/мин`);
    console.log(`  первый скин: ${fmt(r.firstSkin?.minutes)} мин (${r.firstSkin?.matches ?? '—'} матчей)`);
    console.log(`  вся коллекция: ${fmt(r.fullSet?.minutes)} мин\n`);
  }
  const first = rows.map(r => r.firstSkin?.minutes ?? Infinity);
  console.log(`Первый скин: от ${fmt(Math.min(...first))} до ${fmt(Math.max(...first))} мин.`);
  console.log('С rewarded «удвоить награду» на каждом матче — примерно вдвое быстрее.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
