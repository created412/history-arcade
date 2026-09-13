// 시간여행 역사(驛舍) 화면 동작
const LINE_COLORS = {
  korea: 'var(--line-korea)',
  east: 'var(--line-east)',
  west: 'var(--line-west)',
  transfer: 'var(--line-transfer)',
};

const state = {
  lines: [],         // [{ id, name, stations }]
  transfer: '여러 시대',
  games: [],
  filter: { line: null, era: null }, // line: 노선 id 또는 'transfer', era: '노선/역'
  query: '',
  current: null,     // 탑승 중인 게임
  editing: null,     // 고치는 중인 게임
  editPin: '',
  cover: undefined,  // undefined: 그대로, '': 뺌, 'data:...': 새 그림
  pinAfter: null,
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

/* ───────── 노선과 역 ───────── */
// '한국사/조선' → { line, station, lineId, label }
function place(era) {
  if (era === state.transfer) {
    return { lineId: 'transfer', line: '환승역', station: era, label: `${era}(환승역)` };
  }
  const [lineName, station] = String(era).split('/');
  const line = state.lines.find((l) => l.name === lineName);
  return { lineId: line ? line.id : 'transfer', line: `${lineName}선`, station, label: `${lineName} ${station}역` };
}
const lineColor = (era) => LINE_COLORS[place(era).lineId];

function matchesFilter(g) {
  const { line, era } = state.filter;
  if (era) return g.era === era;
  if (line) return place(g.era).lineId === line;
  return true;
}

function visibleGames() {
  const q = state.query.trim().toLowerCase();
  return state.games.filter((g) =>
    matchesFilter(g) && (!q || `${g.title} ${g.author} ${g.summary}`.toLowerCase().includes(q)));
}

function setFilter(line, era) {
  const same = state.filter.line === line && state.filter.era === era;
  state.filter = same ? { line: null, era: null } : { line, era };
  renderLines();
  renderTickets();
}

/* ───────── 출발 안내판 ───────── */
function renderBoard() {
  const body = $('#board');
  const latest = [...state.games]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 6);
  body.replaceChildren();
  if (!latest.length) {
    body.append(el('tr', { class: 'board-empty' }, el('td', { colSpan: 4 }, '아직 출발하는 열차가 없습니다. 첫 열차를 편성해 주세요.')));
    return;
  }
  latest.forEach((g, i) => {
    const p = place(g.era);
    const cell = (...content) => el('td', {}, el('button', { type: 'button', tabIndex: -1, onclick: () => openRide(g) }, ...content));
    const row = el('tr', { class: 'board-row', style: `--i:${i}` },
      el('td', {}, el('button', { type: 'button', class: 'board-title', onclick: () => openRide(g), 'aria-label': `${g.title}, ${p.label}행 타기` }, g.title)),
      cell(el('span', { class: 'board-dest', style: `--line:${lineColor(g.era)}` }, el('i'), p.station)),
      cell(`${g.author}`),
      cell(`${g.plays || 0}회`));
    body.append(row);
  });
}

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* ───────── 노선도 ───────── */
function renderLines() {
  const wrap = $('#lines');
  const count = (fn) => state.games.filter(fn).length;
  const { line: fLine, era: fEra } = state.filter;
  $('#routeAll').setAttribute('aria-pressed', String(!fLine && !fEra));

  const station = (era, name) => {
    const n = count((g) => g.era === era);
    const btn = el('button', { type: 'button', class: `station${n ? '' : ' is-empty'}`, onclick: () => setFilter(null, era), 'aria-label': `${place(era).label}, 열차 ${n}편` },
      el('span', { class: 'station-dot', 'aria-hidden': 'true' }, n ? String(n) : ''),
      el('span', { class: 'station-name' }, name));
    btn.setAttribute('aria-pressed', String(fEra === era));
    return el('li', {}, btn);
  };

  const rows = state.lines.map((l) => {
    const n = count((g) => place(g.era).lineId === l.id);
    const name = el('button', { type: 'button', class: 'line-name', onclick: () => setFilter(l.id, null) },
      `${l.name}선`, el('small', {}, `${n}편`));
    name.setAttribute('aria-pressed', String(fLine === l.id && !fEra));
    return el('div', { class: 'line', style: `--line:${LINE_COLORS[l.id]}` },
      name,
      el('ul', { class: 'stations' }, l.stations.map((st) => station(`${l.name}/${st}`, st))));
  });

  const transfer = el('div', { class: 'line line-transfer', style: `--line:${LINE_COLORS.transfer}` },
    el('span', { class: 'line-name', style: 'cursor:default' }, '환승역'),
    el('ul', { class: 'stations' }, station(state.transfer, `${state.transfer} (여러 노선을 오가는 열차)`)));

  wrap.replaceChildren(...rows, transfer);
}

