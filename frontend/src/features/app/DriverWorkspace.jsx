import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Activity, CheckCircle2, Camera, RefreshCw, CalendarDays, History } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/services/apiClient";
import { useAuth } from "@/context/AuthContext";
import { LoadingState, EmptyState, ErrorState } from "@/components/shared/DataStates";
import { formatQty, formatDateTime } from "@/utils/formatters";
import DriverTaskCard from "@/components/app/DriverTaskCard";
import DriverPodDialog from "@/components/app/DriverPodDialog";
import DriverNavDialog from "@/components/app/DriverNavDialog";
import OdometerDialog from "@/components/app/OdometerDialog";

function StatCard({ icon: Icon, label, value, tone = "#007AFF", testId }) {
  return (
    <div className="rounded-[14px] border border-[#EFF0F2] bg-white p-4 shadow-sm" data-testid={testId}>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[#6B6B73]">
        <Icon size={14} style={{ color: tone }} /> {label}
      </div>
      <div className="mt-1 text-[24px] font-bold tabular-nums text-[#1C1C1E]" style={{ fontFamily: "Outfit, sans-serif" }}>
        {value}
      </div>
    </div>
  );
}

const ACTIVE_ST = ["to_pickup", "on_trip"];
const WAITING_ST = ["standby", "assigned"];

export default function DriverWorkspace() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [podTask, setPodTask] = useState(null);
  const [navTask, setNavTask] = useState(null);
  const [odo, setOdo] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, t] = await Promise.all([
        apiClient.get("/driver/summary"),
        apiClient.get("/driver/tasks"),
      ]);
      setSummary(s.data || null);
      setTasks(Array.isArray(t.data) ? t.data : []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Gagal memuat ruang kerja driver");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (task, fn, successMsg) => {
    setBusyId(task.trip_id);
    try { await fn(); toast.success(successMsg); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Aksi gagal"); }
    finally { setBusyId(null); }
  };

  const onAck = (t) => act(t, () => apiClient.post(`/driver/tasks/${t.trip_id}/ack`), "Tugas dikonfirmasi");
  const onDepart = (t) => setOdo({ mode: "start", task: t });
  // RC-D: transisi ke on_trip memakai state machine trip TUNGGAL (/trips/{id}/status) —
  // TIDAK ada jalur status kedua (anti split-brain RC-03).
  const onPickup = (t) => act(t, () => apiClient.post(`/trips/${t.trip_id}/status`, { status: "on_trip" }), "Penumpang naik — perjalanan dimulai");
  const onArrived = (t) => act(t, () => apiClient.post(`/driver/tasks/${t.trip_id}/arrived`), "Status tiba terkirim ke pelanggan");
  const onCheckout = (t) => setOdo({ mode: "end", task: t });

  const confirmOdo = async (value) => {
    const cur = odo; setOdo(null);
    if (!cur) return;
    if (cur.mode === "start") {
      await act(cur.task, () => apiClient.post("/driver/checkin", { trip_id: cur.task.trip_id, odometer_start: value }), "Berangkat menjemput penumpang");
    } else {
      await act(cur.task, () => apiClient.post("/driver/checkout", { trip_id: cur.task.trip_id, odometer_end: value }), "Trip diselesaikan (check-out)");
    }
  };

  const notDriver = summary && summary.is_driver === false;

  const todayStr = new Date().toISOString().slice(0, 10);
  const byStart = (a, b) => String(a.start_datetime || "").localeCompare(String(b.start_datetime || ""));
  const active = tasks.filter((t) => ACTIVE_ST.includes(t.trip_status)).sort(byStart);
  const upcoming = tasks
    .filter((t) => WAITING_ST.includes(t.trip_status) && t.booking_status !== "cancelled")
    .sort(byStart);
  const upcomingToday = upcoming.filter((t) => String(t.start_datetime || "").slice(0, 10) <= todayStr);
  const upcomingLater = upcoming.filter((t) => String(t.start_datetime || "").slice(0, 10) > todayStr);
  const history = tasks.filter((t) => t.trip_status === "completed").sort((a, b) => byStart(b, a));

  const cardProps = { busy: false, onAck, onDepart, onPickup, onArrived, onCheckout };
  const renderCards = (list) => list.map((t) => (
    <DriverTaskCard key={t.trip_id} task={t} {...cardProps} busy={busyId === t.trip_id}
      onPod={() => setPodTask(t)} onNav={() => setNavTask(t)} />
  ));

  if (loading) return <LoadingState testId="driver-workspace-loading" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-5" data-testid="driver-workspace-page">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[#6B6B73]">
          {notDriver ? "Halaman ini untuk akun driver." : `Tugas perjalanan Anda, ${summary?.driver_name || user?.name || ""}.`}
        </p>
        <button className="icon-button !h-9 !w-9" title="Muat ulang" onClick={load} data-testid="dw-refresh"><RefreshCw size={15} /></button>
      </div>

      {summary && summary.is_driver ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dw-summary">
          <StatCard icon={ClipboardCheck} label="Total Tugas" value={formatQty(summary.total)} testId="dw-stat-total" />
          <StatCard icon={Activity} label="Aktif" value={formatQty(summary.active)} tone="#FF9500" testId="dw-stat-active" />
          <StatCard icon={CheckCircle2} label="Selesai" value={formatQty(summary.completed)} tone="#34C759" testId="dw-stat-completed" />
          <StatCard icon={Camera} label="Perlu POD" value={formatQty(summary.need_pod)} tone="#FF3B30" testId="dw-stat-pod" />
        </div>
      ) : null}

      {notDriver ? (
        <EmptyState title="Akun Anda bukan driver" description="Masuk dengan akun driver untuk melihat dan mengelola tugas perjalanan." testId="dw-not-driver" />
      ) : tasks.length === 0 ? (
        <EmptyState title="Belum ada tugas" description="Tugas perjalanan akan muncul di sini setelah Anda di-assign oleh tim dispatch." testId="dw-empty" />
      ) : (
        <>
          {active.length > 0 ? (
            <section data-testid="dw-active">
              <h2 className="mb-2 flex items-center gap-2 text-[14px] font-bold text-[#1C1C1E]" style={{ fontFamily: "Outfit, sans-serif" }}>
                <Activity size={15} className="text-[#FF9500]" /> Trip Aktif
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{renderCards(active)}</div>
            </section>
          ) : null}

          <section data-testid="dw-upcoming">
            <h2 className="mb-2 flex items-center gap-2 text-[14px] font-bold text-[#1C1C1E]" style={{ fontFamily: "Outfit, sans-serif" }}>
              <CalendarDays size={15} className="text-[#007AFF]" /> Upcoming Trips
              <span className="rounded-full bg-[#EAF2FF] px-2 py-0.5 text-[11px] font-semibold text-[#0058CC]" data-testid="dw-upcoming-count">{upcoming.length}</span>
            </h2>
            {upcoming.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-[#E5E5EA] px-4 py-3 text-[12.5px] text-[#8E8E93]" data-testid="dw-upcoming-empty">
                Tidak ada trip menunggu — tugas baru dari dispatch akan tampil di sini.
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingToday.length > 0 ? (
                  <>
                    <p className="text-[12px] font-semibold text-[#6B6B73]">Hari ini / siap berangkat</p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="dw-upcoming-today">{renderCards(upcomingToday)}</div>
                  </>
                ) : null}
                {upcomingLater.length > 0 ? (
                  <>
                    <p className="text-[12px] font-semibold text-[#6B6B73]">Mendatang</p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="dw-upcoming-later">{renderCards(upcomingLater)}</div>
                  </>
                ) : null}
              </div>
            )}
          </section>

          {history.length > 0 ? (
            <section data-testid="dw-history">
              <button className="flex items-center gap-2 text-[14px] font-bold text-[#1C1C1E]" style={{ fontFamily: "Outfit, sans-serif" }}
                onClick={() => setShowHistory((s) => !s)} data-testid="dw-history-toggle">
                <History size={15} className="text-[#8E8E93]" /> Riwayat Selesai ({formatQty(history.length)}) {showHistory ? "▾" : "▸"}
              </button>
              {showHistory ? (
                <div className="mt-2 space-y-1.5">
                  {history.slice(0, 10).map((t) => (
                    <div key={t.trip_id} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[#EFF0F2] bg-white px-3 py-2 text-[12.5px]" data-testid={`dw-history-${t.trip_id}`}>
                      <span className="font-semibold text-[#1C1C1E]">{t.code || t.trip_id}</span>
                      <span className="text-[#6B6B73]">{t.destination || "-"}</span>
                      <span className="tabular-nums text-[#8E8E93]">{formatDateTime(t.start_datetime)}</span>
                      <button className="secondary-button !h-7 !px-2 !text-[11px]" onClick={() => setPodTask(t)} data-testid={`dw-history-pod-${t.trip_id}`}>
                        {t.has_pod ? "Lihat POD" : "Unggah POD"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <DriverPodDialog open={Boolean(podTask)} task={podTask} onOpenChange={(v) => !v && setPodTask(null)} onSaved={load} />
      <DriverNavDialog open={Boolean(navTask)} task={navTask} onOpenChange={(v) => !v && setNavTask(null)} />
      <OdometerDialog open={Boolean(odo)} mode={odo?.mode} task={odo?.task} onOpenChange={(v) => !v && setOdo(null)} onConfirm={confirmOdo} />
    </div>
  );
}
