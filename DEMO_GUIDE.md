# GogglesGuard ? what to say at AI For Makers 2026

Booth name: **GogglesGuard** (photo stamp: GOGGLESGUARD)  
Event: AI For Makers 2026 · Borneo Makers Festival · TEGAS Digital Village, Kuching  
URL on the laptop: **http://127.0.0.1:5050** (use localhost, not a LAN IP, or the camera may be blocked)

Learn in this order: the 40-second story ? the one sentence if you freeze ? ?how did you train it?? ? the Q&A.

---

## 1. Short story (about 40 seconds)

*Say this while someone stands in front of the MacBook. Do not rush.*

In factories and labs, people get eye injuries because they forget safety goggles. Our project is **GogglesGuard**, a live AI booth for **AI For Makers 2026**.

You stand in front of this camera. One AI finds your face. Another AI checks whether those are **real safety goggles**, not ordinary glasses. If they are on, the corner says **Goggle On** and the booth **locks**. If you take them off, it **unlocks** ? so the souvenir is a reward for wearing PPE, not just for having a face.

Then you tap **I'm ready**, it counts 3-2-1, takes a photo. You pick an industry border ? lab, factory, construction, timber, clinic, or Sarawak ? type your email, and we send you the snap.

So it is not only a detector. It is a safety reminder.

---

## 2. One sentence if you freeze

**GoggleGuard is a local AI booth that checks for safety goggles on a live camera, only then takes a photo with an industry border, and emails it to you.**

---

## 3. Two-minute pitch (supervisor / judges)

**Problem.** PPE only works if people wear it. Eye injuries still happen when goggles stay in the pocket. Old systems wait for a photo upload. A festival queue needs a live camera.

**What we built.** One screen. MacBook camera. No ChatGPT vision, no cloud API. Face AI in the browser, goggles AI in Python on this laptop.

**What is new vs the old version.** First version: upload a photo, YOLO draws boxes, count who is wearing vs not. This version: live camera ? lock only when safety goggles stay on ? countdown ? industry border ? email.

**How the AI thinks (simple).** Two models, two jobs:

1. **Face AI** (MediaPipe Face Landmarker, in the browser) ? where is the head, where are the eyes.
2. **Goggles AI** (YOLO-World + CLIP, in Python) ? is that object *safety goggles*, or just eyeglasses / sunglasses?

**Souvenir.** After snap, they pick a PNG border. The photo is stamped `GOGGLESGUARD · AI FOR MAKERS 2026` plus the safety status. Email goes out.

---

## 4. How it works, A to Z

### A. You start the booth

Run `./start.sh`. That creates a Python virtual environment if needed, installs packages, then runs `app.py`.

`app.py` is a **Flask** web server on port **5050**. It serves the webpage and two APIs:

| Piece | File | Job |
| --- | --- | --- |
| Page | `static/index.html` | The four screens: attract, live camera, decorate, sent |
| Booth brain | `static/booth.js` | Camera, lock, countdown, snap, email |
| Borders + stamp | `static/filters.js` | Overlay PNG frames and the event text |
| Goggles AI | `detector.py` | YOLO-World + your prompts and rules |
| Server | `app.py` | `/` `/api/health` `/api/detect` `/api/send` |
| Email | `mailer.py` | Gmail SMTP, or Mac Mail.app |

On boot, a background thread loads **YOLO-World** (`yolov8s-worldv2.pt`). It prefers Apple **MPS** (the Mac GPU). If that fails, CPU. That is why the first screen says ?Warming up the safety AI?.

The webpage polls `/api/health` until `yolo` is true.

### B. Visitor presses Start camera

The browser asks macOS for the webcam at **1920×1080** if the camera can do it. The video is **mirrored** (`scaleX(-1)`) so it feels like a mirror.

At the same time, the browser loads **MediaPipe Face Landmarker** from files in `static/vendor/` (`face_landmarker.task` + WASM). That model:

