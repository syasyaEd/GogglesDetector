# GoggleGuard — Demo story, how it works, and Q&A

Use this at **AI For Makers 2026** (Borneo Makers Festival, TEGAS Digital Village, Kuching).

Project name on the booth: **GoggleGuard**  
URL: `http://127.0.0.1:5050`

---

## 1. Short story (about 40 seconds)

*Say this while someone stands in front of the MacBook.*

In factories and labs, people get eye injuries because they forget safety goggles. My project, **GoggleGuard**, is a live AI booth for **AI For Makers 2026**.

You stand in front of the camera. The AI finds your face, then checks whether those are **real safety goggles**, not normal glasses. If they are on, the corner says **Goggle On** and it **locks**. If you take them off, it **unlocks**. Smile, it counts 3-2-1, takes a photo. Then you pick a fun Apple-emoji filter that sits on your face, type your email, and we send you the snap.

So it is not only a detector. It is a safety reminder you can take home.

---

## 2. Two-minute pitch (supervisor / judges)

**Problem.** PPE only works if people wear it. Old systems wait for a photo upload. Queues at an event need a live camera.

**What I built.** One screen. MacBook camera. No cloud vision API. Everything runs on this laptop.

**What is new vs my old version.** The first version: upload a photo, YOLO draws boxes, count who wears goggles. This version: live camera → lock only when safety goggles are on → smile + countdown → decorate → email.

**How the AI thinks (simple).** Two AIs work together:

1. **Face AI** (in the browser) finds eyes, ears, smile.
2. **Goggles AI** (on the laptop, YOLO-World) looks for *safety goggles* vs *eyeglasses / sunglasses*.

**Souvenir.** After snap, filters follow the face. The photo is emailed. A copy is saved on the laptop with a log of email, status, and filter.

---

## 3. How it works, A to Z

### A. You start the booth

Run `./start.sh` (or `python app.py`). Flask serves the website at `http://127.0.0.1:5050`.

In the background, Python loads **YOLO-World** (`yolov8s-worldv2.pt`) on Apple **MPS** (the Mac GPU) if it can, otherwise CPU. That is why the first screen says “Warming up the safety AI”.

| Piece | File |
|---|---|
| Web page | `static/index.html` |
| Booth logic | `static/booth.js` |
| Filters + photo stamp | `static/filters.js` |
| Goggles AI | `detector.py` |
| Website + APIs | `app.py` |
| Email | `mailer.py` |

### B. Visitor presses “Start camera”

The browser asks macOS for the webcam. The video is **mirrored** so it feels like a mirror.

At the same time, the browser loads **MediaPipe Face Landmarker** (`static/vendor/face_landmarker.task`). That model outputs up to **468 points** on the face (eyes, nose, mouth, ears, outline) and **blendshapes** (including smile).

This does **not** go to Google’s servers. The model file is stored locally and runs in the browser.

### C. Every frame: find the face

`booth.js` runs a loop (`requestAnimationFrame`).

Each frame:

- Face Landmarker → “there is a face here, these are the landmarks.”
- If the head stays still (~0.7s), the face is **stable**.
- Smile score = average of `mouthSmileLeft` and `mouthSmileRight`.

A yellow box is drawn around the face. When locked, the box turns green and **LOCKED** appears.

### D. Every few hundred ms: find the goggles

The camera image is JPEG’d and POSTed to `/api/detect`.

Python:

1. Opens the image.
2. YOLO-World runs at **640px**, confidence **0.15**.
3. Returns boxes: `label`, `kind` (`safety` or `glasses`), `conf`, `bbox` in 0–1 coordinates.

YOLO-World is **open-vocabulary**. You do **not** only get “cat, dog, person”. You give it **text prompts**, and it searches for those words in the image.

Prompts in `detector.py`:

- Safety side: `safety goggles`, `protective goggles`, `lab goggles`, `wraparound safety glasses`, …
- Everyday side: `eyeglasses`, `sunglasses`, `reading glasses`

That is how you “tell” the model what to look for.

Then your **rules** (this part is yours, not Ultralytics):

- If the label contains goggle / safety / protective / wraparound → **safety**.
- Else if it is ordinary glasses and confidence is low (`< 0.28`) → ignore (noise).
- If a glasses box **overlaps** a safety box → keep safety only (IoU).
- In the browser, the box must sit on the **eye region** of the face, not a random object.

