"""
Authentication + authorization for the whole API.

- Passwords: PBKDF2-HMAC-SHA256 with a per-user random salt (stdlib only — no passlib/bcrypt dependency).
- Sessions: stateless signed tokens (HMAC-SHA256). Every request still re-loads
  the user from the database, so disabling an account, changing its role, or
  resetting its password takes effect immediately.
- Authorization: one global dependency (`authorize`) maps the first URL segment
  to a module and checks the user's role: GET needs "view", anything else "edit".
  Unknown paths are denied by default.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import datetime
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import models
from .database import get_db, SessionLocal

TOKEN_TTL_SECONDS = 7 * 24 * 3600
PBKDF2_ITERATIONS = 240_000

LEVELS = {"none": 0, "view": 1, "edit": 2}

# (key, label, section, url prefixes). `dashboard` is UI-only (the dashboard page
# itself tolerates missing data); every other key guards the listed URL prefixes.
# >>> ADD A MODULE: append a row here, register the router in main.py, add the page
# >>> key to frontend/src/permissions.js (PAGE_MODULE) and Sidebar.jsx (NAV_SECTIONS).
# The first URL segment of a route (e.g. "items" in /items/5) is looked up in PREFIX_TO_MODULE;
# a path whose first segment is not listed here is DENIED for non-admins (deny by default).
MODULES = [
    ("dashboard", "Home Dashboard", "Analytics", []),
    ("items", "Items (example module)", "Catalogue", ["items"]),
    ("invoice_settings", "Company & Invoice Settings", "Settings", ["settings"]),
]
MODULE_KEYS = {m[0] for m in MODULES}
PREFIX_TO_MODULE = {p: m[0] for m in MODULES for p in m[3]}

# Extra actions that sit on top of module access (checked with require_action(...) on a route
# and canDo(...) in the React UI). Assign them per role in Accounts -> Roles.
ACTIONS = [
    ("delete_items", "Delete items"),
]
ACTION_KEYS = {a[0] for a in ACTIONS}

# Master-data lists that forms in OTHER modules need for dropdowns. Any signed-in user may READ
# these (the base list / detail only — never anything whose last URL segment is in
# SENSITIVE_LAST_SEGMENTS, e.g. balances or ledgers). Example: let a storekeeper raise a goods
# receipt without being handed the whole Vendors module.
LOOKUP_PREFIXES = {"items"}
SENSITIVE_LAST_SEGMENTS = {"balance", "ledger"}

# Read-only companions: holders of the modules on the right can also READ the module on the
# left, because their screens call it (e.g. the GRN form lists open purchase orders).
# Writes still need the module itself. Format: {"module_being_read": {"modules_whose_screens_need_it"}}
READ_ALSO = {
    # "purchase_orders": {"grn"},
}

PUBLIC_PATHS = {"/", "/auth/login", "/auth/status"}


# ---------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt, hexhash = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters))
        return hmac.compare_digest(dk.hex(), hexhash)
    except Exception:
        return False


_DUMMY_HASH = hash_password("not-a-real-password")


def validate_new_password(password: str):
    if len(password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")


# ------------------------------------------------------------------- tokens
_secret_cache: Optional[bytes] = None


def _secret() -> bytes:
    global _secret_cache
    if _secret_cache:
        return _secret_cache
    env = os.getenv("SECRET_KEY")
    if env:
        _secret_cache = env.encode()
        return _secret_cache
    db = SessionLocal()
    try:
        row = db.query(models.AuthSecret).filter(models.AuthSecret.id == 1).first()
        if not row:
            row = models.AuthSecret(id=1, value=secrets.token_hex(32))
            db.add(row)
            db.commit()
        _secret_cache = row.value.encode()
        return _secret_cache
    finally:
        db.close()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def create_token(user: models.User) -> str:
    payload = {"u": user.id, "v": user.token_version or 0, "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _decode_token(token: str) -> Optional[dict]:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


# -------------------------------------------------------------- permissions
def parse_permissions(role: models.Role) -> dict:
    try:
        raw = json.loads(role.permissions or "{}")
    except Exception:
        raw = {}
    modules = {k: v for k, v in (raw.get("modules") or {}).items() if k in MODULE_KEYS and v in ("view", "edit")}
    actions = [a for a in (raw.get("actions") or []) if a in ACTION_KEYS]
    return {"modules": modules, "actions": actions}


def normalize_permissions(modules: dict, actions: list) -> str:
    clean_modules = {}
    for k, v in (modules or {}).items():
        if k not in MODULE_KEYS:
            raise HTTPException(status_code=400, detail=f"Unknown module '{k}'")
        if v not in LEVELS:
            raise HTTPException(status_code=400, detail=f"Invalid access level '{v}' for {k}")
        if v != "none":
            clean_modules[k] = v
    clean_actions = []
    for a in actions or []:
        if a not in ACTION_KEYS:
            raise HTTPException(status_code=400, detail=f"Unknown action '{a}'")
        if a not in clean_actions:
            clean_actions.append(a)
    return json.dumps({"modules": clean_modules, "actions": clean_actions})


def user_can(user: models.User, module: str, level: str = "view") -> bool:
    if user.role.is_admin:
        return True
    have = parse_permissions(user.role)["modules"].get(module, "none")
    return LEVELS[have] >= LEVELS[level]


def user_has_action(user: models.User, action: str) -> bool:
    return bool(user.role.is_admin) or action in parse_permissions(user.role)["actions"]


def user_summary(user: models.User) -> dict:
    perms = parse_permissions(user.role)
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role_id": user.role_id,
        "role_name": user.role.name,
        "is_admin": bool(user.role.is_admin),
        "modules": perms["modules"],
        "actions": perms["actions"],
        "must_change_password": bool(user.must_change_password),
    }


# -------------------------------------------------------------- the guard
def _extract_token(request: Request, path: str) -> Optional[str]:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    # <img src> / <a href> can't send headers, so uploaded files also accept ?token=
    if path.startswith("/uploads/"):
        return request.query_params.get("token")
    return None


def authorize(request: Request, db: Session = Depends(get_db)):
    """Global dependency: authenticates the caller and checks module access."""
    if request.method == "OPTIONS":
        return
    path = request.url.path
    norm = path.rstrip("/") or "/"
    if norm in PUBLIC_PATHS:
        return

    token = _extract_token(request, path)
    payload = _decode_token(token) if token else None
    if not payload:
        raise HTTPException(status_code=401, detail="Please sign in")
    user = db.query(models.User).filter(models.User.id == payload["u"]).first()
    if (not user or not user.is_active or (user.token_version or 0) != payload["v"]):
        raise HTTPException(status_code=401, detail="Your session has ended — please sign in again")
    request.state.user = user

    seg = norm.strip("/").split("/")[0]

    if seg == "auth":
        return  # me / change-password: any signed-in user
    if user.must_change_password:
        raise HTTPException(status_code=403, detail="You must change your temporary password before continuing")
    if seg == "uploads":
        return
    if user.role.is_admin:
        return
    if seg in ("accounts", "admin"):
        raise HTTPException(status_code=403, detail="Only administrators can do this")

    module = PREFIX_TO_MODULE.get(seg)
    if module is None:
        raise HTTPException(status_code=403, detail="Access denied")

    is_read = request.method in ("GET", "HEAD")
    last_segment = norm.rsplit("/", 1)[-1]
    if is_read and seg in LOOKUP_PREFIXES and last_segment not in SENSITIVE_LAST_SEGMENTS:
        return
    if is_read and seg == "settings":
        return  # invoice branding is needed to print any invoice

    need = "view" if is_read else "edit"
    if is_read and last_segment != "report" and any(user_can(user, m, "view") for m in READ_ALSO.get(module, ())):
        return
    if not user_can(user, module, need):
        label = next(m[1] for m in MODULES if m[0] == module)
        verb = "view" if is_read else "make changes in"
        raise HTTPException(status_code=403, detail=f"Your role doesn't allow you to {verb} {label}")


def require_action(action: str):
    def dep(request: Request):
        user = getattr(request.state, "user", None)
        if not user or not user_has_action(user, action):
            label = dict(ACTIONS).get(action, action)
            raise HTTPException(status_code=403, detail=f"Your role doesn't include permission to: {label}")
    return dep


def current_user(request: Request) -> models.User:
    return request.state.user


# ---------------------------------------------------------------- bootstrap
def ensure_admin_bootstrap():
    """Always guarantee the built-in Admin role. If ADMIN_USERNAME/ADMIN_PASSWORD
    are set and there are no users yet, create the first admin. ADMIN_FORCE_RESET=1
    additionally resets that account's password (lock-out recovery) — remove the
    variable afterwards."""
    db = SessionLocal()
    try:
        role = db.query(models.Role).filter(models.Role.is_system == 1).first()
        if not role:
            role = db.query(models.Role).filter(models.Role.name == "Admin").first()
            if role:
                role.is_system, role.is_admin = 1, 1
            else:
                role = models.Role(name="Admin", description="Full access, including account management",
                                   is_admin=1, is_system=1, permissions="{}")
                db.add(role)
            db.commit()
            db.refresh(role)

        username = (os.getenv("ADMIN_USERNAME") or "").strip().lower()
        password = os.getenv("ADMIN_PASSWORD") or ""
        user_count = db.query(models.User).count()

        if not username or not password:
            if user_count == 0:
                print("[auth] WARNING: no user accounts exist and ADMIN_USERNAME/ADMIN_PASSWORD are not set — "
                      "nobody can sign in. Set both variables and redeploy.")
            return
        if len(password) < 8:
            print("[auth] ADMIN_PASSWORD is shorter than 8 characters — ignoring bootstrap.")
            return

        existing = db.query(models.User).filter(models.User.username == username).first()
        if user_count == 0 and not existing:
            db.add(models.User(username=username, full_name=username.title(), password_hash=hash_password(password),
                               role_id=role.id, is_active=1, must_change_password=0))
            db.commit()
            print(f"[auth] Created first admin account '{username}'.")
        elif os.getenv("ADMIN_FORCE_RESET", "").lower() in ("1", "true", "yes"):
            if existing:
                existing.password_hash = hash_password(password)
                existing.role_id = role.id
                existing.is_active = 1
                existing.must_change_password = 0
                existing.token_version = (existing.token_version or 0) + 1
            else:
                db.add(models.User(username=username, full_name=username.title(), password_hash=hash_password(password),
                                   role_id=role.id, is_active=1, must_change_password=0))
            db.commit()
            print(f"[auth] ADMIN_FORCE_RESET: reset admin account '{username}'. Remove ADMIN_FORCE_RESET now.")
    finally:
        db.close()
