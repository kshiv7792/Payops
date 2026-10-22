from pydantic import BaseModel, Field


class ChatInput(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = None
