import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, FileText } from "lucide-react";
import apiClient from "@/services/apiClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/utils/formatters";

export default function InvoiceFormDialog({ open, onOpenChange, onSaved }) {
  const [bookings, setBookings] = useState([]);
  const [bookingId, setBookingId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBookingId(""); setAmount(""); setDueAt(""); setNotes("");
    apiClient.get("/bookings").then((r) => setBookings(Array.isArray(r.data) ? r.data : [])).catch(() => setBookings([]));
  }, [open]);

  const onPickBooking = (id) => {
    setBookingId(id);
    const b = bookings.find((x) => x.id === id);
    if (b) setAmount(String(b.total_amount || 0));
  };

  const submit = async () => {
    if (!bookingId) { toast.error("Pilih booking terlebih dahulu"); return; }
    setSaving(true);
    try {
      await apiClient.post("/invoices", {
        booking_id: bookingId,
        amount: amount ? Number(amount) : null,
        due_at: dueAt || null,
        notes,
      });
      toast.success("Invoice dibuat");
      onOpenChange(false);
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gagal membuat invoice");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" data-testid="invoice-form-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText size={17} className="text-[#007AFF]" /> Buat Invoice</DialogTitle>
          <DialogDescription>Terbitkan faktur dari booking. Nominal default = total booking.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Booking</Label>
            <Select value={bookingId} onValueChange={onPickBooking}>
              <SelectTrigger data-testid="inv-booking"><SelectValue placeholder="Pilih booking" /></SelectTrigger>
              <SelectContent>
                {bookings.map((b) => <SelectItem key={b.id} value={b.id}>{b.code} · {b.customer_name} · {formatCurrency(b.total_amount)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nominal (Rp)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Total booking" data-testid="inv-amount" />
            </div>
            <div className="space-y-1.5">
              <Label>Jatuh Tempo</Label>
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} data-testid="inv-due" />
            </div>
          </div>
          {amount ? <p className="text-[12px] text-[#6B6B73]">Tagihan: <span className="font-semibold tabular-nums text-[#1C1C1E]">{formatCurrency(amount)}</span></p> : null}
          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="mis. Pembayaran via transfer BCA…" data-testid="inv-notes" />
          </div>
        </div>
        <DialogFooter className="mt-2">
          <button className="secondary-button" onClick={() => onOpenChange(false)} data-testid="inv-cancel">Batal</button>
          <button className="primary-button" disabled={saving} onClick={submit} data-testid="inv-submit">{saving ? <Loader2 size={14} className="animate-spin" /> : null} Buat Invoice</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
