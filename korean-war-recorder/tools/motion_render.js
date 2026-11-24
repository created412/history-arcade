// 모션 썸네일 렌더러: 게임의 지도 엔진(MAP)으로 1950~1953 전선 이동을 프레임마다 그려 PNG로 저장한다
const { chromium } = require('playwright');
const fs = require('fs');
const [page_, outDir, W = '1920', H = '1080', FPS = '30', SECS = '10'] = process.argv.slice(2);
const w = +W, h = +H, fps = +FPS, total = Math.round(+SECS * fps);
fs.mkdirSync(outDir, { recursive: true });

// 구간: [시작초, 끝초, 시작날짜, 끝날짜]
const SEG = [
  [0.0, 0.9, '1950-06-24', '1950-06-24'],
  [0.9, 3.3, '1950-06-25', '1950-08-01'],   // 북한군 남침 → 낙동강
  [3.3, 3.9, '1950-08-01', '1950-09-14'],
  [3.9, 5.7, '1950-09-15', '1950-11-24'],   // 인천 상륙 → 압록강
  [5.7, 7.2, '1950-11-25', '1951-01-15'],   // 중국군 개입 → 1·4 후퇴
  [7.2, 8.7, '1951-01-16', '1953-07-27'],   // 재반격 → 교착 → 정전
  [8.7, 10.0, '1953-07-27', '1953-07-27'],
];
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('file://' + page_);
  await p.waitForTimeout(1500);
  await p.addStyleTag({ content: `
    *, *::before, *::after { transition: none !important; animation: none !important; }
    .title, .hud, .fxlayer, .tpanel, .scene, .brandmark, .intro, .modal, .toast { display: none !important; }
    #mapHost { transform-origin: 72% 50%; }
    #map .lb:not(.klabel), #map .mk, #map .p38 text, #map #achT, #map #mdlT, .callout, .pin, .hot { display: none !important; }
    #map .lb.klabel text { font-size: calc(var(--u) * 26px) !important; }
    #map .front { stroke-width: calc(var(--u) * 3.6px) !important; filter: drop-shadow(0 0 calc(var(--u) * 6px) #ffb347); }
    #map .front-glow { stroke-width: calc(var(--u) * 14px) !important; opacity: var(--glow, .8) !important; filter: blur(calc(var(--u) * 3px)); }
    #map .arrow { stroke-width: calc(var(--u) * 7px) !important; }
    #ov { position: fixed; inset: 0; z-index: 99; pointer-events: none; font-family: 'GameSerif', serif; color: #f4ead2; }
    #ov .shade { position: absolute; inset: 0; background:
      linear-gradient(90deg, rgba(6,8,12,.96) 0%, rgba(6,8,12,.86) 27%, rgba(6,8,12,.38) 47%, rgba(6,8,12,0) 62%),
      radial-gradient(120% 100% at 72% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,.6) 100%); }
    #ov .flash { position: absolute; inset: 0; background: radial-gradient(60% 60% at 70% 45%, rgba(255,240,210,.85), rgba(255,120,60,.25) 50%, rgba(0,0,0,0) 80%); opacity: 0; }
    #ov .copy { position: absolute; left: ${w * 0.058}px; top: 50%; transform: translateY(-50%); }
    #ov .yr { font-weight: 700; font-size: ${h * 0.037}px; letter-spacing: .5em; color: #e6c878; margin-bottom: ${h * 0.015}px; text-shadow: 0 2px 12px rgba(0,0,0,.8); }
    #ov .t1, #ov .t2 { font-weight: 900; line-height: 1; background-clip: text; -webkit-background-clip: text; color: transparent; }
    #ov .t1 { font-size: ${h * 0.1}px; background-image: linear-gradient(180deg, #fff6df, #f1dcae 55%, #c9a24a); filter: drop-shadow(0 8px 24px rgba(0,0,0,.9)); }
    #ov .t2 { font-size: ${h * 0.2}px; margin-top: ${h * 0.006}px; background-image: linear-gradient(180deg, #fff, #f4ead2 50%, #d9b25e); filter: drop-shadow(0 12px 30px rgba(0,0,0,.95)); }
    #ov .rule { width: ${w * 0.27}px; height: 3px; margin: ${h * 0.026}px 0 ${h * 0.022}px; background: linear-gradient(90deg, #e6c878, rgba(230,200,120,0)); }
    #ov .tag { font-weight: 700; font-size: ${h * 0.04}px; text-shadow: 0 3px 16px rgba(0,0,0,.95); }
    #ov .tag b { color: #ff7a4c; }
    #ov .clock { position: absolute; right: ${w * 0.03}px; top: ${h * 0.045}px; text-align: right; text-shadow: 0 3px 16px rgba(0,0,0,.95); }
    #ov .clock .d { font-weight: 900; font-size: ${h * 0.062}px; letter-spacing: .02em; font-variant-numeric: tabular-nums; color: #fff4d6; }
    #ov .clock .e { margin-top: ${h * 0.006}px; display: inline-block; padding: ${h * 0.006}px ${h * 0.016}px; border-radius: 999px; background: rgba(140, 20, 28, .88); color: #fff; font-weight: 700; font-size: ${h * 0.026}px; }
    #ov .bar { position: absolute; left: ${w * 0.058}px; right: ${w * 0.03}px; bottom: ${h * 0.05}px; height: 4px; background: rgba(255,255,255,.14); border-radius: 2px; }
    #ov .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #c9a24a, #ffdf8a); border-radius: 2px; }
    #ov .logo { position: absolute; right: ${w * 0.02}px; bottom: ${h * 0.075}px; width: ${h * 0.11}px; border-radius: 50%; box-shadow: 0 6px 24px rgba(0,0,0,.65); }
  ` });
  await p.evaluate(({ w, h }) => {
    const ov = document.createElement('div'); ov.id = 'ov';
    ov.innerHTML = `<div class="shade"></div><div class="flash"></div>
      <div class="copy"><div class="yr">1945 – 1953</div><div class="t1">지도로 보는</div><div class="t2">6·25 전쟁</div><div class="rule"></div>
      <div class="tag">광복에서 정전까지, <b>전선</b>이 움직인 8년</div></div>
      <div class="clock"><div class="d"></div><div class="e"></div></div>
      <div class="bar"><i></i></div><img class="logo" src="logo.png">`;
    document.body.appendChild(ov);
    // 한반도가 오른쪽 3분의 1쯤에 오도록 16:9 범위를 잡는다
    const latSpan = 10.4, lonSpan = latSpan * (w / h) / 0.788, cx = 127.6;
    MAP.setView({ lon: [cx - 0.7 * lonSpan, cx + 0.3 * lonSpan], lat: [33.0, 33.0 + latSpan] }, true);
  }, { w, h });
  await p.waitForTimeout(800);

  const dn = await p.evaluate(() => [MAP.dnum('1950-06-24'), MAP.dnum('1953-07-27')]);
  for (let f = 0; f < total; f++) {
    const t = f / fps;
    const s = SEG.find((x) => t >= x[0] && t < x[1]) || SEG[SEG.length - 1];
    const k = ease(Math.min(1, Math.max(0, (t - s[0]) / (s[1] - s[0]))));
    await p.evaluate(({ s, k, t, f, total, dn }) => {
      const a = MAP.dnum(s[2]), z = MAP.dnum(s[3]);
      const n = a + (z - a) * k;
      MAP.setDate(n);
      const str = MAP.dstr(n);
      document.querySelector('#ov .d').textContent = `${+str.slice(0, 4)}. ${+str.slice(5, 7)}. ${+str.slice(8, 10)}.`;
      const ev = MAP.EV.filter((e) => e.n <= n).pop();
      const eEl = document.querySelector('#ov .e');
      eEl.textContent = ev ? ev.t : '';
      eEl.style.visibility = ev ? 'visible' : 'hidden';
      document.querySelector('#ov .bar i').style.width = `${((n - dn[0]) / (dn[1] - dn[0])) * 100}%`;
      // 카메라: 천천히 밀고 들어가며 전선 쪽으로 살짝 흔들림
      const zoom = 1 + 0.07 * (f / total);
      const sway = Math.sin(t * 0.9) * 6;
      const shake = t > 0.9 && t < 1.4 ? Math.sin(t * 90) * 7 * (1.4 - t) / 0.5 : 0;
      document.getElementById('mapHost').style.transform = `scale(${zoom}) translate(${sway + shake}px, ${shake * 0.6}px)`;
      // 6·25 새벽 섬광
      const fl = t > 0.9 && t < 1.6 ? Math.max(0, 1 - (t - 0.9) / 0.7) : 0;
      document.querySelector('#ov .flash').style.opacity = fl;
      document.getElementById('map').style.setProperty('--glow', (0.55 + 0.4 * Math.abs(Math.sin(t * 3.2))).toFixed(3));
    }, { s, k, t, f, total, dn });
    await p.screenshot({ path: `${outDir}/f${String(f).padStart(4, '0')}.png` });
  }
  await b.close();
  console.log('frames', total);
})();
