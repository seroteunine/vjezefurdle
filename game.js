// Launch date: the day VjezeFurdle went live.
// WORDS[daysSinceLaunch % WORDS.length] is today's entry.
const LAUNCH_DATE = new Date(2026, 3, 17);

const MAX_GUESSES = 6;
const FLIP_MS     = 500; // duration of one tile flip
const FLIP_DELAY  = 300; // stagger between tiles

// ── State ──────────────────────────────────────────────

let state = {
  answer:   '',   // uppercased word to guess
  lyric:    '',   // full lyric revealed at the end
  song:     '',   // optional song title
  wordLen:  0,
  guesses:  [],   // completed guesses (strings)
  current:  '',   // letters typed so far in current row
  gameOver: false,
  won:      false,
};

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function todayEntry() {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days  = Math.floor((today - LAUNCH_DATE) / 86400000);
  return WORDS[((days % WORDS.length) + WORDS.length) % WORDS.length];
}

function saveState() {
  localStorage.setItem('vjezefurdle-state', JSON.stringify({
    date:     todayKey(),
    guesses:  state.guesses,
    current:  state.current,
    gameOver: state.gameOver,
    won:      state.won,
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem('vjezefurdle-state');
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.date !== todayKey()) return false;
    state.guesses  = d.guesses  || [];
    state.current  = d.current  || '';
    state.gameOver = d.gameOver || false;
    state.won      = d.won      || false;
    return true;
  } catch (_) {
    return false;
  }
}

// ── Wordle coloring algorithm ───────────────────────────

function getColors(guess, answer) {
  const len    = answer.length;
  const result = Array(len).fill('absent');
  const ans    = answer.split('');
  const gss    = guess.split('');

  // Pass 1: exact matches
  for (let i = 0; i < len; i++) {
    if (gss[i] === ans[i]) {
      result[i] = 'correct';
      ans[i] = null;
      gss[i] = null;
    }
  }

  // Pass 2: wrong-position matches
  for (let i = 0; i < len; i++) {
    if (gss[i] === null) continue;
    const j = ans.indexOf(gss[i]);
    if (j !== -1) {
      result[i] = 'present';
      ans[j] = null;
    }
  }

  return result;
}

// ── Tile sizing ─────────────────────────────────────────

function applyTileSize(wordLen) {
  // Fit tiles into ~330px comfortably (5px gap between each)
  const available = Math.min(330, window.innerWidth - 32);
  const size      = Math.floor((available - (wordLen - 1) * 5) / wordLen);
  const capped    = Math.max(28, Math.min(62, size));
  const fontSize  = (capped * 0.52).toFixed(1) + 'px';
  const board     = document.getElementById('board');
  board.style.setProperty('--tile-size', capped + 'px');
  board.style.setProperty('--tile-font', fontSize);
}

// ── DOM helpers ─────────────────────────────────────────

function tile(row, col) {
  return document.getElementById(`tile-${row}-${col}`);
}

function buildBoard() {
  applyTileSize(state.wordLen);
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    row.id = `row-${r}`;
    for (let c = 0; c < state.wordLen; c++) {
      const t = document.createElement('div');
      t.className = 'tile';
      t.id = `tile-${r}-${c}`;
      row.appendChild(t);
    }
    board.appendChild(row);
  }
}

function buildKeyboard() {
  const layout = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L','⌫'],
    ['Z','X','C','V','B','N','M','ENTER'],
  ];
  layout.forEach((keys, i) => {
    const row = document.getElementById(`krow-${i + 1}`);
    row.innerHTML = '';
    keys.forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'key' + (k === 'ENTER' || k === '⌫' ? ' wide' : '');
      btn.textContent = k;
      btn.dataset.key = k;
      btn.addEventListener('click', () => handleKey(k));
      row.appendChild(btn);
    });
  });
}

// ── Rendering ───────────────────────────────────────────

