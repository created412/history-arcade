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
  me: { role: 'guest' }, // guest | teacher(id, name, school) | student(school, number, coins)
  token: '',
  rideId: null,        // 지금 탄 열차의 승차 기록 (클리어 보상에 쓴다)
  loginAfter: null,    // 들어온 뒤 이어서 할 일
  limits: { gameBytes: 100 * 1024 * 1024 },
  school: '',          // 학교 고르기 ('' = 모든 학교)
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
// 역 이름: 한국사는 '조선', 동양사·서양사는 '동양고대사'처럼 붙여 부른다
function stationName(line, station) {
  return line.prefix ? `${line.prefix}${station}사` : station;
}

// 1판부터 차례로 붙는 번호 (한국사 1~6판, 동양사 7~10판, 서양사 11~15판)
function stationNumber(line, station) {
  let n = 0;
  for (const l of state.lines) {
    if (l === line) return n + l.stations.indexOf(station) + 1;
    n += l.stations.length;
  }
  return null;
}

// '서양사/중세' → { lineId, line: '서양사선', station: '서양중세사', no: 12, tag: '12판 서양중세사' }
function place(era) {
  if (era === state.transfer) {
    return { lineId: 'transfer', line: '환승역', station: era, no: null, tag: era };
  }
  const [lineName, st] = String(era).split('/');
  const line = state.lines.find((l) => l.name === lineName);
  if (!line) return { lineId: 'transfer', line: '환승역', station: st || era, no: null, tag: st || era };
  const station = stationName(line, st);
  const no = stationNumber(line, st);
  return { lineId: line.id, line: `${lineName}선`, station, no, tag: `${no}판 ${station}` };
}
const lineColor = (era) => LINE_COLORS[place(era).lineId];

function matchesFilter(g) {
  const { line, era } = state.filter;
  if (era) return g.era === era;
  if (line) return place(g.era).lineId === line;
  return true;
}

const schoolKey = (v) => String(v || '').replace(/\s/g, '');

function visibleGames() {
  const q = state.query.trim().toLowerCase();
  return state.games.filter((g) =>
    matchesFilter(g)
    && (!state.school || schoolKey(g.school) === schoolKey(state.school))
    && (!q || `${g.title} ${g.author} ${g.school} ${g.summary}`.toLowerCase().includes(q)));
}

// 게임을 올린 학교 목록으로 학교 고르기 칸을 채운다. 들어온 사람의 학교는 맨 위에 둔다.
function renderSchoolFilter() {
  const select = $('#schoolFilter');
  const mine = state.me.school || '';
  const schools = [...new Map(state.games.filter((g) => g.school).map((g) => [schoolKey(g.school), g.school])).entries()]
    .filter(([key]) => key !== schoolKey(mine))
    .map(([, name]) => name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const options = [el('option', { value: '' }, '모든 학교')];
  if (mine) options.push(el('option', { value: mine }, `우리 학교 (${mine})`));
  options.push(...schools.map((s) => el('option', { value: s }, s)));
  select.replaceChildren(...options);
  const keep = [...select.options].find((o) => o.value && schoolKey(o.value) === schoolKey(state.school));
  select.value = keep ? keep.value : '';
  if (!keep) state.school = '';
  select.closest('.school-filter').hidden = select.options.length <= 1;
}

/* ───────── 출발 안내판 ───────── */
function renderBoard() {
  const body = $('#board');
  const latest = [...state.games]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 6);
  body.replaceChildren();
  if (!latest.length) {
    body.append(el('tr', { class: 'board-empty' }, el('td', { colSpan: 4 }, '아직 올라온 게임이 없습니다. 선생님이 첫 게임을 올려 주세요.')));
    return;
  }
  latest.forEach((g, i) => {
    const p = place(g.era);
    const cell = (...content) => el('td', {}, el('button', { type: 'button', tabIndex: -1, onclick: () => openRide(g) }, ...content));
    const row = el('tr', { class: 'board-row', style: `--i:${i}` },
      el('td', {}, el('button', { type: 'button', class: 'board-title', onclick: () => openRide(g), 'aria-label': `${g.title} 타기` }, g.title)),
      cell(el('span', { class: 'board-dest', style: `--line:${lineColor(g.era)}` }, el('i'), p.tag)),
      cell(`${g.author}`),
      cell(g.fare ? `${g.fare}닢` : '무료'));
    body.append(row);
  });
}

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* ───────── 시대 고르기: 노선 탭 + 역 ───────── */
function lineTab(id, label, count, selected, onclick) {
  const btn = el('button', { type: 'button', class: 'line-tab', style: `--line:${LINE_COLORS[id] || 'var(--cream)'}`, onclick },
    el('span', { class: 'line-tab-dot', 'aria-hidden': 'true' }),
    label,
    el('small', {}, String(count)));
  btn.setAttribute('aria-pressed', String(selected));
  return btn;
}

