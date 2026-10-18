import base64
import hashlib
import hmac
import secrets

from .config import get_settings

# No 0/O, 1/I: easy to read aloud and type from a wallet card. 32^6 ~ 1.07 billion IDs.
VITAL_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def new_vital_id() -> str:
    return "VID-" + "".join(secrets.choice(VITAL_ID_ALPHABET) for _ in range(6))


def new_qr_nonce() -> str:
    return secrets.token_urlsafe(18)


def qr_token_from_nonce(nonce: str) -> str:
    """The QR token is an HMAC of a random nonce, so the database alone can't reproduce it."""
    secret = get_settings().qr_token_secret
    if not secret:
        raise RuntimeError("QR_TOKEN_SECRET is not set")
    digest = hmac.new(secret.encode(), nonce.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")[:32]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
