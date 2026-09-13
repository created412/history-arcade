// 역사오락실 화면 동작
const ERA_COLORS = {
  '선사·고조선': '#c08a4e',
  '삼국·남북국': '#e8452c',
  '고려': '#2fae84',
  '조선': '#3a63c9',
  '근대': '#d9a520',
  '현대': '#d8487f',
  '세계사': '#8a64d6',
  '여러 시대': '#c9b48a',
};

const state = {
  eras: [],
  games: [],
  era: '전체',
  query: '',
  current: null,     // 플레이 중인 게임
  editing: null,     // 고치는 중인 게임
  editPin: '',
  cover: undefined,  // undefined: 그대로, '': 뺌, 'data:...': 새 그림
  pinAfter: null,    // 비밀번호 확인 뒤 할 일
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.includes('-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ───────── 목록 ───────── */
async function load() {
  try {
    const data = await api('/api/games');
    state.eras = data.eras;
    state.games = data.games;
    renderStages();
    renderEraChoices();
    renderCabinets();
  } catch (e) {
    $('#floorStatus').textContent = `게임기를 불러오지 못했습니다. 서버가 켜져 있는지 확인한 뒤 새로고침해 주세요. (${e.message})`;
  }
}

function renderStages() {
  const list = $('#stageList');
  list.replaceChildren();
  const stages = ['전체', ...state.eras];
  stages.forEach((era, i) => {
    const count = era === '전체' ? state.games.length : state.games.filter((g) => g.era === era).length;
    const btn = el('button', {
      class: 'stage', type: 'button', role: 'tab',
      style: era === '전체' ? '' : `--era:${ERA_COLORS[era]}`,
    },
    // 한국사 시대는 실제로 순서가 있으므로 ‘판’ 번호를 붙인다 (세계사·여러 시대는 제외)
    i === 0 || i > 6 ? null : el('b', {}, `${i}판`),
    `${era} ${count}`);
    btn.setAttribute('aria-selected', String(state.era === era));
    btn.addEventListener('click', () => { state.era = era; renderStages(); renderCabinets(); });
    list.append(btn);
  });
}

function visibleGames() {
  const q = state.query.trim().toLowerCase();
  return state.games.filter((g) =>
    (state.era === '전체' || g.era === state.era) &&
    (!q || `${g.title} ${g.author} ${g.summary}`.toLowerCase().includes(q)));
}

function renderCabinets() {
  const wrap = $('#cabinets');
  const games = visibleGames();
  wrap.replaceChildren();

  const where = state.era === '전체' ? '오락실에' : `${state.era} 판에`;
  $('#floorStatus').textContent = games.length
    ? `${where} 게임기 ${games.length}대가 켜져 있습니다.`
    : state.query
      ? `‘${state.query}’에 맞는 게임기가 없습니다. 다른 이름으로 찾아보세요.`
      : `${where} 아직 게임기가 없습니다.`;

  for (const g of games) wrap.append(cabinet(g));

  if (!state.query) {
    const empty = el('div', { class: 'cabinet-empty' },
      el('p', {}, games.length ? '이 자리가 비어 있습니다. 선생님의 게임을 들여놓아 주세요.' : '첫 번째 게임기를 들여놓아 주세요.'),
      el('button', { class: 'btn btn-register', type: 'button', onclick: () => openSheet(null) }, '새 게임 들여놓기'));
    wrap.append(empty);
  }
}

function cabinet(g) {
  const color = ERA_COLORS[g.era] || '#f5c542';
  const screen = g.cover
    ? el('img', { src: g.cover, alt: `${g.title} 표지`, loading: 'lazy' })
    : el('div', { class: 'cab-art', 'aria-hidden': 'true' }, el('span', {}, g.title));

  return el('article', { class: 'cabinet', style: `--era:${color}` },
    el('header', { class: 'cab-marquee' },
      el('p', { class: 'cab-era' }, `${g.era}${g.grade ? `, ${g.grade}` : ''}`),
      el('h2', { class: 'cab-title' }, g.title)),
    el('div', { class: 'cab-screen' }, screen),
    el('p', { class: 'cab-summary' }, g.summary || '소개 글이 아직 없습니다.'),
    el('div', { class: 'cab-panel' },
      el('span', { class: 'stick', 'aria-hidden': 'true' }),
      el('button', { class: 'btn btn-insert', type: 'button', onclick: () => openPlay(g) },
        el('img', { src: 'coin.svg', alt: '' }), '한 판 하기'),
      el('button', { class: 'btn btn-ghost btn-fix', type: 'button', onclick: () => askPin(g), 'aria-label': `${g.title} 고치기` }, '고치기')),
    el('p', { class: 'cab-plate' },
      el('span', {}, '만든 이 ', el('strong', {}, `${g.author} 선생님`)),
      el('span', {}, `${g.plays || 0}판 플레이`)));
}

/* ───────── 플레이 ───────── */
function gameSrc(g) {
  return g.kind === 'link' ? g.url : `/play/${g.id}`;
}

function openPlay(g) {
  state.current = g;
  $('#playEra').textContent = g.era;
  $('#playTitle').textContent = g.title;
  $('#playHowTo').textContent = g.howTo || g.summary || '게임 화면의 안내를 따라 즐겨 보세요.';
  $('#playByline').textContent = `${g.author} 선생님이 만든 게임`;
  $('#playNewWindow').href = gameSrc(g);
  $('#insert').hidden = false;
  $('#insert').classList.remove('dropping');
  const frame = $('#playFrame');
  frame.hidden = true;
  frame.removeAttribute('src');
  $('#play').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#coinButton').focus();
}

function insertCoin() {
  const g = state.current;
  if (!g) return;
  const insert = $('#insert');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  insert.classList.add('dropping');
  api(`/api/games/${g.id}/play`, { method: 'POST' })
    .then(({ plays }) => { g.plays = plays; renderCabinets(); })
    .catch(() => {});
  setTimeout(() => {
    insert.hidden = true;
    const frame = $('#playFrame');
    frame.src = gameSrc(g);
    frame.hidden = false;
    frame.focus();
  }, reduce ? 0 : 600);
}

function closePlay() {
  const frame = $('#playFrame');
  frame.removeAttribute('src');
  frame.hidden = true;
  $('#play').hidden = true;
  document.body.style.overflow = '';
  state.current = null;
}

/* ───────── 비밀번호 확인 ───────── */
function askPin(g) {
  state.pinAfter = g;
  $('#pinLead').textContent = `‘${g.title}’ 게임기를 고치려면 비밀번호를 적어 주세요.`;
  $('#p-pin').value = '';
  $('#pinError').hidden = true;
  $('#pinDialog').showModal();
}

async function submitPin(e) {
  e.preventDefault();
  const g = state.pinAfter;
  const pin = $('#p-pin').value;
  try {
    await api(`/api/games/${g.id}/verify`, { method: 'POST', body: { pin } });
    $('#pinDialog').close();
    closePlay();
    openSheet(g, pin);
  } catch (err) {
    $('#pinError').textContent = err.message;
    $('#pinError').hidden = false;
    $('#p-pin').select();
  }
}

/* ───────── 신청서 ───────── */
function renderEraChoices() {
  const box = $('#eraChoices');
  box.replaceChildren(...state.eras.map((era) =>
    el('label', { class: 'era-choice', style: `--era:${ERA_COLORS[era]}` },
      el('input', { type: 'radio', name: 'era', value: era, required: true }),
      el('span', {}, era))));
}

function setKind(kind) {
  document.querySelectorAll('[data-kind]').forEach((f) => { f.hidden = f.dataset.kind !== kind; });
}

function showCover(src) {
  const box = $('#coverPreview');
  box.hidden = !src;
  if (src) box.querySelector('img').src = src;
}

function openSheet(g, pin = '') {
  const form = $('#gameForm');
  form.reset();
  state.editing = g;
  state.editPin = pin;
  state.cover = undefined;
  $('#formError').hidden = true;

  const editing = Boolean(g);
  $('#sheetTitle').textContent = editing ? `‘${g.title}’ 고치기` : '새 게임기 들여놓기';
  $('#submitButton').textContent = editing ? '고친 내용 저장' : '게임기 들여놓기';
  $('#deleteButton').hidden = !editing;
  $('#newPinField').hidden = !editing;
  form.querySelector('.pin-field').hidden = editing;
  $('#htmlHint').textContent = editing && g.kind === 'html'
    ? '지금 올라가 있는 파일을 바꿀 때만 새 파일을 골라 주세요.'
    : '그림·소리는 파일 안에 넣어 둔 한 개짜리 HTML이어야 합니다.';

  if (editing) {
    for (const key of ['title', 'author', 'grade', 'summary', 'howTo', 'url']) form.elements[key].value = g[key] || '';
    form.elements.kind.value = g.kind;
    const eraInput = form.querySelector(`input[name="era"][value="${g.era}"]`);
    if (eraInput) eraInput.checked = true;
  } else if (state.era !== '전체') {
    const eraInput = form.querySelector(`input[name="era"][value="${state.era}"]`);
    if (eraInput) eraInput.checked = true;
  }
  setKind(form.elements.kind.value);
  showCover(editing ? g.cover : '');
  $('#sheet').showModal();
  form.elements.title.focus();
}

const readFile = (file, as) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
  as === 'text' ? r.readAsText(file) : r.readAsDataURL(file);
});

