// 시간여행 역사(驛舍) — 의존성 없는 Node 서버
// 실행: node server.js  (기본 포트 3000, PORT 환경변수로 변경)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGithubStore } = require('./github-store');
const { createPassengers } = require('./passengers');

// 로컬 실행용 .env 파일(git에 올리지 않음)의 값을 환경변수로 읽는다
(function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
})();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const GAMES_DIR = path.join(DATA_DIR, 'games');
const DB_FILE = path.join(DATA_DIR, 'games.json');
const CLASSES_FILE = path.join(DATA_DIR, 'classes.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const MAX_BODY = 4 * 1024 * 1024; // 게임 정보(JSON)와 표지 그림
// HTML 게임 파일 한 개의 최대 크기. 파일은 디스크로 흘려 받고 GitHub 릴리스(파일당 2GB)에 보관하므로
// 메모리 부담은 없다. 게임을 여는 학생 기기를 생각해 기본 100MB로 두고, MAX_GAME_MB로 바꿀 수 있다.
const MAX_GAME_BYTES = Number(process.env.MAX_GAME_MB || 100) * 1024 * 1024;

// 노선(대분류)과 역(시대). 게임의 era 값은 '노선/역' 또는 환승역 '여러 시대'
// 역에는 1판부터 차례로 번호가 붙는다 (한국사 1~6판, 동양사 7~10판, 서양사 11~15판)
const LINES = [
  { id: 'korea', name: '한국사', stations: ['선사·고조선', '삼국·남북국', '고려', '조선', '근대', '현대'] },
  { id: 'east', name: '동양사', prefix: '동양', stations: ['고대', '중세', '근대', '현대'] },
  { id: 'west', name: '서양사', prefix: '서양', stations: ['고대', '중세', '근세', '근대', '현대'] },
];
const TRANSFER = '여러 시대';
// 게임마다 선생님이 정하는 차비와 클리어 보상 (엽전 닢)
const FARE = { min: 0, max: 5, default: 1 };
const REWARD = { min: 0, max: 10, default: 2 };
const ERAS = [...LINES.flatMap((l) => l.stations.map((st) => `${l.name}/${st}`)), TRANSFER];

// 예전 한 줄짜리 시대 이름을 새 분류로 옮긴다
const LEGACY_ERAS = {
  '선사·고조선': '한국사/선사·고조선', '삼국·남북국': '한국사/삼국·남북국', '고려': '한국사/고려',
  '조선': '한국사/조선', '근대': '한국사/근대', '현대': '한국사/현대', '세계사': TRANSFER,
  // 나라별로 나눴던 동양사는 시대를 알 수 없어 환승역으로 옮긴다
  '동양사/중국사': TRANSFER, '동양사/일본사': TRANSFER,
};
function migrateEras() {
  if (!fs.existsSync(DB_FILE)) return false;
  const games = readDb();
  let changed = false;
  for (const g of games) {
    if (LEGACY_ERAS[g.era]) { g.era = LEGACY_ERAS[g.era]; changed = true; }
  }
  if (changed) writeDb(games);
  return changed;
}

const SEED_DIR = path.join(ROOT, 'seed');

// GITHUB_TOKEN과 GITHUB_REPO가 있으면 데이터를 GitHub 브랜치에 보관한다 (무료 호스팅용)
const store = process.env.GITHUB_TOKEN && process.env.GITHUB_REPO
  ? createGithubStore({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPO, branch: process.env.DATA_BRANCH })
  : null;

// 처음 켤 때 정거장이 텅 비지 않도록 견본 게임을 들여놓는다
function seedGames() {
  const seedFile = path.join(SEED_DIR, 'games.json');
  const seeds = fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile, 'utf8')) : [];
  const now = new Date().toISOString();
  const changes = {};
  const games = seeds.map(({ pin, ...g }) => {
    const html = path.join(SEED_DIR, 'games', `${g.id}.html`);
    if (fs.existsSync(html)) {
      fs.copyFileSync(html, gameFile(g.id));
      changes[`games/${g.id}.html`] = fs.readFileSync(html, 'utf8');
    }
    return { plays: 0, createdAt: now, updatedAt: now, ...g, pinHash: hashPin(pin) };
  });
  fs.writeFileSync(DB_FILE, JSON.stringify(games, null, 2));
  changes['games.json'] = fs.readFileSync(DB_FILE, 'utf8');
  return changes;
}

