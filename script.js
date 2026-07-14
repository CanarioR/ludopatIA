const buttons = document.querySelectorAll('.menu-screen .menu-buttons .pixel-btn[data-action]');
const audioHint = document.querySelector('.audio-hint');
const scanlines = document.querySelector('.scanlines');
const menuScreen = document.querySelector('.menu-screen');
const modeSelectScreen = document.querySelector('.mode-select-screen');
const gameScreen = document.querySelector('.game-screen');
const outcomeOverlay = document.querySelector('#outcomeOverlay');
const outcomeOverlaySprite = document.querySelector('#outcomeOverlaySprite');
const optionsPanel = document.querySelector('#optionsPanel');
const optionsBackdrop = document.querySelector('#optionsBackdrop');
const optionsCrtToggle = document.querySelector('#optionsCrtToggle');
const optionsMusicToggle = document.querySelector('#optionsMusicToggle');
const optionsResetCreditsBtn = document.querySelector('#optionsResetCreditsBtn');
const optionsCloseBtn = document.querySelector('#optionsCloseBtn');

const creditsValue = document.querySelector('#creditsValue');
const creditsHud = document.querySelector('#creditsHud');
const roundValue = document.querySelector('#roundValue');
const currentNumberEl = document.querySelector('#currentNumber');
const nextNumberEl = document.querySelector('.next-number');
const resultText = document.querySelector('#resultText');
const betInput = document.querySelector('#betInput');
const guessLowerBtn = document.querySelector('#guessLowerBtn');
const guessHigherBtn = document.querySelector('#guessHigherBtn');
const backMenuBtn = document.querySelector('#backMenuBtn');
const playBtn = document.querySelector('#playBtn');
const playMayorMenorBtn = document.querySelector('#playMayorMenorBtn');
const playRuletaRusaBtn = document.querySelector('#playRuletaRusaBtn');
const backToMainMenuBtn = document.querySelector('#backToMainMenuBtn');
const menuCharacter = document.querySelector('.ia-character');
const gameBotSprite = document.querySelector('.game-bot-sprite');

const BOT_GIFS = {
  idle: 'assets/sprites/idle.gif',
  angry: 'assets/sprites/Angry.gif',
  laughing: 'assets/sprites/laughing.gif',
};

if (menuCharacter) {
  menuCharacter.src = BOT_GIFS.idle;
}

let audioStarted = false;
let audioCtx;
let masterGain;
let bgMusic;
let bgFadeRaf;
let autoNextRoundTimer;
let creditsPopTimer;
let outcomeOverlayTimer;
let deferredCreditsTimer;
let creditsDisplayTimer;
let audioUnlockWarmupDone = false;

const MUSIC_TARGET_VOLUME = 0.35;
const MUSIC_FADE_SECONDS = 0.8;
const SFX_NOTE_VOLUME = 0.95;

const HOUSE_EDGE = 0.92;

const gameState = {
  credits: 1000,
  round: 1,
  currentNumber: 50,
  roundResolved: false,
};

let previousCredits = gameState.credits;
let displayedCredits = gameState.credits;
let musicEnabled = true;

function openOptionsPanel() {
  if (!optionsPanel) {
    return;
  }

  optionsPanel.classList.remove('hidden');
}

function closeOptionsPanel() {
  if (!optionsPanel) {
    return;
  }

  optionsPanel.classList.add('hidden');
}

function setCrtEnabled(enabled) {
  document.body.classList.toggle('crt-enabled', enabled);

  if (scanlines) {
    scanlines.classList.toggle('hidden', !enabled);
  }

  if (optionsCrtToggle) {
    optionsCrtToggle.checked = enabled;
  }
}

function setMusicEnabled(enabled) {
  musicEnabled = enabled;

  ensureBgMusic();

  if (!musicEnabled) {
    if (bgMusic && !bgMusic.paused) {
      fadeMusicTo(0, 0.45, () => {
        if (!bgMusic) {
          return;
        }

        bgMusic.pause();
      });
    }

    return;
  }

  if (bgMusic && bgMusic.paused) {
    bgMusic.play().catch(() => {
      // Ignore autoplay interruptions; next user gesture retries.
    });
  }

  fadeMusicTo(MUSIC_TARGET_VOLUME, MUSIC_FADE_SECONDS);
}

