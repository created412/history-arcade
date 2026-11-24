import json, os, re, shutil, sys
src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
lines = s.split('\n')
os.makedirs(out + '/data', exist_ok=True)

def take(prefix):
    idx = next(i for i, l in enumerate(lines) if l.startswith(prefix))
    return idx, lines[idx]

ia, la = take('const ASSETS = ')
iv, lv = take('const VO = ')
assets = json.loads(la[len('const ASSETS = '):].rstrip(';'))
vo = json.loads(lv[len('const VO = '):].rstrip(';'))
guide = {k: v for k, v in vo.items() if k.startswith('guide|')}
cast = {k: v for k, v in vo.items() if not k.startswith('guide|')}

def dump(path, var, obj, merge=False):
    body = json.dumps(obj, ensure_ascii=False)
    js = f'window.{var} = Object.assign(window.{var} || {{}}, {body});\n' if merge else f'window.{var} = {body};\n'
    open(path, 'w', encoding='utf-8').write(js)
    print(path, round(len(js.encode()) / 1e6, 2), 'MB')

dump(out + '/data/assets.js', 'ASSETS', assets)
dump(out + '/data/voice-cast.js', 'VO', cast, merge=True)
dump(out + '/data/voice-guide.js', 'VO', guide, merge=True)

# 게임 본체: 데이터 두 줄을 빼고, 판(수업용·복습용)에 따라 시작 화면의 모드 단추를 하나만 보인다
lines[ia] = '// ASSETS: data/assets.js'
lines[iv] = '// VO: data/voice-cast.js (+ data/voice-guide.js)'
shell = '\n'.join(lines)
old = "    $('[data-a=new]', v).onclick = () => go(false, 'solo');"
assert shell.count(old) == 1
shell = shell.replace(old, """    // 웹사이트 판: 수업용 페이지는 교사 진행만, 복습용 페이지는 혼자 해 보기만 보인다
    const ED = window.EDITION;
    if (ED === 'teach') $('[data-a=new]', v).remove();
    if (ED === 'solo') $('[data-a=teach]', v).remove();
    const home = h('<a class="linkbtn edhome" href="index.html#pick">← 다른 판 고르기</a>');
    if (ED) $('.small', v).prepend(home, document.createElement('br'));
""" + old)
shell = shell.replace("    $('[data-a=teach]', v).onclick = () => go(false, 'teach');",
                      "    const tb = $('[data-a=teach]', v); if (tb) tb.onclick = () => go(false, 'teach');")
shell = shell.replace("    $('[data-a=new]', v).onclick = () => go(false, 'solo');",
                      "    const nb = $('[data-a=new]', v); if (nb) nb.onclick = () => go(false, 'solo');")
# 웹사이트 판은 게임 시작 화면(이름·모드 선택)을 건너뛰고 바로 첫 장으로 들어간다
old_cont = "    const cont = $('[data-a=cont]', v); if (cont) cont.onclick = () => go(true);"
assert shell.count(old_cont) == 1
shell = shell.replace(old_cont, old_cont + """
    // 웹사이트 판: 시작 화면을 보이지 않고 곧바로 시작(복습용은 하던 기록이 있으면 이어서)
    if (ED) { v.style.display = 'none'; return go(ED === 'solo' && !!(saved && saved.ch > 0 && !saved.finished), ED); }""")
# 보고서의 「처음 화면」은 웹사이트에서는 판 고르기 화면으로
old_home = "    $('[data-a=home]', v).onclick = () => { v.remove(); titleScreen(); };"
assert shell.count(old_home) == 1
shell = shell.replace(old_home, "    $('[data-a=home]', v).onclick = () => { if (window.EDITION) { location.href = 'index.html#pick'; return; } v.remove(); titleScreen(); };")
# 페이지를 막 열었을 때는 브라우저가 소리를 막으므로, 장 표지의 「기록 시작」을 누를 때 배경음악을 다시 튼다
old_intro = "    await new Promise((res) => { $('.btn', v).onclick = res; $('.btn', v).focus(); });\n    v.style.transition = 'opacity .6s';"
assert shell.count(old_intro) == 1
shell = shell.replace(old_intro, "    await new Promise((res) => { $('.btn', v).onclick = res; $('.btn', v).focus(); });\n    if (bgm.src && bgm.paused && !muted) bgm.play().catch(() => {});\n    v.style.transition = 'opacity .6s';")
# 저장 키를 판마다 나눠서 서로의 이어하기 기록이 섞이지 않게
shell = shell.replace("const KEY = 'war-recorder-v3';", "const KEY = 'war-recorder-v3' + (window.EDITION ? '-' + window.EDITION : '');")
assert "const KEY = 'war-recorder-v3' + " in shell

def page(edition, scripts, name):
    p = shell.replace('<script>\n// ASSETS: data/assets.js', '<script>window.EDITION = %s;</script>\n%s\n<script>\n// ASSETS: data/assets.js' % (
        json.dumps(edition), '\n'.join(f'<script src="data/{x}"></script>' for x in scripts)), 1)
    assert p != shell, 'script anchor not found'
    open(out + '/' + name, 'w', encoding='utf-8').write(p)
    print(name, round(len(p.encode()) / 1e6, 2), 'MB')

page('teach', ['assets.js', 'voice-cast.js'], 'teach.html')
page('solo', ['assets.js', 'voice-cast.js', 'voice-guide.js'], 'solo.html')
