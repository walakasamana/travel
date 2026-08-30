import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MapPin, User2, Bus } from "lucide-react";
import apiClient from "@/services/apiClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// AssignTripDialog — E3: pilih driver + unit untuk sebuah booking; tujuan di-geocode otomatis (Nominatim).
export default function AssignTripDialog({ open, onOpenChange, booking, onSaved }) {
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([apiClient.get("/drivers"), apiClient.get("/vehicles")])
      .then(([d, v]) => {
        setDrivers(Array.isArray(d.data) ? d.data : []);
        setVehicles(Array.isArray(v.data) ? v.data : []);
      })
      .catch(() => {});
    setDriverId(booking?.driver_id || "");
    setVehicleId(booking?.vehicle_id || "");
  }, [open, booking]);

  const submit = async () => {
    if (!driverId) { toast.error("Pilih driver terlebih dahulu"); return; }
    if (!vehicleId) { toast.error("Pilih armada terlebih dahulu"); return; }
    setSaving(true);
    try {
      const r = await apiClient.post(`/dispatch/${booking.id}/assign`, {
        driver_id: driverId, vehicle_id: vehicleId,
      });
      const geo = r.data?.geocode;
      toast.success(geo ? `Trip dijadwalkan · tujuan terpetakan: ${geo.display_name}`
        : "Trip dijadwalkan (koordinat tujuan belum ditemukan)");
      onOpenChange(false);
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gagal meng-assign trip");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="assign-dialog">
        <DialogHeader>
          <DialogTitle>Assign &amp; Jadwalkan Trip</DialogTitle>
          <DialogDescription>
            {booking ? `${booking.code} · ${booking.customer_name}` : ""} — tujuan akan dipetakan otomatis.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-[12px] border border-[#EFF0F2] bg-[#FAFAFB] px-3 py-2.5 text-[12.5px] text-[#3C3C43]">
            <div className="flex items-center gap-1.5"><MapPin size={13} className="text-[#007AFF]" />
              <span className="font-semibold text-[#1C1C1E]">{booking?.origin || "-"}</span>
              <span className="text-[#8E8E93]">→</span>
              <span className="font-semibold text-[#1C1C1E]">{booking?.destination || "-"}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label><User2 size={12} className="mr-1 inline" /> Driver</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger data-testid="assign-driver"><SelectValue placeholder="Pilih driver" /></SelectTrigger>
              <SelectContent>
                {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}{d.phone ? ` · ${d.phone}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label><Bus size={12} className="mr-1 inline" /> Armada</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger data-testid="assign-vehicle"><SelectValue placeholder="Pilih armada" /></SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="mt-2">
          <button className="secondary-button" onClick={() => onOpenChange(false)} data-testid="assign-cancel">Batal</button>
          <button className="primary-button" disabled={saving} onClick={submit} data-testid="assign-save">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Jadwalkan Trip
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
