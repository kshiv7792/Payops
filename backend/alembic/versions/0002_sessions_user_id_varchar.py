"""Align session user IDs with the users table."""

from alembic import op
import sqlalchemy as sa

revision = "0002_sessions_user_id_varchar"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration must run against PostgreSQL.")

    op.alter_column(
        "sessions",
        "user_id",
        existing_type=sa.Integer(),
        type_=sa.String(),
        existing_nullable=False,
        postgresql_using="user_id::VARCHAR",
    )


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration must run against PostgreSQL.")

    has_non_integer_ids = bind.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM sessions WHERE user_id !~ '^[+-]?[0-9]+$')")
    ).scalar_one()
    if has_non_integer_ids:
        raise RuntimeError(
            "Cannot downgrade sessions.user_id to INTEGER after UUID user IDs have been stored."
        )

    op.alter_column(
        "sessions",
        "user_id",
        existing_type=sa.String(),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="user_id::INTEGER",
    )