function renderLines() {
  const count = (fn) => state.games.filter(fn).length;
  const { line: fLine, era: fEra } = state.filter;
  const activeLine = fEra ? place(fEra).lineId : fLine;

  const tabs = [
    lineTab('all', '전체', state.games.length, !activeLine, () => { state.filter = { line: null, era: null }; renderLines(); renderTickets(); }),
    ...state.lines.map((l) => lineTab(l.id, l.name, count((g) => place(g.era).lineId === l.id), activeLine === l.id,
      () => { state.filter = { line: l.id, era: null }; renderLines(); renderTickets(); })),
    lineTab('transfer', state.transfer, count((g) => g.era === state.transfer), activeLine === 'transfer',
      () => { state.filter = { line: 'transfer', era: null }; renderLines(); renderTickets(); }),
  ];
  $('#lineTabs').replaceChildren(...tabs);

  // 노선을 고르면 그 노선의 역(시대)이 선로 위에 펼쳐진다
  const rail = $('#stationRail');
  const line = state.lines.find((l) => l.id === activeLine);
  if (!line) {
    rail.hidden = true;
    rail.replaceChildren();
    return;
  }
  rail.hidden = false;
  rail.style.setProperty('--line', LINE_COLORS[line.id]);
  rail.replaceChildren(
    el('p', { class: 'rail-hint' }, `${line.name}에서 시대를 골라 보세요`),
    el('ul', { class: 'stations' }, line.stations.map((st) => {
      const era = `${line.name}/${st}`;
      const n = count((g) => g.era === era);
      const p = place(era);
      const btn = el('button', {
        type: 'button', class: `station${n ? '' : ' is-empty'}`,
        onclick: () => setFilter(line.id, era),
        'aria-label': `${p.tag}, 게임 ${n}개`,
      },
      el('span', { class: 'station-dot', 'aria-hidden': 'true' }, n ? String(n) : ''),
      el('span', { class: 'station-no' }, `${p.no}판`),
      el('span', { class: 'station-name' }, p.station));
      btn.setAttribute('aria-pressed', String(fEra === era));
      return el('li', {}, btn);
    })));
}

function setFilter(line, era) {
  const same = state.filter.era === era;
  state.filter = same ? { line, era: null } : { line, era };
  renderLines();
  renderTickets();
}

/* ───────── 게임 목록 ───────── */
function renderTickets() {
  const wrap = $('#tickets');
  const games = visibleGames();
  const { line, era } = state.filter;
  const title = era ? place(era).tag
    : line === 'transfer' ? state.transfer
      : line ? state.lines.find((l) => l.id === line)?.name
        : '모든 게임';
  $('#platformTitle').textContent = title;

  $('#platformStatus').textContent = games.length
    ? `게임 ${games.length}개${state.school ? `, ${state.school}` : ''}`
    : state.query
      ? `‘${state.query}’에 맞는 게임이 없습니다. 다른 이름으로 찾아보세요.`
      : state.school
        ? `${state.school}에서 올린 이 시대 게임이 아직 없습니다. 학교를 ‘모든 학교’로 바꿔 보세요.`
        : '아직 이 시대의 게임이 없습니다.';

  wrap.replaceChildren(...games.map(ticket));
  if (!state.query && (isTeacher() || !games.length)) {
    wrap.append(el('div', { class: 'ticket-empty' },
      el('span', { class: 'ticket-empty-plus', 'aria-hidden': 'true' }, '+'),
      el('p', {}, isTeacher() ? '선생님이 만든 게임을 여기에 올려 주세요.' : '선생님이 게임을 올리면 여기에 나타납니다.'),
      isTeacher() ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openSheet(null) }, '게임 올리기') : null));
  }
}