async function submitSheet(e) {
  e.preventDefault();
  const form = $('#gameForm');
  const f = form.elements;
  const error = $('#formError');
  const fail = (msg, field) => {
    error.textContent = msg;
    error.hidden = false;
    error.scrollIntoView({ block: 'nearest' });
    field?.focus();
  };
  error.hidden = true;

  const editing = state.editing;
  const body = {
    title: f.title.value, author: f.author.value, grade: f.grade.value,
    summary: f.summary.value, howTo: f.howTo.value,
    era: form.querySelector('input[name="era"]:checked')?.value,
    kind: f.kind.value,
  };
  if (!body.title.trim()) return fail('게임 이름을 적어 주세요.', f.title);
  if (!body.author.trim()) return fail('만든 선생님 이름을 적어 주세요.', f.author);
  if (!body.era) return fail('다루는 시대를 골라 주세요.', form.querySelector('input[name="era"]'));

  if (body.kind === 'link') {
    if (!/^https?:\/\//.test(f.url.value.trim())) return fail('게임 주소를 https:// 로 시작하게 적어 주세요.', f.url);
    body.url = f.url.value.trim();
  } else if (f.html.files[0]) {
    body.html = await readFile(f.html.files[0], 'text');
  } else if (!editing || editing.kind !== 'html') {
    return fail('올릴 HTML 파일을 골라 주세요.', f.html);
  }

  if (state.cover !== undefined) body.cover = state.cover;

  if (editing) {
    body.pin = state.editPin;
    if (f.newPin.value) body.newPin = f.newPin.value;
  } else {
    if (f.pin.value.length < 4) return fail('수정용 비밀번호를 4자 이상으로 정해 주세요.', f.pin);
    body.pin = f.pin.value;
  }

  const submit = $('#submitButton');
  submit.disabled = true;
  try {
    if (editing) {
      const { game } = await api(`/api/games/${editing.id}`, { method: 'PUT', body });
      Object.assign(editing, game);
      toast('고친 내용을 저장했습니다.');
    } else {
      const { game } = await api('/api/games', { method: 'POST', body });
      state.games.unshift(game);
      toast(`‘${game.title}’ 게임기를 들여놓았습니다.`);
    }
    $('#sheet').close();
    renderStages();
    renderCabinets();
  } catch (err) {
    fail(err.message);
  } finally {
    submit.disabled = false;
  }
}

async function deleteGame() {
  const g = state.editing;
  if (!g) return;
  const btn = $('#deleteButton');
  // 브라우저 확인창 대신 버튼을 두 번 누르게 한다
  if (btn.dataset.armed !== 'true') {
    btn.dataset.armed = 'true';
    btn.textContent = '한 번 더 누르면 치웁니다';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '게임기 치우기'; }, 4000);
    return;
  }
  try {
    await api(`/api/games/${g.id}`, { method: 'DELETE', body: { pin: state.editPin } });
    state.games = state.games.filter((x) => x.id !== g.id);
    $('#sheet').close();
    toast(`‘${g.title}’ 게임기를 치웠습니다.`);
    renderStages();
    renderCabinets();
  } catch (err) {
    $('#formError').textContent = err.message;
    $('#formError').hidden = false;
  } finally {
    btn.dataset.armed = '';
    btn.textContent = '게임기 치우기';
  }
}

