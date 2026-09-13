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
  me: { role: 'guest' }, // guest | teacher | student(name, coins, className, classCode)
  token: '',
  rideId: null,        // 지금 탄 열차의 승차 기록 (클리어 보상에 쓴다)
  loginAfter: null,    // 들어온 뒤 이어서 할 일
};

const SESSION_KEY = 'history-station-session';
const SIGNAL = 'history-station:clear';
const isTeacher = () => state.me.role === 'teacher';
const isStudent = () => state.me.role === 'student';

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
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
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
      el('p', { class: 'ticket-summary' }, g.summary || '소개 글이 아직 없습니다.'),
      fareLine(g)),
    el('div', { class: 'ticket-stub' },
      el('p', { class: 'ticket-meta' },
        el('span', {}, '기관사 ', el('strong', {}, `${g.author} 선생님`)),
        el('span', {}, `승차 ${g.plays || 0}회`)),
      el('button', { class: 'btn btn-go', type: 'button', onclick: () => openRide(g) }, '승차권 끊기'),
      isTeacher()
        ? el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => askPin(g), 'aria-label': `${g.title} 고치기` }, '고치기')
        : null));
}

const coinImg = () => el('img', { src: 'coin.svg', alt: '' });

function fareLine(g) {
  if (!g.fare && !g.reward) {
    return el('p', { class: 'ticket-fare' }, el('span', { class: 'is-free' }, g.kind === 'link' ? '무료 열차 (링크 게임)' : '무료 열차'));
  }
  return el('p', { class: 'ticket-fare' },
    el('span', {}, coinImg(), `차비 ${g.fare}닢`),
    el('span', {}, `클리어하면 ${g.reward}닢`));
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
  $('#arrival').hidden = true;
  state.rideId = null;
  renderGate(g);
  renderRidePurse();
  ride.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#gateButton').focus();
}

// 누가 타는지, 엽전이 넉넉한지에 따라 개찰구 안내를 바꾼다
function renderGate(g) {
  const box = $('#farebox');
  const text = $('#fareText');
  const button = $('#gateButton');
  const note = $('#gateNote');
  box.classList.remove('is-free', 'is-pass');
  note.hidden = true;
  button.disabled = false;
  button.dataset.mode = 'ride';

  if (isTeacher()) {
    box.classList.add('is-pass');
    text.replaceChildren('선생님 정기권으로 엽전 없이 탑니다.');
    button.textContent = '정기권으로 개찰하기';
  } else if (!g.fare) {
    box.classList.add('is-free');
    text.replaceChildren('무료 열차입니다.', g.reward && isStudent() ? el('b', {}, ` 클리어하면 엽전 ${g.reward}닢`) : '');
    button.textContent = '개찰하고 타기';
  } else if (!isStudent()) {
    text.replaceChildren('이 열차의 차비는 ', el('b', {}, `엽전 ${g.fare}닢`), '입니다.');
    button.textContent = '들어와서 타기';
    button.dataset.mode = 'login';
    note.textContent = '학생은 반 코드로, 선생님은 교사 비밀번호로 들어오면 탈 수 있습니다.';
    note.hidden = false;
  } else if (state.me.coins < g.fare) {
    text.replaceChildren('차비 ', el('b', {}, `${g.fare}닢`), `, 가진 엽전 ${state.me.coins}닢`);
    button.textContent = '엽전이 모자랍니다';
    button.disabled = true;
    note.textContent = '무료 열차를 타거나, 차비가 적은 게임을 클리어해 엽전을 모아 보세요.';
    note.hidden = false;
  } else {
    text.replaceChildren('차비 ', el('b', {}, `${g.fare}닢`), `을 내면 ${state.me.coins - g.fare}닢이 남습니다. 클리어하면 `, el('b', {}, `${g.reward}닢`), '을 받습니다.');
    button.textContent = `엽전 ${g.fare}닢 내고 개찰하기`;
  }
}

