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

  return { loadAll, save, describe: `${repo}@${branch}` };
}

module.exports = { createGithubStore };
