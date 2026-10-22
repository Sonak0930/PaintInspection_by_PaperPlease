'use strict';

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/bmp'];
const COMPANY = '블루씨중공업';
const DAY_QUOTA = 5;            // 하루 처리 건수 → 채우면 근무 종료
const SAVE_KEY = 'paint-inspection-save-v1';
const PAY = { salary: 10, arrestBonus: 5, rent: 20, food: 15, heat: 10 };
const FAMILY = ['아내', '아들', '장모', '삼촌'];

const $ = (id) => document.getElementById(id);
const els = {
  game: $('game'),
  desk: $('desk'),
  docSlot: $('docSlot'),
  deskEmpty: $('deskEmpty'),
  stampBar: $('stampBar'),
  stampApproved: $('stampApproved'),
  stampDenied: $('stampDenied'),
  applicant: $('applicant'),
  portrait: $('portrait'),
  guardLeft: $('guardLeft'),
  guardRight: $('guardRight'),
  tagDept: $('tagDept'),
  tagName: $('tagName'),
  speech: $('speech'),
  nextBtn: $('nextBtn'),
  fileInput: $('fileInput'),
  yard: $('yard'),
  ledger: $('ledger'),
  countOk: $('countOk'),
  countNg: $('countNg'),
  day: $('day'),
  clock: $('clock'),
  soundToggle: $('soundToggle'),
  permitTemplate: $('permitTemplate'),
  dayScreen: $('dayScreen'),
};

const state = {
  busy: false,
  closed: true,        // 보고서/신문 화면이 떠 있는 동안 접수 중지
  permitNo: 0,
  ok: 0,
  ng: 0,
  currentUrl: null,
  day: 1,
  savings: 0,
  family: FAMILY.map((name) => ({ name, hungry: 0, cold: 0 })),
  todayLog: [],
  lastLog: null,
  jaehongSlot: 0,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* ---------- 저장 (이 브라우저에만, 실패해도 게임은 진행) ---------- */
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.day) Object.assign(state, { day: s.day, savings: s.savings, family: s.family, lastLog: s.lastLog });
  } catch { /* 저장소 사용 불가 */ }
}

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ day: state.day, savings: state.savings, family: state.family, lastLog: state.lastLog }));
  } catch { /* 저장소 사용 불가 */ }
}

/* ---------- 대사 (Papers, Please 패러디) ---------- */
const LINES = {
  request: ['서류.', '도장 사진.', '서류를 제출하십시오.', '블록 사진. 어서.'],
  handover: [
    '여기 있습니다. {block} 블록입니다.',
    '어젯밤 새워서 칠했습니다. 확인해 주십시오.',
    '반장님이 이번엔 꼭 통과시키라고 하셨습니다.',
    '이 사진... 문제 없을 겁니다. 아마도요.',
    '영광을 {company}에. 서류입니다.',
    '딸아이 생일입니다. 빨리 부탁드립니다.',
    '도막 두께 측정했습니다. 진짜로요.',
    '{dept}에서 왔습니다. 사진 여기요.',
    '...',
  ],
  checking: ['흠.', '...', '확인 중.', '움직이지 마십시오.'],
  approvedInspector: ['통과. 문제 일으키지 마십시오.', '이상 없음. 통과.', '승인. 다음.'],
  approvedWorker: [
    '영광을 {company}에!',
    '감사합니다! 정말 감사합니다!',
    '역시. 저는 실수 안 합니다.',
    '휴... 오늘은 집에 갈 수 있겠군.',
    '다음 블록도 잘 부탁드립니다.',
  ],
  deniedInspector: ['DISCREPANCY DETECTED — {label}. 경비업체!', '{label} 확인. 연행하십시오.', '{label}. 경비업체 호출.'],
  deniedWorker: [
    '안 돼... 제발요!',
    '이건 실수입니다! 다시 확인해 주십시오!',
    '반장님한테는 말하지 말아 주세요...',
    '재도장하겠습니다! 연행만은!',
    '저는 지시대로 칠했을 뿐입니다!',
    '용접은 제가 한 게 아닙니다!',
  ],
  guard: ['따라오십시오.', '조용히 하고 따라와.', '도장 불량 현행범으로 연행합니다.', '경비실로 갑니다. 움직여.'],
  // 박재홍 전용 대사
  jaehongHandover: ['박재홍입니다. 오늘은 진짜 잘 칠했어요.', '또 저예요. 이번엔 자신 있습니다.', '박재홍, {block} 블록 제출합니다.'],
  jaehongApproved: ['거 봐요. 제가 뭐랬어요.', '영광을 {company}에! 퇴근!'],
  jaehongDenied: ['저 박재홍이에요! 저 몰라요?!', '이번 한 번만요! 제발!', '내일 신문에 나오면 안 되는데...'],
};