function ticket(g) {
  const p = place(g.era);
  const stationLabel = p.tag;
  const view = g.cover
    ? el('img', { src: g.cover, alt: '', loading: 'lazy' })
    : el('div', { class: 'window-art', 'aria-hidden': 'true' }, el('span', {}, p.station));

  return el('article', { class: 'ticket', style: `--line:${lineColor(g.era)}` },
    // 표지 전체가 ‘타기’ 버튼
    el('button', { class: 'ticket-window', type: 'button', onclick: () => openRide(g), 'aria-label': `${g.title} 타기` },
      view,
      el('span', { class: 'ticket-chip ticket-era' }, stationLabel),
      el('span', { class: `ticket-chip ticket-price${g.fare ? '' : ' is-free'}` }, g.fare ? coinImg() : null, g.fare ? `${g.fare}닢` : '무료'),
      el('span', { class: 'ticket-play', 'aria-hidden': 'true' }, '▶ 타기')),
    el('div', { class: 'ticket-body' },
      el('h3', { class: 'ticket-title' }, g.title),
      el('p', { class: 'ticket-summary' }, g.summary || '소개 글이 아직 없습니다.'),
      el('p', { class: 'ticket-meta' },
        el('span', { class: 'ticket-maker' }, g.school ? `${g.school} ${g.author} 선생님` : `${g.author} 선생님`),
        g.grade ? el('span', {}, g.grade) : null,
        el('span', {}, `${g.plays || 0}번 탔어요`))),
    el('div', { class: 'ticket-stub' },
      fareLine(g),
      el('div', { class: 'ticket-buttons' },
        isTeacher() && (isMine(g) || g.hasPin)
          ? el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => askPin(g), 'aria-label': `${g.title} 고치기` }, '고치기')
          : null,
        el('button', { class: 'btn btn-go', type: 'button', onclick: () => openRide(g) }, '▶ 타기'))));
}

const coinImg = () => el('img', { src: 'coin.svg', alt: '' });

function fareLine(g) {
  if (!g.fare && !g.reward) {
    return el('p', { class: 'ticket-fare' }, el('span', { class: 'is-free' }, g.kind === 'link' ? '무료 게임 (링크)' : '무료 게임'));
  }
  return el('p', { class: 'ticket-fare' },
    el('span', {}, `차비 ${g.fare}닢`),
    el('span', { class: 'is-reward' }, `깨면 +${g.reward}닢`));
}

