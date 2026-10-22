from datetime import date

from pydantic import BaseModel, Field


class DecisionInput(BaseModel):
    comment: str | None = Field(default=None, max_length=1000)


class PaymentInput(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    payment_date: date = Field(default_factory=date.today)
    payment_method: str = Field(default="Bank transfer", max_length=40)
    reference: str | None = Field(default=None, max_length=120)


class InvoiceEditInput(BaseModel):
    invoice_number: str | None = None
    vendor_name: str | None = None
    invoice_date: date | None = None
    due_date: date | None = None
    subtotal: float | None = Field(default=None, ge=0)
    cgst: float | None = Field(default=None, ge=0)
    sgst: float | None = Field(default=None, ge=0)
    igst: float | None = Field(default=None, ge=0)
    total_tax: float | None = Field(default=None, ge=0)
    total_amount: float | None = Field(default=None, ge=0)
    payment_terms: str | None = None
