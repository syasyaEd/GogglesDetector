import { FaceLandmarker, FilesetResolver } from "/static/vendor/vision_bundle.mjs";
import { FILTERS, drawBanner, drawFilters, faceBox, preloadBorders } from "./filters.js";

const WASM = "/static/vendor/wasm";
const MODEL = "/static/vendor/face_landmarker.task";

const views = {
  attract: document.getElementById("view-attract"),
  live: document.getElementById("view-live"),
  edit: document.getElementById("view-edit"),
  sent: document.getElementById("view-sent"),
};

const els = {
  start: document.getElementById("btn-start"),
  boot: document.getElementById("boot-note"),
  video: document.getElementById("cam"),
  overlay: document.getElementById("overlay"),
  countdown: document.getElementById("countdown"),
  flash: document.getElementById("flash"),
  lockTag: document.getElementById("lock-tag"),
  goggleBadge: document.getElementById("goggle-badge"),
  chip: document.getElementById("status-chip"),
  hint: document.getElementById("hint"),
  ready: document.getElementById("btn-ready"),
  photo: document.getElementById("photo"),
  filters: document.getElementById("filters"),
  form: document.getElementById("email-form"),
  email: document.getElementById("email"),
  send: document.getElementById("btn-send"),
  sendError: document.getElementById("send-error"),
  retake: document.getElementById("btn-retake"),
  next: document.getElementById("btn-next"),
  sentCopy: document.getElementById("sent-copy"),
  sentPreview: document.getElementById("sent-preview"),
  sentTimer: document.getElementById("sent-timer"),
  sentTitle: document.getElementById("sent-title"),
  sentKicker: document.getElementById("sent-kicker"),
};

const STATUS = {
  none: { label: "NO SAFETY GOGGLES", color: "#ff8a8a", chip: "bad" },
  glasses: { label: "GLASSES DETECTED — not safety goggles", color: "#ffb020", chip: "warn" },
  safety: { label: "SAFETY GOGGLES ON", color: "#3ee0a2", chip: "ok" },
};

const state = {
  videoLandmarker: null,
  imageLandmarker: null,
  stream: null,
  running: false,
  locked: false,
  counting: false,
  countdownTimer: null,
  yoloReady: false,
  emailReady: false,
  lastBoxes: [],
  lastFaces: [],
  stableMs: 0,
  smileMs: 0,
  wearMs: 0,
  goneMs: 0,
  lastTs: 0,
  lastBox: null,
  frozenFaces: null,
  frozenBoxes: [],
  frozenStatus: null,
  yoloBusy: false,
  lastYolo: 0,
  snapFaces: [],
  snapStatus: STATUS.none,
  snapBase: null,
  filterId: "default",
  snapUrl: "",
  resetTimer: null,
};

function show(name) {
  Object.entries(views).forEach(([key, node]) => {
    node.classList.toggle("hidden", key !== name);
  });
}

function beep(freq = 880, ms = 120) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
  osc.start();
  osc.stop(ctx.currentTime + ms / 1000);
}

async function createLandmarker(mode) {
  const files = await FilesetResolver.forVisionTasks(WASM);
  const options = {
    runningMode: mode,
    numFaces: 4,
    outputFaceBlendshapes: true,
  };
  try {
    return await FaceLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    });
  } catch {
    return FaceLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
    });
  }
}

async function pollHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    state.yoloReady = Boolean(data.yolo);
    state.emailReady = Boolean(data.email_ready);
    if (data.yolo) {
      els.boot.textContent = data.email_ready
        ? "Safety AI ready. Camera will open on this MacBook."
        : "Safety AI ready. Add Gmail in .env or sign in to Mac Mail so photos can be emailed.";
    } else if (data.error) {
      els.boot.textContent = `AI still loading… ${data.error}`;
    } else {
      els.boot.textContent = "Warming up the safety AI… first launch downloads the model.";
    }
  } catch {
    els.boot.textContent = "Server not reachable. Run start.sh first.";
  }
}

