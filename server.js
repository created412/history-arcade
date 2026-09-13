// 시간여행 역사(驛舍) — 의존성 없는 Node 서버
// 실행: node server.js  (기본 포트 3000, PORT 환경변수로 변경)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGithubStore } = require('./github-store');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const GAMES_DIR = path.join(DATA_DIR, 'games');
const DB_FILE = path.join(DATA_DIR, 'games.json');
const MAX_BODY = 12 * 1024 * 1024; // 12MB (HTML 파일 + 표지 그림)

// 노선(대분류)과 역(시대). 게임의 era 값은 '노선/역' 또는 환승역 '여러 시대'
const LINES = [
  { id: 'korea', name: '한국사', stations: ['선사·고조선', '삼국·남북국', '고려', '조선', '근대', '현대'] },
  { id: 'east', name: '동양사', stations: ['중국사', '일본사'] },
  { id: 'west', name: '서양사', stations: ['고대', '중세', '근대', '현대'] },
];
const TRANSFER = '여러 시대';
const ERAS = [...LINES.flatMap((l) => l.stations.map((st) => `${l.name}/${st}`)), TRANSFER];

// 예전 한 줄짜리 시대 이름을 새 분류로 옮긴다
const LEGACY_ERAS = {
  '선사·고조선': '한국사/선사·고조선', '삼국·남북국': '한국사/삼국·남북국', '고려': '한국사/고려',
  '조선': '한국사/조선', '근대': '한국사/근대', '현대': '한국사/현대', '세계사': TRANSFER,
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
      if (rel !== 'games.json' && !/^games\/[a-f0-9]{12}\.html$/.test(rel)) continue;
      fs.writeFileSync(path.join(DATA_DIR, rel), buf);
    }
    if (!files['games.json']) await store.save(seedGames(), '견본 게임 들여놓기');
    else if (migrateEras()) await persist({}, '시대 분류를 노선별로 옮기기');
    console.log(`데이터 보관소: GitHub ${store.describe}`);
  } else if (!fs.existsSync(DB_FILE)) {
    seedGames();
  } else {
    migrateEras();
  }
}

// 바뀐 파일을 보관소에 올린다. 로컬 실행(보관소 없음)이면 아무 일도 하지 않는다.
async function persist(changes, message) {
  if (!store) return;
  changes['games.json'] = fs.readFileSync(DB_FILE, 'utf8');
  try {
    await store.save(changes, message);
  } catch (e) {
    console.error('보관소 저장 실패, 다음 저장 때 다시 올립니다:', e.message);
  }
}

// 플레이 횟수는 판마다 커밋하지 않고 10분에 한 번 모아서 올린다
let playsTimer = null;
function persistPlaysLater() {
  if (!store || playsTimer) return;
  playsTimer = setTimeout(() => {
    playsTimer = null;
    persist({}, '플레이 횟수 기록');
  }, 10 * 60 * 1000);
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
  return rest;
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
        reject(Object.assign(new Error('파일이 너무 큽니다. 12MB 이하로 올려 주세요.'), { status: 413 }));
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
      if (input.html !== undefined) {
        const html = String(input.html);
        if (!html.trim()) throw err('HTML 파일이 비어 있습니다.');
        out.html = html;
      } else if (!partial) {
        throw err('HTML 파일을 골라 주세요.');
      }
      out.kind = 'html';
    } else {
      throw err('게임을 링크로 올릴지, HTML 파일로 올릴지 골라 주세요.');
    }
  }

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

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','games',id?]
  if (parts[1] !== 'games') return send(res, 404, { error: '없는 주소입니다.' });
  const id = parts[2];
  const games = readDb();

  if (req.method === 'GET' && !id) {
    return send(res, 200, { lines: LINES, transfer: TRANSFER, eras: ERAS, games: games.map(publicGame) });
  }

  if (req.method === 'POST' && !id) {
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
      plays: 0,
      createdAt: now,
      updatedAt: now,
      pinHash: hashPin(pin),
    };
    if (data.kind === 'html') fs.writeFileSync(gameFile(game.id), data.html);
    games.unshift(game);
    writeDb(games);
    await persist(data.kind === 'html' ? { [`games/${game.id}.html`]: data.html } : {}, `게임 등록: ${game.title}`);
    return send(res, 201, { game: publicGame(game) });
  }

  const idx = games.findIndex((g) => g.id === id);
  if (idx === -1) return send(res, 404, { error: '그 게임을 찾을 수 없습니다.' });
  const game = games[idx];

  if (req.method === 'POST' && parts[3] === 'play') {
    game.plays = (game.plays || 0) + 1;
    writeDb(games);
    persistPlaysLater();
    return send(res, 200, { plays: game.plays });
  }

  if (req.method === 'POST' && parts[3] === 'verify') {
    const body = await readBody(req);
    if (!checkPin(body.pin, game.pinHash)) return send(res, 403, { error: '비밀번호가 맞지 않습니다.' });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    if (!checkPin(body.pin, game.pinHash)) return send(res, 403, { error: '비밀번호가 맞지 않습니다.' });
    const data = validate(body, true);
    const changes = {};
    if (data.html !== undefined) {
      fs.writeFileSync(gameFile(game.id), data.html);
      changes[`games/${game.id}.html`] = data.html;
      delete data.html;
    }
    if (data.kind === 'link' && fs.existsSync(gameFile(game.id))) {
      fs.unlinkSync(gameFile(game.id));
      changes[`games/${game.id}.html`] = null;
    }
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
    if (fs.existsSync(gameFile(game.id))) {
      fs.unlinkSync(gameFile(game.id));
      changes[`games/${game.id}.html`] = null;
    }
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

// 호스팅이 서버를 끌 때 모아 둔 플레이 횟수를 먼저 올린다
process.on('SIGTERM', async () => {
  if (playsTimer) { clearTimeout(playsTimer); await persist({}, '플레이 횟수 기록'); }
  process.exit(0);
});