Corner badge:

- Safety → **Goggle On** (green, upper right)
- Anything else with a face → **You are not wearing safety goggles** (red)

### E. Lock (booth logic)

Lock is **not** “any face”.

Lock only if:

1. A face is present and fairly still, **and**
2. Safety goggles stay detected for a short hold time (~0.45s+).

If they take the goggles off for ~0.7s:

- lock releases
- countdown cancels
- they cannot snap until goggles are back

That is the safety lesson: the fun photo is a **reward for wearing PPE**.

### F. Smile → 3-2-1 → snap

When locked, if they smile long enough, or they tap **I’m ready**, countdown starts.

`snap()`:

1. Freeze the loop.
2. Flash.
3. Copy the video frame onto a canvas (mirrored, same as what they saw).
4. Run Face Landmarker again on that still (`IMAGE` mode) so filters sit on the **photo**, not the live video.
5. Run YOLO again on the still so the status on the photo is from the actual snap.
6. Switch to the decorate screen.

### G. Filters (after snap only)

Visitor picks panda, kitty, bunny, etc.

`filters.js`:

- Reads landmark 33 and 263 (eye corners) to get **head tilt**.
- Places Apple Color Emoji at ears / forehead / crown using that angle and face size.
- So if they tilt their head, the panda ears tilt. It is not a sticker glued at a fixed x,y.

Then `drawBanner()` draws the original black strip:

- `GOGGLEGUARD · AI FOR MAKERS 2026`
- status line (`SAFETY GOGGLES ON` / not wearing)

### H. Email

They type an email. `sendEmail()` turns the canvas into a JPEG and POSTs `/api/send`.

Server:

1. Checks the email looks valid.
2. Saves `sent_photos/TIMESTAMP_email.jpg`.
3. Appends `sent_photos/log.csv` (time, email, status, filter, result).
4. Sends via **Gmail SMTP** if `.env` has an app password, otherwise **Mac Mail.app**.

Visitor gets the decorated photo. You keep a log for the event.

Then the booth resets for the next person (~15 seconds, or **Next visitor** / Escape).

---

## 4. “How did you train it?” — say this honestly

Judges will ask. **Do not say you trained YOLO from scratch on thousands of your own goggles photos** unless you actually did that for this project. In **this** booth you did not run a custom training loop. You did something that is still real AI work.

### What “training” means in AI

**Training** = show a model many labeled examples, update millions of weights with backpropagation, until loss goes down. That needs a dataset, GPU time, and labels (boxes around goggles).

**Inference** = the trained model is frozen; you only run it on new images. That is what happens live at the booth.

Your laptop is doing **inference**, not training, during the demo.

### Who trained the heavy models?

| Piece | Who trained it | What you did |
|---|---|---|
| **YOLO-World v2** (`yolov8s-worldv2.pt`) | Ultralytics / research, on huge image–text data | Downloaded it, ran it locally |
| **CLIP** (text encoder YOLO-World uses) | CLIP (Ultralytics CLIP package) | Lets the model understand words like “safety goggles” |
| **MediaPipe Face Landmarker** | Google | You load it in the browser and use landmarks |

YOLO-World is a **vision-language** detector: the image tower is YOLO-like; the text tower is CLIP. At runtime, your prompts are turned into embeddings. The model asks: “where in this frame does the visual pattern match **this phrase**?”

That is why you can add `"lab goggles"` without drawing 5,000 new boxes.

### What *you* did instead of classic training (your contribution)

1. **Chose the model** — YOLO-World, not a closed cloud API, so it works offline at TEGAS.
2. **Prompt engineering for classes** — the list in `PROMPTS` specialises it for **safety** goggles vs fashion glasses.
3. **Decision rules** — confidence thresholds, overlap (IoU), match box to the eye zone, ignore weak “glasses” detections.
4. **Booth state machine** — face stable → goggles on → lock → smile → countdown → snap → filter → email.
5. **Product design** — live camera, not upload; lock releases if goggles come off; filters on landmarks.

If someone says “so you didn’t train anything?”, answer:

> I did not retrain the backbone from zero. I specialised an open-vocabulary detector with safety-goggle prompts and rules, then built the full live system around it. For a two-day festival booth, that is the practical way: I cannot label a factory-scale dataset overnight, but I can make the model look for the right object and wrap it in a working experience.

