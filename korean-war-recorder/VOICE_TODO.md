# 목소리 다시 만들기 (일레븐랩스) — 다음 세션용 작업 목록

`voice-jobs.json`의 13개 대사를 일레븐랩스로 새로 만들어 `index.html`의 `VO`에 바꿔 넣는다.

## 할 일 (22개, 자세한 목록은 voice-jobs.json)
| 화자 | 개수 | 이유 |
|---|---|---|
| 지도자 7명(애치슨·스탈린·김일성·트루먼·맥아더·마오·이승만) | 12 | **대사 전면 수정** — 실제 기록 기반 새 대사(SCRIPT_LEADERS.md). 화자별 목소리 지시는 voice-jobs.json의 `voice` |
| 학예사 `guide` | 5 | `38도선`을 「삼십팔도선」으로 읽음 → 「삼팔선」 |
| 학도병 이우근 `student` | 3 | 너무 밝음 → 17세 학도병의 참담함. 녹음 뒤 `tools/somber.sh` |
| 아나운서 `announcer` | 2 | 1950년 라디오 아나운서 말투. 녹음 뒤 `tools/radio.sh` |

- 지도자 장면은 이제 옛 입 모양 영상(LV_*_talk)을 쓰지 않고 움직이는 초상 + 새 목소리로 나온다. 새 목소리를 넣기 전까지 지도자 대사는 **소리 없이 글자만** 나온다 → 그래서 공개 주소(gh-pages)에는 아직 반영하지 않았다. 목소리를 넣은 뒤 함께 배포할 것.
- `tts_text`에는 `38도선 → 삼팔선`을 바꿔 두었다. 화면 자막(`vo_key`의 `|` 뒤 글)은 그대로.
- 실제 육성 기준 목소리 높이(중앙값): 트루먼 144Hz, 애치슨 133Hz, 스탈린 182Hz(말 빠르기 초당 약 4음절).

## 넣는 법
1. 새 mp3를 모노 24kHz 48kbps로 맞춘다: `ffmpeg -i in.mp3 -ac 1 -ar 24000 -b:a 48k out.mp3`
2. `index.html`에서 `const VO = {...};` 줄을 JSON으로 읽어 `vo_key`의 값을 `data:audio/mpeg;base64,...`로 바꾼다.
3. 웹사이트 다시 만들기: `python3 tools/build_site.py index.html site`
4. 공개 주소 반영: `gh-pages` 브랜치에 `site/`의 `teach.html`·`solo.html`·`data/*.js`를 복사해 push
   (https://created412.github.io/history-arcade/)