function renderBoard() {
  // Completed guesses
  for (let r = 0; r < state.guesses.length; r++) {
    const colors = getColors(state.guesses[r], state.answer);
    for (let c = 0; c < state.wordLen; c++) {
      const t   = tile(r, c);
      t.textContent = state.guesses[r][c];
      t.className   = `tile ${colors[c]}`;
    }
  }

  // Active row
  if (!state.gameOver) {
    const r = state.guesses.length;
    for (let c = 0; c < state.wordLen; c++) {
      const t      = tile(r, c);
      const letter = state.current[c] || '';
      t.textContent = letter;
      t.className   = letter ? 'tile filled' : 'tile';
    }
  }
}

function updateKeyboard() {
  const priority = { correct: 3, present: 2, absent: 1 };
  const best     = {};

  for (const guess of state.guesses) {
    const colors = getColors(guess, state.answer);
    for (let i = 0; i < state.wordLen; i++) {
      const letter = guess[i];
      const color  = colors[i];
      if (!best[letter] || priority[color] > priority[best[letter]]) {
        best[letter] = color;
      }
    }
  }

  document.querySelectorAll('.key[data-key]').forEach(btn => {
    const k = btn.dataset.key;
    if (best[k]) {
      const wide = k === 'ENTER' || k === '⌫' ? ' wide' : '';
      btn.className = `key${wide} ${best[k]}`;
    }
  });
}

function showMessage(msg, permanent = false) {
  const el = document.getElementById('message');
  el.textContent = msg;
  if (!permanent) {
    setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 1800);
  }
}

// ── Animations ──────────────────────────────────────────

function shakeTiles(rowIndex) {
  for (let c = 0; c < state.wordLen; c++) {
    const t = tile(rowIndex, c);
    t.classList.add('shake');
    t.addEventListener('animationend', () => t.classList.remove('shake'), { once: true });
  }
}

function revealRow(rowIndex, colors, done) {
  const guess = state.guesses[rowIndex];

  for (let c = 0; c < state.wordLen; c++) {
    const t     = tile(rowIndex, c);
    const delay = c * FLIP_DELAY;

    // Start flip
    setTimeout(() => t.classList.add('flipping'), delay);

    // Swap color at midpoint (tile is perpendicular → invisible)
    setTimeout(() => {
      t.textContent = guess[c];
      t.className   = `tile ${colors[c]} flipping`;
    }, delay + FLIP_MS / 2);

    // End flip
    setTimeout(() => {
      t.classList.remove('flipping');
      if (c === state.wordLen - 1 && done) done();
    }, delay + FLIP_MS);
  }
}

// ── Input handling ──────────────────────────────────────

function handleKey(key) {
  if (state.gameOver) return;

  if (key === '⌫' || key === 'Backspace') {
    if (state.current.length > 0) {
      state.current = state.current.slice(0, -1);
      renderBoard();
      saveState();
    }
    return;
  }

  if (key === 'ENTER' || key === 'Enter') {
    submitGuess();
    return;
  }

  if (/^[A-Za-z]$/.test(key) && state.current.length < state.wordLen) {
    state.current += key.toUpperCase();
    renderBoard();
    saveState();
  }
}

function submitGuess() {
  const rowIndex = state.guesses.length;
  const guess    = state.current;

  if (guess.length < state.wordLen) {
    showMessage('Niet genoeg letters');
    shakeTiles(rowIndex);
    return;
  }

  const colors = getColors(guess, state.answer);
  state.guesses.push(guess);
  state.current = '';
  saveState();

  revealRow(rowIndex, colors, () => {
    updateKeyboard();

    if (guess === state.answer) {
      state.won      = true;
      state.gameOver = true;
      saveState();
      const msgs = [
        'Okeee dan hondeeerd!', 'Sterk neef!', 'Goddammit nummer 1!',
      ];
      showMessage(msgs[rowIndex] || 'Gewonnen!', true);
      setTimeout(showShareModal, 1400);

    } else if (state.guesses.length >= MAX_GUESSES) {
      state.gameOver = true;
      saveState();
      showMessage(`Het woord was: ${state.answer}`, true);
      setTimeout(showShareModal, 1400);
    }
  });
}

