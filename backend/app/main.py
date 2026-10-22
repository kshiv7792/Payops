import csv
import hashlib
import io
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
from .database import Base, SessionLocal, engine, get_db
from .models import AIMessage, Approval, Company, Invoice, InvoiceItem, InvoiceValidation, Payment, User, Vendor
from .schemas.assistant import ChatInput
from .schemas.auth import LoginInput, RegisterInput
from .schemas.invoices import DecisionInput, InvoiceEditInput, PaymentInput
from .security import create_access_token, get_current_user, hash_password, require_roles, verify_password
from .seed import seed_demo
from .services.documents import DocumentProcessingError, extract_invoice
from .services.assistant import answer_from_workspace, refine_grounded_answer
from .services.storage import LocalFileStorage
from .services.validation import validate_invoice

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("invoiceai")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[2] / "uploads")).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
file_storage = LocalFileStorage(UPLOAD_DIR)
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))
ALLOWED_TYPES = {
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
}

@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo(db)
    yield


app = FastAPI(
    title="PayOps API",
    description="Invoice operations, extraction, approvals and payments.",
    version="1.0.0",
    lifespan=lifespan,
)
origins = [value.strip() for value in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5500").split(",") if value.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _company_query(model, user: User):
    return select(model).where(model.company_id == user.company_id)


def _invoice_or_404(db: Session, user: User, invoice_id: str) -> Invoice:
    invoice = db.scalar(
        select(Invoice)
        .options(
            joinedload(Invoice.vendor),
            selectinload(Invoice.items),
            selectinload(Invoice.validations),
            selectinload(Invoice.approvals),
            selectinload(Invoice.payments),
        )
        .where(Invoice.id == invoice_id, Invoice.company_id == user.company_id)
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    return invoice


def _invoice_data(invoice: Invoice, include_file: bool = False, include_bank_details: bool = False) -> dict[str, Any]:
    result = {
        "id": invoice.id,
        "company_id": invoice.company_id,
        "vendor_id": invoice.vendor_id,
        "vendor_name": invoice.vendor.name if invoice.vendor else "Unknown vendor",
        "vendor_gstin": invoice.vendor.gstin if invoice.vendor else None,
        "invoice_number": invoice.invoice_number,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        "subtotal": invoice.subtotal,
        "cgst": invoice.cgst,
        "sgst": invoice.sgst,
        "igst": invoice.igst,
        "total_tax": invoice.total_tax,
        "total_amount": invoice.total_amount,
        "currency": invoice.currency,
        "status": invoice.status,
        "payment_status": invoice.payment_status,
        "source": invoice.source,
        "original_filename": invoice.original_filename,
        "ai_confidence": invoice.ai_confidence,
        "payment_terms": invoice.payment_terms,
        "extraction_mode": invoice.extraction_mode,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
        "items": [
            {"id": item.id, "description": item.description, "quantity": item.quantity,
             "unit_price": item.unit_price, "tax_rate": item.tax_rate, "tax_amount": item.tax_amount, "total": item.total}
            for item in invoice.items
        ],
        "validations": [
            {"id": issue.id, "validation_type": issue.validation_type, "severity": issue.severity,
             "message": issue.message, "expected_value": issue.expected_value, "actual_value": issue.actual_value,
             "related_invoice_id": issue.related_invoice_id,
             "status": issue.status}
            for issue in invoice.validations
        ],
        "approvals": [
            {"id": approval.id, "status": approval.status, "comment": approval.comment,
             "created_at": approval.created_at.isoformat() if approval.created_at else None}
            for approval in invoice.approvals
        ],
        "payments": [
            {"id": payment.id, "amount": payment.amount, "payment_date": payment.payment_date.isoformat(),
             "payment_method": payment.payment_method, "reference": payment.reference, "status": payment.status}
            for payment in sorted(invoice.payments, key=lambda row: row.payment_date)
        ],
    }
    if include_file:
        result["file_url"] = f"/api/invoices/{invoice.id}/file" if invoice.file_url else None
    if include_bank_details:
        result["bank_details"] = invoice.bank_details
    return result


@app.get("/")
def root():
    return {
        "name": "PayOps API",
        "status": "running",
        "docs": "/docs",
        "health": "/api/health",
    }


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(select(1))
        ai_configured = any(os.getenv(key) for key in ("OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_DOCUMENT_INTELLIGENCE_KEY"))
        return {"status": "ok", "database": "connected", "mode": "ai" if ai_configured else "demo"}
    except Exception as exc:
        logger.exception("Health check database failure")
        raise HTTPException(status_code=503, detail="Database unavailable.") from exc


@app.post("/api/auth/login")
def login(payload: LoginInput, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "company_id": user.company_id},
        "company": {"name": user.company.name, "gstin": user.company.gstin},
    }


@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterInput, db: Session = Depends(get_db)):
    if db.scalar(select(User.id).where(User.email == payload.email.lower())):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    company = Company(name=payload.company_name, gstin=payload.gstin)
    db.add(company)
    db.flush()
    user = User(name=payload.name, email=payload.email.lower(), password_hash=hash_password(payload.password), company_id=company.id, role="OWNER")
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "access_token": create_access_token(user), "token_type": "bearer",
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "company_id": user.company_id},
        "company": {"name": company.name, "gstin": company.gstin},
    }


