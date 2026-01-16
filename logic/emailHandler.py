import smtplib
from email.message import EmailMessage
import sys
import os
import uuid
# APPROVED template hardcoded but *not* directly in use; incase i decide to implement user notifs into this script, currently user notifs are sent by another script running outside app container
HTML_APPROVED = """<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9;"><div style="max-width:600px;margin:40px auto;background:#fff;border:1px solid #eef0f3;border-radius:12px;overflow:hidden;font-family:Arial,sans-serif;color:#111;line-height:1.55;"><div style="padding:16px 22px;background:#0b1220;"><div style="font-weight:900;letter-spacing:1px;font-size:13px;color:#fff;">TASKER</div><div style="margin-top:4px;font-size:11px;color:#94a3b8;">Notification</div></div><div style="padding:22px;font-size:14px;"><h2 style="margin:10px 0 6px 0;font-size:18px;line-height:1.25;">Hi <span style="font-weight:900;">${username}</span>,</h2><p style="margin:0 0 14px 0;color:#334155;">Your Tasker account has been approved.</p><div style="text-align:center;margin:18px 0 22px 0;"><a href="${login_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:9px;font-size:13px;font-weight:800;">Tasker</a><div style="margin-top:8px;font-size:11px;color:#64748b;">Manual redirect: <a href="${login_url}" style="color:#2563eb;text-decoration:none;">${login_url}</a></div></div><p style="margin:0;font-size:13px;color:#475569;">Updates and README: <a href="${readme_url}" style="color:#2563eb;text-decoration:none;font-weight:700;">GitHub</a></p><p style="margin:10px 0 0 0;font-size:13px;color:#475569;">Something broke? Got a feature idea? Respond to this email!</p><p style="margin:14px 0 0 0;font-size:13px;">Thanks,<br><strong>Anirudh</strong><br><span style="color:#64748b;">Tasker Admin</span></p></div><div style="padding:14px 22px;background:#f8fafc;border-top:1px solid #eef2f7;"><p style="margin:0;font-size:11px;color:#64748b;">Automated email. Replies go straight to me.<br>pls give internship</p></div></div></body></html>"""

#admin notification template
HTML_ADMIN_NOTIFY = """<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f6f7f9;">
    <div style="max-width:600px;margin:40px auto;background:#ffffff;
                border:1px solid #eef0f3;border-radius:12px;overflow:hidden;
                font-family: Arial, sans-serif;color:#111;line-height:1.55;">
      <div style="padding:16px 22px;background:#0b1220;">
        <div style="font-weight:900;letter-spacing:1px;font-size:13px;color:#fff;">
          TASKER
        </div>
        <div style="margin-top:4px;font-size:11px;color:#94a3b8;">
          Admin Notification
        </div>
      </div>

      <div style="padding:22px 22px;font-size:14px;">
        <h2 style="margin:10px 0 10px 0;font-size:18px;line-height:1.25;">
          Account request received
        </h2>

        <p style="margin:0 0 10px 0;color:#334155;">
          A new user requested an account:
        </p>

        <div style="padding:12px 14px;background:#f8fafc;border:1px solid #eef2f7;border-radius:10px;">
          <div style="margin:0 0 6px 0;font-size:13px;color:#0f172a;">
            <strong>Username:</strong> ${username}
          </div>
          <div style="margin:0;font-size:13px;color:#0f172a;">
            <strong>Email:</strong> ${email}
          </div>
        </div>
      </div>

      <div style="padding:14px 22px;background:#f8fafc;border-top:1px solid #eef2f7;">
        <p style="margin:0;font-size:11px;color:#64748b;">
          Automated email.
        </p>
      </div>
    </div>
  </body>
</html>
"""


def usage_and_exit():
    print("usage:")
    print("  python3 send_email.py <username> <email>")
    print("  python3 send_email.py --notifyAdmin <username> <email>")
    sys.exit(1)



notify_admin = False
args = sys.argv[1:]

if not args:
    usage_and_exit()

if args[0] == "--notifyAdmin":
    notify_admin = True
    args = args[1:]

if len(args) < 2:
    usage_and_exit()

recipientUsername = args[0]
recipientAddress = args[1]



SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587

SMTP_USER = os.getenv("TASKER_SMTP_USER")         
SMTP_PASS = os.getenv("TASKER_SMTP_PASS")         
FROM_ADDR  = os.getenv("TASKER_FROM_ADDR")
ADMIN_ADDR = os.getenv("TASKER_ADMIN_EMAIL")

LOGIN_URL  = os.getenv("TASKER_LOGIN_URL")
README_URL  = os.getenv("TASKER_README_URL")

if not SMTP_USER or not SMTP_PASS:
    print("Missing env vars: TASKER_SMTP_USER and TASKER_SMTP_PASS are required.")
    sys.exit(1)


# ---- Thread breakers (1,4) ----
notif_uuid = uuid.uuid4().hex
short_id = notif_uuid[:4].upper()
# build message
msg = EmailMessage()


msg["Message-ID"] = f"<tasker-{notif_uuid}@4nirudh.org>"


msg["X-Tasker-Notification-ID"] = notif_uuid

if notify_admin:
    # (3) Subject unique ONLY by username
    msg["Subject"] = f"Tasker: account request received - {recipientUsername} [{short_id}]"
    msg["From"] = FROM_ADDR
    msg["To"] = ADMIN_ADDR

    msg.set_content(
        f"Account request received.\n\nUsername: {recipientUsername}\nEmail: {recipientAddress}\n"
    )

    html = (
        HTML_ADMIN_NOTIFY
            .replace("${username}", recipientUsername)
            .replace("${email}", recipientAddress)
        # (4) Invisible nonce to avoid identical-body threading
        + f"<!-- tasker-nonce:{notif_uuid} -->"
    )

    msg.add_alternative(html, subtype="html", cte="base64")

else:
    # (3) Subject unique ONLY by username
    msg["Subject"] = f"Tasker access granted — {recipientUsername} [{short_id}]"
    msg["From"] = FROM_ADDR
    msg["To"] = recipientAddress

    msg.set_content("Your Tasker account is approved. View in HTML.")

    html = (
        HTML_APPROVED
            .replace("${username}", recipientUsername)
            .replace("${login_url}", LOGIN_URL)
            .replace("${readme_url}", README_URL)
        # (4) Invisible nonce to avoid identical-body threading
        + f"<!-- tasker-nonce:{notif_uuid} -->"
    )

    msg.add_alternative(html, subtype="html")

# Send
with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
    smtp.ehlo()
    smtp.starttls()
    smtp.ehlo()
    smtp.login(SMTP_USER, SMTP_PASS)
    smtp.send_message(msg)

print("Sent")
