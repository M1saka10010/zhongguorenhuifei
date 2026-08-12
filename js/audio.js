// 音频管理：背景音乐（循环）与失败音效
export const bgm = new Audio('static/' + encodeURIComponent('中国人能飞.mp3'));
bgm.loop = true;

export const loseSound = new Audio('static/man.mp3');

export function playBgm() {
  loseSound.pause();
  loseSound.currentTime = 0;
  bgm.currentTime = 0;
  bgm.play().catch(() => {});
}

export function playLoseSound() {
  bgm.pause();
  loseSound.currentTime = 0;
  loseSound.play().catch(() => {});
}

// 击落敌机时的音效（小声，可重叠播放）
export function playKillSound() {
  const s = loseSound.cloneNode();
  s.volume = 0.25;
  s.play().catch(() => {});
}
