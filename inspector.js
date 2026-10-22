'use strict';
/* 브라우저 안에서 모델 실행 (ONNX Runtime Web) — 서버 없이 Netlify 같은 정적 호스팅용
 *
 * 모델 출력: 픽셀별 클래스 점수 맵 (1, 16, 16, C) = feature_map · W + b
 *   logits = 맵의 공간 평균,  CAM(c) = relu(맵[..., c] - b[c])  (webapp/inference.py의 Grad-CAM과 같은 값)
 * app.js는 window.localInspector가 있으면 서버 대신 이것을 사용함
 */
(function () {
  const OK_CLASS = '양품';
  const CAM_THRESHOLD = 0.6; // 히트맵 최댓값 대비 이 비율 이상인 영역을 불량 후보로 봄
  const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';

  /* ---------- 전처리: paint_preprocess.py의 'pad' 모드를 PIL과 똑같이 재현 ---------- */
  // 경계선 근처 사진은 축소 방식 차이만으로 판정이 뒤집혀서, canvas 축소 대신 PIL LANCZOS를 직접 구현

  // 파이썬 round (0.5는 짝수 쪽으로)
  function pyRound(v) {
    const f = Math.floor(v);
    const d = v - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  function padGeometry(w, h, size) {
    // PIL.ImageOps.contain + pad: 긴 변을 size에 맞추고 짧은 변은 반올림, 가운데 정렬
    let dw = size, dh = size;
    if (w / h > 1) dh = pyRound((h / w) * size);
    else if (w / h < 1) dw = pyRound((w / h) * size);
    const scale = Math.min(size / w, size / h);
    return {
      dw, dh,
      ox: pyRound((size - dw) * 0.5),
      oy: pyRound((size - dh) * 0.5),
      geom: { scale, pad_x: (size - w * scale) / 2, pad_y: (size - h * scale) / 2, crop_x: 0, crop_y: 0, orig_w: w, orig_h: h },
    };
  }

  const PRECISION_BITS = 22; // PIL 8비트 리샘플링의 고정소수점 정밀도 (32 - 8 - 2)
  const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const lanczos = (x) => (x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);

  // PIL Resample.c precompute_coeffs와 같은 계산
  function coeffs(inSize, outSize) {
    const scale = inSize / outSize;
    const filterScale = Math.max(scale, 1);
    const support = 3 * filterScale;
    const bounds = [];
    for (let xx = 0; xx < outSize; xx++) {
      const center = (xx + 0.5) * scale;
      const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
      const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
      const k = new Array(xmax);
      let ww = 0;
      for (let x = 0; x < xmax; x++) {
        k[x] = lanczos((x + xmin - center + 0.5) / filterScale);
        ww += k[x];
      }
      const fixed = k.map((v) => {
        const n = ww === 0 ? v : v / ww;
        return Math.trunc(n < 0 ? -0.5 + n * (1 << PRECISION_BITS) : 0.5 + n * (1 << PRECISION_BITS));
      });
      bounds.push({ xmin, k: fixed });
    }
    return bounds;
  }

  const clip8 = (ss) => Math.min(255, Math.max(0, Math.floor(ss / (1 << PRECISION_BITS))));

  // RGB(채널 3) uint8 배열을 가로 → 세로 순서로 리샘플링 (PIL과 같은 순서와 반올림)
  function resizeLanczos(src, sw, sh, dw, dh) {
    let cur = src, cw = sw;
    if (dw !== sw) {
      const cs = coeffs(sw, dw);
      const out = new Uint8ClampedArray(dw * sh * 3);
      for (let y = 0; y < sh; y++) {
        const row = y * sw * 3;
        for (let x = 0; x < dw; x++) {
          const { xmin, k } = cs[x];
          for (let c = 0; c < 3; c++) {
            let ss = 1 << (PRECISION_BITS - 1);
            for (let i = 0; i < k.length; i++) ss += cur[row + (xmin + i) * 3 + c] * k[i];
            out[(y * dw + x) * 3 + c] = clip8(ss);
          }
        }
      }
      cur = out; cw = dw;
    }
    if (dh !== sh) {
      const cs = coeffs(sh, dh);
      const out = new Uint8ClampedArray(cw * dh * 3);
      for (let y = 0; y < dh; y++) {
        const { xmin, k } = cs[y];
        for (let x = 0; x < cw; x++) {
          for (let c = 0; c < 3; c++) {
            let ss = 1 << (PRECISION_BITS - 1);
            for (let i = 0; i < k.length; i++) ss += cur[((xmin + i) * cw + x) * 3 + c] * k[i];
            out[(y * cw + x) * 3 + c] = clip8(ss);
          }
        }
      }
      cur = out;
    }
    return cur;
  }

  async function prepare(file, size) {
    // imageOrientation: 휴대폰 사진의 EXIF 회전 반영 (exif_transpose와 같은 역할)
    // colorSpaceConversion none: PIL처럼 색 프로필 변환 없이 원래 픽셀 값 사용
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'none' });
    const sw = bmp.width, sh = bmp.height;
    const { dw, dh, ox, oy, geom } = padGeometry(sw, sh, size);

    const full = document.createElement('canvas');
    full.width = sw;
    full.height = sh;
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(bmp, 0, 0);
    bmp.close();
    const rgba = fctx.getImageData(0, 0, sw, sh).data;
    const rgb = new Uint8ClampedArray(sw * sh * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    const small = resizeLanczos(rgb, sw, sh, dw, dh);

    const x = new Float32Array(size * size * 3); // NHWC, 0~255, 여백은 검정(0) (EfficientNet이 내부에서 정규화)
    for (let y = 0; y < dh; y++) {
      for (let xx = 0; xx < dw; xx++) {
        const s = (y * dw + xx) * 3;
        const d = ((y + oy) * size + (xx + ox)) * 3;
        x[d] = small[s];
        x[d + 1] = small[s + 1];
        x[d + 2] = small[s + 2];
      }
    }
    return { x, geom };
  }

  /* ---------- 후처리: 확률 + CAM → 불량 박스 ---------- */
  function resizeBilinear(src, sh, sw, dh, dw) {
    // PIL BILINEAR 확대와 같은 픽셀 중심 기준 보간
    const out = new Float32Array(dh * dw);
    for (let y = 0; y < dh; y++) {
      const fy = Math.min(Math.max((y + 0.5) * (sh / dh) - 0.5, 0), sh - 1);
      const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, sh - 1), ty = fy - y0;
      for (let x = 0; x < dw; x++) {
        const fx = Math.min(Math.max((x + 0.5) * (sw / dw) - 0.5, 0), sw - 1);
        const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, sw - 1), tx = fx - x0;
        const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
        const bot = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
        out[y * dw + x] = top * (1 - ty) + bot * ty;
      }
    }
    return out;
  }

  function camToBox(cam, fh, fw, size, geom) {
    const big = resizeBilinear(cam, fh, fw, size, size);
    // pad 여백 부분은 실제 이미지가 아니므로 제외
    const s = geom.scale;
    const x0 = Math.ceil(geom.pad_x), y0 = Math.ceil(geom.pad_y);
    const x1 = Math.floor(geom.pad_x + geom.orig_w * s), y1 = Math.floor(geom.pad_y + geom.orig_h * s);
    let vmax = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vmax = Math.max(vmax, big[y * size + x]);
    if (vmax <= 0) return null;
    const th = CAM_THRESHOLD * vmax;

    // 연결 영역(상하좌우) 중 히트맵 합이 가장 큰 것 하나 선택
    const label = new Int32Array(size * size);
    const stack = [];
    let best = null;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const start = y * size + x;
        if (label[start] || big[start] < th) continue;
        label[start] = 1;
        stack.push(start);
        const r = { sum: 0, minX: x, maxX: x, minY: y, maxY: y };
        while (stack.length) {
          const p = stack.pop();
          const py = (p / size) | 0, px = p - py * size;
          r.sum += big[p];
          if (px < r.minX) r.minX = px; if (px > r.maxX) r.maxX = px;
          if (py < r.minY) r.minY = py; if (py > r.maxY) r.maxY = py;
          for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
            if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
            const q = ny * size + nx;
            if (!label[q] && big[q] >= th) { label[q] = 1; stack.push(q); }
          }
        }
        if (!best || r.sum > best.sum) best = r;
      }
    }
    if (!best) return null;

    const clamp = (v) => Math.min(Math.max(v, 0), 1);
    const toOrig = (px, py) => [
      clamp(((px - geom.pad_x) / s + geom.crop_x) / geom.orig_w),
      clamp(((py - geom.pad_y) / s + geom.crop_y) / geom.orig_h),
    ];
    const [bx0, by0] = toOrig(best.minX, best.minY);
    const [bx1, by1] = toOrig(best.maxX + 1, best.maxY + 1);
    return { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
  }

  function postprocess(maps, dims, meta, geom) {
    const [, fh, fw, nc] = dims;
    const n = fh * fw;
    const logits = new Array(nc).fill(0);
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) logits[c] += maps[i * nc + c] / n;
    const m = Math.max(...logits);
    const exps = logits.map((v) => Math.exp(v - m));
    const total = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((v) => v / total);
    const idx = probs.indexOf(Math.max(...probs));
    const label = meta.class_names[idx];
    const isOk = label === OK_CLASS;

    let box = null;
    if (!isOk) {
      const cam = new Float32Array(n);
      for (let i = 0; i < n; i++) cam[i] = Math.max(0, maps[i * nc + idx] - meta.bias[idx]);
      box = camToBox(cam, fh, fw, meta.img_size[0], geom);
    }
    return {
      verdict: isOk ? 'APPROVED' : 'DENIED',
      label,
      confidence: probs[idx],
      probs: Object.fromEntries(meta.class_names.map((c, i) => [c, probs[i]])),
      box,
      image_size: { w: geom.orig_w, h: geom.orig_h },
    };
  }

  /* ---------- 모델 로드 + 판정 ---------- */
  let loading = null;
  function load() {
    if (!loading) {
      loading = (async () => {
        const meta = await (await fetch('model/model_meta.json')).json();
        ort.env.wasm.wasmPaths = ORT_WASM;
        const session = await ort.InferenceSession.create('model/paint_model.onnx', { executionProviders: ['wasm'] });
        return { meta, session };
      })();
      loading.catch(() => { loading = null; }); // 실패하면 다음 요청 때 다시 시도
    }
    return loading;
  }

  async function inspect(file) {
    let model;
    try {
      model = await load();
    } catch (err) {
      throw new Error(`모델을 불러오지 못했습니다 (${err.message})`);
    }
    const { meta, session } = model;
    const size = meta.img_size[0];
    let prepared;
    try {
      prepared = await prepare(file, size);
    } catch {
      throw new Error('이미지 파일이 아닙니다.');
    }
    const input = new ort.Tensor('float32', prepared.x, [1, size, size, 3]);
    const out = await session.run({ [session.inputNames[0]]: input });
    const maps = out[session.outputNames[0]];
    return postprocess(maps.data, maps.dims, meta, prepared.geom);
  }

  if (typeof window !== 'undefined') {
    window.localInspector = { inspect, load };
    load().catch(() => {}); // 페이지 열 때 미리 받아 둠 (첫 판정 대기 줄이기)
  }
  if (typeof module !== 'undefined') module.exports = { postprocess, padGeometry, resizeLanczos }; // Node 검증용
})();