function overlap(face, box) {
  const fx1 = face.x1;
  const fy1 = face.y1;
  const fx2 = face.x2;
  const fy2 = face.y1 + (face.y2 - face.y1) * 0.7;
  const [x1, y1, x2, y2] = box.bbox;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  if (cx >= fx1 && cx <= fx2 && cy >= fy1 && cy <= fy2) return 0.6;
  const ix1 = Math.max(fx1, x1);
  const iy1 = Math.max(fy1, y1);
  const ix2 = Math.min(fx2, x2);
  const iy2 = Math.min(fy2, y2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const area = Math.max((x2 - x1) * (y2 - y1), 1e-6);
  return inter / area;
}

function isFashionGlasses(box) {
  return /eyeglass|sunglass|reading/.test(box.label || "") || box.kind === "glasses";
}

function isSafetyGoggles(box) {
  if (/eyeglass|sunglass|reading/.test(box.label || "")) return false;
  return (
    box.kind === "safety" ||
    /goggle|wraparound|protective|lab goggle|industrial|safety glasses/.test(box.label || "")
  );
}

function classify(faces, boxes) {
  if (!faces.length) return STATUS.none;
  let best = "none";
  for (const landmarks of faces) {
    const face = faceBox(landmarks);
    const hits = boxes.filter((box) => overlap(face, box) > 0.1);
    const safetyHits = hits.filter(isSafetyGoggles);
    const glassesHits = hits.filter((box) => /eyeglass|sunglass|reading/.test(box.label || ""));
    if (safetyHits.length && glassesHits.length) {
      const s = Math.max(...safetyHits.map((box) => box.conf || 0));
      const g = Math.max(...glassesHits.map((box) => box.conf || 0));
      best = g > s + 0.12 ? "glasses" : "safety";
    } else if (safetyHits.length) {
      best = "safety";
    } else if (glassesHits.length || hits.length) {
      best = "glasses";
    }
  }
  if (best === "safety") return STATUS.safety;
  if (best === "glasses") return STATUS.glasses;
  return STATUS.none;
}

function smileScore(blendshapes) {
  if (!blendshapes?.categories) return 0;
  const map = Object.fromEntries(blendshapes.categories.map((c) => [c.categoryName, c.score]));
  return ((map.mouthSmileLeft || 0) + (map.mouthSmileRight || 0)) / 2;
}

function setChip(status, extra = "") {
  els.chip.className = `chip ${status.chip}`;
  els.chip.textContent = extra || status.label;
}

function setGoggleBadge(status, hasFace) {
  if (!els.goggleBadge) return;
  if (!hasFace) {
    els.goggleBadge.classList.add("hidden");
    return;
  }
  const on = status === STATUS.safety || status.chip === "ok";
  els.goggleBadge.classList.remove("hidden", "on", "off");
  els.goggleBadge.classList.add(on ? "on" : "off");
  els.goggleBadge.textContent = on ? "Goggle On" : "You are not wearing safety goggles";
}

function drawLive(faces, boxes, status) {
  const canvas = els.overlay;
  const video = els.video;
  const nextW = video.videoWidth || 1920;
  const nextH = video.videoHeight || 1080;
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const locked = state.locked;
  const facesToDraw =
    locked && state.frozenFaces?.length ? state.frozenFaces : faces;
  const boxesToDraw =
    locked && state.frozenBoxes?.length ? state.frozenBoxes : boxes;
  const statusToShow =
    locked && state.frozenStatus ? state.frozenStatus : status;

  for (const landmarks of facesToDraw) {
    const box = faceBox(landmarks);
    const x = box.x1 * canvas.width;
    const y = box.y1 * canvas.height;
    const w = (box.x2 - box.x1) * canvas.width;
    const h = (box.y2 - box.y1) * canvas.height;
    ctx.strokeStyle = locked ? "#3ee0a2" : "#ffd100";
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
  }

  for (const box of boxesToDraw) {
    const [x1, y1, x2, y2] = box.bbox;
    ctx.strokeStyle = locked ? "#3ee0a2" : box.kind === "safety" ? "#3ee0a2" : "#ffb020";
    ctx.lineWidth = 3;
    ctx.strokeRect(x1 * canvas.width, y1 * canvas.height, (x2 - x1) * canvas.width, (y2 - y1) * canvas.height);
  }

  setChip(statusToShow, locked || faces.length ? statusToShow.label : "Looking for a face…");
  setGoggleBadge(statusToShow, locked || faces.length > 0);
}

async function sendFrameForYolo() {
  if (state.yoloBusy || !state.yoloReady || !els.video.videoWidth) return;
  const now = performance.now();
  if (now - state.lastYolo < 280) return;
  state.lastYolo = now;
  state.yoloBusy = true;
  const canvas = document.createElement("canvas");
  canvas.width = els.video.videoWidth;
  canvas.height = els.video.videoHeight;
  canvas.getContext("2d").drawImage(els.video, 0, 0);
  canvas.toBlob(async (blob) => {
    try {
      const body = new FormData();
      body.append("image", blob, "frame.jpg");
      const res = await fetch("/api/detect", { method: "POST", body });
      const data = await res.json();
      if (data.ok) state.lastBoxes = data.boxes || [];
      state.yoloReady = Boolean(data.ready);
    } catch {
      /* keep last boxes */
    } finally {
      state.yoloBusy = false;
    }
  }, "image/jpeg", 0.7);
}

async function loop() {
  if (!state.running) return;
  const ts = performance.now();
  const dt = state.lastTs ? ts - state.lastTs : 16;
  state.lastTs = ts;

  if (els.video.videoWidth && state.videoLandmarker) {
    const result = state.videoLandmarker.detectForVideo(els.video, ts);
    const faces = result.faceLandmarks || [];
    state.lastFaces = faces;

    sendFrameForYolo();

    const liveStatus = state.yoloReady
      ? classify(faces, state.lastBoxes)
      : { label: "Checking goggles…", color: "#ffd100", chip: "" };
    const wearing = liveStatus === STATUS.safety || liveStatus.chip === "ok";

    if (state.locked) {
      drawLive(
        state.frozenFaces || faces,
        state.frozenBoxes,
        state.frozenStatus || STATUS.safety
      );
      if (!state.counting) els.ready.classList.remove("hidden");

      if (faces.length && wearing) {
        state.goneMs = 0;
      } else {
        state.goneMs += dt;
        if (state.goneMs > 800) {
          unlockFace("Goggles off — lock released. Put safety goggles back on.");
        }
      }
    } else {
      drawLive(faces, state.lastBoxes, liveStatus);
      if (faces.length) {
        if (wearing) {
          state.wearMs += dt;
          if (state.wearMs > 350) lockFace();
        } else {
          state.wearMs = 0;
          els.hint.textContent = "Face found. Put on safety goggles to lock and snap.";
        }
      } else {
        state.wearMs = 0;
      }
    }
  }

  requestAnimationFrame(loop);
}

function cloneFaces(faces) {
  return (faces || []).map((face) => face.map((p) => ({ x: p.x, y: p.y, z: p.z })));
}

function cloneBoxes(boxes) {
  return (boxes || []).map((box) => ({
    ...box,
    bbox: [...box.bbox],
  }));
}

function lockFace() {
  state.locked = true;
  state.frozenFaces = cloneFaces(state.lastFaces);
  state.frozenBoxes = cloneBoxes(state.lastBoxes);
  state.frozenStatus = STATUS.safety;
  els.lockTag.classList.remove("hidden");
  els.ready.classList.remove("hidden");
  els.hint.textContent = "Safety goggles locked. Tap I’m ready, then pick a border.";
  beep(520, 90);
}

function unlockFace(reason) {
  state.locked = false;
  state.counting = false;
  state.smileMs = 0;
  state.wearMs = 0;
  state.frozenFaces = null;
  state.frozenStatus = null;
  state.frozenBoxes = [];
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  els.countdown.classList.add("hidden");
  els.countdown.textContent = "";
  els.lockTag.classList.add("hidden");
  els.ready.classList.add("hidden");
  els.hint.textContent = reason;
}

function startCountdown() {
  if (state.counting) return;
  if (!state.locked) lockFace();
  state.counting = true;
  els.ready.classList.add("hidden");
  els.countdown.classList.remove("hidden");
  let n = 3;
  els.countdown.textContent = n;
  els.hint.textContent = "Smile! Capturing your safety snap.";
  beep(700, 80);
  state.countdownTimer = setInterval(() => {
    if (!state.counting) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      return;
    }
    n -= 1;
    if (n > 0) {
      els.countdown.textContent = n;
      beep(700, 80);
      return;
    }
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    els.countdown.textContent = "";
    els.countdown.classList.add("hidden");
    snap();
  }, 1000);
}

