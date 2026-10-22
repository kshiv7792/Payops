from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class InvoiceItemExtraction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(max_length=300)
    quantity: float = Field(default=1, ge=0, allow_inf_nan=False)
    unit_price: float = Field(default=0, ge=0, allow_inf_nan=False)
    tax_rate: float = Field(default=0, ge=0, allow_inf_nan=False)
    tax_amount: float = Field(default=0, ge=0, allow_inf_nan=False)
    total: float = Field(default=0, ge=0, allow_inf_nan=False)


class InvoiceExtraction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vendor_name: str = Field(min_length=1, max_length=160)
    vendor_gstin: str | None = Field(default=None, max_length=20)
    invoice_number: str = Field(min_length=1, max_length=120)
    invoice_date: date | None = None
    due_date: date | None = None
    currency: str = Field(default="INR", min_length=1, max_length=8)
    subtotal: float = Field(default=0, ge=0, allow_inf_nan=False)
    cgst: float = Field(default=0, ge=0, allow_inf_nan=False)
    sgst: float = Field(default=0, ge=0, allow_inf_nan=False)
    igst: float = Field(default=0, ge=0, allow_inf_nan=False)
    total_tax: float = Field(default=0, ge=0, allow_inf_nan=False)
    total_amount: float = Field(default=0, ge=0, allow_inf_nan=False)
    payment_terms: str = Field(default="", max_length=120)
    items: list[InvoiceItemExtraction] = Field(default_factory=list, max_length=500)
    bank_details: dict[str, str | None] = Field(default_factory=dict)
    confidence: float = Field(default=0, ge=0, le=1, allow_inf_nan=False)