/* ───────── 승강장 ───────── */
function renderTickets() {
  const wrap = $('#tickets');
  const games = visibleGames();
  const { line, era } = state.filter;
  const where = era ? `${place(era).label}에` : line ? `${state.lines.find((l) => l.id === line)?.name}선에` : '모든 노선에';

  $('#platformStatus').textContent = games.length
    ? `${where} 열차 ${games.length}편이 서 있습니다.`
    : state.query
      ? `‘${state.query}’에 맞는 열차가 없습니다. 다른 이름으로 찾아보세요.`
      : `${where} 아직 서는 열차가 없습니다.`;

  wrap.replaceChildren(...games.map(ticket));
  if (!state.query) {
    wrap.append(el('div', { class: 'ticket-empty' },
      el('p', {}, games.length ? '이 승강장에 선생님의 열차를 더 세워 주세요.' : '이 역에 설 첫 열차를 편성해 주세요.'),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openSheet(null) }, '새 열차 편성하기')));
  }
}

function ticket(g) {
  const p = place(g.era);
  const view = g.cover
    ? el('img', { src: g.cover, alt: `${g.title} 표지`, loading: 'lazy' })
    : el('div', { class: 'window-art', 'aria-hidden': 'true' }, el('p', {}, el('small', {}, '다음 역'), el('span', {}, p.station)));

  return el('article', { class: 'ticket', style: `--line:${lineColor(g.era)}` },
    el('div', { class: 'ticket-band' },
      el('b', {}, p.line),
      el('span', {}, `${p.station} 행${g.grade ? `, ${g.grade}` : ''}`)),
    el('div', { class: 'ticket-window' }, view),
    el('div', { class: 'ticket-body' },
      el('h3', { class: 'ticket-title' }, g.title),
      el('p', { class: 'ticket-summary' }, g.summary || '소개 글이 아직 없습니다.')),
    el('div', { class: 'ticket-stub' },
      el('p', { class: 'ticket-meta' },
        el('span', {}, '기관사 ', el('strong', {}, `${g.author} 선생님`)),
        el('span', {}, `승차 ${g.plays || 0}회`)),
      el('button', { class: 'btn btn-go', type: 'button', onclick: () => openRide(g) }, '승차권 끊기'),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => askPin(g), 'aria-label': `${g.title} 고치기` }, '고치기')));
}

/* ───────── 개찰과 탑승 ───────── */
function gameSrc(g) {
  return g.kind === 'link' ? g.url : `/play/${g.id}`;
}

function openRide(g) {
  const p = place(g.era);
  state.current = g;
  const ride = $('#ride');
  ride.style.setProperty('--line', lineColor(g.era));
  $('#rideRoute').textContent = `${p.line} ${p.station} 행`;
  $('#rideTitle').textContent = g.title;
  $('#rideNewWindow').href = gameSrc(g);
  $('#bigTicket').style.setProperty('--line', lineColor(g.era));
  $('#bigTicketLine').textContent = `${p.line} ${g.title}`;
  $('#bigTicketStation').textContent = p.station;
  $('#bigTicketHowTo').textContent = g.howTo || g.summary || '게임 화면의 안내를 따라 즐겨 보세요.';
  $('#bigTicketByline').textContent = `기관사 ${g.author} 선생님`;

  const gate = $('#gate');
  gate.hidden = false;
  gate.classList.remove('punched');
  const frame = $('#rideFrame');
  frame.hidden = true;
  frame.removeAttribute('src');
  ride.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#gateButton').disabled = false;
  $('#gateButton').focus();
}

function passGate() {
  const g = state.current;
  if (!g) return;
  const gate = $('#gate');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#gateButton').disabled = true;
  gate.classList.add('punched');
  api(`/api/games/${g.id}/play`, { method: 'POST' })
    .then(({ plays }) => { g.plays = plays; renderBoard(); renderTickets(); })
    .catch(() => {});
  setTimeout(() => {
    if (state.current !== g) return;
    gate.hidden = true;
    const frame = $('#rideFrame');
    frame.src = gameSrc(g);
    frame.hidden = false;
    frame.focus();
  }, reduce ? 300 : 1250);
}

function closeRide() {
  const frame = $('#rideFrame');
  frame.removeAttribute('src');
  frame.hidden = true;
  $('#ride').hidden = true;
  document.body.style.overflow = '';
  state.current = null;
}