- finds up to **4 faces**
- outputs **468 landmarks** (eyes, nose, mouth, ears, outline)
- can output **blendshapes** (smile scores exist in the code; the live booth starts the countdown from the **I'm ready** button, not from a smile)

This does **not** go to Google's servers. The model file is on the laptop and runs in the browser.

### C. Every video frame: find the face

`booth.js` runs `requestAnimationFrame` ? about 30?60 times a second.

Each frame:

1. Face Landmarker looks at the live video.
2. Yellow box around the face (green when locked).
3. Corner badge: **Goggle On** (green) or **You are not wearing safety goggles** (red), but only if a face is there.

The face box is the min/max of all 468 points, converted to 0?1 coordinates so it works at any resolution.

### D. Every ~280 ms: find the goggles

YOLO is slower than the face model, so we do **not** run it every frame. About 3?4 times a second:

1. Copy the video onto a small canvas.
2. JPEG at quality **0.7** (this JPEG is only for detection, not the souvenir).
3. POST to `/api/detect`.
4. Flask opens the image with Pillow, converts to a NumPy RGB array, calls `detector.detect()`.

YOLO-World settings:

- image size **640**
- confidence floor **0.15** (the model's own cutoff before your rules)

Each box comes back as:

- `label` ? the prompt it matched, e.g. `wraparound safety glasses`
- `kind` ? `safety` or `glasses`
- `conf` ? 0 to 1 (?how sure?)
- `bbox` ? `[x1, y1, x2, y2]` in **0?1** so the browser can draw on any canvas size

### E. What YOLO-World actually is

Normal YOLO is trained on a **fixed list** of classes: person, car, dog? You cannot say ?safety goggles? unless that class was in the training set.

**YOLO-World** is **open-vocabulary**. It has two towers:

1. **Image tower** ? YOLO-like, finds candidate boxes in the picture.
2. **Text tower** ? **CLIP**, which turns words into a vector (an embedding).

At runtime you call `model.set_classes(PROMPTS)`. CLIP embeds your phrases. For each box, the model asks: ?does this patch look like **this phrase**??

That is why adding `"wraparound safety glasses"` changed behaviour **without** drawing thousands of new boxes. You specialised the detector with language, not with a new training run.

Prompts in `detector.py`:

**Safety side:** safety goggles, protective goggles, lab goggles, industrial safety goggles, wraparound safety glasses, goggles

**Everyday side:** eyeglasses, sunglasses, reading glasses

Real wraparound PPE on your tests often scored around **0.89** on `wraparound safety glasses`. That prompt matters. If you drop it, the booth can miss real goggles.

### F. Your rules (this is your AI engineering)

The backbone was trained by Ultralytics / CLIP researchers. **The decision layer is yours.**

In Python (`detector.py`):

1. Label contains eyeglass / sunglass / reading, or is exactly `glasses` ? kind **glasses**, but only if conf ? **0.22**. Weaker hits are treated as noise.
2. Label contains wraparound / goggle / protective / lab / industrial / safety glasses ? kind **safety**, if conf ? **0.18**.
3. If a safety box and a glasses box **overlap** (IoU > **0.25**): keep safety, **unless** the fashion glasses score is clearly higher (**+0.12**). Safety wins the tie. That stops the model from calling PPE ?sunglasses?.
4. If a glasses box overlaps a kept safety box, drop the glasses box.

**IoU** = Intersection over Union. How much two boxes sit on the same pixels. 0 = no overlap, 1 = identical box.

In the browser (`booth.js`):

5. A goggles box only ?counts? if it sits on the **upper ~70% of the face** (eye zone), overlap > **0.1**. A random box on a poster in the room does not lock the booth.
6. If both safety and fashion glasses hit the same face: fashion wins only if its confidence is **0.12 above** safety. Otherwise safety.

Corner logic:

- safety on the face ? **Goggle On** / `SAFETY GOGGLES ON`
- fashion glasses on the face ? glasses warning
- face, nothing on the eyes ? **You are not wearing safety goggles**

### G. Lock (the booth idea)

Lock is **not** ?I saw a face?.

**Lock** when a face is present **and** safety goggles stay classified for about **350 ms**. Then:

- freeze the face box, goggle boxes, and green status (so walking with goggles on does not flicker)
- show **LOCKED**
- show **I'm ready ? start countdown**
- keep sending frames to YOLO in the background, so taking goggles **off** can still be seen

**Unlock** when goggles are gone for about **800 ms**:

- live boxes return
- countdown cancels
- they cannot snap until PPE is back

That is the safety lesson you can demonstrate live: no goggles ? red badge ? no lock ? no photo.

While locked, moving around should **not** reset, as long as the goggles stay on.

### H. Countdown and snap

They tap **I'm ready**. Countdown **3-2-1** with beeps. Then `snap()`:

1. Stop the live loop.
2. White flash.
3. Copy the **mirrored** video frame onto a canvas (what they saw in the ?mirror?).
4. JPEG quality **1.0** for the still (high quality souvenir).
5. Run Face Landmarker again in **IMAGE** mode on that still.
6. Run YOLO again on that still so the stamp (`SAFETY GOGGLES ON` vs not) matches the actual photo, not an old live frame.
7. Switch to the decorate screen.

### I. Industry borders (not face stickers)

After snap they pick:

| Button | File | Meaning |
| --- | --- | --- |
| Sarawak | `default.png` | Hornbill / Dayak frame (this is a frame, not ?no border?) |
| Lab | `lab.png` | Laboratory |
| Factory | `factory.png` | Factory |
| Site | `construction.png` | Construction |
| Timber | `timber.png` | Timber |
| Clinic | `healthcare.png` | Healthcare |

The PNGs are full-frame overlays (designed around 1920×1080 with a hole in the middle). `punchedFrame()` makes near-white pixels in the inner rectangle transparent so the photo shows through.

Then `drawBanner()` writes, without a black bar:

- `GOGGLESGUARD · AI FOR MAKERS 2026`
- status in colour (`SAFETY GOGGLES ON` / not wearing)

### J. Email

They type an email. The decorated canvas becomes a JPEG (quality **0.92**) and POSTs `/api/send`.

Server:

1. Checks the email looks valid.
2. Saves `sent_photos/TIMESTAMP_email.jpg`.
3. Appends `sent_photos/log.csv` (time, email, status, border, result).
4. Sends:
   - **Gmail SMTP** if `.env` has an app password, else
   - **Mac Mail.app** (you must be signed in to Mail)

Then **Next visitor** or wait ~15 seconds, or press Escape. The booth returns to the live camera.

Nothing is uploaded to ChatGPT. Camera traffic stays on **localhost**.

---

## 5. ?How did you train it?? ? say this honestly

Judges will ask. **Do not say you trained YOLO from scratch on thousands of your own goggles photos.** In this booth you did **not** run a custom training loop (`yolo detect train ...`). That is still real AI work. Say the next paragraphs until they feel natural.

### Training vs inference

**Training** = show a model many labeled pictures, update millions of weights with backpropagation, until loss goes down. Needs a dataset, labels (boxes around goggles), and GPU time.

**Inference** = the trained weights are frozen; you only **run** the model on new camera frames. That is what happens live at the booth.

We did not train YOLO from scratch. The heavy models were already trained by Ultralytics, CLIP, and Google; this booth is doing inference, meaning it only runs those models on the live camera. What we did is specialise YOLO-World with safety-goggle prompts ? especially wraparound safety glasses ? then add our own rules for confidence, overlap, and the eye zone, and wrap it in a lock-and-snap booth. We tested real safety goggles versus ordinary glasses, watched the wrong labels, and iterated until PPE unlocked the photo and fashion glasses did not.

### If they ask how classic YOLO training would work

1. Collect photos: goggles on, eyeglasses, nothing, many lights and angles.
2. Label boxes in Roboflow / Label Studio (`safety_goggles` / `no_goggles`).
3. Split train / val / test (e.g. 70 / 20 / 10).
4. Train: `yolo detect train data=data.yaml model=yolov8s.pt epochs=100`.
5. Watch mAP, precision, recall. If eyeglasses are confused with goggles, add hard examples.
6. Export `best.pt` and swap it into the booth.

You can add: *?The first version was closer to that idea: upload a photo, boxes, count wearing vs not. For the festival I switched to live YOLO-World so we don't need a huge custom dataset, and visitors leave with a photo.?*

---

## 6. Data path (one glance)

```
MacBook camera
  ? browser (MediaPipe: face)
  ? JPEG every ~280 ms
  ? Flask /api/detect
  ? YOLO-World + CLIP prompts + my rules
  ? boxes back to browser
  ? lock / badge / countdown
  ? still photo + PNG border + stamp
  ? /api/send
  ? JPEG on disk + email + CSV log
```

---

## 7. Likely questions ? short answers

**Q. What model?**  
YOLO-World v8s (open-vocabulary object detection) + CLIP text encoder. Face: MediaPipe Face Landmarker.

**Q. Why two models?**  
A face needs landmarks (where are the eyes). Goggles are an object in the image. One model for ?where is the head?, one for ?what is on the eyes?.

**Q. Why not ChatGPT vision?**  
Needs internet, costs money, slower, privacy. This runs on the Mac.

**Q. Did you train it?**  
I did not retrain YOLO from scratch. I used a pretrained open-vocabulary model, specialised it with prompts and rules, and built the live booth. (Then the paragraph in section 5.)

**Q. Accuracy?**  
Not 100%. Clear wraparound safety goggles work well. Dark sunglasses can look similar. Side-on faces and bad lighting are harder. That is why the box must sit on the face, not anywhere in the room.

**Q. What is confidence 0.89?**  
YOLO's score that this box matches the text prompt. 0 = no, 1 = very sure. We ignore weak glasses hits below about 0.22.

**Q. What is MPS?**  
Metal Performance Shaders ? Apple's GPU on the MacBook. Faster than CPU.

**Q. Why lock?**  
So we don't snap a blurry random frame. Also: no goggles ? no lock ? no photo. PPE first, souvenir second.

**Q. Privacy?**  
Email is only to send *their* photo. Files sit in `sent_photos/` on this laptop. Not a face-recognition ID system. No login. No cloud vision API.

**Q. Many people in frame?**  
Face Landmarker allows up to 4 faces. The lock follows the safety-goggles logic on the detected faces. The booth is designed for one visitor at a time.

**Q. Tech stack?**  
Python, Flask, Ultralytics YOLO-World, PyTorch, CLIP, JavaScript, MediaPipe, HTML/CSS, SMTP or Mail.app.

**Q. What would you improve?**  
A small custom PPE detector trained on factory photos; safety helmet class; live compliance %; auto-delete emails after the event.

---

## 8. Physical demo script

Keep a spare pair of **safety goggles** on the table. Ordinary glasses as a contrast is a strong trick.

1. Without goggles: ?Red badge. It will not lock.?
2. Put goggles on: ?Green **Goggle On**. Wait for **LOCKED**.?
3. Walk a little with goggles still on: ?It stays locked. The AI is not resetting just because I moved.?
4. Tap **I'm ready**. Countdown. Snap.
5. Pick **Lab** or **Sarawak**: ?Industry border, then we email it.?
6. Optional second pass: take goggles off while locked: ?It unlocks. It is checking PPE, not just a face.?

---

## 9. If something breaks at the booth

- **Camera blocked** ? Safari/Chrome must allow camera for `http://127.0.0.1:5050`. Do not open a `192.168?` address.
- **Address already in use** ? an old `app.py` is still running. Quit it, then `./start.sh` again.
- **AI still loading** ? first launch downloads the `.pt` file. Wait. Needs internet once.
- **Safety goggles not detected** ? confirm `wraparound safety glasses` is still in `detector.py`, then restart Flask (`Ctrl+C`, `./start.sh`). Prompt changes do not apply until restart.
- **Email fails** ? Mail.app signed in, or `.env` Gmail app password. They can still download the photo from the error link.
