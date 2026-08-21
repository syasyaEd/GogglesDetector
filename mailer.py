"""Send souvenir photos by SMTP or macOS Mail.app."""

from __future__ import annotations

import os
import platform
import re
import smtplib
import subprocess
import tempfile
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

EMAIL_RE = re.compile(r"^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$", re.I)


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match((value or "").strip()))


def smtp_configured() -> bool:
    return bool(os.getenv("MAIL_USERNAME") and os.getenv("MAIL_PASSWORD"))


def mail_app_available() -> bool:
    return platform.system() == "Darwin"


def send_photo(
    to_email: str,
    image_bytes: bytes,
    status_label: str,
    filter_name: str,
) -> dict:
    to_email = to_email.strip()
    if not is_valid_email(to_email):
        return {"ok": False, "error": "Please enter a valid email address."}

    subject = "Your GoggleGuard snap from AI For Makers 2026"
    text_body = (
        "Hi!\n\n"
        "Thanks for visiting the GogglesGuard booth at AI For Makers 2026 "
        "(Borneo Makers Festival) at TEGAS Digital Village, Kuching.\n\n"
        f"Safety check: {status_label}\n"
        f"Filter: {filter_name}\n\n"
        "Your photo is attached. In factories and labs, always wear safety goggles "
        "to protect your eyes.\n\n"
        "— GogglesGuard × AI For Makers 2026\n"
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;background:#0b0c0e;color:#f4f1ea;padding:24px;">
      <div style="max-width:560px;margin:auto;background:#15171c;border-radius:18px;overflow:hidden;border:1px solid #2a2e38;">
        <div style="background:#ffd100;color:#111;padding:16px 20px;font-weight:800;letter-spacing:.04em;">
          GOGGLESGUARD · AI FOR MAKERS 2026
        </div>
        <div style="padding:20px;">
          <p style="margin:0 0 12px;">Thanks for trying the safety goggles booth.</p>
          <p style="margin:0 0 16px;"><b>Safety check:</b> {status_label}<br>
          <b>Filter:</b> {filter_name}</p>
          <img src="cid:snap" alt="Your snap" style="width:100%;border-radius:12px;display:block;">
          <p style="margin:16px 0 0;color:#c6c1b4;font-size:14px;">
            In factories, labs and workshops, always wear safety goggles.
          </p>
        </div>
      </div>
    </div>
    """

    errors: list[str] = []
    if smtp_configured():
        try:
            _send_smtp(to_email, subject, text_body, html_body, image_bytes)
            return {"ok": True, "via": "smtp"}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"SMTP: {exc}")

    if mail_app_available():
        try:
            _send_mail_app(to_email, subject, text_body, image_bytes)
            return {"ok": True, "via": "mail.app"}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Mail.app: {exc}")

    if not errors:
        return {
            "ok": False,
            "error": "Email is not configured. Add Gmail details in .env or sign in to Mac Mail.",
        }
    return {"ok": False, "error": " | ".join(errors)}


def _send_smtp(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str,
    image_bytes: bytes,
) -> None:
    host = os.getenv("MAIL_HOST", "smtp.gmail.com")
    port = int(os.getenv("MAIL_PORT", "587"))
    username = os.getenv("MAIL_USERNAME", "")
    password = os.getenv("MAIL_PASSWORD", "")
    from_addr = os.getenv("MAIL_FROM", username)
    from_name = os.getenv("MAIL_FROM_NAME", "GoggleGuard Booth")

    msg = MIMEMultipart("related")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_addr}>"
    msg["To"] = to_email

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text_body, "plain", "utf-8"))
    alt.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(alt)

    image = MIMEImage(image_bytes, _subtype="jpeg")
    image.add_header("Content-ID", "<snap>")
    image.add_header("Content-Disposition", "attachment", filename="goggleguard-snap.jpg")
    msg.attach(image)

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.login(username, password)
        smtp.sendmail(from_addr, [to_email], msg.as_string())


def _as_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _send_mail_app(to_email: str, subject: str, body: str, image_bytes: bytes) -> None:
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
        handle.write(image_bytes)
        path = handle.name

    posix = Path(path).resolve().as_posix()
    script = f'''
    tell application "Mail"
        set newMessage to make new outgoing message with properties {{subject:"{_as_literal(subject)}", content:"{_as_literal(body)}", visible:false}}
        tell newMessage
            make new to recipient at end of to recipients with properties {{address:"{_as_literal(to_email)}"}}
            make new attachment with properties {{file name:POSIX file "{posix}"}} at after the last paragraph
        end tell
        send newMessage
    end tell
    '''
    try:
        completed = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=40,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "Mail.app refused to send")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
