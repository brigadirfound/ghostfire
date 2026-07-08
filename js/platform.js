// Обёртка платформы. Все обращения игры к SDK/рекламе/сохранениям — ТОЛЬКО отсюда.
// Сейчас — localStorage-заглушки; при интеграции (Yandex Games, Poki, CrazyGames...)
// меняется только этот файл.

const LS_PREFIX = 'ghostfire.';

export const Platform = {
  ready: false,

  async initSDK() {
    // Заглушка: реальный SDK инициализируется здесь.
    console.log('[platform] initSDK (stub)');
    this.ready = true;
    return true;
  },

  /**
   * Rewarded-реклама. resolve(true) — награда выдана, resolve(false) — отказ/ошибка.
   * Хук уже используется: "реванш с того же счёта" на экране поражения.
   */
  async showRewardedAd(placement) {
    console.log(`[platform] showRewardedAd("${placement}") (stub) → granted`);
    return true;
  },

  async showInterstitialAd(placement) {
    console.log(`[platform] showInterstitialAd("${placement}") (stub)`);
    return true;
  },

  /** Сохранение профиля игрока (прогресс, призрак, настройки). */
  async savePlayer(data) {
    try {
      localStorage.setItem(LS_PREFIX + 'player', JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('[platform] savePlayer failed', e);
      return false;
    }
  },

  async loadPlayer() {
    try {
      const raw = localStorage.getItem(LS_PREFIX + 'player');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[platform] loadPlayer failed', e);
      return null;
    }
  },

  /** Таблица лидеров — заглушка. */
  async submitScore(board, score) {
    console.log(`[platform] submitScore("${board}", ${score}) (stub)`);
    return true;
  },
};