async function prepareData() {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  if (store) {
    const files = await store.loadAll();
    for (const [rel, buf] of Object.entries(files)) {
      if (!['games.json', 'classes.json'].includes(rel) && !/^games\/[a-f0-9]{12}\.html$/.test(rel)) continue;
      fs.writeFileSync(path.join(DATA_DIR, rel), buf);
    }
    if (!files['games.json']) await store.save(seedGames(), '견본 게임 들여놓기');
    else if (migrateEras()) await persist({}, '시대 분류를 노선별로 옮기기');
    console.log(`데이터 보관소: GitHub ${store.describe}`);
    await restoreGameFiles();
  } else if (!fs.existsSync(DB_FILE)) {
    seedGames();
  } else {
    migrateEras();
  }
  passengers = createPassengers({
    file: CLASSES_FILE, hashPin, checkPin,
    onChange: (message, now) => (now ? persist({}, message) : persistLater()),
  });
  if (!passengers.teacherReady) console.warn('TEACHER_PASSWORD가 없어 교사로 들어올 수 없습니다.');
}

let passengers = null;

// 게임 파일을 보관소에서 내려받는다. 실패해도 서버는 켜고, 1분 뒤 다시 시도한다.
async function restoreGameFiles() {
  try {
    const count = await store.loadFiles(GAMES_DIR);
    console.log(`게임 파일 ${count}개를 보관소에서 받았습니다.`);
  } catch (e) {
    console.error('게임 파일을 받지 못했습니다. 1분 뒤 다시 시도합니다:', e.message);
    setTimeout(restoreGameFiles, 60 * 1000).unref();
  }
}

// 바뀐 파일을 보관소에 올린다. 로컬 실행(보관소 없음)이면 아무 일도 하지 않는다.
async function persist(changes, message) {
  if (!store) return;
  changes['games.json'] = fs.readFileSync(DB_FILE, 'utf8');
  if (fs.existsSync(CLASSES_FILE)) changes['classes.json'] = fs.readFileSync(CLASSES_FILE, 'utf8');
  try {
    await store.save(changes, message);
  } catch (e) {
    console.error('보관소 저장 실패, 다음 저장 때 다시 올립니다:', e.message);
  }
}