// ── Share ────────────────────────────────────────────────

function buildShareText() {
  const emojiMap = { correct: '🟩', present: '🟨', absent: '⬛' };
  const score    = state.won ? `${state.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const lines    = [`VjezeFurdle ${score}`, ''];
  for (const guess of state.guesses) {
    const colors = getColors(guess, state.answer);
    lines.push(colors.map(c => emojiMap[c]).join(''));
  }
  lines.push('', 'vjezefurdle.online/');
  return lines.join('\n');
}

function showShareModal() {
  const emojiMap = { correct: '🟩', present: '🟨', absent: '⬛' };
  const score    = state.won ? `${state.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;

  document.getElementById('share-result').textContent = `VjezeFurdle ${score}`;

  const grid = document.getElementById('share-emoji-grid');
  grid.innerHTML = '';
  for (const guess of state.guesses) {
    const colors = getColors(guess, state.answer);
    const row    = document.createElement('div');
    row.className   = 'share-emoji-row';
    row.textContent = colors.map(c => emojiMap[c]).join('');
    grid.appendChild(row);
  }

  document.getElementById('share-lyric').textContent = `"${state.lyric}"`;
  document.getElementById('share-song').textContent = state.song ? `— ${state.song}` : '';
  document.getElementById('share-overlay').classList.remove('hidden');
}

function fallbackCopy(text, onSuccess) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); onSuccess(); } catch (_) {}
  document.body.removeChild(ta);
}

function initShareModal() {
  const overlay  = document.getElementById('share-overlay');
  const copyBtn  = document.getElementById('share-copy-btn');
  const closeBtn = document.getElementById('share-close-btn');

  closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

  copyBtn.addEventListener('click', () => {
    const text = buildShareText();
    const orig = copyBtn.textContent;
    const confirm = () => {
      copyBtn.textContent = 'Gekopieerd!';
      setTimeout(() => { copyBtn.textContent = orig; }, 2000);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(confirm).catch(() => fallbackCopy(text, confirm));
    } else {
      fallbackCopy(text, confirm);
    }
  });
}

// ── Modal ───────────────────────────────────────────────

function initModal() {
  const overlay  = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('modal-close');
  const infoBtn  = document.getElementById('info-btn');

  const open  = () => overlay.classList.remove('hidden');
  const close = () => overlay.classList.add('hidden');

  infoBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  if (!localStorage.getItem('vjezefurdle-seen')) {
    localStorage.setItem('vjezefurdle-seen', '1');
    open();
  }
}

// ── Boot ────────────────────────────────────────────────

function init() {
  const entry    = todayEntry();
  state.answer   = entry.word.toUpperCase();
  state.lyric    = entry.lyric;
  state.song     = entry.song || '';
  state.wordLen  = state.answer.length;

  buildBoard();
  buildKeyboard();
  loadState();
  renderBoard();
  updateKeyboard();

  if (state.gameOver) {
    if (state.won) {
      const msgs = [
        'Ongelooflijk!', 'Waanzinnig!', 'Goddammit nummer 1!',
        'Goed gedaan!', 'Net aan!', 'Knap hoor!',
      ];
      showMessage(msgs[state.guesses.length - 1] || 'Gewonnen!', true);
    } else {
      showMessage(`Het woord was: ${state.answer}`, true);
    }
    setTimeout(showShareModal, 800);
  }

  document.addEventListener('keydown', e => {
    if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;
    if (!document.getElementById('share-overlay').classList.contains('hidden')) return;
    handleKey(e.key);
  });

  initModal();
  initShareModal();
}

document.addEventListener('DOMContentLoaded', init);