@app.get("/api/auth/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "company_id": user.company_id, "company": user.company.name}


@app.get("/api/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invoices = list(db.scalars(_company_query(Invoice, user).options(
        joinedload(Invoice.vendor),
        selectinload(Invoice.items),
        selectinload(Invoice.validations),
    )).unique())
    today = date.today()
    paid = [invoice for invoice in invoices if invoice.payment_status == "PAID"]
    payable = [invoice for invoice in invoices if invoice.status not in {"REJECTED", "DUPLICATE"}]
    overdue = [invoice for invoice in payable if invoice.payment_status != "PAID" and invoice.due_date and invoice.due_date < today]
    unpaid = [invoice for invoice in payable if invoice.payment_status not in {"PAID", "OVERDUE"}]
    due_week = [invoice for invoice in payable if invoice.payment_status != "PAID" and invoice.due_date and today <= invoice.due_date <= today + timedelta(days=7)]
    trend = []
    for offset in reversed(range(6)):
        month = (today.replace(day=1) - timedelta(days=offset * 28)).replace(day=1)
        month_invoices = [invoice for invoice in invoices if invoice.invoice_date and invoice.invoice_date.year == month.year and invoice.invoice_date.month == month.month]
        trend.append({"month": month.strftime("%b"), "invoiced": round(sum(row.total_amount for row in month_invoices)), "paid": round(sum(row.total_amount for row in month_invoices if row.payment_status == "PAID"))})
    issues = [item for invoice in invoices for item in invoice.validations if item.severity in {"WARNING", "ERROR", "CRITICAL"} and item.status == "OPEN"]
    notifications = []
    for invoice in overdue[:4]:
        notifications.append({"id": invoice.id, "title": f"Invoice {invoice.invoice_number} is overdue", "description": f"{invoice.vendor.name if invoice.vendor else 'Vendor'} · ₹{invoice.total_amount:,.0f}", "type": "overdue"})
    for invoice in invoices:
        if invoice.status == "PENDING_APPROVAL":
            notifications.append({"id": invoice.id + "-approval", "title": "New invoice requires approval", "description": f"{invoice.invoice_number} · {invoice.vendor.name if invoice.vendor else 'Vendor'}", "type": "approval"})
    counts = {
        "total_invoices": len(invoices),
        "total_amount": round(sum(i.total_amount for i in invoices)),
        "unpaid_count": len(unpaid),
        "unpaid_amount": round(sum(i.total_amount for i in unpaid)),
        "overdue_count": len(overdue),
        "overdue_amount": round(sum(i.total_amount for i in overdue)),
        "paid_count": len(paid),
        "paid_amount": round(sum(i.total_amount for i in paid)),
        "pending_approval_count": sum(i.status == "PENDING_APPROVAL" for i in invoices),
        "due_this_week_count": len(due_week),
        "due_this_week_amount": round(sum(i.total_amount for i in due_week)),
    }
    payment_mix = [
        {"name": "Paid", "value": len(paid), "color": "#16a37a"},
        {"name": "Unpaid", "value": len(unpaid), "color": "#f3a634"},
        {"name": "Overdue", "value": len(overdue), "color": "#ec625a"},
    ]
    recent = sorted(invoices, key=lambda row: row.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)[:6]
    return {
        "summary": counts,
        "trend": trend,
        "payment_mix": payment_mix,
        "recent_invoices": [_invoice_data(i) for i in recent],
        "alerts": [{"id": issue.id, "type": issue.severity.lower(), "message": issue.message, "invoice_id": issue.invoice_id, "invoice_number": issue.invoice.invoice_number} for issue in issues[:5]],
        "upcoming_payments": [_invoice_data(i) for i in sorted(due_week, key=lambda row: row.due_date)[:5]],
        "overdue_invoices": [_invoice_data(i) for i in sorted(overdue, key=lambda row: row.due_date)[:5]],
        "notifications": notifications[:8],
    }