function fill(text, ctx) {
  return text.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');
}

/* ---------- 작업자 생성 ---------- */
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송'];
const GIVEN_M = ['민수', '영호', '성철', '재훈', '동현', '상우', '지훈', '현석', '태영', '기범', '준호', '명수', '광석', '병철', '진우', '승현'];
const GIVEN_F = ['지영', '수진', '민지', '서연', '은정', '혜진', '유나', '미경', '소영', '하은', '다은', '정아'];
const DEPTS = ['도장1부', '도장2부', '의장부', '선각부', '탑재부', '블록도장팀'];
const SKINS = ['#d8b08c', '#c99a76', '#b5835f', '#a8714f'];
const HAIR = ['#2a1d16', '#2a1d16', '#3b2c22', '#6b645a'];

const randomBlock = () => `${1 + Math.floor(Math.random() * 3)}도크 ${pick('ABCDEF')}${100 + Math.floor(Math.random() * 900)}`;

function makeWorker() {
  const female = Math.random() < 0.4;
  return {
    name: pick(SURNAMES) + pick(female ? GIVEN_F : GIVEN_M),
    female,
    dept: pick(DEPTS),
    block: randomBlock(),
    skin: pick(SKINS),
    hair: female ? pick(HAIR.slice(0, 3)) : pick(HAIR),
    brow: female ? 1 : pick([1, 1, 2]),
    glasses: Math.random() < 0.65,
    mask: Math.random() < 0.2,
    mustache: !female && Math.random() < 0.25,
  };
}

// 하루에 한 번 꼭 오는 고정 캐릭터 (판정은 다른 사람과 똑같이 모델 결과대로)
function makeJaehong() {
  return {
    name: '박재홍', female: true, special: true, dept: '도장1부', block: randomBlock(),
    skin: '#d8b08c', hair: '#2a1d16', brow: 1, glasses: true, mask: false, mustache: false,
  };
}

/* ---------- 효과음 (WebAudio로 직접 합성, 파일 없음) ---------- */
const sound = {
  ctx: null,
  enabled: true,
  init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.enabled = false; }
    }
  },
  noise(duration, filterType, freq, gain) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
  },
  tone(type, from, to, duration, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  },
  siren(duration) {
    // 오르내리는 경보음
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'square';
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    osc.frequency.setValueAtTime(620, t0);
    for (let t = 0; t < duration; t += 0.7) {
      osc.frequency.linearRampToValueAtTime(1150, t0 + t + 0.35);
      osc.frequency.linearRampToValueAtTime(620, t0 + t + 0.7);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.1);
    g.gain.setValueAtTime(0.07, t0 + duration - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(filter).connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
  },
  play(name) {
    if (!this.enabled || !this.ctx) return;
    if (name === 'paper') this.noise(0.18, 'bandpass', 2400, 0.35);
    if (name === 'stamp') { this.noise(0.09, 'lowpass', 500, 0.9); this.tone('sine', 110, 40, 0.22, 0.8); }
    if (name === 'bell') { this.tone('square', 880, 870, 0.12, 0.08); setTimeout(() => this.tone('square', 660, 650, 0.18, 0.08), 130); }
    if (name === 'buzz') this.tone('sawtooth', 120, 110, 0.35, 0.12);
    if (name === 'siren') this.siren(4.2);
    if (name === 'steps') for (let i = 0; i < 4; i++) setTimeout(() => this.noise(0.06, 'lowpass', 280, 0.7), i * 150);
  },
};

/* ---------- 상단: 날짜, 시계 ---------- */
function todayText() {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
}

