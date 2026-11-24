# 목소리 다시 만들기 (일레븐랩스) — 다음 세션용 작업 목록

`voice-jobs.json`의 13개 대사를 일레븐랩스로 새로 만들어 `index.html`의 `VO`에 바꿔 넣는다.

## 할 일
| 화자 | 개수 | 이유 |
|---|---|---|
| 애치슨 `acheson` | 2 | 젊게 들림 → 중후한 50대 후반 미국 남성 |
| 스탈린 `stalin` | 2 | 실제 육성과 너무 다름 → 70대, 느리고 차분한 저음, 약간 쉰 목소리 |
| 김일성 `kim` | 2 | 목소리 교체 (1개는 삼팔선 발음도 포함) |
| 학예사 `guide` | 5 | `38도선`을 「삼십팔도선」으로 읽음 → 「삼팔선」 |
| 트루먼 `truman` | 1 | 같은 발음 문제 (트루먼은 직접 가공으로 이미 중후하게 바꿈, 같은 결로) |
| 마오 `mao` | 1 | 같은 발음 문제 |

- `tts_text`에는 이미 `38도선 → 삼팔선`을 바꿔 두었다. 화면 자막(`vo_key`의 `|` 뒤 글)은 그대로 둔다.
- 실제 육성 기준 목소리 높이(중앙값): 트루먼 144Hz, 애치슨 133Hz, 스탈린 182Hz(말 빠르기 초당 약 4음절로 느림).
- 학예사·마오·트루먼은 **원래 목소리와 같은 결**로 만들어야 한다(학예사는 젊은 여성 큐레이터).

## 넣는 법
1. 새 mp3를 모노 24kHz 48kbps로 맞춘다: `ffmpeg -i in.mp3 -ac 1 -ar 24000 -b:a 48k out.mp3`
2. `index.html`에서 `const VO = {...};` 줄을 JSON으로 읽어 `vo_key`의 값을 `data:audio/mpeg;base64,...`로 바꾼다.
3. 웹사이트 다시 만들기: `python3 tools/build_site.py index.html site`
4. 공개 주소 반영: `gh-pages` 브랜치에 `site/`의 `teach.html`·`solo.html`·`data/*.js`를 복사해 push
   (https://created412.github.io/history-arcade/)