@app.get("/api/invoices")
def list_invoices(
    search: str = "",
    status: str | None = None,
    payment_status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    sort_by: str = "created_at",
    order: str = "desc",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = _company_query(Invoice, user).options(
        joinedload(Invoice.vendor),
        selectinload(Invoice.items),
        selectinload(Invoice.validations),
    )
    if status:
        if status.upper() in {"UNPAID", "PARTIALLY_PAID", "OVERDUE", "PAID"}:
            query = query.where(Invoice.payment_status == status.upper())
        else:
            query = query.where(Invoice.status == status.upper())
    if payment_status:
        query = query.where(Invoice.payment_status == payment_status.upper())
    if search.strip():
        pattern = f"%{search.strip()}%"
        query = query.join(Vendor, Invoice.vendor_id == Vendor.id, isouter=True).where(
            or_(Invoice.invoice_number.ilike(pattern), Vendor.name.ilike(pattern))
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    sort_column = {
        "created_at": Invoice.created_at,
        "invoice_date": Invoice.invoice_date,
        "due_date": Invoice.due_date,
        "total_amount": Invoice.total_amount,
        "invoice_number": Invoice.invoice_number,
    }.get(sort_by, Invoice.created_at)
    query = query.order_by(sort_column.asc() if order.lower() == "asc" else sort_column.desc())
    rows = db.scalars(query.offset((page - 1) * page_size).limit(page_size)).unique().all()
    return {"items": [_invoice_data(row) for row in rows], "total": total, "page": page, "page_size": page_size}


@app.post("/api/invoices/upload", status_code=201)
async def upload_invoice(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("OWNER", "ACCOUNTANT", "STAFF")),
):
    filename = Path(file.filename or "invoice").name
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_TYPES or file.content_type not in ALLOWED_TYPES[extension]:
        raise HTTPException(status_code=415, detail="Upload a PDF, PNG or JPG invoice.")
    contents = await file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if not contents:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(contents) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_UPLOAD_MB} MB upload limit.")
    if (extension == ".pdf" and not contents.startswith(b"%PDF")) or (
        extension == ".png" and not contents.startswith(b"\x89PNG\r\n\x1a\n")
    ) or (extension in {".jpg", ".jpeg"} and not contents.startswith(b"\xff\xd8\xff")):
        raise HTTPException(status_code=400, detail="The file content does not match its extension.")
    digest = hashlib.sha256(contents).hexdigest()
    same_file = db.scalar(select(Invoice).where(Invoice.company_id == user.company_id, Invoice.content_hash == digest))
    stored_name = file_storage.save(contents, extension)
    invoice = Invoice(
        company_id=user.company_id, invoice_number="Processing", status="PROCESSING", payment_status="UNPAID",
        source="UPLOAD", file_url=stored_name, original_filename=filename, content_hash=digest,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    try:
        extracted, mode, ocr_warning = extract_invoice(contents, filename, file.content_type or "application/octet-stream")
        vendor_name = str(extracted.get("vendor_name") or "").strip() or Path(filename).stem
        gstin = extracted.get("vendor_gstin")
        vendor = db.scalar(
            select(Vendor).where(Vendor.company_id == user.company_id, Vendor.gstin == gstin)
        ) if gstin else None
        if not vendor:
            vendor = db.scalar(select(Vendor).where(
                Vendor.company_id == user.company_id, func.lower(Vendor.name) == vendor_name.lower()
            ))
        if not vendor:
            vendor = Vendor(company_id=user.company_id, name=vendor_name[:160], gstin=gstin, category="New vendor")
            db.add(vendor)
            db.flush()
        invoice.vendor_id = vendor.id
        invoice.invoice_number = str(extracted.get("invoice_number") or "Needs review")[:120]
        invoice.invoice_date = date.fromisoformat(extracted["invoice_date"]) if extracted.get("invoice_date") else None
        invoice.due_date = date.fromisoformat(extracted["due_date"]) if extracted.get("due_date") else None
        invoice.subtotal = max(0, float(extracted.get("subtotal") or 0))
        invoice.cgst = max(0, float(extracted.get("cgst") or 0))
        invoice.sgst = max(0, float(extracted.get("sgst") or 0))
        invoice.igst = max(0, float(extracted.get("igst") or 0))
        invoice.total_tax = max(0, float(extracted.get("total_tax") or (invoice.cgst + invoice.sgst + invoice.igst)))
        invoice.total_amount = max(0, float(extracted.get("total_amount") or 0))
        invoice.currency = str(extracted.get("currency") or "INR")[:8]
        invoice.payment_terms = str(extracted.get("payment_terms") or "")[:120]
        invoice.bank_details = extracted.get("bank_details") or {}
        invoice.ai_confidence = max(0, min(float(extracted.get("confidence") or 0), 1))
        invoice.extraction_mode = mode
        invoice.status = "DUPLICATE" if same_file else "PENDING_REVIEW"
        for item in extracted.get("items") or []:
            db.add(InvoiceItem(
                invoice_id=invoice.id,
                description=str(item.get("description") or "Invoice item")[:300],
                quantity=max(0, float(item.get("quantity") or 1)),
                unit_price=max(0, float(item.get("unit_price") or 0)),
                tax_rate=max(0, float(item.get("tax_rate") or 0)),
                tax_amount=max(0, float(item.get("tax_amount") or 0)),
                total=max(0, float(item.get("total") or 0)),
            ))
        db.flush()
        existing = list(db.scalars(select(Invoice).where(Invoice.company_id == user.company_id, Invoice.id != invoice.id)))
        findings = validate_invoice(invoice, vendor, existing, ocr_warning)
        if same_file:
            findings.append({
                "validation_type": "POSSIBLE_DUPLICATE", "severity": "CRITICAL",
                "message": "This uploaded file exactly matches an existing invoice.",
                "expected_value": None, "actual_value": None, "related_invoice_id": same_file.id, "status": "OPEN",
            })
            invoice.status = "DUPLICATE"
        for issue in findings:
            db.add(InvoiceValidation(invoice_id=invoice.id, **issue))
        db.add(Approval(invoice_id=invoice.id, approver_id=None, status="PENDING"))
        db.commit()
    except (DocumentProcessingError, httpx.HTTPError, ValidationError, ValueError, KeyError) as exc:
        logger.exception("Invoice extraction failed for %s", filename)
        invoice.status = "PENDING_REVIEW"
        db.add(InvoiceValidation(
            invoice_id=invoice.id, validation_type="EXTRACTION_FAILED", severity="ERROR",
            message="Automatic extraction failed. Review the attached document and enter the invoice fields manually.",
            status="OPEN",
        ))
        db.commit()
        raise HTTPException(status_code=422, detail=f"Invoice was saved for manual review. Extraction failed: {exc}") from exc
    invoice = _invoice_or_404(db, user, invoice.id)
    result = _invoice_data(invoice, include_file=True, include_bank_details=user.role in {"OWNER", "ACCOUNTANT"})
    result["ocr_warning"] = ocr_warning
    return result


@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _invoice_data(_invoice_or_404(db, user, invoice_id), include_file=True, include_bank_details=user.role in {"OWNER", "ACCOUNTANT"})


@app.get("/api/invoices/{invoice_id}/file")
def get_invoice_file(invoice_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invoice = _invoice_or_404(db, user, invoice_id)
    if not invoice.file_url:
        raise HTTPException(status_code=404, detail="No document is attached to this invoice.")
    path = file_storage.resolve(invoice.file_url)
    if not path:
        raise HTTPException(status_code=404, detail="Invoice document is no longer available.")
    return FileResponse(path, filename=invoice.original_filename or path.name)


@app.put("/api/invoices/{invoice_id}")
def edit_invoice(
    invoice_id: str,
    payload: InvoiceEditInput,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("OWNER", "ACCOUNTANT")),
):
    invoice = _invoice_or_404(db, user, invoice_id)
    if invoice.payment_status == "PAID":
        raise HTTPException(status_code=409, detail="Paid invoices cannot be edited.")
    values = payload.model_dump(exclude_unset=True)
    vendor_name = values.pop("vendor_name", None)
    for key, value in values.items():
        setattr(invoice, key, value)
    if vendor_name:
        vendor = invoice.vendor
        if not vendor:
            vendor = Vendor(company_id=user.company_id, name=vendor_name[:160], category="New vendor")
            db.add(vendor)
            db.flush()
            invoice.vendor_id = vendor.id
        else:
            vendor.name = vendor_name[:160]
    invoice.status = "PENDING_REVIEW"
    for issue in list(invoice.validations):
        db.delete(issue)
    invoice.validations.clear()
    db.flush()
    existing = list(db.scalars(select(Invoice).where(Invoice.company_id == user.company_id, Invoice.id != invoice.id)))
    for issue in validate_invoice(invoice, invoice.vendor, existing):
        db.add(InvoiceValidation(invoice_id=invoice.id, **issue))
    db.commit()
    return _invoice_data(_invoice_or_404(db, user, invoice_id), include_file=True, include_bank_details=user.role in {"OWNER", "ACCOUNTANT"})


def _record_decision(db: Session, user: User, invoice: Invoice, decision: str, comment: str | None):
    if invoice.status not in {"PENDING_REVIEW", "PENDING_APPROVAL", "PROCESSING"}:
        raise HTTPException(status_code=409, detail=f"An invoice in {invoice.status.lower()} status cannot be {decision.lower()}.")
    invoice.status = decision
    db.add(Approval(invoice_id=invoice.id, approver_id=user.id, status=decision, comment=comment, approved_at=datetime.now(timezone.utc) if decision == "APPROVED" else None))
    db.commit()
    return _invoice_data(_invoice_or_404(db, user, invoice.id), include_file=True, include_bank_details=user.role in {"OWNER", "ACCOUNTANT"})


@app.post("/api/invoices/{invoice_id}/approve")
def approve_invoice(invoice_id: str, payload: DecisionInput, db: Session = Depends(get_db), user: User = Depends(require_roles("OWNER", "MANAGER"))):
    return _record_decision(db, user, _invoice_or_404(db, user, invoice_id), "APPROVED", payload.comment)


@app.post("/api/invoices/{invoice_id}/reject")
def reject_invoice(invoice_id: str, payload: DecisionInput, db: Session = Depends(get_db), user: User = Depends(require_roles("OWNER", "MANAGER"))):
    if not payload.comment:
        raise HTTPException(status_code=422, detail="Add a reason before rejecting an invoice.")
    return _record_decision(db, user, _invoice_or_404(db, user, invoice_id), "REJECTED", payload.comment)


@app.post("/api/invoices/{invoice_id}/request-changes")
def request_invoice_changes(invoice_id: str, payload: DecisionInput, db: Session = Depends(get_db), user: User = Depends(require_roles("OWNER", "MANAGER"))):
    if not payload.comment:
        raise HTTPException(status_code=422, detail="Add a note describing the changes needed.")
    invoice = _invoice_or_404(db, user, invoice_id)
    if invoice.status not in {"PENDING_REVIEW", "PENDING_APPROVAL", "PROCESSING"}:
        raise HTTPException(status_code=409, detail=f"An invoice in {invoice.status.lower()} status cannot be sent back for changes.")
    invoice.status = "DRAFT"
    db.add(Approval(invoice_id=invoice.id, approver_id=user.id, status="CHANGES_REQUESTED", comment=payload.comment))
    db.commit()
    return _invoice_data(_invoice_or_404(db, user, invoice_id), include_file=True, include_bank_details=user.role in {"OWNER", "ACCOUNTANT"})


@app.post("/api/invoices/{invoice_id}/mark-paid")
def mark_invoice_paid(invoice_id: str, payload: PaymentInput, db: Session = Depends(get_db), user: User = Depends(require_roles("OWNER", "ACCOUNTANT"))):
    invoice = _invoice_or_404(db, user, invoice_id)
    if invoice.status == "REJECTED":
        raise HTTPException(status_code=409, detail="A rejected invoice cannot be marked as paid.")
    if invoice.status not in {"APPROVED", "PAID", "OVERDUE"} and invoice.payment_status != "PARTIALLY_PAID":
        raise HTTPException(status_code=409, detail="Approve this invoice before recording a payment.")
    amount = payload.amount or (invoice.total_amount - sum(p.amount for p in invoice.payments if p.status == "COMPLETED"))
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero.")
    paid_before = sum(p.amount for p in invoice.payments if p.status == "COMPLETED")
    if amount > invoice.total_amount - paid_before + 0.01:
        raise HTTPException(status_code=422, detail="Payment amount exceeds the remaining invoice balance.")
    db.add(Payment(invoice_id=invoice.id, amount=amount, payment_date=payload.payment_date, payment_method=payload.payment_method, reference=payload.reference, status="COMPLETED"))
    paid_total = paid_before + amount
    invoice.payment_status = "PAID" if paid_total >= invoice.total_amount - 0.01 else "PARTIALLY_PAID"
    invoice.status = "PAID" if invoice.payment_status == "PAID" else "APPROVED"
    db.commit()
    return _invoice_data(_invoice_or_404(db, user, invoice_id), include_file=True, include_bank_details=user.role in {"OWNER", "ACCOUNTANT"})


@app.get("/api/approvals")
def list_approvals(status: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = _company_query(Invoice, user).options(
        joinedload(Invoice.vendor),
        selectinload(Invoice.items),
        selectinload(Invoice.validations),
    )
    if status and status.upper() != "ALL":
        if status.upper() in {"PENDING", "PENDING_APPROVAL"}:
            query = query.where(Invoice.status.in_(["PENDING_APPROVAL", "PENDING_REVIEW"]))
        else:
            query = query.where(Invoice.status == status.upper())
    rows = db.scalars(query.order_by(Invoice.created_at.desc())).unique().all()
    return {"items": [_invoice_data(row) for row in rows], "total": len(rows)}


@app.get("/api/payments")
def list_payments(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invoices = db.scalars(_company_query(Invoice, user).options(
        joinedload(Invoice.vendor),
        selectinload(Invoice.items),
        selectinload(Invoice.validations),
        selectinload(Invoice.payments),
    )).unique().all()
    today = date.today()
    rows = []
    for invoice in invoices:
        paid = sum(payment.amount for payment in invoice.payments if payment.status == "COMPLETED")
        if invoice.payment_status == "PAID" and paid == 0:
            paid = invoice.total_amount
        is_payable = invoice.status not in {"REJECTED", "DUPLICATE"}
        rows.append({
            **_invoice_data(invoice),
            "paid_amount": paid,
            "balance": max(0, invoice.total_amount - paid) if is_payable else 0,
            "is_overdue": is_payable and invoice.payment_status != "PAID" and bool(invoice.due_date and invoice.due_date < today),
        })
    return {"items": rows, "summary": {
        "total_payable": round(sum(row["balance"] for row in rows)),
        "due_this_week": round(sum(row["balance"] for row in rows if row["due_date"] and today <= date.fromisoformat(row["due_date"]) <= today + timedelta(days=7))),
        "overdue": round(sum(row["balance"] for row in rows if row["is_overdue"])),
        "paid": round(sum(row["paid_amount"] for row in rows)),
    }}


@app.get("/api/vendors")
def list_vendors(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vendors = db.scalars(_company_query(Vendor, user).order_by(Vendor.name)).all()
    invoices = db.scalars(_company_query(Invoice, user).options(selectinload(Invoice.payments))).unique().all()
    result = []
    for vendor in vendors:
        rows = [invoice for invoice in invoices if invoice.vendor_id == vendor.id]
        payable_rows = [invoice for invoice in rows if invoice.status not in {"REJECTED", "DUPLICATE"}]
        paid = sum(sum(payment.amount for payment in invoice.payments if payment.status == "COMPLETED") for invoice in rows)
        result.append({
            "id": vendor.id, "name": vendor.name, "gstin": vendor.gstin, "email": vendor.email,
            "phone": vendor.phone, "category": vendor.category, "address": vendor.address,
            "invoice_count": len(rows), "total_amount": round(sum(row.total_amount for row in payable_rows)),
            "paid_amount": round(paid), "outstanding": round(max(0, sum(row.total_amount for row in payable_rows) - paid)),
            "overdue_count": sum(row.status not in {"REJECTED", "DUPLICATE"} and row.payment_status != "PAID" and bool(row.due_date and row.due_date < date.today()) for row in rows),
        })
    return {"items": result, "total": len(result)}


@app.get("/api/vendors/{vendor_id}")
def get_vendor(vendor_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vendor = db.scalar(select(Vendor).where(Vendor.id == vendor_id, Vendor.company_id == user.company_id))
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found.")
    invoices = db.scalars(_company_query(Invoice, user).where(Invoice.vendor_id == vendor_id).options(
        joinedload(Invoice.vendor),
        selectinload(Invoice.items),
        selectinload(Invoice.validations),
    )).unique().all()
    data = next((item for item in list_vendors(db, user)["items"] if item["id"] == vendor_id), {})
    return {**data, "invoices": [_invoice_data(item) for item in invoices]}


@app.get("/api/validations")
def list_validations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    issues = db.scalars(
        select(InvoiceValidation).join(Invoice).options(joinedload(InvoiceValidation.invoice).joinedload(Invoice.vendor))
        .where(Invoice.company_id == user.company_id).order_by(InvoiceValidation.created_at.desc())
    ).unique().all()
    return {"items": [
        {"id": issue.id, "invoice_id": issue.invoice_id, "invoice_number": issue.invoice.invoice_number,
         "vendor_name": issue.invoice.vendor.name if issue.invoice.vendor else "Unknown vendor",
         "severity": issue.severity, "validation_type": issue.validation_type, "message": issue.message,
         "status": issue.status}
        for issue in issues
    ]}


@app.post("/api/ai/chat")
def chat(payload: ChatInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invoices = db.scalars(_company_query(Invoice, user).options(
        joinedload(Invoice.vendor),
        selectinload(Invoice.validations),
        selectinload(Invoice.payments),
    )).unique().all()
    vendors = db.scalars(_company_query(Vendor, user)).all()
    answer, sources = answer_from_workspace(payload.message, invoices, vendors)
    mode = "database_grounded_fallback"
    try:
        ai_answer = refine_grounded_answer(payload.message, answer, sources, invoices, vendors)
        if ai_answer:
            answer = ai_answer
            mode = "openai_grounded"
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.exception("Grounded AI assistant request failed")
        raise HTTPException(status_code=503, detail="AI assistant is unavailable. Your invoice data is unchanged; try again shortly.") from exc
    conversation_id = payload.conversation_id or str(uuid.uuid4())
    db.add_all([
        AIMessage(user_id=user.id, conversation_id=conversation_id, role="user", content=payload.message),
        AIMessage(user_id=user.id, conversation_id=conversation_id, role="assistant", content=answer, sources=sources),
    ])
    db.commit()
    return {"conversation_id": conversation_id, "answer": answer, "sources": sources, "mode": mode}


@app.get("/api/ai/history")
def chat_history(conversation_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = select(AIMessage).where(AIMessage.user_id == user.id)
    if conversation_id:
        query = query.where(AIMessage.conversation_id == conversation_id)
    rows = db.scalars(query.order_by(AIMessage.created_at).limit(100)).all()
    return {"items": [{"id": row.id, "conversation_id": row.conversation_id, "role": row.role, "content": row.content, "sources": row.sources} for row in rows]}


@app.get("/api/reports/summary.csv")
def export_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invoices = db.scalars(_company_query(Invoice, user).options(joinedload(Invoice.vendor))).unique().all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Invoice No", "Vendor", "Invoice Date", "Due Date", "Amount", "Status", "Payment Status"])
    for invoice in invoices:
        writer.writerow([invoice.invoice_number, invoice.vendor.name if invoice.vendor else "", invoice.invoice_date or "", invoice.due_date or "", invoice.total_amount, invoice.status, invoice.payment_status])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=invoice-summary.csv"})


@app.post("/api/settings/reset-demo")
def reset_demo(db: Session = Depends(get_db), user: User = Depends(require_roles("OWNER"))):
    if user.email != os.getenv("DEMO_EMAIL", "demo@invoiceai.local").lower():
        raise HTTPException(status_code=403, detail="Demo data reset is available only for the demo workspace.")
    seed_demo(db, reset=True)
    renewed_user = db.scalar(select(User).where(User.email == user.email))
    if not renewed_user:
        raise HTTPException(status_code=500, detail="Demo account could not be restored after reset.")
    return {
        "message": "Demo workspace data has been reset.",
        "access_token": create_access_token(renewed_user),
        "user": {"id": renewed_user.id, "name": renewed_user.name, "email": renewed_user.email, "role": renewed_user.role, "company_id": renewed_user.company_id},
        "company": {"name": renewed_user.company.name},
    }
