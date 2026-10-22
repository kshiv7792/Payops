from typing import Annotated

from pydantic import BaseModel, Field

EmailAddress = Annotated[str, Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=255)]


class LoginInput(BaseModel):
    email: EmailAddress
    password: str = Field(min_length=1, max_length=128)


class RegisterInput(LoginInput):
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=2, max_length=120)
    company_name: str = Field(min_length=2, max_length=160)
    gstin: str | None = None
