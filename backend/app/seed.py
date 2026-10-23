import os
import random
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AIMessage, Approval, AuthSession, Company, Invoice, InvoiceItem, InvoiceValidation, Payment, User, Vendor, utcnow
from .security import hash_password


def seed_demo(db: Session, reset: bool = False) -> None:
    email = os.getenv("DEMO_EMAIL", "demo@invoiceai.local").lower()
    user = db.scalar(select(User).where(User.email == email))
    if user and not reset:
        return
    if reset:
        db.query(Payment).delete()
        db.query(Approval).delete()
        db.query(InvoiceValidation).delete()
        db.query(InvoiceItem).delete()
        db.query(Invoice).delete()
        db.query(Vendor).delete()
        if user:
            company_user_ids = select(User.id).where(User.company_id == user.company_id)
            db.query(AuthSession).filter(AuthSession.user_id.in_(company_user_ids)).delete(synchronize_session=False)
            db.query(AIMessage).filter(AIMessage.user_id.in_(company_user_ids)).delete(synchronize_session=False)
            company = db.get(Company, user.company_id)
            if company:
                db.query(User).filter(User.company_id == company.id).delete()
                db.delete(company)
        db.commit()

    company = Company(name="Shiv Traders", gstin="27ABCDE1234F1Z5", business_type="Trader / Distributor", country="India")
    db.add(company)
    db.flush()
    owner = User(
        name="Shiv Kumar",
        email=email,
        password_hash=hash_password(os.getenv("DEMO_PASSWORD", "Demo@123")),
        role="OWNER",
        company_id=company.id,
    )
    db.add(owner)
    vendors = [
        Vendor(company_id=company.id, name="ABC Electricals", gstin="27AAECA1122A1Z3", email="billing@abcelectricals.in", category="Electrical supplies", address="Mumbai, Maharashtra"),
        Vendor(company_id=company.id, name="XYZ Traders", gstin="27AABFX2222B1Z7", email="accounts@xyztraders.in", category="Office supplies", address="Pune, Maharashtra"),
        Vendor(company_id=company.id, name="Global Systems", gstin="29AABCG3333C1Z2", email="finance@globalsystems.in", category="Technology", address="Bengaluru, Karnataka"),
        Vendor(company_id=company.id, name="Tech Solutions", gstin="27AAACT4444D1Z5", email="ap@techsolutions.in", category="Technology", address="Nashik, Maharashtra"),
        Vendor(company_id=company.id, name="Kumar Agencies", gstin="27AAAPK5555E1Z9", email="billing@kumaragencies.in", category="Packaging", address="Thane, Maharashtra"),
        Vendor(company_id=company.id, name="Metro Supplies", gstin="24AABCM6666F1Z6", email="accounts@metrosupplies.in", category="Office supplies", address="Ahmedabad, Gujarat"),
        Vendor(company_id=company.id, name="Industrial Co.", gstin="27AACCI7777G1Z4", email="payables@industrialco.in", category="Industrial", address="Aurangabad, Maharashtra"),
    ]
    db.add_all(vendors)
    db.flush()

    today = date.today()
    rng = random.Random(24)
    invoices: list[Invoice] = []
    status_plan = ["PAID"] * 9 + ["APPROVED"] * 8 + ["OVERDUE"] * 5 + ["PENDING_APPROVAL"] * 3 + ["REJECTED"] * 2 + ["DUPLICATE"]
    amounts = [12800, 49650, 32000, 78400, 28500, 45000, 102000, 18200, 54800, 28750, 9800, 67200]
    for index, status in enumerate(status_plan):
        vendor = vendors[index % len(vendors)]
        invoice_day = today - timedelta(days=(index * 3 + 2) % 85)
        due = invoice_day + timedelta(days=30)
        if status == "OVERDUE":
            due = today - timedelta(days=2 + index % 18)
        amount = float(amounts[index % len(amounts)])
        subtotal = round(amount / 1.18, 2)
        tax = round(amount - subtotal, 2)
        inv = Invoice(
            company_id=company.id,
            vendor_id=vendor.id,
            invoice_number=f"INV-{20391 + index}",
            invoice_date=invoice_day,
            due_date=due,
            subtotal=subtotal,
            cgst=round(tax / 2, 2),
            sgst=round(tax / 2, 2),
            total_tax=tax,
            total_amount=amount,
            currency="INR",
            status=status,
            payment_status=status if status in {"PAID", "OVERDUE"} else "UNPAID",
            source="EMAIL" if index % 4 == 0 else "UPLOAD",
            ai_confidence=round(rng.uniform(0.89, 0.99), 2),
            payment_terms="30 days",
            extraction_mode="DEMO_SEED",
            original_filename=f"invoice-{20391 + index}.pdf",
        )
        db.add(inv)
        invoices.append(inv)
    db.flush()
    duplicate = invoices[-1]
    original = invoices[6]
    duplicate.vendor_id = original.vendor_id
    duplicate.invoice_number = original.invoice_number
    duplicate.invoice_date = original.invoice_date
    duplicate.due_date = original.due_date
    duplicate.subtotal = original.subtotal
    duplicate.cgst = original.cgst
    duplicate.sgst = original.sgst
    duplicate.total_tax = original.total_tax
    duplicate.total_amount = original.total_amount
    db.add_all([
        InvoiceItem(invoice_id=inv.id, description="Business supplies", quantity=1, unit_price=inv.subtotal, tax_rate=18, tax_amount=inv.total_tax, total=inv.total_amount)
        for inv in invoices
    ])

    for index, inv in enumerate(invoices):
        if index in (3, 15):
            db.add(InvoiceValidation(
                invoice_id=inv.id,
                validation_type="CALCULATION_MISMATCH",
                severity="WARNING",
                message="Invoice total differs slightly from subtotal plus GST. Verify the line items.",
                expected_value=f"{inv.subtotal + inv.total_tax:.2f}",
                actual_value=f"{inv.total_amount + 175:.2f}",
            ))
        elif index == 27:
            db.add(InvoiceValidation(
                invoice_id=inv.id,
                validation_type="POSSIBLE_DUPLICATE",
                severity="CRITICAL",
                message="Invoice number matches an existing invoice from this vendor.",
                related_invoice_id=invoices[6].id,
            ))
        if inv.status in {"PENDING_APPROVAL", "APPROVED", "PAID"}:
            db.add(Approval(
                invoice_id=inv.id,
                approver_id=owner.id,
                status="APPROVED" if inv.status in {"APPROVED", "PAID"} else "PENDING",
                comment="Reviewed against vendor record." if inv.status in {"APPROVED", "PAID"} else None,
                approved_at=None if inv.status == "PENDING_APPROVAL" else utcnow(),
            ))
        if inv.status == "PAID":
            db.add(Payment(
                invoice_id=inv.id,
                amount=inv.total_amount,
                payment_date=min(today - timedelta(days=index % 12), inv.due_date or today),
                payment_method="Bank transfer",
                reference=f"NEFT-{700100 + index}",
                status="COMPLETED",
            ))
    db.commit()
