# 도장 검사소 (Paint Inspection Checkpoint)

도장 불량 탐지 모델(ONNX, 브라우저 추론)을 이용한 픽셀풍 웹 게임.

## 실행
정적 사이트입니다. 로컬에서:

```
python -m http.server 8000
```
후 http://localhost:8000 접속. (Netlify 등 정적 호스팅에 그대로 배포 가능)

- `model/paint_model.onnx` — onnxruntime-web으로 브라우저에서 추론
- 폰트: Galmuri (OFL, `fonts/OFL.txt`)
