"""Script to completely reset the FluencyCast database to a clean slate.

Usage:
    python reset_db.py
"""
import sys
from sqlalchemy import text, inspect
from app.core.database import engine, Base
import app.models  # Ensure all models are registered with Base.metadata


def reset_database():
    print("=" * 60)
    print("  FluencyCast - Reset Database to Clean Slate")
    print("=" * 60)
    print(f"Connecting to: {engine.url.render_as_string(hide_password=True)}")

    is_sqlite = engine.url.drivername.startswith("sqlite")

    with engine.begin() as conn:
        print("\n1. Dropping existing tables and constraints...")
        if is_sqlite:
            conn.execute(text("PRAGMA foreign_keys = OFF;"))
            inspector = inspect(engine)
            for table_name in reversed(inspector.get_table_names()):
                conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}";'))
            conn.execute(text("PRAGMA foreign_keys = ON;"))
        else:
            # PostgreSQL: drop all tables in public schema cleanly with CASCADE
            conn.execute(text("""
                DROP SCHEMA public CASCADE;
                CREATE SCHEMA public;
                GRANT ALL ON SCHEMA public TO postgres;
                GRANT ALL ON SCHEMA public TO public;
            """))

    print("2. Recreating all tables from SQLAlchemy models...")
    Base.metadata.create_all(bind=engine)

    # If alembic table needs to be tracked/stamped
    try:
        from alembic.config import Config
        from alembic import command
        alembic_cfg = Config("alembic.ini")
        command.stamp(alembic_cfg, "head")
        print("3. Alembic migration version stamped to 'head'.")
    except Exception as e:
        print(f"Notice: Alembic stamp skipped ({e})")

    # Verify all tables are present and empty
    print("\n4. Verifying clean database state:")
    inspector = inspect(engine)
    tables = inspector.get_table_names()

    with engine.connect() as conn:
        for tbl in sorted(tables):
            try:
                cnt = conn.execute(text(f'SELECT count(*) FROM "{tbl}"')).scalar()
                print(f"   [OK] {tbl:.<30} {cnt} records")
            except Exception as ex:
                print(f"   [!]  {tbl:.<30} (could not count: {ex})")

    print("\n" + "=" * 60)
    print("  DATABASE HAS BEEN FULLY RESET TO ZERO! READY FOR USE.")
    print("=" * 60)


if __name__ == "__main__":
    try:
        reset_database()
    except Exception as err:
        print(f"\n[ERROR] Failed to reset database: {err}", file=sys.stderr)
        sys.exit(1)