function renderRidePurse() {
  document.querySelectorAll('[data-teacher-only]').forEach((b) => { b.hidden = !isTeacher(); });
  const purse = $('#ridePurse');
  purse.hidden = !isStudent();
  if (isStudent()) purse.replaceChildren(purseChip());
}

async function passGate() {
  const g = state.current;
  if (!g) return;
  const button = $('#gateButton');
  if (button.dataset.mode === 'login') {
    openLogin('student', `‘${g.title}’ 열차는 엽전이 필요합니다. 들어오면 바로 탈 수 있습니다.`, () => openRide(g));
    return;
  }
  const gate = $('#gate');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  button.disabled = true;
  try {
    const ride = await api(`/api/games/${g.id}/ride`, { method: 'POST' });
    state.rideId = ride.rideId;
    g.plays = ride.plays;
    setMe(ride.me);
  } catch (err) {
    $('#gateNote').textContent = err.message;
    $('#gateNote').hidden = false;
    button.disabled = false;
    return;
  }
  gate.classList.add('punched');
  renderRidePurse();
  renderBoard();
  renderTickets();
  setTimeout(() => {
    if (state.current !== g) return;
    gate.hidden = true;
    const frame = $('#rideFrame');
    frame.src = gameSrc(g);
    frame.hidden = false;
    frame.focus();
  }, reduce ? 300 : 1250);
}

// 게임이 보내는 클리어 신호를 받아 보상을 청구한다
async function claimClear() {
  const g = state.current;
  const rideId = state.rideId;
  if (!g || !rideId) return;
  state.rideId = null; // 한 번 탈 때 한 번만
  try {
    const result = await api(`/api/rides/${rideId}/clear`, { method: 'POST' });
    setMe(result.me);
    renderRidePurse();
    let message = `‘${g.title}’ 도착! 클리어했습니다.`;
    if (result.reward > 0) message = `도착! 클리어 보상으로 엽전 ${result.reward}닢을 받았습니다. 가진 엽전 ${state.me.coins}닢`;
    else if (isTeacher()) message = '도착! 학생이 탔다면 이때 보상이 들어갑니다.';
    showArrival(message);
    if (result.reward > 0) bumpPurse();
  } catch (err) {
    showArrival(err.message);
  }
}

function showArrival(message) {
  $('#arrivalText').textContent = message;
  $('#arrival').hidden = false;
}

function closeRide() {
  const frame = $('#rideFrame');
  frame.removeAttribute('src');
  frame.hidden = true;
  $('#ride').hidden = true;
  $('#arrival').hidden = true;
  document.body.style.overflow = '';
  state.current = null;
  state.rideId = null;
}

