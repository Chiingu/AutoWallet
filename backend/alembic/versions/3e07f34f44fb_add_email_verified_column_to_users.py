
"""add email_verified column to users

Revision ID: 3e07f34f44fb
Revises: 7ca19ba37749
Create Date: 2026-10-16 21:05:34.779091
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "3e07f34f44fb"
down_revision: Union[str, Sequence[str], None] = "7ca19ba37749"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add email verification status to users."""

    op.add_column(
        "users",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Remove email verification status from users."""

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("email_verified")