// 승차 횟수와 엽전은 판마다 커밋하지 않고 2분에 한 번 모아서 올린다
let laterTimer = null;
function persistLater() {
  if (!store || laterTimer) return;
  laterTimer = setTimeout(() => {
    laterTimer = null;
    persist({}, '승차·엽전 기록');
  }, 2 * 60 * 1000);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(games) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(games, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function checkPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(pin || ''), salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

// 비밀번호 해시는 절대 밖으로 내보내지 않는다
function publicGame(g) {
  const { pinHash, ...rest } = g;
  return { ...rest, ...fareOf(g) };
}

// 링크 게임은 클리어 신호를 보낼 수 없으므로 무료로 태운다
function fareOf(g) {
  if (g.kind === 'link') return { fare: 0, reward: 0 };
  return { fare: g.fare ?? FARE.default, reward: g.reward ?? REWARD.default };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? MIME['.json'] : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('게임 정보가 너무 큽니다. 표지 그림을 더 작은 것으로 골라 주세요.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('요청 형식이 올바르지 않습니다.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// 입력 검증: 새로 만들 때(partial=false)와 고칠 때(partial=true)
function validate(input, partial) {
  const out = {};
  const err = (m) => Object.assign(new Error(m), { status: 400 });
  const text = (key, max, required) => {
    if (input[key] === undefined) {
      if (required && !partial) throw err(`${key} 항목이 비어 있습니다.`);
      return;
    }
    const v = String(input[key]).trim();
    if (required && !v) throw err(`${key} 항목이 비어 있습니다.`);
    if (v.length > max) throw err(`${key} 항목은 ${max}자 이하로 적어 주세요.`);
    out[key] = v;
  };
  text('title', 40, true);
  text('author', 30, true);
  text('summary', 300, false);
  text('howTo', 300, false);
  text('grade', 20, false);

  if (input.era !== undefined || !partial) {
    if (!ERAS.includes(input.era)) throw err('시대를 골라 주세요.');
    out.era = input.era;
  }

  if (input.kind !== undefined || !partial) {
    if (input.kind === 'link') {
      let url;
      try { url = new URL(String(input.url || '')); } catch { throw err('게임 주소(URL)가 올바르지 않습니다.'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw err('게임 주소는 http:// 또는 https:// 로 시작해야 합니다.');
      out.kind = 'link';
      out.url = url.href;
    } else if (input.kind === 'html') {
      // 파일은 먼저 /api/uploads로 올리고, 받은 번호(upload)만 여기로 보낸다
      if (input.upload !== undefined) {
        const upload = String(input.upload);
        if (!/^[a-f0-9]{24}$/.test(upload) || !fs.existsSync(uploadFile(upload))) {
          throw err('올린 HTML 파일을 찾을 수 없습니다. 파일을 다시 골라 주세요.');
        }
        out.upload = upload;
      } else if (!partial) {
        throw err('HTML 파일을 골라 주세요.');
      }
      out.kind = 'html';
    } else {
      throw err('게임을 링크로 올릴지, HTML 파일로 올릴지 골라 주세요.');
    }
  }

  const coins = (key, range, label) => {
    if (input[key] === undefined || input[key] === '') return;
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < range.min || n > range.max) throw err(`${label}는 ${range.min}~${range.max}닢 사이로 정해 주세요.`);
    out[key] = n;
  };
  coins('fare', FARE, '차비');
  coins('reward', REWARD, '클리어 보상');

  if (input.cover !== undefined) {
    const c = String(input.cover);
    if (c && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(c)) throw err('표지 그림은 PNG, JPG, GIF, WEBP만 쓸 수 있습니다.');
    if (c.length > 2 * 1024 * 1024) throw err('표지 그림은 1.5MB 이하로 올려 주세요.');
    out.cover = c;
  }
  return out;
}

function gameFile(id) {
  return path.join(GAMES_DIR, `${id}.html`);
}

function uploadFile(id) {
  return path.join(UPLOADS_DIR, `${id}.html`);
}

// 올려 둔 파일을 게임 자리로 옮긴다. 보관소(GitHub 릴리스)에는 뒤에서 이어 올려
// 선생님이 큰 파일 보관이 끝날 때까지 기다리지 않게 한다.
function placeUpload(uploadId, gameId) {
  fs.renameSync(uploadFile(uploadId), gameFile(gameId));
  if (store) store.saveFile(gameId, gameFile(gameId));
  return {};
}

function forgetFile(gameId, changes) {
  if (fs.existsSync(gameFile(gameId))) fs.unlinkSync(gameFile(gameId));
  if (store) store.deleteFile(gameId);
  changes[`games/${gameId}.html`] = null; // 예전 방식(브랜치)에 남아 있을 수 있는 파일도 지운다
}

// HTML 파일을 메모리에 모으지 않고 바로 디스크에 흘려 쓴다
function receiveUpload(req, res) {
  const length = Number(req.headers['content-length'] || 0);
  const limitMb = Math.round(MAX_GAME_BYTES / 1024 / 1024);
  if (length > MAX_GAME_BYTES) {
    req.resume();
    return send(res, 413, { error: `HTML 파일은 ${limitMb}MB까지 올릴 수 있습니다.` });
  }
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const id = crypto.randomBytes(12).toString('hex');
  const file = uploadFile(id);
  const out = fs.createWriteStream(file);
  let size = 0;
  let failed = false;
  const fail = (status, message) => {
    if (failed) return;
    failed = true;
    out.destroy();
    fs.rm(file, { force: true }, () => {});
    if (!res.headersSent) send(res, status, { error: message });
    req.resume();
  };
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_GAME_BYTES) fail(413, `HTML 파일은 ${limitMb}MB까지 올릴 수 있습니다.`);
  });
  req.on('error', () => fail(400, '파일을 받는 중에 연결이 끊겼습니다. 다시 올려 주세요.'));
  out.on('error', () => fail(500, '파일을 저장하지 못했습니다.'));
  out.on('finish', () => {
    if (failed) return;
    if (size === 0) return fail(400, 'HTML 파일이 비어 있습니다.');
    send(res, 201, { upload: id, size });
  });
  req.pipe(out);
}

// 게임으로 옮기지 않은 채 남은 임시 파일은 한 시간 뒤 지운다
function sweepUploads() {
  if (!fs.existsSync(UPLOADS_DIR)) return;
  for (const name of fs.readdirSync(UPLOADS_DIR)) {
    const file = path.join(UPLOADS_DIR, name);
    if (Date.now() - fs.statSync(file).mtimeMs > 60 * 60 * 1000) fs.rmSync(file, { force: true });
  }
}
setInterval(sweepUploads, 15 * 60 * 1000).unref();

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', area, ...]
  if (parts[1] === 'session' || parts[1] === 'classes') return passengers.handle(req, res, parts, { readBody, send });
  if (parts[1] === 'rides' && req.method === 'POST' && parts[3] === 'clear') {
    return send(res, 200, passengers.clearRide(req, parts[2]));
  }
  if (parts[1] === 'uploads' && req.method === 'POST' && !parts[2]) {
    passengers.requireTeacher(req);
    return receiveUpload(req, res);
  }
  if (parts[1] !== 'games') return send(res, 404, { error: '없는 주소입니다.' });
  const id = parts[2];
  const games = readDb();

  if (req.method === 'GET' && !id) {
    return send(res, 200, {
      lines: LINES, transfer: TRANSFER, eras: ERAS,
      limits: { gameBytes: MAX_GAME_BYTES },
      games: games.map(publicGame),
    });
  }

  if (req.method === 'POST' && !id) {
    passengers.requireTeacher(req);
    const body = await readBody(req);
    const pin = String(body.pin || '');
    if (pin.length < 4) return send(res, 400, { error: '수정용 비밀번호는 4자 이상으로 정해 주세요.' });
    const data = validate(body, false);
    const now = new Date().toISOString();
    const game = {
      id: crypto.randomBytes(6).toString('hex'),
      title: data.title,
      author: data.author,
      era: data.era,
      grade: data.grade || '',
      summary: data.summary || '',
      howTo: data.howTo || '',
      kind: data.kind,
      url: data.kind === 'link' ? data.url : '',
      cover: data.cover || '',
      fare: data.fare ?? FARE.default,
      reward: data.reward ?? REWARD.default,
      plays: 0,
      createdAt: now,
      updatedAt: now,
      pinHash: hashPin(pin),
    };
    const changes = data.kind === 'html' ? placeUpload(data.upload, game.id) : {};
    games.unshift(game);
    writeDb(games);
    await persist(changes, `게임 등록: ${game.title}`);
    return send(res, 201, { game: publicGame(game) });
  }

  const idx = games.findIndex((g) => g.id === id);
  if (idx === -1) return send(res, 404, { error: '그 게임을 찾을 수 없습니다.' });
  const game = games[idx];

  // 개찰: 학생은 차비를 내고, 선생님은 그냥 탄다
  if (req.method === 'POST' && parts[3] === 'ride') {
    const ride = passengers.startRide(req, publicGame(game));
    game.plays = (game.plays || 0) + 1;
    writeDb(games);
    persistLater();
    return send(res, 200, { ...ride, plays: game.plays });
  }

  // 게임 고치기·치우기는 선생님으로 들어온 뒤, 그 게임의 비밀번호까지 맞아야 한다
  if (req.method !== 'GET') passengers.requireTeacher(req);

  if (req.method === 'POST' && parts[3] === 'verify') {
    const body = await readBody(req);
    if (!checkPin(body.pin, game.pinHash)) return send(res, 403, { error: '비밀번호가 맞지 않습니다.' });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    if (!checkPin(body.pin, game.pinHash)) return send(res, 403, { error: '비밀번호가 맞지 않습니다.' });
    const data = validate(body, true);
    let changes = {};
    if (data.upload !== undefined) {
      changes = placeUpload(data.upload, game.id);
      delete data.upload;
    }
    if (data.kind === 'link' && game.kind === 'html') forgetFile(game.id, changes);
    if (data.kind === 'html') {
      data.url = '';
      if (!fs.existsSync(gameFile(game.id))) return send(res, 400, { error: 'HTML 파일을 골라 주세요.' });
    }
    if (body.newPin) {
      if (String(body.newPin).length < 4) return send(res, 400, { error: '새 비밀번호는 4자 이상으로 정해 주세요.' });
      game.pinHash = hashPin(body.newPin);
    }
    Object.assign(game, data, { updatedAt: new Date().toISOString() });
    writeDb(games);
    await persist(changes, `게임 수정: ${game.title}`);
    return send(res, 200, { game: publicGame(game) });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    if (!checkPin(body.pin, game.pinHash)) return send(res, 403, { error: '비밀번호가 맞지 않습니다.' });
    games.splice(idx, 1);
    writeDb(games);
    const changes = {};
    if (game.kind === 'html') forgetFile(game.id, changes);
    await persist(changes, `게임 치움: ${game.title}`);
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: '지원하지 않는 요청입니다.' });
}