function captureCanvas() {
  const video = els.video;
  const canvas = els.photo;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0);
  ctx.restore();
  return canvas;
}

async function snap() {
  state.running = false;
  beep(1200, 140);
  els.flash.classList.remove("pop");
  void els.flash.offsetWidth;
  els.flash.classList.add("pop");

  const canvas = captureCanvas();
  state.snapBase = document.createElement("canvas");
  state.snapBase.width = canvas.width;
  state.snapBase.height = canvas.height;
  state.snapBase.getContext("2d").drawImage(canvas, 0, 0);
  const image = await createImageBitmap(canvas);
  const result = state.imageLandmarker.detect(image);
  if (result.faceLandmarks?.length) {
    state.snapFaces = result.faceLandmarks;
  } else {
    state.snapFaces = state.lastFaces.map((face) => face.map((p) => ({ ...p, x: 1 - p.x })));
  }

  const mirrorBoxes = (boxes) =>
    boxes.map((box) => ({
      ...box,
      bbox: [1 - box.bbox[2], box.bbox[1], 1 - box.bbox[0], box.bbox[3]],
    }));
  let boxes = mirrorBoxes(state.lastBoxes);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 1.0));
  try {
    const body = new FormData();
    body.append("image", blob, "snap.jpg");
    const res = await fetch("/api/detect", { method: "POST", body });
    const data = await res.json();
    if (data.ok && data.boxes) boxes = data.boxes;
  } catch {
    /* keep mirrored live boxes */
  }
  state.snapStatus = classify(state.snapFaces, boxes);
  state.filterId = "default";
  renderPhoto();
  show("edit");
}

