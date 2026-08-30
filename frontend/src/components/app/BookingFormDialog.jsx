import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, Calculator } from "lucide-react";
import apiClient from "@/services/apiClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/utils/formatters";
import DestinationSelect from "@/components/app/DestinationSelect";
import PickupPointSelect from "@/components/app/PickupPointSelect";

function toIso(localValue) {
  if (!localValue) return "";
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const EMPTY = {
  customer_id: "", vehicle_id: "", driver_id: "", origin: "", destination: "",
  start: "", end: "", base_price: "", addon_label: "", addon_amount: "",
  require_dp: false, hold_hours: "",
};

export default function BookingFormDialog({ open, onOpenChange, onCreated, initialStart = "", initial = null }) {
  const [opts, setOpts] = useState({ customers: [], vehicles: [], drivers: [] });
  const [form, setForm] = useState(EMPTY);
  const [avail, setAvail] = useState(null); // {available, conflicts}
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quote, setQuote] = useState(null); // hasil Pricing Engine
  const [pricing, setPricing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, start: initialStart || "", ...(initial || {}) }); setAvail(null); setQuote(null);
    Promise.all([
      apiClient.get("/customers"), apiClient.get("/vehicles"), apiClient.get("/drivers"),
    ]).then(([c, v, d]) => setOpts({
      customers: Array.isArray(c.data) ? c.data : [],
      vehicles: Array.isArray(v.data) ? v.data : [],
      drivers: Array.isArray(d.data) ? d.data : [],
    })).catch(() => {});
  }, [open, initialStart]);

  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }));

  // Cek ketersediaan (anti double-booking) saat armada+tanggal lengkap.
  useEffect(() => {
    const { vehicle_id, start, end } = form;
    if (!vehicle_id || !start || !end) { setAvail(null); return; }
    let active = true;
    setChecking(true);
    const params = new URLSearchParams({ vehicle_id, start: toIso(start), end: toIso(end) });
    apiClient.get(`/bookings/availability?${params.toString()}`)
      .then((r) => { if (active) setAvail(r.data); })
      .catch(() => { if (active) setAvail(null); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [form.vehicle_id, form.start, form.end]);

  const total = (Number(form.base_price) || 0) + (Number(form.addon_amount) || 0);
  const canSubmit = form.customer_id && form.vehicle_id && form.start && form.end
    && avail && avail.available === true && !saving;

  // Pricing Engine (B1): hitung harga dasar otomatis dari tarif terkonfigurasi.
  const autoPrice = useCallback(async () => {
    if (!form.vehicle_id || !form.start || !form.end) {
      toast.message("Lengkapi armada, tanggal mulai & selesai dulu.");
      return;
    }
    setPricing(true);
    const startMs = new Date(form.start).getTime();
    const endMs = new Date(form.end).getTime();
    const days = Math.max(Math.ceil((endMs - startMs) / 86400000) || 1, 1);
    try {
      const { data } = await apiClient.post("/pricing/quote", {
        vehicle_id: form.vehicle_id, days, start_date: toIso(form.start),
      });
      setQuote(data);
      set("base_price", String(data.total));
      toast.success(`Harga dihitung: ${formatCurrency(data.total)} (${days} hari)`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gagal menghitung harga");
    } finally {
      setPricing(false);
    }
  }, [form.vehicle_id, form.start, form.end]);

  const submit = useCallback(async () => {
    setSaving(true);
    const addOns = form.addon_label && Number(form.addon_amount) > 0
      ? [{ label: form.addon_label, amount: Number(form.addon_amount) }] : [];
    try {
      const res = await apiClient.post("/bookings", {
        customer_id: form.customer_id, vehicle_id: form.vehicle_id,
        driver_id: form.driver_id || null, origin: form.origin, destination: form.destination,
        start_datetime: toIso(form.start), end_datetime: toIso(form.end),
        base_price: Number(form.base_price) || 0, add_ons: addOns,
        require_dp: Boolean(form.require_dp),
        hold_hours: form.require_dp && Number(form.hold_hours) > 0 ? Number(form.hold_hours) : null,
      });
      toast.success(form.require_dp ? `Booking ${res.data.code} dibuat (HOLD — menunggu DP)` : `Booking ${res.data.code} dibuat`);
      onOpenChange(false);
      if (onCreated) onCreated(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gagal membuat booking");
    } finally {
      setSaving(false);
    }
  }, [form, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="booking-form-dialog">
        <DialogHeader>
          <DialogTitle>Buat Booking Baru</DialogTitle>
          <DialogDescription>Sistem memeriksa bentrok armada otomatis (anti double-booking).</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Customer</label>
            <Select value={form.customer_id} onValueChange={(v) => set("customer_id", v)}>
              <SelectTrigger data-testid="bf-customer"><SelectValue placeholder="Pilih customer" /></SelectTrigger>
              <SelectContent>{opts.customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Armada</label>
              <Select value={form.vehicle_id} onValueChange={(v) => set("vehicle_id", v)}>
                <SelectTrigger data-testid="bf-vehicle"><SelectValue placeholder="Pilih armada" /></SelectTrigger>
                <SelectContent>{opts.vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.name} ({v.plate_number})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Driver (opsional)</label>
              <Select value={form.driver_id} onValueChange={(v) => set("driver_id", v)}>
                <SelectTrigger data-testid="bf-driver"><SelectValue placeholder="Pilih driver" /></SelectTrigger>
                <SelectContent>{opts.drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Mulai</label>
              <Input type="datetime-local" value={form.start} onChange={(e) => set("start", e.target.value)} data-testid="bf-start" />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Selesai</label>
              <Input type="datetime-local" value={form.end} onChange={(e) => set("end", e.target.value)} data-testid="bf-end" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Titik Jemput (master)</label>
              <PickupPointSelect value={form.origin} onChange={(v) => set("origin", v)} testId="bf-origin" />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Tujuan (master destinasi)</label>
              <DestinationSelect value={form.destination} onChange={(v) => set("destination", v)} testId="bf-destination" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-[12px] font-semibold text-[#6B6B73]">Harga Dasar (Rp)</label>
                <button type="button" onClick={autoPrice} disabled={pricing}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#007AFF] hover:underline disabled:opacity-50"
                  data-testid="bf-auto-price">
                  {pricing ? <Loader2 size={11} className="animate-spin" /> : <Calculator size={11} />} Hitung Otomatis
                </button>
              </div>
              <Input type="number" value={form.base_price} onChange={(e) => set("base_price", e.target.value)} placeholder="Kosongkan = auto" data-testid="bf-base-price" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Add-on</label>
                <Input value={form.addon_label} onChange={(e) => set("addon_label", e.target.value)} placeholder="Tol" data-testid="bf-addon-label" />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[#6B6B73]">Nominal</label>
                <Input type="number" value={form.addon_amount} onChange={(e) => set("addon_amount", e.target.value)} placeholder="500000" data-testid="bf-addon-amount" />
              </div>
            </div>
          </div>

          {/* Rincian Pricing Engine */}
          {quote && Array.isArray(quote.breakdown) ? (
            <div className="rounded-lg border border-[#E5E5EA] bg-[#FAFAFC] px-3 py-2 text-[12px]" data-testid="bf-price-breakdown">
              <div className="mb-1 font-semibold text-[#6B6B73]">Rincian harga otomatis</div>
              {quote.breakdown.map((b, i) => (
                <div key={i} className="flex items-center justify-between py-0.5">
                  <span className="text-[#6B6B73]">{b.label}</span>
                  <span className="tabular-nums text-[#1C1C1E]">{formatCurrency(b.amount)}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between border-t border-[#E5E5EA] pt-1 font-semibold">
                <span className="text-[#1C1C1E]">Harga dasar</span>
                <span className="tabular-nums text-[#1C1C1E]">{formatCurrency(quote.total)}</span>
              </div>
            </div>
          ) : null}

          {/* Status ketersediaan */}
          <div className="min-h-[28px]" data-testid="bf-availability">
            {checking ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-[#6B6B73]"><Loader2 size={13} className="animate-spin" /> Memeriksa ketersediaan…</span>
            ) : avail && avail.available === true ? (
              <span className="status-pill tone-success"><CheckCircle2 size={12} /> Armada tersedia</span>
            ) : avail && avail.available === false ? (
              <span className="status-pill tone-danger"><XCircle size={12} /> Bentrok: {avail.conflicts.map((c) => c.code).join(", ")}</span>
            ) : null}
          </div>

          <div className="rounded-lg border border-[#E5E5EA] px-3 py-2.5" data-testid="bf-dp-gate">
            <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-[#3a3f4a]">
              <input type="checkbox" checked={form.require_dp} onChange={(e) => set("require_dp", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#007AFF]" data-testid="bf-require-dp" />
              <span><span className="font-semibold text-[#1C1C1E]">Wajib DP (mode Hold)</span> — booking dibuat sebagai <em>hold</em> yang mereservasi armada; otomatis batal bila DP tak masuk sebelum batas waktu.</span>
            </label>
            {form.require_dp ? (
              <div className="mt-2 flex items-center gap-2 pl-6.5">
                <label className="text-[12px] font-semibold text-[#6B6B73]">Batas DP (jam)</label>
                <Input type="number" min="1" value={form.hold_hours} onChange={(e) => set("hold_hours", e.target.value)} placeholder="24 (default)" className="!h-8 max-w-[140px]" data-testid="bf-hold-hours" />
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-lg bg-[#F7F8FA] px-3 py-2">
            <span className="text-[12px] text-[#6B6B73]">Total</span>
            <span className="text-[15px] font-bold tabular-nums text-[#1C1C1E]">{formatCurrency(total)}</span>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <button className="secondary-button" onClick={() => onOpenChange(false)} data-testid="bf-cancel">Batal</button>
          <button className="primary-button" disabled={!canSubmit} onClick={submit} data-testid="bf-submit">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Simpan Booking
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