function queueCreditsValueUpdate(nextCredits) {
  clearTimeout(creditsDisplayTimer);

  const overlayActive = outcomeOverlay && outcomeOverlay.classList.contains('is-visible');
  const overlayDelay = overlayActive ? 1180 : 0;
  const animationDuration = 1250;

  creditsDisplayTimer = setTimeout(() => {
    displayedCredits = nextCredits;
    creditsValue.textContent = String(displayedCredits);
  }, overlayDelay + animationDuration);
}

function animateCreditsGain(gain) {
  if (!creditsHud || gain <= 0) {
    return;
  }

  creditsHud.dataset.gain = `+${gain}`;
  delete creditsHud.dataset.loss;
  creditsHud.classList.remove('credits-drop', 'credits-pop');
  void creditsHud.offsetWidth;
  creditsHud.classList.add('credits-pop');

  clearTimeout(creditsPopTimer);
  creditsPopTimer = setTimeout(() => {
    creditsHud.classList.remove('credits-pop');
    delete creditsHud.dataset.gain;
  }, 1250);
}

function animateCreditsLoss(loss) {
  if (!creditsHud || loss <= 0) {
    return;
  }

  creditsHud.dataset.loss = `-${loss}`;
  delete creditsHud.dataset.gain;
  creditsHud.classList.remove('credits-pop', 'credits-drop');
  void creditsHud.offsetWidth;
  creditsHud.classList.add('credits-drop');

  clearTimeout(creditsPopTimer);
  creditsPopTimer = setTimeout(() => {
    creditsHud.classList.remove('credits-drop');
    delete creditsHud.dataset.loss;
  }, 1250);
}

function queueCreditsChangeAnimation(delta) {
  if (delta === 0) {
    return;
  }

  clearTimeout(deferredCreditsTimer);

  const overlayActive = outcomeOverlay && outcomeOverlay.classList.contains('is-visible');
  const delay = overlayActive ? 1180 : 0;

  deferredCreditsTimer = setTimeout(() => {
    if (delta > 0) {
      animateCreditsGain(delta);
    } else {
      animateCreditsLoss(Math.abs(delta));
    }
  }, delay);
}

function makeSquareOsc(freq, start, duration, volume = 0.045) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function primeSfxOutput() {
  if (!audioCtx || !masterGain || audioCtx.state !== 'running') {
    return;
  }

  // iOS Safari often needs an actual node start in a trusted gesture to unlock SFX.
  const now = audioCtx.currentTime;
  makeSquareOsc(660, now, 0.035, 0.0045);
}

function playBar() {
  if (!audioCtx || audioCtx.state !== 'running') {
    return;
  }

  const now = audioCtx.currentTime;
  const melody = [392, 523.25, 659.25, 523.25, 349.23, 440, 587.33, 440];
  const bass = [98, 98, 130.81, 130.81];

  melody.forEach((note, i) => {
    makeSquareOsc(note, now + i * 0.18, 0.14, 0.04);
  });

  bass.forEach((note, i) => {
    makeSquareOsc(note, now + i * 0.36, 0.26, 0.03);
  });
}

function ensureBgMusic() {
  if (bgMusic) {
    return;
  }

  bgMusic = new Audio('assets/audio/Coins_On_The_Glass.mp3');
  bgMusic.loop = true;
  bgMusic.preload = 'auto';
  bgMusic.volume = 0;
}

function fadeMusicTo(targetVolume, durationSeconds, onComplete) {
  if (!bgMusic) {
    if (onComplete) {
      onComplete();
    }
    return;
  }

  const startVolume = bgMusic.volume;
  const change = targetVolume - startVolume;
  const durationMs = Math.max(durationSeconds * 1000, 1);
  const startTime = performance.now();

  if (bgFadeRaf) {
    cancelAnimationFrame(bgFadeRaf);
  }

  const step = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    bgMusic.volume = Math.max(0, Math.min(1, startVolume + change * progress));

    if (progress < 1) {
      bgFadeRaf = requestAnimationFrame(step);
      return;
    }

    bgFadeRaf = null;
    if (onComplete) {
      onComplete();
    }
  };

  bgFadeRaf = requestAnimationFrame(step);
}

function playWinSfx() {
  if (!audioCtx || audioCtx.state !== 'running') {
    return;
  }

  const now = audioCtx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];

  notes.forEach((note, i) => {
    makeSquareOsc(note, now + i * 0.07, 0.2, SFX_NOTE_VOLUME);
  });
}

function playLoseSfx() {
  if (!audioCtx || audioCtx.state !== 'running') {
    return;
  }

  const now = audioCtx.currentTime;
  const notes = [392, 329.63, 261.63, 196];

  notes.forEach((note, i) => {
    makeSquareOsc(note, now + i * 0.08, 0.24, SFX_NOTE_VOLUME);
  });
}

