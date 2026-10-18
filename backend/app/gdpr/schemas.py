from pydantic import BaseModel, Field


class DeleteConfirm(BaseModel):
    """The 6-digit code the user received by email."""
    code: str = Field(pattern=r"^\d{6}$")


class GdprMessage(BaseModel):
    """A short answer the page can show to the user."""
    message: str