/* ───────── 첫 화면 버튼과 순서 안내 ───────── */
function renderHero() {
  const box = $('#heroActions');
  const me = state.me;
  const scrollToGames = () => $('#linesNav').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  if (me.role === 'teacher') {
    box.replaceChildren(
      el('button', { class: 'btn btn-hero', type: 'button', onclick: () => openSheet(null) }, '＋ 게임 올리기'),
      el('a', { class: 'btn btn-hero-ghost', href: '/guide' }, '사용 안내'),
      el('p', { class: 'hero-note' }, `${me.school} ${me.name} 선생님, 어서 오세요. 선생님은 엽전 없이 모든 게임을 탈 수 있어요.`));
  } else if (me.role === 'student') {
    box.replaceChildren(
      el('div', { class: 'hero-purse' },
        el('img', { src: 'coin.svg', alt: '' }),
        el('div', {},
          el('small', {}, `${me.school} ${me.number}`),
          el('b', { class: 'purse-count' }, `엽전 ${me.coins}닢`))),
      el('button', { class: 'btn btn-hero', type: 'button', onclick: scrollToGames }, '게임 고르러 가기 ↓'));
  } else {
    box.replaceChildren(
      el('button', { class: 'btn btn-hero', type: 'button', onclick: () => openLogin('student') }, '학생 입장하기'),
      el('button', { class: 'btn btn-hero-ghost', type: 'button', onclick: () => openLogin('teacher') }, '선생님 입장'),
      el('p', { class: 'hero-note' }, '입장하지 않아도 무료 게임은 바로 할 수 있어요. ',
        el('button', { class: 'link-button', type: 'button', onclick: scrollToGames }, '구경하러 가기')));
  }

  const steps = me.role === 'teacher'
    ? [
      ['게임 올리기', 'HTML 파일이나 링크를 올리고, 시대(판)와 차비·클리어 보상을 정해요.'],
      ['학생에게 알리기', '학생은 학교 이름과 학번만 적으면 들어올 수 있다고 알려 주세요.'],
      ['함께 쓰기', '다른 학교 선생님 게임도 수업에 쓸 수 있어요. 학교별로 골라 볼 수 있어요.'],
    ]
    : [
      ['학교와 학번으로 입장', '학교 이름과 학번만 적으면 들어와요. 처음엔 엽전 3닢!'],
      ['게임 골라 타기', '시대를 고르고 게임을 눌러요. 차비만큼 엽전을 내요.'],
      ['끝까지 깨고 엽전 받기', '게임을 깨면 엽전을 받아요. 모은 엽전으로 다른 게임을 타요.'],
    ];
  $('#steps').replaceChildren(...steps.map(([title, text], i) =>
    el('li', { class: 'step', style: `--i:${i}` },
      el('span', { class: 'step-num', 'aria-hidden': 'true' }, String(i + 1)),
      el('div', {}, el('b', {}, title), el('p', {}, text)))));
  $('#steps').setAttribute('aria-label', me.role === 'teacher' ? '선생님 이용 순서' : '이용 순서');
}