async function startAudio(primeSfx = false) {
  if (!audioStarted) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.78;
    masterGain.connect(audioCtx.destination);

    audioStarted = true;

    if (audioHint) {
      audioHint.textContent = 'Musica 8-bit activa';
    }
  }

  if (audioCtx && audioCtx.state !== 'running') {
    try {
      await audioCtx.resume();
    } catch {
      // iOS can reject resume sporadically; next gesture retries.
    }
  }

  // Warm up iOS audio output on first user gesture so subsequent SFX are audible.
  if (!audioUnlockWarmupDone && audioCtx && audioCtx.state === 'running') {
    audioUnlockWarmupDone = true;
    makeSquareOsc(880, audioCtx.currentTime, 0.03, 0.0032);
  }

  if (primeSfx) {
    primeSfxOutput();
  }

  ensureBgMusic();

  if (musicEnabled) {
    if (bgMusic.paused) {
      bgMusic.play().catch(() => {
        // Ignore autoplay interruptions; next user gesture retries.
      });
    }

    fadeMusicTo(MUSIC_TARGET_VOLUME, MUSIC_FADE_SECONDS);
  }
}

function randomNumber() {
  return Math.floor(Math.random() * 98) + 2;
}

function drawDifferentNumber(currentNumber) {
  let candidate = randomNumber();

  while (candidate === currentNumber) {
    candidate = randomNumber();
  }

  return candidate;
}

function toMultiplier(probability) {
  if (probability <= 0) {
    return 0;
  }

  return Number((HOUSE_EDGE / probability).toFixed(2));
}

function getOdds(number) {
  const higherProbability = (100 - number) / 99;
  const lowerProbability = (number - 1) / 99;

  return {
    higherProbability,
    lowerProbability,
    higherMultiplier: toMultiplier(higherProbability),
    lowerMultiplier: toMultiplier(lowerProbability),
  };
}

function renderState() {
  const { higherProbability, lowerProbability, higherMultiplier, lowerMultiplier } = getOdds(gameState.currentNumber);
  const hasCredits = gameState.credits > 0;
  const creditsGain = gameState.credits - previousCredits;

  roundValue.textContent = String(gameState.round);
  currentNumberEl.textContent = String(gameState.currentNumber);

  guessHigherBtn.disabled = higherProbability <= 0 || gameState.roundResolved || !hasCredits;
  guessLowerBtn.disabled = lowerProbability <= 0 || gameState.roundResolved || !hasCredits;

  guessHigherBtn.textContent = higherProbability > 0
    ? `Mayor ↑ x${higherMultiplier.toFixed(2)}`
    : 'Mayor ↑';
  guessLowerBtn.textContent = lowerProbability > 0
    ? `Menor ↓ x${lowerMultiplier.toFixed(2)}`
    : 'Menor ↓';

  if (creditsGain !== 0) {
    queueCreditsChangeAnimation(creditsGain);
    queueCreditsValueUpdate(gameState.credits);
  } else {
    displayedCredits = gameState.credits;
    creditsValue.textContent = String(displayedCredits);
  }

  previousCredits = gameState.credits;
}

function setBotMood(mood) {
  if (!gameBotSprite) {
    return;
  }

  const nextGif = BOT_GIFS[mood] || BOT_GIFS.idle;
  gameBotSprite.src = nextGif;
  gameBotSprite.alt = `IA pixel art ${mood}`;
  gameBotSprite.setAttribute('aria-label', `IA pixel art ${mood}`);
}

function showOutcomeOverlay(outcome) {
  if (!outcomeOverlay || !outcomeOverlaySprite) {
    return;
  }

  if (outcome !== 'win' && outcome !== 'lose') {
    return;
  }

  const spriteSrc = outcome === 'win' ? BOT_GIFS.angry : BOT_GIFS.laughing;
  outcomeOverlaySprite.src = spriteSrc;
  outcomeOverlaySprite.alt = outcome === 'win' ? 'Victoria' : 'Derrota';

  outcomeOverlay.classList.remove('is-win', 'is-lose', 'is-visible');
  void outcomeOverlay.offsetWidth;
  outcomeOverlay.classList.add('is-visible', outcome === 'win' ? 'is-win' : 'is-lose');

  clearTimeout(outcomeOverlayTimer);
  outcomeOverlayTimer = setTimeout(() => {
    outcomeOverlay.classList.remove('is-visible', 'is-win', 'is-lose');
  }, 1150);
}