function renderPhoto() {
  const canvas = els.photo;
  const ctx = canvas.getContext("2d");
  if (state.snapBase) {
    canvas.width = state.snapBase.width;
    canvas.height = state.snapBase.height;
    ctx.drawImage(state.snapBase, 0, 0);
  }
  drawFilters(ctx, state.filterId, state.snapFaces, canvas.width, canvas.height);
  drawBanner(ctx, canvas.width, canvas.height, state.snapStatus);
}

function setupFilters() {
  els.filters.innerHTML = "";
  for (const filter of FILTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `filter-btn${filter.id === state.filterId ? " active" : ""}`;
    btn.innerHTML = `<span>${filter.emoji}</span>${filter.name}`;
    btn.addEventListener("click", () => {
      state.filterId = filter.id;
      [...els.filters.children].forEach((child) => child.classList.remove("active"));
      btn.classList.add("active");
      renderPhoto();
    });
    els.filters.appendChild(btn);
  }
}

async function startCamera() {
  els.start.disabled = true;
  els.start.textContent = "Opening camera…";
  try {
    if (!state.videoLandmarker) {
      state.videoLandmarker = await createLandmarker("VIDEO");
      state.imageLandmarker = await createLandmarker("IMAGE");
    }
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    await els.video.play();
    state.running = true;
    state.locked = false;
    state.counting = false;
    state.stableMs = 0;
    state.smileMs = 0;
    state.wearMs = 0;
    state.goneMs = 0;
    state.lastBox = null;
    state.frozenFaces = null;
    state.frozenStatus = null;
    state.frozenBoxes = [];
    els.lockTag.classList.add("hidden");
    els.ready.classList.add("hidden");
    els.goggleBadge.classList.add("hidden");
    els.hint.textContent = "Stand in the frame with safety goggles on. Hold still so we can lock onto you.";
    show("live");
    requestAnimationFrame(loop);
  } catch (err) {
    els.start.disabled = false;
    els.start.textContent = "Start camera";
    els.boot.textContent = `Camera blocked: ${err.message}. Allow camera access for this site.`;
  }
}

