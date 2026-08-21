if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r) {
    const radius = typeof r === "number" ? r : 8;
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
    return this;
  };
}

export const FILTERS = [
  { id: "default", name: "Sarawak", emoji: "🪶", src: "/static/borders/default.png" },
  { id: "lab", name: "Lab", emoji: "🧪", src: "/static/borders/lab.png" },
  { id: "factory", name: "Factory", emoji: "🏭", src: "/static/borders/factory.png" },
  { id: "construction", name: "Site", emoji: "🚧", src: "/static/borders/construction.png" },
  { id: "timber", name: "Timber", emoji: "🪵", src: "/static/borders/timber.png" },
  { id: "healthcare", name: "Clinic", emoji: "🏥", src: "/static/borders/healthcare.png" },
];

const borderImages = new Map();

export function preloadBorders() {
  return Promise.all(
    FILTERS.map(
      (border) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            borderImages.set(border.id, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = border.src;
        })
    )
  );
}

export function faceBox(landmarks) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x1: minX, y1: minY, x2: maxX, y2: maxY };
}

function punchedFrame(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = data.data;
  const x0 = Math.round(canvas.width * 0.0625);
  const y0 = Math.round(canvas.height * 0.0833);
  const x1 = Math.round(canvas.width * 0.9375);
  const y1 = Math.round(canvas.height * 0.88);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245) {
        pixels[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

const punched = new Map();

export function drawFilters(ctx, filterId, _faces, width, height) {
  const img = borderImages.get(filterId);
  if (!img) return;
  let frame = punched.get(filterId);
  if (!frame) {
    frame = punchedFrame(img);
    punched.set(filterId, frame);
  }
  ctx.drawImage(frame, 0, 0, width, height);
}

export function drawBanner(ctx, width, height, status) {
  const h = Math.max(54, height * 0.09);
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `700 ${Math.max(16, width * 0.022)}px Outfit, sans-serif`;
  ctx.fillText("GOGGLESGUARD  ·  AI FOR MAKERS 2026", 18, height - h + 28);
  ctx.fillStyle = status.color;
  ctx.font = `700 ${Math.max(14, width * 0.018)}px Outfit, sans-serif`;
  ctx.fillText(status.label, 18, height - 14);
  ctx.restore();
}