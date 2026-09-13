// GitHub 저장소 브랜치를 오락실 데이터 보관소로 쓴다.
// 무료 호스팅은 재시작 때 디스크가 비워지므로, 바뀐 파일을 커밋해 두고 켤 때 다시 받아온다.
// 필요한 환경변수: GITHUB_TOKEN(저장소 Contents 쓰기 권한), GITHUB_REPO(예: owner/name)
// 선택: DATA_BRANCH(기본 arcade-data) — main이 아닌 브랜치라 커밋해도 재배포되지 않는다.

const API = 'https://api.github.com';

function createGithubStore({ token, repo, branch = 'arcade-data', prefix = 'data' }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'history-arcade',
  };

  async function gh(method, path, body) {
    const res = await fetch(`${API}/repos/${repo}${path}`, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  async function headSha() {
    const ref = await gh('GET', `/git/ref/heads/${branch}`);
    return ref && ref.object.sha;
  }

  // 데이터 브랜치가 없으면 기본 브랜치에서 갈라 만든다
  async function ensureBranch() {
    const sha = await headSha();
    if (sha) return sha;
    const info = await gh('GET', '');
    const base = await gh('GET', `/git/ref/heads/${info.default_branch}`);
    await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: base.object.sha });
    return base.object.sha;
  }

  // 브랜치의 prefix/ 아래 파일을 모두 받아 { '상대경로': Buffer } 로 돌려준다
  async function loadAll() {
    const sha = await ensureBranch();
    const commit = await gh('GET', `/git/commits/${sha}`);
    const tree = await gh('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
    const files = {};
    for (const item of tree.tree) {
      if (item.type !== 'blob' || !item.path.startsWith(`${prefix}/`)) continue;
      const blob = await gh('GET', `/git/blobs/${item.sha}`);
      files[item.path.slice(prefix.length + 1)] = Buffer.from(blob.content, 'base64');
    }
    return files;
  }

  // 실패한 변경은 pending에 남겨 두었다가 다음 저장 때 함께 올린다
  const pending = new Map(); // 상대경로 → 내용(string) | null(삭제)
  let queue = Promise.resolve();

  function save(changes, message) {
    for (const [p, content] of Object.entries(changes)) pending.set(p, content);
    const run = queue.then(() => flush(message));
    queue = run.catch(() => {});
    return run;
  }

  async function flush(message) {
    if (pending.size === 0) return;
    const batch = new Map(pending);
    const parent = await ensureBranch();
    const parentCommit = await gh('GET', `/git/commits/${parent}`);
    const tree = [];
    for (const [p, content] of batch) {
      const path = `${prefix}/${p}`;
      if (content === null) {
        tree.push({ path, mode: '100644', type: 'blob', sha: null });
      } else {
        const blob = await gh('POST', '/git/blobs', { content: Buffer.from(content).toString('base64'), encoding: 'base64' });
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
    }
    let newTree;
    try {
      newTree = await gh('POST', '/git/trees', { base_tree: parentCommit.tree.sha, tree });
    } catch (e) {
      // 이미 없는 파일을 지우려 하면 실패하므로, 삭제 항목을 빼고 다시 시도
      const kept = tree.filter((t) => t.sha !== null);
      if (kept.length === tree.length) throw e;
      newTree = await gh('POST', '/git/trees', { base_tree: parentCommit.tree.sha, tree: kept });
    }
    const commit = await gh('POST', '/git/commits', { message, tree: newTree.sha, parents: [parent] });
    await gh('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha });
    for (const [p, content] of batch) if (pending.get(p) === content) pending.delete(p);
  }

  /* ───── 게임 HTML 파일: 릴리스 첨부 파일로 보관 ─────
     브랜치 커밋은 base64로 부풀어 큰 파일(수십 MB)에서 실패하므로,
     파일당 2GB까지 원본 그대로 받는 GitHub Releases 첨부 파일을 쓴다.
     첨부 이름은 '게임번호--올린시각.html'이고, 같은 게임의 예전 첨부는 새것이 올라간 뒤 지운다. */
  const RELEASE_TAG = `${branch}-files`;
  let releaseId = null;

  // GitHub가 잠깐 5xx를 낼 때가 있어 몇 번 다시 시도한다
  async function retry(fn, tries = 4) {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i >= tries || !/→ 5\d\d|fetch failed|ECONNRESET|ETIMEDOUT/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 1500 * i));
      }
    }
  }

  async function ensureRelease() {
    if (releaseId) return releaseId;
    let rel = await retry(() => gh('GET', `/releases/tags/${RELEASE_TAG}`));
    if (!rel) {
      // 태그는 기본 브랜치에 붙는다. 태그와 릴리스는 Render 재배포를 일으키지 않는다.
      rel = await retry(() => gh('POST', '/releases', {
        tag_name: RELEASE_TAG, name: '시간여행 역사 게임 파일',
        body: '시간여행 역사 서버가 선생님들이 올린 HTML 게임 파일을 보관하는 곳입니다. 직접 지우지 마세요.',
        prerelease: true,
      }).catch(async (e) => {
        // 동시에 다른 요청이 먼저 만들었다면 그것을 쓴다
        const existing = await gh('GET', `/releases/tags/${RELEASE_TAG}`);
        if (existing) return existing;
        throw e;
      }));
    }
    releaseId = rel.id;
    return releaseId;
  }

  async function listAssets() {
    const id = await ensureRelease();
    const assets = [];
    for (let page = 1; ; page++) {
      const batch = await gh('GET', `/releases/${id}/assets?per_page=100&page=${page}`);
      assets.push(...batch);
      if (batch.length < 100) return assets;
    }
  }

  const assetGame = (name) => (name.match(/^([a-f0-9]{12})--(\d+)\.html$/) || []).slice(1);

  // https.request는 fetch와 달리 응답 대기 시간 제한이 없어 큰 파일도 끝까지 보낸다
  function request(url, { method = 'GET', headers: extra = {}, body, toFile } = {}) {
    const https = require('https');
    const fs = require('fs');
    return new Promise((resolve, reject) => {
      const req = https.request(url, { method, headers: { ...headers, ...extra } }, (res) => {
        if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
          res.resume();
          // 내려받기는 저장소 서버로 넘겨지며, 이때는 토큰을 보내지 않는다
          const next = require('https');
          const again = next.get(res.headers.location, (r2) => pipeOut(r2));
          again.on('error', reject);
          return;
        }
        pipeOut(res);
      });
      function pipeOut(res) {
        if (res.statusCode >= 400) {
          let text = '';
          res.on('data', (c) => { text += c; });
          res.on('end', () => reject(new Error(`GitHub ${method} ${url} → ${res.statusCode} ${text.slice(0, 200)}`)));
          return;
        }
        if (toFile) {
          const out = fs.createWriteStream(toFile);
          res.pipe(out);
          out.on('finish', () => resolve(null));
          out.on('error', reject);
        } else {
          let text = '';
          res.on('data', (c) => { text += c; });
          res.on('end', () => resolve(text ? JSON.parse(text) : null));
        }
      }
      req.on('error', reject);
      if (body) {
        const stream = fs.createReadStream(body);
        stream.on('error', reject);
        stream.pipe(req);
      } else {
        req.end();
      }
    });
  }

  // 서버가 켜질 때: 게임마다 가장 최근 첨부 파일을 dir/게임번호.html 로 내려받는다
  async function loadFiles(dir) {
    const latest = new Map();
    for (const a of await listAssets()) {
      const [gameId, stamp] = assetGame(a.name);
      if (!gameId) continue;
      if (!latest.has(gameId) || Number(stamp) > Number(assetGame(latest.get(gameId).name)[1])) latest.set(gameId, a);
    }
    const path = require('path');
    for (const [gameId, a] of latest) {
      const tmp = path.join(dir, `${gameId}.html.part`);
      await request(`${API}/repos/${repo}/releases/assets/${a.id}`, { headers: { Accept: 'application/octet-stream' }, toFile: tmp });
      require('fs').renameSync(tmp, path.join(dir, `${gameId}.html`));
    }
    return latest.size;
  }

  // 올리기·지우기는 게임별로 마지막 요청만 남겨 차례로 처리한다 (실패하면 1분 뒤 다시)
  const filePending = new Map(); // 게임번호 → 파일 경로 | null(지우기)
  let fileQueue = Promise.resolve();
  let retryTimer = null;

  function queueFile(gameId, filePath) {
    filePending.set(gameId, filePath);
    fileQueue = fileQueue.then(flushFiles).catch((e) => {
      console.error('게임 파일 보관 실패, 1분 뒤 다시 시도합니다:', e.message);
      if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; fileQueue = fileQueue.then(flushFiles).catch(() => {}); }, 60 * 1000);
    });
    return fileQueue;
  }

  async function flushFiles() {
    const fs = require('fs');
    for (const [gameId, filePath] of [...filePending]) {
      const id = await ensureRelease();
      const old = (await listAssets()).filter((a) => assetGame(a.name)[0] === gameId);
      if (filePath) {
        if (!fs.existsSync(filePath)) { filePending.delete(gameId); continue; }
        const size = fs.statSync(filePath).size;
        const name = `${gameId}--${Date.now()}.html`;
        const t0 = Date.now();
        await request(`https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=${name}`, {
          method: 'POST', body: filePath,
          headers: { 'Content-Type': 'text/html', 'Content-Length': size },
        });
        console.log(`게임 파일 보관: ${name} (${(size / 1048576).toFixed(1)}MB, ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
      }
      for (const a of old) await gh('DELETE', `/releases/assets/${a.id}`);
      if (filePending.get(gameId) === filePath) filePending.delete(gameId);
    }
  }

  return {
    loadAll, save, describe: `${repo}@${branch}`,
    loadFiles,
    saveFile: (gameId, filePath) => queueFile(gameId, filePath),
    deleteFile: (gameId) => queueFile(gameId, null),
    flushFiles: () => fileQueue,
    pendingFiles: () => filePending.size,
  };
}

module.exports = { createGithubStore };