// 클리어 보상: 엽전이 비처럼 쏟아진다
function coinRain(target) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = el('div', { class: 'coin-rain', 'aria-hidden': 'true' });
  for (let i = 0; i < 28; i++) {
    layer.append(el('img', {
      src: 'coin.svg', alt: '',
      style: `left:${Math.random() * 100}%;animation-delay:${Math.random() * .9}s;animation-duration:${1.4 + Math.random()}s;width:${28 + Math.random() * 26}px`,
    }));
  }
  target.append(layer);
  setTimeout(() => layer.remove(), 2800);
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
  $('#rideRoute').textContent = `${p.line} ${p.tag} 행`;
  $('#rideTitle').textContent = g.title;
  $('#rideNewWindow').href = gameSrc(g);
  $('#bigTicket').style.setProperty('--line', lineColor(g.era));
  $('#bigTicketLine').textContent = `${p.line} ${g.title}`;
  $('#bigTicketStation').textContent = p.station;
  $('#bigTicketHowTo').textContent = g.howTo || g.summary || '게임 화면의 안내를 따라 즐겨 보세요.';
  $('#bigTicketByline').textContent = `만든 선생님: ${g.author}`;

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
    button.textContent = '선생님은 무료로 시작';
  } else if (!g.fare) {
    box.classList.add('is-free');
    text.replaceChildren('무료 열차입니다.', g.reward && isStudent() ? el('b', {}, ` 클리어하면 엽전 ${g.reward}닢`) : '');
    button.textContent = '게임 시작';
  } else if (!isStudent()) {
    text.replaceChildren('이 열차의 차비는 ', el('b', {}, `엽전 ${g.fare}닢`), '입니다.');
    button.textContent = '입장하고 타기';
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
    button.textContent = `엽전 ${g.fare}닢 내고 시작`;
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
    if (result.reward > 0) {
      bumpPurse();
      coinRain($('.ride-stage'));
    }
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

/* ───────── 고치기 권한 ───────── */
const isMine = (g) => isTeacher() && g.ownerId && g.ownerId === state.me.id;

// 내가 올린 게임은 바로 고치고, 다른 선생님 게임은 게임 비밀번호를 묻는다
function askPin(g) {
  if (!isTeacher()) {
    openLogin('teacher', '게임을 고치려면 먼저 선생님으로 들어와 주세요.', () => askPin(g));
    return;
  }
  if (isMine(g)) {
    closeRide();
    openSheet(g, '');
    return;
  }
  if (!g.hasPin) {
    toast(`이 게임은 ${g.school ? `${g.school} ` : ''}${g.author} 선생님만 고칠 수 있습니다.`);
    return;
  }
  state.pinAfter = g;
  $('#pinLead').textContent = `‘${g.title}’은 ${g.school ? `${g.school} ` : ''}${g.author} 선생님이 올린 게임입니다. 함께 고치려면 게임 비밀번호를 적어 주세요.`;
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
    ...state.lines.map((l) => group(l.id, l.name, l.stations.map((st) => choice(`${l.name}/${st}`, place(`${l.name}/${st}`).tag)))),
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
    openLogin('teacher', '게임 올리기는 선생님만 할 수 있습니다.', () => openSheet(g, pin));
    return;
  }
  const form = $('#gameForm');
  form.reset();
  state.editing = g;
  state.editPin = pin;
  state.cover = undefined;
  $('#formError').hidden = true;

  const editing = Boolean(g);
  $('#sheetTitle').textContent = editing ? `‘${g.title}’ 고치기` : '게임 올리기';
  $('#submitButton').textContent = editing ? '고친 내용 저장' : '게임 올리기';
  $('#deleteButton').hidden = !editing;
  $('#newPinField').hidden = !editing;
  form.querySelector('.pin-field').hidden = editing;
  $('#htmlHint').textContent = editing && g.kind === 'html'
    ? '지금 올라가 있는 파일을 바꿀 때만 새 파일을 골라 주세요.'
    : '그림·소리는 파일 안에 넣어 둔 한 개짜리 HTML이어야 합니다.';

  $('#schoolNote').textContent = editing
    ? `${g.school || '학교 정보 없음'}에서 올린 게임입니다.`
    : `${state.me.school} ${state.me.name} 선생님 이름으로 올라갑니다. 다른 선생님 이름으로 올리려면 ‘만든 선생님’ 칸을 고쳐 주세요.`;

  if (editing) {
    for (const key of ['title', 'author', 'grade', 'summary', 'howTo', 'url']) form.elements[key].value = g[key] || '';
    form.elements.kind.value = g.kind;
    form.elements.fare.value = g.fare ?? 1;
    form.elements.reward.value = g.reward ?? 2;
    checkEra(form, g.era);
  } else {
    form.elements.author.value = state.me.name || '';
    checkEra(form, state.filter.era);
  }
  setKind(form.elements.kind.value);
  setFareKind(form.elements.kind.value);
  showCover(editing ? g.cover : '');
  $('#sheet').showModal();
  form.elements.title.focus();
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

// 진행률을 보여 주려고 fetch 대신 XMLHttpRequest로 올린다
function uploadHtml(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.setRequestHeader('Content-Type', 'text/html; charset=utf-8');
    if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.floor((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* 빈 응답 */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || '파일을 올리지 못했습니다.'));
    };
    xhr.onerror = () => reject(new Error('파일을 올리는 중에 연결이 끊겼습니다. 인터넷 연결을 확인하고 다시 올려 주세요.'));
    xhr.send(file);
  });
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

  let htmlFile = null;
  if (body.kind === 'link') {
    if (!/^https?:\/\//.test(f.url.value.trim())) return fail('게임 주소를 https:// 로 시작하게 적어 주세요.', f.url);
    body.url = f.url.value.trim();
  } else if (f.html.files[0]) {
    htmlFile = f.html.files[0];
    if (htmlFile.size > state.limits.gameBytes) {
      return fail(`HTML 파일이 ${formatSize(htmlFile.size)}입니다. ${formatSize(state.limits.gameBytes)}까지 올릴 수 있습니다.`, f.html);
    }
    if (htmlFile.size === 0) return fail('HTML 파일이 비어 있습니다.', f.html);
  } else if (!editing || editing.kind !== 'html') {
    return fail('올릴 HTML 파일을 골라 주세요.', f.html);
  }

  if (state.cover !== undefined) body.cover = state.cover;

  if (editing) {
    body.pin = state.editPin;
    if (f.newPin.value) body.newPin = f.newPin.value;
  } else if (f.pin.value) {
    if (f.pin.value.length < 4) return fail('게임 비밀번호는 4자 이상으로 정하거나 비워 두세요.', f.pin);
    body.pin = f.pin.value;
  }

  const submit = $('#submitButton');
  const submitLabel = submit.textContent;
  submit.disabled = true;
  try {
    // 큰 파일은 따로 흘려 올리고, 받은 번호만 게임 정보에 담는다
    if (htmlFile) {
      const { upload } = await uploadHtml(htmlFile, (pct) => { submit.textContent = `파일 올리는 중 ${pct}%`; });
      body.upload = upload;
      submit.textContent = '저장하는 중';
    }
    if (editing) {
      const { game } = await api(`/api/games/${editing.id}`, { method: 'PUT', body });
      Object.assign(editing, game);
      toast('고친 내용을 저장했습니다.');
    } else {
      const { game } = await api('/api/games', { method: 'POST', body });
      state.games.unshift(game);
      toast(`‘${game.title}’ 게임을 올렸습니다.`);
    }
    $('#sheet').close();
    renderAll();
  } catch (err) {
    fail(err.message);
  } finally {
    submit.textContent = submitLabel;
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
    btn.textContent = '한 번 더 누르면 게임을 내립니다';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '게임 내리기'; }, 4000);
    return;
  }
  try {
    await api(`/api/games/${g.id}`, { method: 'DELETE', body: { pin: state.editPin } });
    state.games = state.games.filter((x) => x.id !== g.id);
    $('#sheet').close();
    toast(`‘${g.title}’ 게임을 내렸습니다.`);
    renderAll();
  } catch (err) {
    $('#formError').textContent = err.message;
    $('#formError').hidden = false;
  } finally {
    btn.dataset.armed = '';
    btn.textContent = '게임 내리기';
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
  const before = `${state.me.role}:${state.me.id || state.me.school || ''}`;
  state.me = me || { role: 'guest' };
  renderPassenger();
  if (before !== `${state.me.role}:${state.me.id || state.me.school || ''}` && state.lines.length) {
    renderSchoolFilter();
    renderTickets();
  }
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
      el('p', { class: 'passenger-who' }, el('span', { class: 'pass-badge' }, '선생님'), ` ${me.school} ${me.name}`),
      el('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => openSheet(null) }, '＋ 게임 올리기'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: logout }, '나가기'));
  } else if (me.role === 'student') {
    box.replaceChildren(
      el('p', { class: 'passenger-who' }, `${me.school} ${me.number}`),
      purseChip(),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: logout }, '나가기'));
  } else {
    box.replaceChildren(
      el('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => openLogin('student') }, '입장하기'));
  }
  renderHero();
}

function logout() {
  state.token = '';
  saveSession();
  setMe({ role: 'guest' });
  toast('나갔습니다. 다음에 또 오세요.');
}

function switchLoginTab(tab) {
  const student = tab === 'student';
  $('#tabStudent').setAttribute('aria-selected', String(student));
  $('#tabTeacher').setAttribute('aria-selected', String(!student));
  $('#studentForm').hidden = !student;
  $('#teacherForm').hidden = student;
  (student ? ($('#s-school').value ? $('#s-number') : $('#s-school')) : $('#t-password')).focus();
}

// 같은 컴퓨터에서 다시 들어올 때 학교 이름(선생님은 이름까지)을 채워 둔다
const REMEMBER_KEY = 'history-station-remember';
function remembered() {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}'); } catch { return {}; }
}
function remember(values) {
  try { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ ...remembered(), ...values })); } catch { /* 기억하지 못해도 괜찮다 */ }
}

