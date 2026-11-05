import time
import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db
from .. import security

router = APIRouter(prefix="/auth", tags=["Sign-in"])

# In-memory brute-force throttle: 5 wrong passwords for a username locks it for
# 5 minutes. Resets on restart, which is acceptable for a single-instance app.
_FAILS: dict = {}
MAX_FAILS = 5
LOCK_SECONDS = 300


@router.get("/status")
def auth_status(db: Session = Depends(get_db)):
    """Public. Lets the login screen explain what to do when no accounts exist yet."""
    return {"has_users": db.query(models.User).count() > 0}


@router.post("/login")
def login(body: schemas.LoginRequest, db: Session = Depends(get_db)):
    key = body.username.strip().lower()
    rec = _FAILS.get(key)
    if rec and rec["locked_until"] > time.time():
        wait = int(rec["locked_until"] - time.time()) // 60 + 1
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in about {wait} minute(s).")

    user = db.query(models.User).filter(models.User.username == key).first()
    ok = security.verify_password(body.password, user.password_hash if user else security._DUMMY_HASH)
    if not user or not ok or not user.is_active:
        rec = _FAILS.setdefault(key, {"count": 0, "locked_until": 0})
        rec["count"] += 1
        if rec["count"] >= MAX_FAILS:
            rec["locked_until"] = time.time() + LOCK_SECONDS
            rec["count"] = 0
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    _FAILS.pop(key, None)
    user.last_login_at = datetime.datetime.utcnow()
    db.commit()
    return {"token": security.create_token(user), "user": security.user_summary(user)}


@router.get("/me")
def me(request: Request):
    return security.user_summary(security.current_user(request))


@router.post("/change-password")
def change_password(body: schemas.ChangePasswordRequest, request: Request, db: Session = Depends(get_db)):
    user = security.current_user(request)
    if not security.verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    security.validate_new_password(body.new_password)
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current one")
    user.password_hash = security.hash_password(body.new_password)
    user.must_change_password = 0
    user.token_version = (user.token_version or 0) + 1   # signs out every other device
    db.commit()
    db.refresh(user)
    # hand back a fresh token so THIS device stays signed in
    return {"token": security.create_token(user), "user": security.user_summary(user)}