function startNewRound(isInitial = false) {
  gameState.roundResolved = false;
  gameState.currentNumber = randomNumber();
  setBotMood('idle');
  if (outcomeOverlay) {
    outcomeOverlay.classList.remove('is-visible', 'is-win', 'is-lose');
  }

  if (nextNumberEl) {
    nextNumberEl.textContent = '?';
  }

  if (!isInitial) {
    gameState.round += 1;
  }

  resultText.textContent = 'La IA espera tu jugada.';
  renderState();
}

function parseBet() {
  const rawBet = betInput.value.trim();

  if (!/^[1-9]\d*$/.test(rawBet)) {
    resultText.textContent = 'Ingresa una apuesta valida: solo numeros enteros mayores a 0.';
    return null;
  }

  const bet = Number(rawBet);

  if (!Number.isInteger(bet) || bet <= 0) {
    resultText.textContent = 'Ingresa una apuesta valida: solo numeros enteros mayores a 0.';
    return null;
  }

  if (bet > gameState.credits) {
    resultText.textContent = 'No tienes suficientes creditos para esa apuesta.';
    return null;
  }

  return bet;
}

function resolveGuess(direction) {
  if (gameState.roundResolved) {
    return;
  }

  const bet = parseBet();
  if (bet === null) {
    return;
  }

  const nextNumber = drawDifferentNumber(gameState.currentNumber);

  if (nextNumberEl) {
    nextNumberEl.textContent = String(nextNumber);
  }

  const { higherMultiplier, lowerMultiplier } = getOdds(gameState.currentNumber);
  const isHigher = nextNumber > gameState.currentNumber;
  const isLower = nextNumber < gameState.currentNumber;

  let outcome = 'lose';
  let payout = 0;
  let multiplierUsed = 0;

  if ((direction === 'higher' && isHigher) || (direction === 'lower' && isLower)) {
    outcome = 'win';
    multiplierUsed = direction === 'higher' ? higherMultiplier : lowerMultiplier;
    payout = Math.floor(bet * multiplierUsed);
  }

  gameState.credits -= bet;
  gameState.credits += payout;
  gameState.roundResolved = true;

  if (outcome === 'win') {
    resultText.textContent = `Salio ${nextNumber}. Acertaste y ganaste ${payout} fichas (x${multiplierUsed.toFixed(2)}).`;
    playWinSfx();
    setBotMood('angry');
    showOutcomeOverlay('win');
  } else {
    resultText.textContent = `Salio ${nextNumber}. Fallaste y perdiste ${bet} fichas.`;
    playLoseSfx();
    setBotMood('laughing');
    showOutcomeOverlay('lose');
  }

  if (gameState.credits <= 0) {
    gameState.credits = 0;
    resultText.textContent += ' Te quedaste sin creditos. Reinicia desde el menu.';
    guessHigherBtn.disabled = true;
    guessLowerBtn.disabled = true;
  }

  renderState();

  // Auto-advance to next round after 2 seconds
  if (gameState.credits > 0) {
    clearTimeout(autoNextRoundTimer);
    autoNextRoundTimer = setTimeout(() => {
      startNewRound();
    }, 2000);
  }
}

function showModeSelectScreen() {
  menuScreen.classList.add('hidden');
  modeSelectScreen.classList.remove('hidden');
}

function showGameScreen() {
  modeSelectScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');

  gameState.credits = 1000;
  gameState.round = 1;
  previousCredits = gameState.credits;
  displayedCredits = gameState.credits;
  creditsValue.textContent = String(displayedCredits);
  setBotMood('idle');
  startNewRound(true);
}

function backToModeSelect() {
  clearTimeout(autoNextRoundTimer);
  clearTimeout(outcomeOverlayTimer);
  clearTimeout(deferredCreditsTimer);
  clearTimeout(creditsDisplayTimer);
  gameScreen.classList.add('hidden');
  modeSelectScreen.classList.remove('hidden');
  if (outcomeOverlay) {
    outcomeOverlay.classList.remove('is-visible', 'is-win', 'is-lose');
  }

  if (bgMusic && !bgMusic.paused) {
    fadeMusicTo(0, 0.55, () => {
      if (!bgMusic) {
        return;
      }

      bgMusic.pause();
      bgMusic.currentTime = 0;
    });
  }

  setBotMood('idle');
}