function openLogin(tab = 'student', reason = '', after = null) {
  state.loginAfter = after;
  $('#loginReason').textContent = reason;
  $('#loginReason').hidden = !reason;
  $('#studentError').hidden = true;
  $('#teacherError').hidden = true;
  const saved = remembered();
  $('#t-password').value = '';
  $('#s-number').value = '';
  if (!$('#s-school').value) $('#s-school').value = saved.studentSchool || '';
  if (!$('#t-school').value) $('#t-school').value = saved.teacherSchool || '';
  if (!$('#t-name').value) $('#t-name').value = saved.teacherName || '';
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
  const body = { school: $('#s-school').value.trim(), number: $('#s-number').value.replace(/\s/g, '') };
  const fail = (msg, field) => { error.textContent = msg; error.hidden = false; field?.focus(); };
  if (body.school.length < 2) return fail('학교 이름을 적어 주세요. 예) 한빛중학교', $('#s-school'));
  if (!/^[0-9][0-9-]{0,11}$/.test(body.number)) return fail('학번을 숫자로 적어 주세요. 예) 20312', $('#s-number'));
  try {
    const result = await api('/api/session/student', { method: 'POST', body });
    remember({ studentSchool: result.me.school });
    finishLogin(result, result.created
      ? `어서 오세요, ${result.me.number} 승객님! 엽전 ${result.startingCoins}닢을 받았습니다.`
      : `다시 오셨네요, ${result.me.number} 승객님. 엽전 ${result.me.coins}닢이 있습니다.`);
  } catch (err) {
    fail(err.message);
  }
}

