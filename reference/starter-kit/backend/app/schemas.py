"""Request/response shapes (Pydantic). One *Create / *Update / *Out trio per entity.
Update models have every field Optional; routers apply them with update.dict(exclude_unset=True).
GOTCHA: exclude_unset turns nested pydantic models into plain dicts — if an Update model has a
nested list of line objects, read it from `update.<field>` (not from the dict) — see PATTERNS.md."""
import datetime
from typing import Optional, List
from pydantic import BaseModel


# ---------- Invoice / company settings ----------
class InvoiceSettingsUpdate(BaseModel):
    company_name: Optional[str] = None
    company_address: Optional[str] = None
    company_phone: Optional[str] = None
    company_email: Optional[str] = None
    ntn_number: Optional[str] = None
    logo_base64: Optional[str] = None
    logo_width_mm: Optional[float] = None
    logo_height_mm: Optional[float] = None
    footer_text: Optional[str] = None
    show_logo: Optional[bool] = None
    accent_color: Optional[str] = None


class InvoiceSettingsOut(BaseModel):
    company_name: str
    company_address: Optional[str] = None
    company_phone: Optional[str] = None
    company_email: Optional[str] = None
    ntn_number: Optional[str] = None
    logo_base64: Optional[str] = None
    logo_width_mm: float
    logo_height_mm: float
    footer_text: Optional[str] = None
    show_logo: bool
    accent_color: str
    class Config:
        from_attributes = True


# ---------- Sign-in, roles and accounts ----------
class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class RoleWrite(BaseModel):
    name: str
    description: Optional[str] = None
    is_admin: bool = False
    modules: dict = {}          # {"vendors": "view" | "edit" | "none", ...}
    actions: List[str] = []


class RoleOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    is_admin: bool
    is_system: bool
    modules: dict
    actions: List[str]
    user_count: int


class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role_id: int
    must_change_password: bool = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role_id: Optional[int] = None
    is_active: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    new_password: str
    must_change_password: bool = True


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role_id: int
    role_name: str
    is_admin: bool
    is_active: bool
    must_change_password: bool
    created_at: datetime.datetime
    last_login_at: Optional[datetime.datetime] = None


# ---------- Example entity: Item ----------
class ItemCreate(BaseModel):
    code: str
    name: str
    unit_price: float = 0.0
    notes: Optional[str] = None


class ItemUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    unit_price: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class ItemOut(BaseModel):
    id: int
    code: str
    name: str
    unit_price: float
    notes: Optional[str] = None
    is_active: bool
    created_at: datetime.datetime
    class Config:
        from_attributes = True
