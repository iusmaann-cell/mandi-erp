"""
Database tables (SQLAlchemy). Add your own models below the "YOUR TABLES" marker.

Rules this project learned the hard way (keep following them):
  * Prefer plain Integer/String/Text/Float columns over Enum for NEW columns. The additive
    startup migrator (database.run_lightweight_migrations) can add a missing column to an
    existing table, but Postgres enum types are awkward to add to later.
  * Flags are Integer 0/1 (not Boolean) — works identically on SQLite and Postgres.
  * Timestamps are naive UTC (datetime.datetime.utcnow); convert to local time only for display
    / date-range filtering (see reporting.pkt_date, reporting.range_bounds).
  * Money/quantities are Float. Money is rounded to 2 dp only when posted to a ledger.
  * Never rename or drop a column in a live database — the migrator only ADDS columns. Add a new
    column and (if needed) backfill with a one-time script (see one_time_cleanup.py).
"""
import enum
import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, ForeignKey, Enum, Text
)
from sqlalchemy.orm import relationship
from .database import Base


# ==========================  CORE (keep)  ==========================
class InvoiceSettings(Base):
    """Singleton row (id always 1) controlling how printed invoices/challans look."""
    __tablename__ = "invoice_settings"
    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String, default="My Company")
    company_address = Column(String, nullable=True)
    company_phone = Column(String, nullable=True)
    company_email = Column(String, nullable=True)
    ntn_number = Column(String, nullable=True)   # tax registration number, printed if set
    logo_base64 = Column(Text, nullable=True)     # data URL or raw base64 of the logo image
    logo_width_mm = Column(Float, default=30.0)
    logo_height_mm = Column(Float, default=30.0)
    footer_text = Column(Text, nullable=True)
    show_logo = Column(Integer, default=1)
    accent_color = Column(String, default="#1f6b3a")


class Role(Base):
    """
    A named bundle of permissions. `permissions` is a JSON string:
      {"modules": {"vendors": "view", "grn": "edit", ...}, "actions": ["approve_stock_adjustments"]}
    A role with is_admin=1 ignores that JSON entirely and can do everything
    (including managing accounts and the Danger Zone reset). The built-in "Admin"
    role (is_system=1) can't be deleted or downgraded.
    Deliberately plain Integer/String/Text columns (no Enum) so the additive
    startup migrator never has to deal with Postgres enum types for these tables.
    """
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)
    is_admin = Column(Integer, default=0)
    is_system = Column(Integer, default=0)
    permissions = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)   # stored lowercase
    full_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    is_active = Column(Integer, default=1)
    must_change_password = Column(Integer, default=0)
    token_version = Column(Integer, default=0)   # bumped on password change/reset -> logs out every other session
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    role = relationship("Role", back_populates="users")


class AuthSecret(Base):
    """Holds the token-signing key when no SECRET_KEY env var is set, so sessions
    survive restarts/redeploys without any manual setup."""
    __tablename__ = "auth_secret"
    id = Column(Integer, primary_key=True)
    value = Column(String, nullable=False)


# ==========================  YOUR TABLES  ==========================
class Item(Base):
    """EXAMPLE business table — copy this shape for your own master data, then delete it."""
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    unit_price = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