/* ───────── 비밀번호 확인 ───────── */
function askPin(g) {
  if (!isTeacher()) {
    openLogin('teacher', '게임을 고치려면 먼저 선생님으로 들어와 주세요.', () => askPin(g));
    return;
  }
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

function setFareKind(kind) {
  const link = kind === 'link';
  $('#fareField').classList.toggle('is-link', link);
  $('#f-fare').disabled = link;
  $('#f-reward').disabled = link;
  $('#fareHint').textContent = link
    ? '링크 게임은 클리어 신호를 보낼 수 없어 무료 열차가 됩니다.'
    : '학생은 차비를 내고 타고, 게임이 클리어 신호를 보내면 보상을 받습니다.';
}

function openSheet(g, pin = '') {
  if (!isTeacher()) {
    openLogin('teacher', '열차 편성은 선생님만 할 수 있습니다.', () => openSheet(g, pin));
    return;
  }
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
    form.elements.fare.value = g.fare ?? 1;
    form.elements.reward.value = g.reward ?? 2;
    checkEra(form, g.era);
  } else {
    checkEra(form, state.filter.era);
  }
  setKind(form.elements.kind.value);
  setFareKind(form.elements.kind.value);
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

  if (body.kind === 'html') {
    const fare = Number(f.fare.value);
    const reward = Number(f.reward.value);
    if (!Number.isInteger(fare) || fare < 0 || fare > 5) return fail('차비는 0~5닢 사이로 정해 주세요.', f.fare);
    if (!Number.isInteger(reward) || reward < 0 || reward > 10) return fail('클리어 보상은 0~10닢 사이로 정해 주세요.', f.reward);
    Object.assign(body, { fare, reward });
  }

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

/* ───────── 승객: 들어오기와 나가기 ───────── */
function saveSession() {
  try {
    if (state.token) localStorage.setItem(SESSION_KEY, state.token);
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* 저장소를 못 쓰면 이번 창에서만 기억한다 */ }
}

function setMe(me) {
  const before = state.me.role;
  state.me = me || { role: 'guest' };
  renderPassenger();
  if (before !== state.me.role) renderTickets();
}

function purseChip() {
  return el('span', { class: 'purse', 'aria-label': `가진 엽전 ${state.me.coins}닢` }, coinImg(), `${state.me.coins}닢`);
}

function bumpPurse() {
  document.querySelectorAll('.purse').forEach((p) => {
    p.classList.remove('is-bump');
    void p.offsetWidth;
    p.classList.add('is-bump');
  });
}

function renderPassenger() {
  const box = $('#passenger');
  const me = state.me;
  if (me.role === 'teacher') {
    box.replaceChildren(
      el('span', { class: 'pass-badge' }, '선생님 정기권'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: openOffice }, '역무실'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: logout }, '나가기'));
  } else if (me.role === 'student') {
    box.replaceChildren(
      el('p', { class: 'passenger-who' }, `${me.name}`, el('small', {}, me.className)),
      purseChip(),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: logout }, '나가기'));
  } else {
    box.replaceChildren(
      el('p', { class: 'passenger-who' }, '구경 중', el('small', {}, '들어오면 엽전으로 열차를 탈 수 있습니다')),
      el('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => openLogin('student') }, '들어오기'));
  }
}

function logout() {
  state.token = '';
  saveSession();
  setMe({ role: 'guest' });
  toast('나갔습니다. 다음에 또 타러 오세요.');
}

function switchLoginTab(tab) {
  const student = tab === 'student';
  $('#tabStudent').setAttribute('aria-selected', String(student));
  $('#tabTeacher').setAttribute('aria-selected', String(!student));
  $('#studentForm').hidden = !student;
  $('#teacherForm').hidden = student;
  (student ? $('#s-code') : $('#t-password')).focus();
}

function openLogin(tab = 'student', reason = '', after = null) {
  state.loginAfter = after;
  $('#loginReason').textContent = reason;
  $('#loginReason').hidden = !reason;
  $('#studentError').hidden = true;
  $('#teacherError').hidden = true;
  $('#t-password').value = '';
  $('#s-pin').value = '';
  if (!$('#loginDialog').open) $('#loginDialog').showModal();
  switchLoginTab(tab);
}

async function finishLogin({ token, me }, message) {
  state.token = token;
  saveSession();
  setMe(me);
  $('#loginDialog').close();
  toast(message);
  const after = state.loginAfter;
  state.loginAfter = null;
  if (after) after();
}

async function submitStudent(e) {
  e.preventDefault();
  const error = $('#studentError');
  error.hidden = true;
  const body = { classCode: $('#s-code').value.trim(), name: $('#s-name').value.trim(), pin: $('#s-pin').value };
  const fail = (msg, field) => { error.textContent = msg; error.hidden = false; field?.focus(); };
  if (body.classCode.length !== 6) return fail('반 코드 6자리를 적어 주세요.', $('#s-code'));
  if (!body.name) return fail('이름을 적어 주세요.', $('#s-name'));
  if (!/^\d{4}$/.test(body.pin)) return fail('비밀번호는 숫자 4자리로 적어 주세요.', $('#s-pin'));
  try {
    const result = await api('/api/session/student', { method: 'POST', body });
    finishLogin(result, result.created
      ? `어서 오세요, ${result.me.name} 승객님! 엽전 ${result.startingCoins}닢을 받았습니다.`
      : `다시 오셨네요, ${result.me.name} 승객님. 엽전 ${result.me.coins}닢이 있습니다.`);
  } catch (err) {
    fail(err.message);
  }
}

async function submitTeacher(e) {
  e.preventDefault();
  const error = $('#teacherError');
  error.hidden = true;
  try {
    const result = await api('/api/session/teacher', { method: 'POST', body: { password: $('#t-password').value } });
    finishLogin(result, '선생님 정기권으로 들어왔습니다.');
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    $('#t-password').select();
  }
}

/* ───────── 역무실: 반과 학생 ───────── */
async function openOffice() {
  if (!isTeacher()) return openLogin('teacher', '역무실은 선생님만 들어갈 수 있습니다.', openOffice);
  $('#officeError').hidden = true;
  $('#officeNotice').hidden = true;
  if (!$('#officeDialog').open) $('#officeDialog').showModal();
  await renderOffice();
}

function officeFail(err) {
  $('#officeError').textContent = err.message;
  $('#officeError').hidden = false;
}

// 두 번 눌러야 실행되는 버튼 (브라우저 확인창 대신)
function twoStep(label, armedLabel, action) {
  const btn = el('button', { class: 'btn btn-danger btn-small', type: 'button' }, label);
  btn.addEventListener('click', async () => {
    if (btn.dataset.armed !== 'true') {
      btn.dataset.armed = 'true';
      btn.textContent = armedLabel;
      setTimeout(() => { btn.dataset.armed = ''; btn.textContent = label; }, 4000);
      return;
    }
    btn.disabled = true;
    await action();
  });
  return btn;
}

const openClasses = new Set();

async function renderOffice() {
  const list = $('#classList');
  let classes;
  try {
    ({ classes } = await api('/api/classes'));
  } catch (err) {
    return officeFail(err);
  }
  if (!classes.length) {
    list.replaceChildren(el('p', { class: 'class-empty' }, '아직 만든 반이 없습니다. 반을 만들면 학생들에게 나눠 줄 반 코드가 나옵니다.'));
    return;
  }
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '');

  list.replaceChildren(...classes.map((c) => {
    const rows = c.students
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((s) => el('tr', {},
        el('td', {}, s.name),
        el('td', { class: 'num' }, `${s.coins}닢`),
        el('td', { class: 'num' }, `${s.clears}번`),
        el('td', {}, date(s.lastSeen)),
        el('td', {}, el('div', { class: 'row-actions' },
          el('button', {
            class: 'btn btn-quiet btn-small', type: 'button',
            onclick: async () => {
              const pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
              try {
                await api(`/api/classes/${c.code}/students/${s.id}/pin`, { method: 'POST', body: { pin } });
                // 금방 사라지는 알림 대신, 선생님이 받아 적을 때까지 남겨 둔다
                $('#officeNotice').replaceChildren(`${c.name} ${s.name} 학생의 새 비밀번호는 `, el('b', {}, pin), '입니다. 학생에게 알려 주세요.');
                $('#officeNotice').hidden = false;
                $('#officeNotice').scrollIntoView({ block: 'nearest' });
              } catch (err) { officeFail(err); }
            },
          }, '비밀번호 새로 정하기'),
          twoStep('지우기', '한 번 더 누르면 지웁니다', async () => {
            try {
              await api(`/api/classes/${c.code}/students/${s.id}`, { method: 'DELETE' });
              toast(`${s.name} 학생을 지웠습니다.`);
              renderOffice();
            } catch (err) { officeFail(err); }
          })))));

    const details = el('details', { class: 'class-card', open: openClasses.has(c.code) },
      el('summary', {},
        el('span', { class: 'class-name' }, c.name),
        el('span', { class: 'class-meta' }, `${c.teacher ? `${c.teacher} 선생님, ` : ''}학생 ${c.students.length}명`),
        el('span', { class: 'class-code', 'aria-label': `반 코드 ${c.code.split('').join(' ')}` }, c.code)),
      el('div', { class: 'class-body' },
        c.students.length
          ? el('div', { class: 'roster-scroll' }, el('table', { class: 'roster' },
            el('thead', {}, el('tr', {},
              el('th', {}, '이름'), el('th', {}, '엽전'), el('th', {}, '클리어'), el('th', {}, '마지막으로 탄 날'), el('th', {}, ''))),
            el('tbody', {}, rows)))
          : el('p', { class: 'class-empty' }, `아직 들어온 학생이 없습니다. 학생들에게 반 코드 ${c.code}를 알려 주세요.`),
        el('div', { class: 'class-actions' },
          el('p', {}, '학생이 비밀번호를 잊으면 ‘비밀번호 새로 정하기’로 새 숫자를 알려 주세요.'),
          twoStep('반 지우기', '한 번 더 누르면 반과 학생 기록을 모두 지웁니다', async () => {
            try {
              await api(`/api/classes/${c.code}`, { method: 'DELETE' });
              toast(`${c.name} 반을 지웠습니다.`);
              renderOffice();
            } catch (err) { officeFail(err); }
          }))));
    details.addEventListener('toggle', () => {
      if (details.open) openClasses.add(c.code); else openClasses.delete(c.code);
    });
    return details;
  }));
}

