# GoggleGuard — AI For Makers 2026

Live Mac/Windows booth: webcam checks **safety goggles**, locks, countdown, industry borders, email the photo.

Open **http://127.0.0.1:5050** (use `localhost`, not a LAN IP, or the camera may be blocked).

## Mac

```bash
git clone https://github.com/YOUR_USERNAME/GogglesDetector.git
cd GogglesDetector
chmod +x start.sh
./start.sh
```

## Windows

Install [Git](https://git-scm.com/download/win) and [Python 3.12+](https://www.python.org/downloads/) (tick **Add python.exe to PATH**).

```bat
git clone https://github.com/YOUR_USERNAME/GogglesDetector.git
cd GogglesDetector
start.bat
```

Or in Command Prompt:

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

First run downloads YOLO-World (~25 MB) and CLIP. Needs internet once.

## Email

- **Mac:** Mail.app can send if you are signed in.
- **Windows:** copy `.env.example` to `.env` and add a Gmail [App Password](https://myaccount.google.com/apppasswords).

Do not commit `.env`.