/* ───────── 이벤트 연결 ───────── */
document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'new') openSheet(null);
  if (action === 'close-sheet') $('#sheet').close();
  if (action === 'close-pin') $('#pinDialog').close();
  if (action === 'close-play') closePlay();
  if (action === 'edit-current' && state.current) askPin(state.current);
  if (action === 'delete') deleteGame();
  if (action === 'remove-cover') { state.cover = ''; $('#f-cover').value = ''; showCover(''); }
});

$('#coinButton').addEventListener('click', insertCoin);
$('#gameForm').addEventListener('submit', submitSheet);
$('#pinForm').addEventListener('submit', submitPin);
$('#gameForm').addEventListener('change', async (e) => {
  if (e.target.name === 'kind') setKind(e.target.value);
  if (e.target.name === 'cover' && e.target.files[0]) {
    const file = e.target.files[0];
    if (file.size > 1.5 * 1024 * 1024) {
      $('#formError').textContent = '표지 그림은 1.5MB 이하로 골라 주세요.';
      $('#formError').hidden = false;
      e.target.value = '';
      return;
    }
    state.cover = await readFile(file, 'dataURL');
    showCover(state.cover);
  }
});
$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderCabinets(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#play').hidden && !document.querySelector('dialog[open]')) closePlay();
});

load();