async function submitTeacher(e) {
  e.preventDefault();
  const error = $('#teacherError');
  error.hidden = true;
  const body = { password: $('#t-password').value, school: $('#t-school').value.trim(), name: $('#t-name').value.trim() };
  const fail = (msg, field) => { error.textContent = msg; error.hidden = false; field?.focus(); };
  if (!body.password) return fail('모임 비밀번호를 적어 주세요.', $('#t-password'));
  if (body.school.length < 2) return fail('학교 이름을 적어 주세요. 예) 한빛중학교', $('#t-school'));
  if (!body.name) return fail('선생님 이름을 적어 주세요.', $('#t-name'));
  try {
    const result = await api('/api/session/teacher', { method: 'POST', body });
    remember({ teacherSchool: result.me.school, teacherName: result.me.name });
    finishLogin(result, result.created
      ? `${result.me.school} ${result.me.name} 선생님, 처음 오셨네요. 환영합니다!`
      : `${result.me.school} ${result.me.name} 선생님으로 들어왔습니다.`);
  } catch (err) {
    fail(err.message, /비밀번호/.test(err.message) ? $('#t-password') : null);
  }
}

/* ───────── 시작 ───────── */
function renderAll() {
  renderSchoolFilter();
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
    state.limits = data.limits || state.limits;
    $('#htmlLimit').textContent = formatSize(state.limits.gameBytes);
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
$('#schoolFilter').addEventListener('change', (e) => { state.school = e.target.value; renderTickets(); });

// 탄 게임(iframe)에서 온 클리어 신호만 받는다
window.addEventListener('message', (e) => {
  const frame = $('#rideFrame');
  if (frame.hidden || e.source !== frame.contentWindow) return;
  if (e.data && e.data.type === SIGNAL) claimClear();
});

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