function retake() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  state.running = true;
  state.locked = false;
  state.counting = false;
  state.stableMs = 0;
  state.smileMs = 0;
  state.wearMs = 0;
  state.goneMs = 0;
  state.frozenFaces = null;
  state.frozenStatus = null;
  state.frozenBoxes = [];
  els.lockTag.classList.add("hidden");
  els.ready.classList.add("hidden");
  els.countdown.classList.add("hidden");
  show("live");
  requestAnimationFrame(loop);
}

async function sendEmail(event) {
  event.preventDefault();
  els.sendError.classList.add("hidden");
  els.send.disabled = true;
  els.send.textContent = "Sending photo…";
  const blob = await new Promise((resolve) => els.photo.toBlob(resolve, "image/jpeg", 0.92));
  const filter = FILTERS.find((item) => item.id === state.filterId);
  const body = new FormData();
  body.append("email", els.email.value.trim());
  body.append("status", state.snapStatus.label);
  body.append("filter", filter ? filter.name : "Sarawak");
  body.append("image", blob, "goggleguard.jpg");
  try {
    const res = await fetch("/api/send", { method: "POST", body });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not send email");
    if (state.snapUrl) URL.revokeObjectURL(state.snapUrl);
    state.snapUrl = URL.createObjectURL(blob);
    els.sentPreview.src = state.snapUrl;
    els.sentKicker.textContent = data.via === "mail.app" ? "Sent with Mac Mail" : "Inbox confirmed";
    els.sentTitle.textContent = "Photo sent";
    els.sentCopy.textContent = `We emailed your GoggleGuard snap to ${els.email.value.trim()}. Check inbox and spam.`;
    show("sent");
    let left = 15;
    els.sentTimer.textContent = `Resetting for the next visitor in ${left}s`;
    clearInterval(state.resetTimer);
    state.resetTimer = setInterval(() => {
      left -= 1;
      els.sentTimer.textContent = `Resetting for the next visitor in ${left}s`;
      if (left <= 0) resetBooth();
    }, 1000);
  } catch (err) {
    els.sendError.innerHTML = `${err.message} You can retry, or <a id="dl-photo" href="#">download the photo</a>.`;
    els.sendError.classList.remove("hidden");
    document.getElementById("dl-photo")?.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      const link = document.createElement("a");
      link.href = els.photo.toDataURL("image/jpeg", 1.0);
      link.download = "goggleguard-snap.jpg";
      link.click();
    });
  } finally {
    els.send.disabled = false;
    els.send.textContent = "Send my photo";
  }
}

function resetBooth() {
  clearInterval(state.resetTimer);
  els.email.value = "";
  state.filterId = "default";
  setupFilters();
  retake();
}

els.start.addEventListener("click", startCamera);
els.ready.addEventListener("click", startCountdown);
els.form.addEventListener("submit", sendEmail);
els.retake.addEventListener("click", retake);
els.next.addEventListener("click", resetBooth);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") resetBooth();
});

preloadBorders().then(() => {
  setupFilters();
});
pollHealth();
setInterval(pollHealth, 2500);
