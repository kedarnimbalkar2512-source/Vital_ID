from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher()


def hash_pin(pin: str) -> str:
    return _hasher.hash(pin)


def verify_pin(pin_hash: str | None, pin: str) -> bool:
    if not pin_hash:
        return False
    try:
        return _hasher.verify(pin_hash, pin)
    except (VerifyMismatchError, InvalidHashError):
        return False