function backToMenu() {
  clearTimeout(autoNextRoundTimer);
  clearTimeout(outcomeOverlayTimer);
  clearTimeout(deferredCreditsTimer);
  clearTimeout(creditsDisplayTimer);
  gameScreen.classList.add('hidden');
  modeSelectScreen.classList.add('hidden');
  menuScreen.classList.remove('hidden');
  if (outcomeOverlay) {
    outcomeOverlay.classList.remove('is-visible', 'is-win', 'is-lose');
  }

  if (bgMusic && !bgMusic.paused) {
    fadeMusicTo(0, 0.55, () => {
      if (!bgMusic) {
        return;
      }

      bgMusic.pause();
      bgMusic.currentTime = 0;
    });
  }

  setBotMood('idle');

  if (playBtn) {
    playBtn.disabled = false;
  }

  if (audioHint) {
    audioHint.textContent = audioStarted ? 'Musica 8-bit activa' : 'Haz clic en cualquier boton para activar la musica 8-bit';
  }
}

async function handleButtonClick(action) {
  await startAudio();

  if (action === 'play') {
    showModeSelectScreen();
    return;
  }

  if (action === 'options') {
    openOptionsPanel();
  }
}

buttons.forEach((button) => {
  button.addEventListener('click', async () => {
    await handleButtonClick(button.dataset.action);
  });
});

if (playBtn) {
  playBtn.disabled = false;

  playBtn.addEventListener('pointerdown', () => {
    void startAudio(true);
  }, { passive: true });

  playBtn.addEventListener('touchstart', () => {
    void startAudio(true);
  }, { passive: true });
}

if (optionsCrtToggle) {
  optionsCrtToggle.addEventListener('change', () => {
    setCrtEnabled(optionsCrtToggle.checked);
  });
}

if (optionsMusicToggle) {
  optionsMusicToggle.addEventListener('change', () => {
    setMusicEnabled(optionsMusicToggle.checked);
  });
}

if (optionsResetCreditsBtn) {
  optionsResetCreditsBtn.addEventListener('click', () => {
    gameState.credits = 1000;
    previousCredits = gameState.credits;
    displayedCredits = gameState.credits;
    creditsValue.textContent = String(displayedCredits);
    
    if (creditsHud) {
      creditsHud.classList.remove('credits-pop', 'credits-drop');
      delete creditsHud.dataset.gain;
      delete creditsHud.dataset.loss;
    }
    
    resultText.textContent = 'Creditos reiniciados a 1000.';
    renderState();
  });
}

if (optionsCloseBtn) {
  optionsCloseBtn.addEventListener('click', () => {
    closeOptionsPanel();
  });
}

if (optionsBackdrop) {
  optionsBackdrop.addEventListener('click', () => {
    closeOptionsPanel();
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeOptionsPanel();
  }
});

setCrtEnabled(document.body.classList.contains('crt-enabled'));

guessHigherBtn.addEventListener('click', async () => {
  await startAudio();
  resolveGuess('higher');
});

guessLowerBtn.addEventListener('click', async () => {
  await startAudio();
  resolveGuess('lower');
});

backMenuBtn.addEventListener('click', backToModeSelect);

if (playMayorMenorBtn) {
  playMayorMenorBtn.addEventListener('click', async () => {
    await startAudio();
    showGameScreen();
  });
}

if (backToMainMenuBtn) {
  backToMainMenuBtn.addEventListener('click', async () => {
    await startAudio();
    backToMenu();
  });
}

betInput.addEventListener('input', () => {
  const digitsOnly = betInput.value.replace(/\D/g, '');

  // Allow empty value while editing; enforce validity only when submitting the guess.
  if (digitsOnly === '') {
    betInput.value = '';
    return;
  }

  betInput.value = digitsOnly.replace(/^0+(?=\d)/, '');
});

window.addEventListener('pointerdown', () => {
  void startAudio();
}, { once: true });
window.addEventListener('keydown', () => {
  void startAudio();
}, { once: true });

window.addEventListener('beforeunload', () => {
  if (autoNextRoundTimer) {
    clearTimeout(autoNextRoundTimer);
  }

  if (outcomeOverlayTimer) {
    clearTimeout(outcomeOverlayTimer);
  }

  if (deferredCreditsTimer) {
    clearTimeout(deferredCreditsTimer);
  }

  if (creditsDisplayTimer) {
    clearTimeout(creditsDisplayTimer);
  }

  if (bgFadeRaf) {
    cancelAnimationFrame(bgFadeRaf);
  }

  if (bgMusic) {
    bgMusic.pause();
    bgMusic.currentTime = 0;
  }

  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close();
  }
});
