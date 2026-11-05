import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Defaults to local SQLite for easy dev/testing.
# For production, set DATABASE_URL to your Postgres connection string, e.g.:
#   postgresql://user:password@host:5432/tehzeeb_erp
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tehzeeb_erp.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_lightweight_migrations():
    """
    Base.metadata.create_all() only creates tables that don't exist yet — it never
    adds new columns to a table that's already there. That's fine on a fresh database,
    but on a live deployment (e.g. Render) where earlier phases already created these
    tables, a later phase adding a new column would silently never apply it, and
    inserts referencing that column would fail at runtime.

    This is a lightweight stand-in for a real migration tool (Alembic) — good enough
    for this stage of the project. It compares each model's expected columns against
    what actually exists in the database and adds anything missing. Safe to run on
    every startup; it's a no-op once columns are in sync.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in Base.metadata.tables.values():
            if table.name not in existing_tables:
                continue  # brand-new table — create_all() already handled it
            existing_columns = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {column.name} {col_type}'))
                print(f"[migration] Added missing column {table.name}.{column.name}")

                # ALTER TABLE ADD COLUMN leaves existing rows NULL, even if the model
                # defines a default — that default only applies to new INSERTs. Backfill
                # NULLs with the model's default so old rows aren't left in a state the
                # application never expects (e.g. a boolean-ish flag that's neither 0 nor 1).
                default = getattr(column, "default", None)
                if default is not None and getattr(default, "is_scalar", False):
                    value = default.arg
                    if isinstance(value, bool):
                        sql_value = "1" if value else "0"
                    elif isinstance(value, (int, float)):
                        sql_value = str(value)
                    elif isinstance(value, str):
                        sql_value = "'" + value.replace("'", "''") + "'"
                    else:
                        sql_value = None
                    if sql_value is not None:
                        conn.execute(text(
                            f'UPDATE {table.name} SET {column.name} = {sql_value} WHERE {column.name} IS NULL'
                        ))
                        print(f"[migration] Backfilled {table.name}.{column.name} default for existing rows")

    # One-time rename: the old default company name becomes the new brand name.
    # Only touches rows still holding the untouched default — custom names stay.
    if "invoice_settings" in existing_tables:
        with engine.begin() as conn:
            res = conn.execute(text("UPDATE invoice_settings SET company_name = 'Riwayat Oils and Fats' WHERE company_name = 'Tehzeeb'"))
            if res.rowcount:
                print("[migration] Renamed default invoice company name to Riwayat Oils and Fats")
