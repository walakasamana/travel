"""routers/invoices.py — invoice/faktur dari booking + export PDF/Excel (Phase 5).

Koleksi kanonik: `invoices`. FK: booking_id→bookings (wajib), customer_id→customers.
INV-8: number unik berurutan (INV-0001, ...). Akses section 'finance'.
Urutan route: literal & sub-path didefinisikan sebelum param generik.
"""
import base64
from io import BytesIO
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from core_utils import money, new_id, now_iso, safe_doc
from db import get_db
from dependencies import require_section
from schemas import InvoiceCreate, InvoiceStatusUpdate
from services.audit import record
from services.exporter import invoice_pdf, invoice_xlsx
from services.finance import next_invoice_number

router = APIRouter(prefix="/api", tags=["invoices"])
FIN = require_section("finance")
VALID_STATUS = {"draft", "sent", "partial", "paid"}


@router.get("/invoices")
async def list_invoices(status: str = Query(default=None), limit: int = Query(default=300, le=1000),
                        skip: int = Query(default=0, ge=0), user=Depends(FIN)):
    query = {}
    if status:
        query["status"] = status
    docs = await get_db().invoices.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).to_list(limit)
    return safe_doc(docs)


@router.post("/invoices")
async def create_invoice(body: InvoiceCreate, user=Depends(FIN)):
    db = get_db()
    booking = await db.bookings.find_one({"id": body.booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=400, detail="Booking tidak ditemukan")
    amount = float(body.amount) if body.amount is not None else float(booking.get("total_amount", 0) or 0)
    issued = now_iso()
    due = body.due_at or (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    doc = {
        "id": new_id("inv"),
        "number": await next_invoice_number(db),
        "booking_id": body.booking_id,
        "customer_id": booking.get("customer_id"),
        "customer_name": booking.get("customer_name"),
        "booking_code": booking.get("code"),
        "amount": money(amount),
        "status": "draft",
        "issued_at": issued,
        "due_at": due,
        "notes": body.notes or "",
        "created_by": user.get("id"),
        "created_at": now_iso(),
    }
    await db.invoices.insert_one(doc)
    await record(db, actor=user, action="create", entity_type="invoice", entity_id=doc["id"],
                 after=doc,
                 summary=f"Terbitkan invoice {doc['number']} (Rp {int(doc['amount']):,})".replace(",", "."))
    return safe_doc(doc)


@router.get("/invoices/{invoice_id}/export")
async def export_invoice(invoice_id: str, format: str = Query(default="pdf"), user=Depends(FIN)):
    inv = await get_db().invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice tidak ditemukan")
    number = inv.get("number", "invoice")
    if format == "excel":
        data = invoice_xlsx(inv)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        fname = f"{number}.xlsx"
    else:
        data = invoice_pdf(inv)
        media = "application/pdf"
        fname = f"{number}.pdf"
    return StreamingResponse(BytesIO(data), media_type=media,
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


async def _resolve_customer_phone(db, inv):
    booking = await db.bookings.find_one({"id": inv.get("booking_id")}, {"_id": 0}) or {}
    phone = booking.get("customer_phone") or ""
    cust_id = inv.get("customer_id") or booking.get("customer_id")
    if not phone and cust_id:
        cust = await db.customers.find_one({"id": cust_id}, {"_id": 0, "phone": 1})
        phone = (cust or {}).get("phone") or ""
    return phone


async def _send_invoice_wa(db, inv, user):
    """Kirim PDF invoice via WhatsApp ke pelanggan (provider aktif). Raise 400 bila gagal."""
    phone = await _resolve_customer_phone(db, inv)
    if not phone:
        raise HTTPException(status_code=400, detail="Nomor WhatsApp pelanggan tidak ditemukan")
    pdf = invoice_pdf(inv)
    data_url = "data:application/pdf;base64," + base64.b64encode(pdf).decode()
    due = (inv.get("due_at") or "")[:10]
    amount_txt = f"Rp {int(inv.get('amount', 0) or 0):,}".replace(",", ".")
    caption = (f"Halo {inv.get('customer_name') or 'Pelanggan'}, berikut invoice {inv.get('number')} "
               f"sebesar {amount_txt} untuk booking {inv.get('booking_code')}."
               + (f" Jatuh tempo {due}." if due else "") + " Terima kasih! 🙏")
    from services.whatsapp import send_wa
    res = await send_wa(db, phone, text=caption, customer_id=inv.get("customer_id"),
                        contact_name=inv.get("customer_name"), source="invoice",
                        author_id=user.get("id"), media_data=data_url,
                        media_filename=f"{inv.get('number', 'invoice')}.pdf")
    if res.get("status") == "skipped":
        raise HTTPException(status_code=400, detail="Kontak telah opt-out WhatsApp")
    if res.get("status") not in ("sent", "delivered", "read"):
        raise HTTPException(status_code=400, detail=res.get("error") or "Gagal mengirim invoice via WhatsApp")
    if inv.get("status") == "draft":
        await db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": "sent"}})
    await record(db, actor=user, action="send", entity_type="invoice", entity_id=inv["id"],
                 summary=f"Kirim invoice {inv.get('number')} via WhatsApp ke {phone}")
    return {"ok": True, "number": inv.get("number"), **res}


@router.post("/invoices/{invoice_id}/send-wa")
async def send_invoice_wa(invoice_id: str, user=Depends(FIN)):
    db = get_db()
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice tidak ditemukan")
    return await _send_invoice_wa(db, inv, user)


@router.post("/bookings/{booking_id}/send-invoice-wa")
async def send_booking_invoice_wa(booking_id: str, user=Depends(FIN)):
    """Kirim invoice TERBARU milik booking via WhatsApp (tombol di halaman Booking)."""
    db = get_db()
    inv = await db.invoices.find_one({"booking_id": booking_id}, {"_id": 0}, sort=[("created_at", -1)])
    if not inv:
        raise HTTPException(status_code=404,
                            detail="Belum ada invoice untuk booking ini — buat dulu di Keuangan → Invoice")
    return await _send_invoice_wa(db, inv, user)


@router.patch("/invoices/{invoice_id}")
async def update_invoice_status(invoice_id: str, body: InvoiceStatusUpdate, user=Depends(FIN)):
    if body.status not in VALID_STATUS:
        raise HTTPException(status_code=400, detail="Status invoice tidak sah")
    db = get_db()
    res = await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": body.status}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invoice tidak ditemukan")
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    await record(db, actor=user, action="update", entity_type="invoice", entity_id=invoice_id,
                 after={"status": body.status},
                 summary=f"Ubah status invoice {inv.get('number')} → {body.status}")
    return safe_doc(inv)


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, user=Depends(FIN)):
    inv = await get_db().invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice tidak ditemukan")
    return safe_doc(inv)