// 올라온 HTML 게임은 CSP sandbox로 격리된 출처에서 실행한다.
// (게임 코드가 사이트 API나 다른 선생님의 데이터에 접근하지 못하게)
function serveGame(res, id) {
  if (!/^[a-f0-9]{12}$/.test(id) || !fs.existsSync(gameFile(id))) {
    return send(res, 404, '게임 파일이 없습니다.');
  }
  res.writeHead(200, {
    'Content-Type': MIME['.html'],
    'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(gameFile(id)).pipe(res);
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, '페이지를 찾을 수 없습니다.');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      const m = url.pathname.match(/^\/play\/([^/]+)\/?$/);
      if (m) return serveGame(res, m[1]);
      return serveStatic(res, url.pathname);
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : '서버에서 문제가 생겼습니다.' });
    }
});

prepareData()
  .then(() => server.listen(PORT, () => console.log(`시간여행 역사 운행 시작 → http://localhost:${PORT}`)))
  .catch((e) => {
    console.error('데이터를 불러오지 못해 서버를 켜지 않았습니다:', e.message);
    process.exit(1);
  });

// 호스팅이 서버를 끌 때 모아 둔 승차·엽전 기록을 먼저 올린다
process.on('SIGTERM', async () => {
  if (laterTimer) { clearTimeout(laterTimer); await persist({}, '승차·엽전 기록'); }
  // 아직 보관 중인 게임 파일이 있으면 최대 25초 기다린다 (Render는 끄기 전 30초를 준다)
  if (store && store.pendingFiles()) {
    await Promise.race([store.flushFiles(), new Promise((r) => setTimeout(r, 25 * 1000))]);
  }
  process.exit(0);
});
