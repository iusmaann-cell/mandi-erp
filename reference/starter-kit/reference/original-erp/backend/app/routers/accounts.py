"""User + role management. Admin-only — enforced centrally by security.authorize."""
import re
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas, security
from ..database import get_db

router = APIRouter(prefix="/accounts", tags=["Accounts & Roles"])

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,39}$")


def _user_out(u: models.User) -> dict:
    return {
        "id": u.id, "username": u.username, "full_name": u.full_name, "role_id": u.role_id,
        "role_name": u.role.name, "is_admin": bool(u.role.is_admin), "is_active": bool(u.is_active),
        "must_change_password": bool(u.must_change_password),
        "created_at": u.created_at, "last_login_at": u.last_login_at,
    }


def _role_out(r: models.Role) -> dict:
    perms = security.parse_permissions(r)
    return {
        "id": r.id, "name": r.name, "description": r.description, "is_admin": bool(r.is_admin),
        "is_system": bool(r.is_system), "modules": perms["modules"], "actions": perms["actions"],
        "user_count": len(r.users),
    }


def _active_admin_count(db: Session, excluding_user_id: int = None) -> int:
    q = db.query(models.User).join(models.Role).filter(models.User.is_active == 1, models.Role.is_admin == 1)
    if excluding_user_id is not None:
        q = q.filter(models.User.id != excluding_user_id)
    return q.count()


@router.get("/modules")
def list_modules():
    """The catalogue the role editor renders its permission grid from."""
    return {
        "modules": [{"key": k, "label": l, "section": s} for k, l, s, _ in security.MODULES],
        "actions": [{"key": k, "label": l} for k, l in security.ACTIONS],
    }


# ------------------------------------------------------------------- roles
@router.get("/roles", response_model=List[schemas.RoleOut])
def list_roles(db: Session = Depends(get_db)):
    return [_role_out(r) for r in db.query(models.Role).order_by(models.Role.is_system.desc(), models.Role.name).all()]


@router.post("/roles", response_model=schemas.RoleOut)
def create_role(body: schemas.RoleWrite, db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Role name is required")
    if db.query(models.Role).filter(models.Role.name.ilike(name)).first():
        raise HTTPException(status_code=400, detail=f"A role named '{name}' already exists")
    role = models.Role(
        name=name, description=(body.description or "").strip() or None, is_admin=1 if body.is_admin else 0,
        is_system=0, permissions=security.normalize_permissions(body.modules, body.actions),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return _role_out(role)


@router.put("/roles/{role_id}", response_model=schemas.RoleOut)
def update_role(role_id: int, body: schemas.RoleWrite, db: Session = Depends(get_db)):
    role = db.query(models.Role).filter(models.Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Role name is required")
    clash = db.query(models.Role).filter(models.Role.name.ilike(name), models.Role.id != role_id).first()
    if clash:
        raise HTTPException(status_code=400, detail=f"A role named '{name}' already exists")
    if role.is_system:
        if name != role.name or not body.is_admin:
            raise HTTPException(status_code=400, detail="The built-in Admin role can't be renamed or downgraded")
    elif role.is_admin and not body.is_admin:
        # would this strip the last working admin?
        admins_via_others = db.query(models.User).join(models.Role).filter(
            models.User.is_active == 1, models.Role.is_admin == 1, models.Role.id != role_id).count()
        if admins_via_others == 0 and any(u.is_active for u in role.users):
            raise HTTPException(status_code=400, detail="That would leave the system with no active administrator")
    role.name = name
    role.description = (body.description or "").strip() or None
    role.is_admin = 1 if (body.is_admin or role.is_system) else 0
    role.permissions = security.normalize_permissions(body.modules, body.actions)
    db.commit()
    db.refresh(role)
    return _role_out(role)


@router.delete("/roles/{role_id}")
def delete_role(role_id: int, db: Session = Depends(get_db)):
    role = db.query(models.Role).filter(models.Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=400, detail="The built-in Admin role can't be deleted")
    if role.users:
        raise HTTPException(status_code=400, detail=f"{len(role.users)} account(s) still use this role — move them to another role first")
    db.delete(role)
    db.commit()
    return {"deleted": True}


# ------------------------------------------------------------------- users
@router.get("/users", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db)):
    return [_user_out(u) for u in db.query(models.User).order_by(models.User.username).all()]


@router.post("/users", response_model=schemas.UserOut)
def create_user(body: schemas.UserCreate, db: Session = Depends(get_db)):
    username = body.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username must be 3–40 characters: lowercase letters, numbers, dot, dash or underscore")
    if not body.full_name.strip():
        raise HTTPException(status_code=400, detail="Full name is required")
    if db.query(models.User).filter(models.User.username == username).first():
        raise HTTPException(status_code=400, detail=f"Username '{username}' is already taken")
    if not db.query(models.Role).filter(models.Role.id == body.role_id).first():
        raise HTTPException(status_code=400, detail="Selected role not found")
    security.validate_new_password(body.password)
    user = models.User(
        username=username, full_name=body.full_name.strip(), password_hash=security.hash_password(body.password),
        role_id=body.role_id, is_active=1, must_change_password=1 if body.must_change_password else 0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.put("/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: int, body: schemas.UserUpdate, request: Request, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    me = security.current_user(request)

    new_role = user.role
    if body.role_id is not None and body.role_id != user.role_id:
        new_role = db.query(models.Role).filter(models.Role.id == body.role_id).first()
        if not new_role:
            raise HTTPException(status_code=400, detail="Selected role not found")
    will_be_active = bool(user.is_active) if body.is_active is None else body.is_active

    if user.id == me.id and not will_be_active:
        raise HTTPException(status_code=400, detail="You can't deactivate your own account")
    was_active_admin = bool(user.is_active) and bool(user.role.is_admin)
    stays_active_admin = will_be_active and bool(new_role.is_admin)
    if was_active_admin and not stays_active_admin and _active_admin_count(db, excluding_user_id=user.id) == 0:
        raise HTTPException(status_code=400, detail="That would leave the system with no active administrator")

    if body.full_name is not None:
        if not body.full_name.strip():
            raise HTTPException(status_code=400, detail="Full name is required")
        user.full_name = body.full_name.strip()
    if new_role.id != user.role_id:
        user.role_id = new_role.id
    if body.is_active is not None:
        if bool(user.is_active) and not body.is_active:
            user.token_version = (user.token_version or 0) + 1   # kick out any live sessions
        user.is_active = 1 if body.is_active else 0
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: int, body: schemas.ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    security.validate_new_password(body.new_password)
    user.password_hash = security.hash_password(body.new_password)
    user.must_change_password = 1 if body.must_change_password else 0
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    return {"message": f"Password reset for {user.username}"}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if user.id == security.current_user(request).id:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    if user.is_active and user.role.is_admin and _active_admin_count(db, excluding_user_id=user.id) == 0:
        raise HTTPException(status_code=400, detail="That would leave the system with no active administrator")
    db.delete(user)
    db.commit()
    return {"deleted": True}
