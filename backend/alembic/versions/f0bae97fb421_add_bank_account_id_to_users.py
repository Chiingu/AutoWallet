"""add bank_account_id to users

Revision ID: f0bae97fb421
Revises: a01c0e893ff5
Create Date: 2026-08-13 09:05:38.890308

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f0bae97fb421'
down_revision: Union[str, Sequence[str], None] = 'a01c0e893ff5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('bank_account_id', sa.String(), nullable=False))
        batch_op.create_unique_constraint('uq_users_bank_account_id', ['bank_account_id'])


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint('uq_users_bank_account_id', type_='unique')
        batch_op.drop_column('bank_account_id')