### How classic YOLO training *would* work

If they ask “how would you train your own?”:

1. **Collect** photos: people with safety goggles, with eyeglasses, with nothing, different lighting, distances, skin tones.
2. **Label** with tools like Roboflow / Label Studio: draw a box, class = `safety_goggles` or `no_goggles`.
3. **Split** train / val / test (e.g. 70 / 20 / 10).
4. **Train** YOLOv8/v11: `yolo detect train data=data.yaml model=yolov8s.pt epochs=100`.
5. **Watch** mAP, precision, recall, confusion matrix. If it thinks eyeglasses are goggles, add more hard examples.
6. **Export** `best.pt` and replace the detector.

You can add: *“My first version was that style: upload photo, boxes, count wearing vs not. For the festival I switched to live YOLO-World so we don’t need a huge custom dataset, and visitors get a photo.”*

### Tiny “training-like” loop you *did* do

This is fair to say:

> I tested real safety goggles vs normal glasses in front of the camera, saw wrong labels, then **changed prompts and rules** until wraparound safety goggles scored high (around 0.9) as safety, and fashion glasses did not unlock the booth.

That is evaluation + iteration, which is part of building a model system.

---

## 5. Data that actually moves through the system

```
MacBook camera
    → browser (MediaPipe: face + smile)
    → JPEG every ~280ms
    → Flask /api/detect
    → YOLO-World + CLIP prompts
    → boxes back to browser
    → lock / badge / countdown
    → still photo + filters + banner
    → /api/send
    → JPEG on disk + email + CSV log
```

Nothing is uploaded to ChatGPT or a public vision API. Camera stays on localhost.

---

## 6. Likely questions — short answers

**Q. What model?**  
YOLO-World v8s (open-vocabulary object detection) + CLIP text encoder. Face: MediaPipe Face Landmarker.

**Q. Why two models?**  
Faces and smiles need landmarks (ears, tilt, mouth). Goggles are an object. One model for “where is the head”, one for “what is on the eyes”.

**Q. Why not ChatGPT vision?**  
Needs internet, cost, privacy, slower. This runs on the Mac.

**Q. Accuracy?**  
It is not 100%. Clear wraparound safety goggles work well. Dark sunglasses can look similar. Lighting and side-on faces are harder. That is why we match the box to the face, not any box in the room.

**Q. Privacy?**  
Email is for sending *their* photo. Saved under `sent_photos/` for the event. Not a face-recognition ID system. No login.

**Q. Can it do many people?**  
Face Landmarker is set for up to 4 faces. Filters can draw on each detected face. The lock follows the main stable face.

**Q. What is confidence 0.89?**  
YOLO’s score that this box matches the prompt. 0 = no, 1 = very sure. We drop weak glasses detections below 0.28.

**Q. What is MPS?**  
Metal Performance Shaders — Apple GPU. Faster than CPU on a MacBook.

**Q. Why lock?**  
So the photo is not a random blurry frame. Also: no goggles → no lock → no snap. PPE first, souvenir second.

**Q. Tech stack?**  
Python, Flask, Ultralytics, PyTorch, JavaScript, MediaPipe, HTML/CSS, SMTP or Mail.app.

**Q. What would you improve?**  
Train a small custom PPE head on factory photos; add a hard hat class; show a live compliance %; encrypt or auto-delete emails after the event.

---

## 7. Demo script (physical)

1. “Without goggles — see the red badge? It will not lock.”
2. Put goggles on. “Green **Goggle On**. Wait for LOCKED.”
3. Smile or tap ready. Countdown. Snap.
4. Pick panda. “The ears follow my face because of landmarks, not a fixed sticker.”
5. Send to a helper’s email. Show inbox.
6. Take goggles off mid-pose next time: “It unlocks. The AI is checking PPE, not just a face.”

Keep a spare pair of **safety goggles** on the table. Fashion glasses as a contrast is a strong live trick.

---

## 8. One sentence if you freeze

**GoggleGuard is a local AI booth that checks for safety goggles on a live camera, only then takes a fun face-tracked photo, and emails it to you.**

Learn that sentence, then the 40-second story, then the two-model answer. That is enough to look in control for the whole festival.
