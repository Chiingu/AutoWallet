import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailError(Exception):
    """The email could not be sent (the SMTP server is down or refused it)."""


def send_email(to: str, subject: str, body: str) -> None:
    """Send one plain-text email through the SMTP server from the settings (Mailpit in development)."""
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.warning("Could not send email to %s: %s", to, exc)
        raise EmailError("The email could not be sent.") from exc