function initHeader() {
  const tick = () => {
    const d = new Date();
    els.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  tick();
  setInterval(tick, 10000);
}

/* ---------- 상단: 대기 마당 (지그재그 두 줄) ---------- */
const YARD = { spacing: 16, baseX: 34, laneY: [8, 58], emptySlots: 3, rightReserve: 64 };
const yard = { people: [], perLane: 0 };

function makeSprite(kind, colors = {}) {
  const el = document.createElement('span');
  el.className = `sprite ${kind}`;
  if (kind === 'worker') {
    if (colors.female ?? Math.random() < 0.4) el.classList.add('female');
    el.style.setProperty('--hat', colors.hat || (Math.random() < 0.85 ? '#e8b524' : '#e6e2d6'));
    el.style.setProperty('--skin', colors.skin || pick(SKINS));
    el.style.setProperty('--h', `${pick([22, 24, 26])}px`);
  }
  return el;
}

function yardSlot(i) {
  const n = yard.perLane;
  const lane = i < n ? 0 : 1;
  const j = lane === 0 ? i : n - 1 - (i - n);
  return { x: YARD.baseX + j * YARD.spacing, y: YARD.laneY[lane] };
}

function layoutYard() {
  const w = els.yard.clientWidth;
  if (!w) return;
  yard.perLane = Math.max(4, Math.floor((w - YARD.baseX - YARD.rightReserve) / YARD.spacing));
  const total = yard.perLane + Math.max(0, yard.perLane - YARD.emptySlots);
  while (yard.people.length < total) {
    const p = makeSprite('worker');
    p.classList.add('arriving');
    els.yard.appendChild(p);
    yard.people.push(p);
  }
  while (yard.people.length > total) yard.people.pop().remove();
  yard.people.forEach((p, i) => {
    const { x, y } = yardSlot(i);
    p.style.left = `${x}px`;
    p.style.bottom = `${y}px`;
  });
}

async function advanceQueue() {
  const first = yard.people.shift();
  if (!first) return;
  first.classList.add('walking');
  first.style.left = '-16px';
  first.style.opacity = '0';
  yard.people.forEach((p) => p.classList.add('walking'));
  layoutYard();
  await sleep(550);
  first.remove();
  yard.people.forEach((p) => p.classList.remove('walking', 'arriving'));
}

function yardEscort(worker) {
  // 경비업체 직원 둘이 작업자를 끌고 오른쪽 경비실로
  const group = document.createElement('div');
  group.className = 'escort';
  group.append(makeSprite('guard'), makeSprite('worker', { hat: '#e8b524', skin: worker.skin, female: worker.female }), makeSprite('guard'));
  group.querySelectorAll('.sprite').forEach((s) => s.classList.add('walking'));
  els.yard.appendChild(group);
  void group.offsetWidth;
  group.style.left = `${els.yard.clientWidth - 46}px`;
  els.yard.classList.add('door-open');
  setTimeout(() => { group.remove(); els.yard.classList.remove('door-open'); }, 3300);
}

/* ---------- 부스 ---------- */
function say(who, text, alert = false) {
  els.speech.querySelector('.who').textContent = who;
  els.speech.querySelector('.line').textContent = text;
  els.speech.dataset.who = who === '검사관' ? 'inspector' : who === '경비업체' ? 'guard' : 'worker';
  els.speech.classList.toggle('alert', alert);
}

function pixelPainter(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
}

// 블루씨중공업 작업자: 노란 안전모 + 회색 작업복 + 네이비 티셔츠 + 보안경
function drawWorker(w, { sweat = false } = {}, canvas = els.portrait) {
  const r = pixelPainter(canvas);
  const SUIT = '#d6d8d2', SUIT_SHADE = '#b3b6af', SUIT_LINE = '#9a9d96';
  const SKIN_SHADE = 'rgba(80, 40, 20, 0.28)';
  const HAT = '#e8b524', HAT_SHADE = '#b88a14', STRAP = '#2f5fa8';

  // 어깨 / 작업복
  r(3, 27, 34, 13, SUIT);
  r(31, 28, 6, 12, SUIT_SHADE);
  r(3, 28, 2, 12, SUIT_SHADE);
  r(17, 26, 6, 3, '#232a3a');   // 네이비 티셔츠 (V넥)
  r(18, 29, 4, 2, '#232a3a');
  r(19, 31, 2, 1, '#232a3a');
  r(14, 26, 3, 5, SUIT_SHADE);  // 깃
  r(23, 26, 3, 5, SUIT_SHADE);
  r(20, 32, 1, 8, SUIT_LINE);   // 지퍼
  r(6, 33, 10, 1, SUIT_LINE);   // 가슴 주머니
  r(24, 33, 10, 1, SUIT_LINE);
  r(25, 29, 9, 3, '#1f4ea3');   // 가슴 로고 바탕
  r(6, 29, 10, 4, '#f2efe6');   // 명찰 바탕

  // 여성: 안전모 아래로 내려온 긴 머리 + 포니테일 (얼굴 뒤에 먼저 그림)
  if (w.female) {
    r(10, 9, 3, 17, w.hair);
    r(27, 9, 3, 17, w.hair);
    r(30, 11, 3, 13, w.hair);
    r(31, 23, 2, 3, w.hair);
  }

  // 목, 얼굴
  r(17, 22, 6, 5, w.skin);
  r(17, 25, 6, 1, SKIN_SHADE);
  r(12, 8, 16, 16, w.skin);
  if (!w.female) {
    r(11, 14, 1, 4, w.skin);
    r(28, 14, 1, 4, w.skin);
  }
  r(26, 9, 2, 14, SKIN_SHADE);
  const ctx = canvas.getContext('2d');
  if (!w.female) {
    ctx.clearRect(12, 23, 1, 1);
    ctx.clearRect(27, 23, 1, 1);
  }
  if (w.female) r(13, 9, 14, 2, w.hair); // 앞머리

  // 눈썹, 눈, 코, 입
  r(14, 13, 4, w.brow, w.hair);
  r(22, 13, 4, w.brow, w.hair);
  r(15, 15, 2, 1, '#2a1d16');
  r(23, 15, 2, 1, '#2a1d16');
  if (w.female) {
    r(14, 15, 1, 1, '#2a1d16'); // 속눈썹
    r(25, 15, 1, 1, '#2a1d16');
  }
  r(19, 16, 2, 3, SKIN_SHADE);
  if (w.mustache) r(16, 19, 8, 1, w.hair);
  r(17, 20, 6, 1, sweat ? '#3a1d16' : w.female ? '#b5534a' : '#6a3a2c');
  if (sweat) r(18, 21, 4, 1, '#3a1d16'); // 벌린 입
  if (w.female && !sweat) r(14, 18, 2, 1, 'rgba(220, 90, 80, 0.35)'); // 볼
  if (w.female && !sweat) r(24, 18, 2, 1, 'rgba(220, 90, 80, 0.35)');

  // 보안경 (노란 렌즈)
  if (w.glasses) {
    r(13, 14, 14, 1, '#3a3a3a');
    r(13, 15, 14, 2, 'rgba(232, 205, 60, 0.6)');
    r(19, 15, 2, 1, '#3a3a3a');
  }
  // 도장용 방진 마스크
  if (w.mask) {
    r(15, 18, 10, 5, '#ece8de');
    r(18, 20, 4, 2, '#8a8a82');
    r(12, 18, 3, 1, '#555');
    r(25, 18, 3, 1, '#555');
  }

  // 턱끈
  r(12, 9, 1, 11, STRAP);
  r(27, 9, 1, 11, STRAP);
  r(13, 20, 1, 3, STRAP);
  r(26, 20, 1, 3, STRAP);
  r(14, 23, 12, 1, STRAP);

  // 안전모 (노랑 + 빨간 띠 + 파란 로고 자리)
  r(14, 1, 12, 1, HAT);
  r(12, 2, 16, 6, HAT);
  r(10, 7, 20, 2, HAT);
  r(10, 8, 20, 1, HAT_SHADE);
  r(25, 2, 3, 6, HAT_SHADE);
  r(12, 5, 3, 1, '#c8352c');
  r(25, 5, 3, 1, '#c8352c');
  r(15, 3, 10, 3, '#1f4ea3');
  r(14, 2, 2, 1, 'rgba(255, 255, 255, 0.5)');
  r(12, 9, 16, 1, 'rgba(0, 0, 0, 0.25)');
  if (w.special) { r(26, 3, 2, 2, '#e0574f'); r(27, 2, 1, 1, '#e0574f'); } // 박재홍: 안전모 하트 스티커

  if (sweat) {
    r(29, 10, 1, 2, '#bfe3ff');
    r(10, 12, 1, 2, '#bfe3ff');
    r(28, 18, 1, 2, '#bfe3ff');
  }

  if (canvas === els.portrait) {
    els.tagDept.textContent = `${COMPANY} ${w.dept}`;
    els.tagName.textContent = w.name;
  }
}

// 경비업체 직원: 검은 제복, 모자, 선글라스, 팔을 뻗어 붙잡는 자세
function drawGuard(canvas) {
  const r = pixelPainter(canvas);
  const UNI = '#20242c', UNI_SHADE = '#14171c', SKIN = '#c99a76';
  r(0, 27, 20, 13, UNI);
  r(0, 27, 3, 13, UNI_SHADE);
  r(8, 26, 4, 4, '#e8e4da');     // 셔츠 깃
  r(9, 28, 2, 6, '#7d1f1b');     // 넥타이
  r(3, 30, 3, 3, '#d8b84a');     // 배지
  r(12, 31, 8, 4, UNI);          // 뻗은 팔
  r(18, 31, 2, 4, SKIN);
  r(7, 22, 6, 5, SKIN);
  r(4, 9, 12, 14, SKIN);
  r(4, 9, 2, 14, 'rgba(80, 40, 20, 0.28)');
  r(5, 13, 10, 3, '#0d0f12');    // 선글라스
  r(7, 19, 6, 1, '#5a3428');
  r(3, 3, 14, 6, UNI);           // 모자
  r(2, 8, 17, 2, '#0d0f12');
  r(9, 4, 2, 2, '#d8b84a');
}

/* ---------- 서류 ---------- */
function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function createPermit(file, url, worker) {
  // importNode: template 안의 노드는 비활성 문서 소속이라 이미지가 로드되지 않음
  const node = document.importNode(els.permitTemplate.content.firstElementChild, true);
  state.permitNo += 1;
  node.classList.add('pending');
  node.querySelector('.permit-no').textContent = `No. ${String(state.permitNo).padStart(4, '0')}`;
  node.querySelector('.f-worker').textContent = worker.name;
  node.querySelector('.f-dept').textContent = `${COMPANY} ${worker.dept}`;
  node.querySelector('.f-block').textContent = worker.block;
  node.querySelector('.f-name').textContent = file.name || '붙여넣은 이미지';
  node.querySelector('.f-size').textContent = formatBytes(file.size);
  const t = new Date();
  node.querySelector('.f-time').textContent = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
  node.querySelector('.verdict-text').textContent = '검사 중...';
  node.querySelector('img').src = url;
  return node;
}

function fillProbs(permit, probs, label) {
  const list = permit.querySelector('.probs-list');
  list.innerHTML = '';
  for (const [name, p] of Object.entries(probs)) {
    const li = document.createElement('li');
    if (name === label) li.classList.add('top');
    const pct = (p * 100).toFixed(1);
    li.innerHTML = `<span></span><span class="prob-bar"><i></i></span><span class="prob-val">${pct}%</span>`;
    li.firstElementChild.textContent = name;
    list.appendChild(li);
    requestAnimationFrame(() => { li.querySelector('i').style.width = `${pct}%`; });
  }
}

function showDefectBox(permit, box, label) {
  const el = permit.querySelector('.defect-box');
  if (!box) { el.hidden = true; return; }
  el.style.left = `${box.x * 100}%`;
  el.style.top = `${box.y * 100}%`;
  el.style.width = `${box.w * 100}%`;
  el.style.height = `${box.h * 100}%`;
  el.classList.toggle('tag-below', box.y < 0.12);
  el.classList.toggle('tag-right', box.x + box.w / 2 > 0.5);
  el.querySelector('.defect-tag').textContent = `DISCREPANCY DETECTED · ${label}`;
  el.hidden = false;
}

async function removeCurrentPermit() {
  const old = els.docSlot.querySelector('.permit');
  els.stampBar.classList.remove('down');
  if (!old) return;
  old.classList.add('leaving');
  sound.play('paper');
  await sleep(350);
  old.remove();
  if (state.currentUrl) { URL.revokeObjectURL(state.currentUrl); state.currentUrl = null; }
}

async function stamp(permit, result) {
  const approved = result.verdict === 'APPROVED';
  const unit = approved ? els.stampApproved : els.stampDenied;
  const other = approved ? els.stampDenied : els.stampApproved;

  other.classList.add('dim');
  unit.classList.remove('dim');
  els.stampBar.classList.add('down');
  await sleep(420);

  unit.classList.add('press');
  await sleep(90);
  sound.play('stamp');
  els.desk.classList.remove('shake');
  void els.desk.offsetWidth;
  els.desk.classList.add('shake');

  const mark = permit.querySelector('.stamp-mark');
  mark.className = `stamp-mark ${approved ? 'approved' : 'denied'} thud`;
  mark.innerHTML = `${result.verdict}<small></small>`;
  mark.querySelector('small').textContent = approved ? '정상 · 양품' : `불량 · ${result.label}`;
  mark.hidden = false;
  permit.querySelector('.stamp-zone-label').style.visibility = 'hidden';

  await sleep(120);
  unit.classList.remove('press');
}

/* ---------- 연행: 사이렌 + 경비업체 ---------- */
async function arrest(worker) {
  sound.play('siren');
  els.game.classList.add('alarm');
  els.yard.classList.add('alarm');
  drawWorker(worker, { sweat: true });
  say(worker.name, pick(worker.special ? LINES.jaehongDenied : LINES.deniedWorker), true);
  await sleep(1100);

  sound.play('steps');
  els.applicant.classList.add('arrest');
  say('경비업체', pick(LINES.guard), true);
  await sleep(1200);

  els.applicant.classList.add('dragged');
  yardEscort(worker);
  await sleep(700);
  els.applicant.classList.remove('present');
  await sleep(450);
  els.applicant.classList.remove('arrest', 'dragged');
  await sleep(900);

  els.game.classList.remove('alarm');
  els.yard.classList.remove('alarm');
  say('검사관', '...다음!');
}

function addLedger(file, result, worker) {
  const li = document.createElement('li');
  const ok = result.verdict === 'APPROVED';
  li.className = ok ? 'ok' : 'ng';
  li.innerHTML = `<b></b><span></span>`;
  li.querySelector('b').textContent = ok ? 'OK' : 'NG';
  li.querySelector('span').textContent = `${String(state.permitNo).padStart(4, '0')} ${worker.name} ${ok ? '양품' : `${result.label} · 연행`}`;
  li.title = file.name || '';
  els.ledger.prepend(li);
  while (els.ledger.children.length > 30) els.ledger.lastElementChild.remove();
}

/* ---------- 하루 근무: 시작 → 보고서 → 신문 → 다음 날 ---------- */
function updateDayLabel() {
  els.day.textContent = `${state.day}일차 · ${todayText()}`;
}

function startDay() {
  els.dayScreen.hidden = true;
  els.dayScreen.innerHTML = '';
  state.todayLog = [];
  state.ok = 0;
  state.ng = 0;
  state.jaehongSlot = Math.floor(Math.random() * DAY_QUOTA);
  els.countOk.textContent = '0';
  els.countNg.textContent = '0';
  els.ledger.innerHTML = '';
  els.docSlot.querySelector('.permit')?.remove();
  els.stampBar.classList.remove('down');
  els.deskEmpty.hidden = false;
  updateDayLabel();
  sound.init();
  sound.play('bell');
  say('검사관', `${state.day}일차 근무 시작. 오늘 할당량 ${DAY_QUOTA}건.`);
  state.closed = false;
}

function familyStatus(m) {
  if (m.hungry >= 2 || m.cold >= 2) return { text: '아픔', bad: 2 };
  if (m.hungry) return { text: '배고픔', bad: 1 };
  if (m.cold) return { text: '추움', bad: 1 };
  return { text: '괜찮음', bad: 0 };
}

async function endDay() {
  state.closed = true;
  await sleep(1400);
  sound.play('bell');
  say('검사관', '근무 종료. 셔터 내립니다.');
  els.applicant.classList.remove('present');
  await sleep(1200);
  showReport();
}

function showReport() {
  const log = state.todayLog;
  const ok = log.filter((e) => e.verdict === 'APPROVED').length;
  const ng = log.length - ok;
  const jh = log.find((e) => e.worker.special);
  const msg = [
    '근무 시간이 종료되었습니다.',
    `오늘 ${log.length}명의 작업자를 심사했습니다. (승인 ${ok} · 연행 ${ng})`,
    ng ? `도장 불량 판정으로 ${ng}명이 경비업체에 인계되었습니다.` : '오늘은 아무도 연행되지 않았습니다.',
    jh ? `박재홍 작업자는 오늘 ${jh.verdict === 'APPROVED' ? '무사히 통과했습니다' : '연행되었습니다'}.` : '',
    `내일도 영광을 ${COMPANY}에.`,
  ].filter(Boolean);

  const rows = [
    { key: 'savings', label: '저축금', amount: state.savings },
    { key: 'salary', label: `봉급 (${log.length})`, amount: log.length * PAY.salary },
    { key: 'bonus', label: `연행 수당 (${ng})`, amount: ng * PAY.arrestBonus },
    { key: 'rent', label: '집세', amount: -PAY.rent },
    { key: 'food', label: '식비', amount: -PAY.food, optional: true },
    { key: 'heat', label: '난방비', amount: -PAY.heat, optional: true },
  ];

  els.dayScreen.innerHTML = `
    <div class="report">
      <div class="report-day"><small>근무 종료</small><b>${state.day} 일</b></div>
      <div class="report-msg">${msg.map((m) => `<p>${esc(m)}</p>`).join('')}</div>
      <div class="report-body">
        <div class="report-ledger">
          ${rows.map((r) => `
            <div class="report-row" data-key="${r.key}">
              <span>${esc(r.label)}</span><span>${r.amount}</span>
              ${r.optional ? `<button type="button" class="pay-toggle" aria-pressed="true" aria-label="${esc(r.label)} 지불"></button>` : '<i></i>'}
            </div>`).join('')}
          <div class="report-total"><span>합계</span><span id="reportTotal"></span><i></i></div>
        </div>
        <ul class="report-family" id="reportFamily"></ul>
      </div>
      <button type="button" class="report-next" id="reportNext">다음 날 ▶</button>
    </div>`;
  els.dayScreen.hidden = false;

  const paid = (key) => els.dayScreen.querySelector(`[data-key="${key}"] .pay-toggle`).getAttribute('aria-pressed') === 'true';
  const preview = () => {
    const food = paid('food');
    const heat = paid('heat');
    const total = rows.reduce((sum, r) => sum + (r.optional && !paid(r.key) ? 0 : r.amount), 0);
    const totalEl = $('reportTotal');
    totalEl.textContent = total;
    totalEl.classList.toggle('neg', total < 0);
    const next = state.family.map((m) => ({ ...m, hungry: food ? 0 : m.hungry + 1, cold: heat ? 0 : m.cold + 1 }));
    $('reportFamily').innerHTML = next.map((m) => {
      const s = familyStatus(m);
      return `<li class="bad-${s.bad}"><b>${s.text}</b><span>${esc(m.name)}</span></li>`;
    }).join('');
    return { total, next };
  };
  preview();

  els.dayScreen.querySelectorAll('.pay-toggle').forEach((btn) => btn.addEventListener('click', () => {
    btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true'));
    btn.closest('.report-row').classList.toggle('unpaid');
    sound.play('paper');
    preview();
  }));

  $('reportNext').addEventListener('click', () => {
    const { total, next } = preview();
    state.savings = total;
    state.family = next;
    state.lastLog = state.todayLog.map(({ worker, verdict, label, confidence }) => ({ worker, verdict, label, confidence }));
    state.day += 1;
    writeSave();
    sound.play('paper');
    showNewspaper();
  });
}

const SIDE_NEWS = [
  ['의문의 도막 박리 사건', '몇몇이 입원하다'],
  ['3도크 블록 탑재', '일정 앞당겨져'],
  ['경비업체, 연행 실적으로', '포상 받아'],
  ['AI 검사기 도입…', '검사관 일자리 위협?'],
  ['구내식당 돈가스', '이틀 연속 품절'],
  ['태풍 북상, 야외 도장', '전면 중단'],
];

function buildNews() {
  const log = state.lastLog;
  if (!log) {
    return {
      head: ['도장 검사소', '오늘 개소'],
      sub: `"불량은 경비업체로" ${COMPANY} 새 검문 방침`,
      worker: null,
      caption: '개소식',
    };
  }
  const arrested = log.filter((e) => e.verdict !== 'APPROVED');
  const jh = log.find((e) => e.worker.special);
  // 확신도가 낮았던 연행자 → 오탐 의혹 기사
  const doubtful = arrested.filter((e) => e.confidence < 0.8).sort((a, b) => a.confidence - b.confidence)[0];

  if (jh && jh.verdict !== 'APPROVED') {
    return { head: ['박재홍,', '끝내 연행되다'], sub: `"${jh.label}" 판정에 조선소 술렁`, worker: jh.worker, caption: '박재홍', sweat: true, doubtful };
  }
  if (doubtful) {
    return {
      head: [`"오탐이다!"`, `${doubtful.worker.name} 억울함 호소`],
      sub: `AI 확신도 ${(doubtful.confidence * 100).toFixed(0)}%… 오탐 의혹 제기`,
      worker: doubtful.worker, caption: doubtful.worker.name, sweat: true,
    };
  }
  if (arrested.length) {
    const a = arrested[0];
    return {
      head: ['도장 불량 작업자', `${arrested.length}명 연행`],
      sub: `${arrested.map((e) => e.worker.name).join(', ')} … "${a.label}" 판정`,
      worker: a.worker, caption: a.worker.name, sweat: true,
    };
  }
  if (jh) {
    return { head: ['박재홍,', '무사 통과'], sub: `"영광을 ${COMPANY}에" 소감 밝혀`, worker: jh.worker, caption: '박재홍' };
  }
  return { head: ['어제 도장 불량 0건', '조선소에 평화'], sub: `검사관 ${state.day - 1}일차 근무 무사히 마쳐`, worker: null, caption: '' };
}

function showNewspaper() {
  const news = buildNews();
  const side = pick(SIDE_NEWS);
  const now = new Date();
  els.dayScreen.innerHTML = `
    <div class="news-wrap">
      <article class="newspaper">
        <header class="news-mast">
          <i class="news-lines"></i><h2>조선소의 진실</h2><i class="news-lines"></i>
        </header>
        <div class="news-date"><span>거제 ${state.day}일차 · ${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일</span><span>무료</span></div>
        <div class="news-cols">
          <section class="news-main">
            <h3>${news.head.map(esc).join('<br>')}</h3>
            <p class="news-sub">${esc(news.sub)}</p>
            <div class="news-main-body">
              ${news.worker ? `<figure><canvas width="40" height="40" id="newsPortrait"></canvas><figcaption>${esc(news.caption)}</figcaption></figure>` : ''}
              <div class="news-text"></div>
            </div>
          </section>
          <section class="news-mid"><div class="news-text tall"></div><small>${esc(news.caption || '운동')}</small><div class="news-text"></div></section>
          <section class="news-side">
            <h4>${side.map(esc).join('<br>')}</h4>
            <span class="news-stamp">검열</span>
            <div class="news-text"></div>
          </section>
        </div>
      </article>
      <button type="button" class="report-next" id="startDayBtn">${state.day}일차 근무 시작 ▶</button>
    </div>`;
  els.dayScreen.hidden = false;
  if (news.worker) drawWorker(news.worker, { sweat: news.sweat }, $('newsPortrait'));
  $('startDayBtn').addEventListener('click', startDay);
}

/* ---------- 메인 흐름 ---------- */
async function requestInspection(file) {
  // Netlify 버전: 서버 없이 브라우저에서 모델 실행 (netlify/inspector.js)
  if (window.localInspector) return window.localInspector.inspect(file);
  const form = new FormData();
  form.append('file', file, file.name || 'pasted.png');
  const res = await fetch('/api/inspect', { method: 'POST', body: form });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.detail || `서버 오류 (${res.status})`);
  return result;
}

