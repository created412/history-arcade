# 역사오락실

‘미디어와 역사’ 모임 선생님들이 직접 만든 역사 게임을 올리고, 고치고, 함께 즐기는 웹 오락실입니다.

## 켜는 법

```bash
npm start          # 또는 node server.js
```

브라우저에서 http://localhost:3000 을 엽니다. 설치할 패키지는 없습니다(Node 18 이상).
포트를 바꾸려면 `PORT=8080 npm start`.

## 할 수 있는 일

- **한 판 하기**: 게임기의 엽전 버튼 → 엽전을 넣으면 게임이 오락실 화면 안에서 열립니다.
- **새 게임 들여놓기**: 게임 이름, 만든 선생님, 시대, 소개, 하는 방법을 적고
  - 한 개짜리 **HTML 파일**을 올리거나
  - 스크래치·구글 사이트·Genially 같은 **링크**를 붙입니다.
  - 표지 그림(선택)과 **수정용 비밀번호**를 정합니다.
- **고치기 / 치우기**: 올릴 때 정한 비밀번호로 내용·파일·비밀번호를 바꾸거나 게임기를 치웁니다.
- **시대별 보기, 찾기**: 선사·고조선부터 현대, 세계사, 여러 시대까지.

## 파일 구조

| 경로 | 내용 |
| --- | --- |
| `server.js` | 의존성 없는 Node 서버 (API + 정적 파일 + 게임 실행) |
| `github-store.js` | GitHub 브랜치를 데이터 보관소로 쓰는 모듈 |
| `render.yaml` | Render 배포 설정 |
| `public/` | 오락실 화면 (HTML·CSS·JS, 엽전 아이콘) |
| `seed/` | 처음 켤 때 들여놓는 견본 게임 (비밀번호 `1234`) |
| `data/` | 실제 저장소. `games.json`과 올라온 HTML 게임 파일 (git에서 제외) |

## 안전장치

- 올라온 HTML 게임은 `Content-Security-Policy: sandbox`로 격리된 출처에서 실행되어,
  오락실 데이터나 다른 선생님의 게임에 손대지 못합니다.
- 비밀번호는 scrypt 해시로만 저장하고 화면으로 내보내지 않습니다.
- 백업은 `data/` 폴더를 통째로 복사하면 됩니다.

## 인터넷에 올리기 (Render 무료 + GitHub 보관)

무료 호스팅은 재시작 때 디스크가 비워지므로, 올라온 게임은 이 저장소의 `arcade-data` 브랜치에
자동으로 커밋해 보관합니다. (`main`이 아니라서 게임을 올려도 재배포되지 않습니다.)

1. **GitHub 토큰 만들기**: GitHub → Settings → Developer settings → Fine-grained tokens → Generate
   - Repository access: *Only select repositories* → `history-arcade`
   - Permissions: *Contents* → **Read and write**
2. **Render에 연결하기**: [Deploy to Render](https://render.com/deploy?repo=https://github.com/created412/history-arcade)
   - `render.yaml` 설정대로 무료 웹 서비스가 만들어집니다.
   - `GITHUB_TOKEN` 칸에 1번 토큰을 붙여 넣고 *Apply*.
3. 몇 분 뒤 `https://history-arcade-xxxx.onrender.com` 같은 주소가 나오면 선생님들께 공유합니다.

무료 플랜은 15분 동안 접속이 없으면 잠들어, 다음 첫 접속에 30~50초가 걸립니다.

| 환경변수 | 뜻 |
| --- | --- |
| `GITHUB_TOKEN` | 저장소 Contents 쓰기 권한 토큰 (없으면 로컬 `data/` 폴더만 사용) |
| `GITHUB_REPO` | 보관할 저장소, 예: `created412/history-arcade` |
| `DATA_BRANCH` | 보관 브랜치 (기본 `arcade-data`) |
| `DATA_DIR` | 로컬 데이터 폴더 위치 (기본 `./data`) |
