
"""add two factor recovery codes

Revision ID: cf8ae45a8c0d
Revises: 3e07f34f44fb
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "cf8ae45a8c0d"
down_revision: Union[str, Sequence[str], None] = "3e07f34f44fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "two_factor_recovery_codes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "code_hash",
            name="uq_recovery_code_user_hash",
        ),
    )

    op.create_index(
        "ix_two_factor_recovery_codes_user_id",
        "two_factor_recovery_codes",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_two_factor_recovery_codes_user_id",
        table_name="two_factor_recovery_codes",
    )

    op.drop_table("two_factor_recovery_codes")