async function submitClass(e) {
  e.preventDefault();
  $('#officeError').hidden = true;
  const name = $('#c-name').value.trim();
  if (!name) return officeFail(new Error('반 이름을 적어 주세요.'));
  try {
    const { class: c } = await api('/api/classes', { method: 'POST', body: { name, teacher: $('#c-teacher').value.trim() } });
    $('#c-name').value = '';
    openClasses.add(c.code);
    toast(`${c.name} 반을 만들었습니다. 반 코드는 ${c.code}입니다.`);
    renderOffice();
  } catch (err) {
    officeFail(err);
  }
}

/* ───────── 시작 ───────── */
function renderAll() {
  renderBoard();
  renderLines();
  renderTickets();
}

async function restoreSession() {
  try { state.token = localStorage.getItem(SESSION_KEY) || ''; } catch { state.token = ''; }
  if (!state.token) return renderPassenger();
  try {
    const me = await api('/api/session');
    if (me.role === 'guest') { state.token = ''; saveSession(); }
    setMe(me);
  } catch {
    renderPassenger();
  }
}

async function load() {
  await restoreSession();
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
  if (action === 'close-login') { state.loginAfter = null; $('#loginDialog').close(); }
  if (action === 'close-office') $('#officeDialog').close();
  if (action === 'close-arrival') $('#arrival').hidden = true;
  if (action === 'copy-signal') {
    navigator.clipboard?.writeText($('#signalCode').textContent)
      .then(() => toast('클리어 신호 코드를 복사했습니다.'))
      .catch(() => toast('복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.'));
  }
});

document.querySelectorAll('[data-login-tab]').forEach((b) => b.addEventListener('click', () => switchLoginTab(b.dataset.loginTab)));
$('#studentForm').addEventListener('submit', submitStudent);
$('#teacherForm').addEventListener('submit', submitTeacher);
$('#classForm').addEventListener('submit', submitClass);
$('#s-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

// 탄 게임(iframe)에서 온 클리어 신호만 받는다
window.addEventListener('message', (e) => {
  const frame = $('#rideFrame');
  if (frame.hidden || e.source !== frame.contentWindow) return;
  if (e.data && e.data.type === SIGNAL) claimClear();
});

$('#routeAll').addEventListener('click', () => { state.filter = { line: null, era: null }; renderLines(); renderTickets(); });
$('#gateButton').addEventListener('click', passGate);
$('#gameForm').addEventListener('submit', submitSheet);
$('#pinForm').addEventListener('submit', submitPin);
$('#gameForm').addEventListener('change', async (e) => {
  if (e.target.name === 'kind') { setKind(e.target.value); setFareKind(e.target.value); }
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