async function processFile(file) {
  if (state.busy || state.closed || !file) return;
  if (!ACCEPT_TYPES.includes(file.type)) { say('검사관', 'JPG, PNG, BMP 이미지만 검사할 수 있습니다.', true); sound.play('buzz'); return; }
  if (file.size > MAX_BYTES) { say('검사관', '파일이 너무 큽니다. (최대 20MB)', true); sound.play('buzz'); return; }

  state.busy = true;
  els.nextBtn.disabled = true;
  sound.init();

  try {
    // 이전 작업자 퇴장 + 서류 반납
    els.applicant.classList.remove('present');
    await removeCurrentPermit();
    els.deskEmpty.hidden = true;
    sound.play('bell');
    say('검사관', '다음!');
    await advanceQueue();

    // 다음 작업자 입장
    const worker = state.todayLog.length === state.jaehongSlot ? makeJaehong() : makeWorker();
    drawWorker(worker);
    els.applicant.classList.add('present');
    sound.play('steps');
    await sleep(500);
    say('검사관', pick(LINES.request));

    const url = URL.createObjectURL(file);
    state.currentUrl = url;
    const permit = createPermit(file, url, worker);
    const img = permit.querySelector('img');
    await Promise.all([
      new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; }),
      sleep(800),
    ]);
    if (img.naturalWidth) permit.querySelector('.f-res').textContent = `${img.naturalWidth} × ${img.naturalHeight}`;

    // 작업자가 서류(사진)를 내밂
    const ctx = { block: worker.block, dept: worker.dept, company: COMPANY };
    say(worker.name, fill(pick(worker.special ? LINES.jaehongHandover : LINES.handover), ctx));
    els.docSlot.appendChild(permit);
    sound.play('paper');
    await sleep(900);
    say('검사관', pick(LINES.checking));

    const [result] = await Promise.all([requestInspection(file), sleep(600)]);

    permit.classList.remove('pending');
    fillProbs(permit, result.probs, result.label);
    const approved = result.verdict === 'APPROVED';
    const vt = permit.querySelector('.verdict-text');
    vt.textContent = approved ? '정상 (양품)' : `불량 (${result.label})`;
    vt.style.color = approved ? 'var(--green-dark)' : 'var(--red)';
    ctx.label = result.label;

    if (approved) {
      say('검사관', pick(LINES.approvedInspector));
      await stamp(permit, result);
      await sleep(500);
      say(worker.name, fill(pick(worker.special ? LINES.jaehongApproved : LINES.approvedWorker), ctx));
    } else {
      showDefectBox(permit, result.box, result.label);
      say('검사관', fill(pick(LINES.deniedInspector), ctx), true);
      await stamp(permit, result);
      await sleep(400);
      await arrest(worker);
    }

    if (approved) state.ok += 1; else state.ng += 1;
    els.countOk.textContent = state.ok;
    els.countNg.textContent = state.ng;
    addLedger(file, result, worker);
    state.todayLog.push({ worker, verdict: result.verdict, label: result.label, confidence: result.confidence });
  } catch (err) {
    const permit = els.docSlot.querySelector('.permit');
    if (permit) {
      permit.classList.remove('pending');
      permit.classList.add('error');
      permit.querySelector('.verdict-text').textContent = '판정 실패';
    }
    say('검사관', `오류: ${err.message}`, true);
    sound.play('buzz');
  } finally {
    state.busy = false;
    els.nextBtn.disabled = false;
  }
  if (state.todayLog.length >= DAY_QUOTA && !state.closed) endDay();
}

/* ---------- 입력: 버튼, 드래그앤드롭, 붙여넣기 ---------- */
function initInputs() {
  els.nextBtn.addEventListener('click', () => {
    if (state.closed) return;
    sound.init();
    els.fileInput.value = '';
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', () => processFile(els.fileInput.files[0]));

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth += 1;
    els.desk.classList.add('dragover');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.desk.classList.remove('dragover');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.desk.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      if (files.length > 1) say('검사관', '한 번에 1장씩 검사합니다. 첫 번째 사진만 받았습니다.');
      processFile(files[0]);
    }
  });

  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (item) processFile(item.getAsFile());
  });

  els.soundToggle.addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    els.soundToggle.setAttribute('aria-pressed', String(sound.enabled));
    els.soundToggle.textContent = sound.enabled ? '♪ ON' : '♪ OFF';
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutYard, 150);
  });
}

initHeader();
drawGuard(els.guardLeft);
drawGuard(els.guardRight);
layoutYard();
initInputs();
loadSave();
updateDayLabel();
showNewspaper(); // 매일 아침 신문부터