/* ───────── 비밀번호 확인 ───────── */
function askPin(g) {
  state.pinAfter = g;
  $('#pinLead').textContent = `‘${g.title}’ 열차를 고치려면 비밀번호를 적어 주세요.`;
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
    closeRide();
    openSheet(g, pin);
  } catch (err) {
    $('#pinError').textContent = err.message;
    $('#pinError').hidden = false;
    $('#p-pin').select();
  }
}

/* ───────── 편성 신청서 ───────── */
function renderEraChoices() {
  const choice = (era, name) => el('label', { class: 'era-choice' },
    el('input', { type: 'radio', name: 'era', value: era, required: true }),
    el('span', {}, name));
  const group = (id, title, choices) => el('div', { class: 'era-group', style: `--line:${LINE_COLORS[id]}` },
    el('span', { class: 'era-group-name' }, title),
    el('div', { class: 'era-choices' }, choices));

  $('#eraChoices').replaceChildren(
    ...state.lines.map((l) => group(l.id, l.name, l.stations.map((st) => choice(`${l.name}/${st}`, st)))),
    group('transfer', '환승역', [choice(state.transfer, state.transfer)]));
}

function setKind(kind) {
  document.querySelectorAll('[data-kind]').forEach((f) => { f.hidden = f.dataset.kind !== kind; });
}

function showCover(src) {
  const box = $('#coverPreview');
  box.hidden = !src;
  if (src) box.querySelector('img').src = src;
}

function checkEra(form, era) {
  const input = era && [...form.querySelectorAll('input[name="era"]')].find((i) => i.value === era);
  if (input) input.checked = true;
}

function openSheet(g, pin = '') {
  const form = $('#gameForm');
  form.reset();
  state.editing = g;
  state.editPin = pin;
  state.cover = undefined;
  $('#formError').hidden = true;

  const editing = Boolean(g);
  $('#sheetTitle').textContent = editing ? `‘${g.title}’ 고치기` : '새 열차 편성하기';
  $('#submitButton').textContent = editing ? '고친 내용 저장' : '열차 편성하기';
  $('#deleteButton').hidden = !editing;
  $('#newPinField').hidden = !editing;
  form.querySelector('.pin-field').hidden = editing;
  $('#htmlHint').textContent = editing && g.kind === 'html'
    ? '지금 올라가 있는 파일을 바꿀 때만 새 파일을 골라 주세요.'
    : '그림·소리는 파일 안에 넣어 둔 한 개짜리 HTML이어야 합니다.';

  if (editing) {
    for (const key of ['title', 'author', 'grade', 'summary', 'howTo', 'url']) form.elements[key].value = g[key] || '';
    form.elements.kind.value = g.kind;
    checkEra(form, g.era);
  } else {
    checkEra(form, state.filter.era);
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
  if (!body.era) return fail('다루는 시대(노선과 역)를 골라 주세요.', form.querySelector('input[name="era"]'));

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
      toast(`‘${game.title}’ 열차를 편성했습니다.`);
    }
    $('#sheet').close();
    renderAll();
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
    btn.textContent = '한 번 더 누르면 운행을 끝냅니다';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '운행 끝내기'; }, 4000);
    return;
  }
  try {
    await api(`/api/games/${g.id}`, { method: 'DELETE', body: { pin: state.editPin } });
    state.games = state.games.filter((x) => x.id !== g.id);
    $('#sheet').close();
    toast(`‘${g.title}’ 열차 운행을 끝냈습니다.`);
    renderAll();
  } catch (err) {
    $('#formError').textContent = err.message;
    $('#formError').hidden = false;
  } finally {
    btn.dataset.armed = '';
    btn.textContent = '운행 끝내기';
  }
}

/* ───────── 시작 ───────── */
function renderAll() {
  renderBoard();
  renderLines();
  renderTickets();
}

async function load() {
  try {
    const data = await api('/api/games');
    state.lines = data.lines;
    state.transfer = data.transfer;
    state.games = data.games;
    renderEraChoices();
    renderAll();
  } catch (e) {
    $('#platformStatus').textContent = `열차 시간표를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요. (${e.message})`;
  }
}

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'new') openSheet(null);
  if (action === 'close-sheet') $('#sheet').close();
  if (action === 'close-pin') $('#pinDialog').close();
  if (action === 'close-ride') closeRide();
  if (action === 'edit-current' && state.current) askPin(state.current);
  if (action === 'delete') deleteGame();
  if (action === 'remove-cover') { state.cover = ''; $('#f-cover').value = ''; showCover(''); }
});

$('#routeAll').addEventListener('click', () => { state.filter = { line: null, era: null }; renderLines(); renderTickets(); });
$('#gateButton').addEventListener('click', passGate);
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
$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderTickets(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#ride').hidden && !document.querySelector('dialog[open]')) closeRide();
});

tickClock();
setInterval(tickClock, 30 * 1000);
load();
