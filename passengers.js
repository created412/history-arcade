// 승객(교사·학생) 로그인과 엽전
// - 교사: 모임 공용 비밀번호(TEACHER_PASSWORD) + 학교 이름 + 선생님 이름으로 들어오고 엽전 없이 탄다.
//   여러 학교가 함께 쓰므로, 누가 어느 학교에서 게임을 올렸는지 구분하는 데 쓴다.
// - 학생: 학교 이름 + 학번만 적고 들어온다. 처음이면 엽전을 받고, 차비를 내고 타며, 클리어하면 보상을 받는다.
const fs = require('fs');
const crypto = require('crypto');

const STARTING_COINS = 3;
const MIN_CLEAR_SECONDS = 10;          // 타자마자 보내는 클리어 신호는 받지 않는다
const RIDE_TTL_MS = 3 * 60 * 60 * 1000; // 탑승 기록은 3시간 동안만 유효
const TEACHER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STUDENT_SESSION_MS = 24 * 60 * 60 * 1000;

const httpError = (status, message) => Object.assign(new Error(message), { status });

function createPassengers({ file, onChange }) {
  // 비밀번호는 코드에 적지 않는다 (저장소가 공개). 로컬은 .env, 배포는 Render 환경변수에 둔다.
  const teacherPassword = process.env.TEACHER_PASSWORD || '';
  const secret = process.env.SESSION_SECRET
    || crypto.createHash('sha256').update(`history-station:${teacherPassword}:${process.env.GITHUB_TOKEN || ''}`).digest('hex');

  // 파일 모양: { teachers: [...], students: [...] }
  const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const teachers = Array.isArray(stored.teachers) ? stored.teachers : [];
  const students = Array.isArray(stored.students) ? stored.students : [];
  const rides = new Map(); // rideId → { gameId, role, sid, fare, reward, startedAt, cleared }

  function save(message, { now = false } = {}) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ teachers, students }, null, 2));
    fs.renameSync(tmp, file);
    return onChange(message, now);
  }

  const tidy = (v) => String(v || '').trim().replace(/\s+/g, ' ');
  // 같은 학교를 '한빛중학교'와 '한빛중 학교'처럼 다르게 적어도 같게 본다
  const schoolKey = (v) => tidy(v).replace(/\s/g, '');

  // 띄어쓰기만 다르게 적었으면 이미 등록된 학교 표기로 맞춘다 (선생님 표기를 먼저 따른다)
  function readSchool(value) {
    const school = tidy(value);
    if (school.length < 2 || school.length > 40) throw httpError(400, '학교 이름을 2~40자로 적어 주세요. 예) 한빛중학교');
    const known = [...teachers, ...students].find((p) => schoolKey(p.school) === schoolKey(school));
    return known ? known.school : school;
  }

  /* ───── 세션 토큰: 서명한 JSON ───── */
  function sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  function verify(token) {
    const [body, mac] = String(token || '').split('.');
    if (!body || !mac) return null;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  }

  // 요청에서 승객을 알아낸다: { role: 'teacher', teacher } | { role: 'student', student } | null
  function identify(req) {
    const auth = req.headers.authorization || '';
    const payload = verify(auth.startsWith('Bearer ') ? auth.slice(7) : '');
    if (!payload) return null;
    if (payload.role === 'teacher') {
      const teacher = teachers.find((t) => t.id === payload.tid);
      return teacher ? { role: 'teacher', teacher } : null;
    }
    if (payload.role === 'student') {
      const student = students.find((s) => s.id === payload.sid);
      return student ? { role: 'student', student } : null;
    }
    return null;
  }

  function requireTeacher(req) {
    const who = identify(req);
    if (!who || who.role !== 'teacher') throw httpError(401, '선생님으로 들어와야 할 수 있습니다.');
    return who;
  }

  /* ───── 모임 비밀번호 시도 제한 ───── */
  // Render 같은 프록시 뒤에서는 X-Forwarded-For의 맨 앞 값을 요청자가 꾸밀 수 있으므로,
  // 프록시가 마지막에 덧붙인 맨 뒤 값을 쓴다.
  function clientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (process.env.RENDER && forwarded.length) return forwarded[forwarded.length - 1];
    return req.socket.remoteAddress;
  }

  const failures = new Map(); // key → { count, until }
  function checkThrottle(key, limit) {
    const f = failures.get(key);
    if (f && f.until > Date.now() && f.count >= limit) throw httpError(429, '비밀번호를 여러 번 틀렸습니다. 10분 뒤에 다시 시도해 주세요.');
  }
  function recordFailure(key) {
    const f = failures.get(key);
    const fresh = !f || f.until < Date.now();
    failures.set(key, { count: fresh ? 1 : f.count + 1, until: Date.now() + 10 * 60 * 1000 });
    if (failures.size > 5000) for (const [k, v] of failures) if (v.until < Date.now()) failures.delete(k);
  }

  function me(who) {
    if (!who) return { role: 'guest' };
    if (who.role === 'teacher') return { role: 'teacher', id: who.teacher.id, name: who.teacher.name, school: who.teacher.school };
    return { role: 'student', school: who.student.school, number: who.student.number, coins: who.student.coins };
  }

  /* ───── 탑승과 클리어 ───── */
  function startRide(req, game) {
    const who = identify(req);
    const fare = game.fare || 0;
    if (fare > 0 && !who) throw httpError(401, `이 열차는 엽전 ${fare}닢이 필요합니다. 학생이나 선생님으로 들어와 주세요.`);
    if (who && who.role === 'student') {
      if (who.student.coins < fare) throw httpError(402, `엽전이 모자랍니다. 이 열차는 ${fare}닢, 가진 엽전은 ${who.student.coins}닢입니다.`);
      who.student.coins -= fare;
      who.student.lastSeen = new Date().toISOString();
      if (fare > 0) save(`차비: ${who.student.school} ${who.student.number}`);
    }
    for (const [id, r] of rides) if (Date.now() - r.startedAt > RIDE_TTL_MS) rides.delete(id);
    const rideId = crypto.randomBytes(12).toString('hex');
    rides.set(rideId, {
      gameId: game.id, role: who ? who.role : 'guest', sid: who?.student?.id,
      fare, reward: game.reward || 0, startedAt: Date.now(), cleared: false,
    });
    return { rideId, fare, reward: game.reward || 0, me: me(who) };
  }

  function clearRide(req, rideId) {
    const ride = rides.get(rideId);
    if (!ride) throw httpError(404, '탑승 기록을 찾을 수 없습니다. 다시 개찰하고 타 주세요.');
    const who = identify(req);
    if (ride.cleared) return { reward: 0, already: true, me: me(who) };
    if (ride.role !== 'student') { ride.cleared = true; return { reward: 0, me: me(who) }; }
    if (!who || who.role !== 'student' || who.student.id !== ride.sid) throw httpError(403, '이 승차권을 끊은 학생만 보상을 받을 수 있습니다.');
    if (Date.now() - ride.startedAt < MIN_CLEAR_SECONDS * 1000) throw httpError(400, '너무 빨리 도착했습니다. 게임을 끝까지 해 주세요.');
    ride.cleared = true;
    who.student.coins += ride.reward;
    who.student.clears = who.student.clears || {};
    who.student.clears[ride.gameId] = (who.student.clears[ride.gameId] || 0) + 1;
    who.student.lastSeen = new Date().toISOString();
    save(`클리어 보상: ${who.student.school} ${who.student.number}`);
    return { reward: ride.reward, me: me(who) };
  }

  /* ───── 라우트 ───── */
  async function handle(req, res, parts, { readBody, send }) {
    const [, area, a] = parts; // api, area, ...
    if (area !== 'session') throw httpError(404, '없는 주소입니다.');

    if (req.method === 'GET' && !a) return send(res, 200, me(identify(req)));

    if (req.method === 'POST' && a === 'teacher') {
      const key = `teacher:${clientIp(req)}`;
      checkThrottle(key, 8);
      if (!teacherPassword) throw httpError(503, '모임 비밀번호가 아직 설정되지 않았습니다. 관리자가 TEACHER_PASSWORD를 정해야 합니다.');
      const body = await readBody(req);
      const given = crypto.createHash('sha256').update(String(body.password || '')).digest();
      const want = crypto.createHash('sha256').update(teacherPassword).digest();
      if (!crypto.timingSafeEqual(given, want)) {
        recordFailure(key);
        throw httpError(403, '모임 비밀번호가 맞지 않습니다.');
      }
      failures.delete(key);

      const school = readSchool(body.school);
      const name = tidy(body.name);
      if (!name || name.length > 20) throw httpError(400, '선생님 이름을 1~20자로 적어 주세요.');

      // 같은 학교 + 같은 이름이면 같은 선생님으로 본다 (처음이면 새로 등록)
      let teacher = teachers.find((t) => schoolKey(t.school) === schoolKey(school) && t.name === name);
      const created = !teacher;
      if (!teacher) {
        teacher = { id: crypto.randomBytes(6).toString('hex'), school, name, createdAt: new Date().toISOString() };
        teachers.push(teacher);
      }
      teacher.lastSeen = new Date().toISOString();
      await save(created ? `선생님 등록: ${school} ${name}` : `선생님 입장: ${name}`, { now: created });
      return send(res, 200, {
        token: sign({ role: 'teacher', tid: teacher.id, exp: Date.now() + TEACHER_SESSION_MS }),
        me: me({ role: 'teacher', teacher }), created,
      });
    }

    if (req.method === 'POST' && a === 'student') {
      const body = await readBody(req);
      const school = readSchool(body.school);
      const number = String(body.number || '').replace(/\s/g, '');
      if (!/^[0-9][0-9-]{0,11}$/.test(number)) throw httpError(400, '학번은 숫자로 적어 주세요. 예) 20312');

      // 같은 학교 + 같은 학번이면 같은 학생으로 본다 (처음이면 엽전을 주고 새로 등록)
      let student = students.find((s) => schoolKey(s.school) === schoolKey(school) && s.number === number);
      const created = !student;
      if (!student) {
        student = {
          id: crypto.randomBytes(6).toString('hex'), school, number,
          coins: STARTING_COINS, clears: {}, createdAt: new Date().toISOString(),
        };
        students.push(student);
      }
      student.lastSeen = new Date().toISOString();
      await save(created ? `학생 등록: ${school} ${number}` : `학생 입장: ${school} ${number}`, { now: created });
      return send(res, 200, {
        token: sign({ role: 'student', sid: student.id, exp: Date.now() + STUDENT_SESSION_MS }),
        me: me({ role: 'student', student }), created, startingCoins: STARTING_COINS,
      });
    }

    throw httpError(404, '없는 주소입니다.');
  }

  return { handle, identify, requireTeacher, startRide, clearRide, teacherReady: Boolean(teacherPassword) };
}

module.exports = { createPassengers, STARTING_COINS };
