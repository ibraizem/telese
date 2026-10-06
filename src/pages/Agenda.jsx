/**
 * Agenda partagé du cabinet : jour / semaine / mois.
 * - glisser-déposer pour déplacer un rendez-vous (heure ou jour)
 * - clic sur un créneau libre pour créer un rendez-vous
 * - clic sur un rendez-vous pour le modifier, l'annuler ou le supprimer
 * - horaires, pauses et congés affichés (configuration du cabinet)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { useModals } from '../modals';
import { useToast } from '../toast';
import { Button, Card, Empty, PageHeader, Select, Spinner, StatusBadge, cx } from '../ui';
import { BLOCK_REASONS, statusMeta } from '../status';
import {
  addDays, addMonths, endOfMonth, endOfWeek, formatDateFr, formatShortDate,
  isToday, minutesToTime, monthLabel, startOfMonth, startOfWeek, timeToMinutes, todayISO, weekdayName,
} from '../date';

const PX_PER_MIN = 1.4;

export default function Agenda() {
  const { clinic, has } = useSession();
  const { openAppointment, openMessage, confirm } = useModals();
  const toast = useToast();

  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(todayISO());
  const [filter, setFilter] = useState('all');
  const [practitioners, setPractitioners] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(null);
  const gridRef = useRef(null);

  const dayStart = timeToMinutes(clinic?.day_start || '09:00');
  const dayEnd = timeToMinutes(clinic?.day_end || '18:00');
  const step = Number(clinic?.slot_minutes || 30);

  /* Référentiel des orthophonistes -------------------------------- */
  useEffect(() => {
    api.get('/api/practitioners')
      .then((d) => setPractitioners(d.practitioners.filter((p) => p.active)))
      .catch(() => setPractitioners([]));
  }, []);

  /* Périmètre de dates selon la vue -------------------------------- */
  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor };
    if (view === 'week') return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
    return { from: startOfWeek(startOfMonth(anchor)), to: endOfWeek(endOfMonth(anchor)) };
  }, [view, anchor]);

  const columns = useMemo(() => {
    const list = [];
    if (view === 'month') return list;
    const count = view === 'week' ? 7 : 1;
    for (let i = 0; i < count; i++) list.push(addDays(range.from, i));
    return list;
  }, [view, range]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (filter !== 'all') params.set('practitioner_id', filter);
      const [ap, bl] = await Promise.all([
        api.get(`/api/appointments?${params}`),
        api.get(`/api/blocked-times?from=${range.from}&to=${range.to}`).catch(() => ({ blocked_times: [] })),
      ]);
      setAppointments(ap.appointments);
      setBlocked(bl.blocked_times || []);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, filter, toast]);

  useEffect(() => { load(); }, [load]);

  /* Navigation ------------------------------------------------------ */
  const shift = (delta) => {
    setAnchor((a) => (view === 'day' ? addDays(a, delta) : view === 'week' ? addDays(a, delta * 7) : addMonths(a, delta)));
  };

  const periodLabel = view === 'month'
    ? monthLabel(anchor)
    : view === 'week'
      ? `${formatDateFr(range.from)} → ${formatDateFr(range.to)}`
      : `${formatDateFr(anchor)} · ${weekdayName(anchor)}`;

  /* Glisser-déposer -------------------------------------------------- */
  async function moveAppointment(appointment, dateStr, minutes) {
    const startMin = Math.max(dayStart, minutes);
    const endMin = Math.min(dayEnd, startMin + Number(appointment.duration_min));
    const snapped = Math.floor(startMin / step) * step;
    if (snapped + appointment.duration_min > endMin) {
      toast.push('Le rendez-vous ne tient pas dans ce créneau.', 'error');
      return;
    }
    const startAt = `${dateStr}T${minutesToTime(snapped)}`;
    if (startAt === appointment.start_at) return;
    try {
      await api.patch(`/api/appointments/${appointment.id}`, { start_at: startAt });
      toast.push(`Rendez-vous déplacé au ${formatDateFr(dateStr)} à ${minutesToTime(snapped)}.`);
      load();
    } catch (err) {
      toast.push(err.message, 'error');
      load();
    }
  }

  function onDrop(event, dateStr) {
    event.preventDefault();
    const column = event.currentTarget;
    column.classList.remove('agenda-day--dropping');
    const id = Number(event.dataTransfer.getData('text/plain'));
    const appt = appointments.find((a) => a.id === id);
    if (!appt) return;
    const rect = column.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const minutes = dayStart + Math.round(offsetY / PX_PER_MIN);
    moveAppointment(appt, dateStr, minutes);
    setDragging(null);
  }

  const apptsOf = (dateStr) => appointments.filter((a) => a.date === dateStr);

  const canWrite = has('agenda.write');

  return (
    <>
      <PageHeader
        title="Agenda partagé"
        subtitle={`${appointments.length} rendez-vous · horaires du cabinet ${clinic?.day_start}–${clinic?.day_end} (pas de ${step} min)`}
        actions={canWrite && (
          <Button variant="primary" icon="+" onClick={() => openAppointment({ defaults: { date: anchor } })}>
            Nouveau rendez-vous
          </Button>
        )}
      />

      <div className="agenda-toolbar">
        <div className="segmented">
          {[['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={cx(view === key && 'segmented__btn')}
              style={view === key ? { background: '#fff', boxShadow: 'var(--shadow)', color: 'var(--text)' } : undefined}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <Button size="sm" variant="secondary" onClick={() => shift(-1)} aria-label="Période précédente">‹</Button>
        <Button size="sm" variant="secondary" onClick={() => setAnchor(todayISO())}>Aujourd'hui</Button>
        <Button size="sm" variant="secondary" onClick={() => shift(1)} aria-label="Période suivante">›</Button>
        <span className="agenda-period">{periodLabel}</span>

        <div className="agenda-filters">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 190 }} aria-label="Filtrer par orthophoniste">
            <option value="all">Tous les orthophonistes</option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="legend">
        <span className="legend__item"><span className="legend__swatch" style={{ background: '#e4f6ee', border: '1px solid #0e7a52' }} /> Confirmé</span>
        <span className="legend__item"><span className="legend__swatch" style={{ background: '#fff', border: '1px solid #7b8798' }} /> En attente / à confirmer</span>
        <span className="legend__item"><span className="legend__swatch" style={{ background: '#f1f4f9', border: '1px solid #cbd5e1' }} /> Fermé</span>
        <span className="legend__item"><span className="legend__swatch" style={{ background: 'repeating-linear-gradient(45deg,#f1f4f9,#f1f4f9 4px,#e9edf4 4px,#e9edf4 8px)', border: '1px solid #cbd5e1' }} /> Pause / congé</span>
        <span className="legend__item muted">Glissez un rendez-vous pour le déplacer</span>
      </div>

      {loading ? (
        <Card><Spinner label="Chargement de l'agenda…" /></Card>
      ) : view === 'month' ? (
        <MonthView
          anchor={anchor}
          appointments={appointments}
          onOpen={(a) => openAppointment({ appointment: a, onSaved: load })}
          onSlot={(date) => canWrite && openAppointment({ defaults: { date } })}
          canWrite={canWrite}
        />
      ) : appointments.length === 0 && columns.every((d) => apptsOf(d).length === 0) ? (
        <Card padded={false}>
          <Empty
            title="Aucun rendez-vous sur cette période"
            hint="Cliquez sur un horaire libre pour en créer un."
            action={canWrite && (
              <Button variant="primary" size="sm" icon="+" onClick={() => openAppointment({ defaults: { date: columns[0] } })}>
                Nouveau rendez-vous
              </Button>
            )}
          />
        </Card>
      ) : (
        <DayWeekGrid
          columns={columns}
          appointments={appointments}
          blocked={blocked}
          practitioners={practitioners}
          dayStart={dayStart}
          dayEnd={dayEnd}
          step={step}
          pxPerMin={PX_PER_MIN}
          gridRef={gridRef}
          dragging={dragging}
          onDragStart={(a) => setDragging(a.id)}
          onDragEnd={() => setDragging(null)}
          onDrop={onDrop}
          onOpen={(a) => openAppointment({ appointment: a, onSaved: load })}
          onSlot={(date, time) => canWrite && openAppointment({ defaults: { date, time } })}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Vue jour / semaine                                                  */
/* ------------------------------------------------------------------ */
function DayWeekGrid({
  columns, appointments, blocked, practitioners, dayStart, dayEnd, step, pxPerMin,
  dragging, onDragStart, onDragEnd, onDrop, onOpen, onSlot,
}) {
  const totalMin = dayEnd - dayStart;
  const height = totalMin * pxPerMin;
  const hours = [];
  for (let m = dayStart; m <= dayEnd; m += 60) hours.push(m);

  const columnsTemplate = `68px repeat(${columns.length}, minmax(150px, 1fr))`;

  return (
    <div className="agenda">
      <div className="agenda-grid" style={{ gridTemplateColumns: columnsTemplate }}>
        {/* ligne d'en-tête */}
        <div className="agenda-head-cell agenda-head-cell--corner" style={{ position: 'sticky', left: 0, zIndex: 6 }}>Heure</div>
        {columns.map((dateStr) => (
          <div
            key={`h-${dateStr}`}
            className={cx('agenda-head-cell', isToday(dateStr) && 'is-today')}
          >
            {formatShortDate(dateStr)}
            {isToday(dateStr) && <span className="badge badge--primary badge--sm" style={{ marginLeft: 6 }}>Aujourd'hui</span>}
          </div>
        ))}

        {/* gouttière des heures */}
        <div className="agenda-gutter" style={{ position: 'sticky', left: 0, zIndex: 4, height }}>
          {hours.map((m) => (
            <div key={m} className="agenda-gutter__slot" style={{ position: 'absolute', top: (m - dayStart) * pxPerMin, right: 7, width: 56 }}>
              {minutesToTime(m)}
            </div>
          ))}
        </div>

        {/* colonnes des jours */}
        {columns.map((dateStr) => {
          const dayAppts = appointments.filter((a) => a.date === dateStr);
          const dayBlocks = blocked.filter((b) => b.date === dateStr);
          return (
            <div
              key={dateStr}
              className={cx('agenda-day', isToday(dateStr) && 'agenda-day--today')}
              style={{ '--hour-h': `${60 * pxPerMin}px`, height, position: 'relative' }}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('agenda-day--dropping'); }}
              onDragLeave={(e) => e.currentTarget.classList.remove('agenda-day--dropping')}
              onDrop={(e) => onDrop(e, dateStr)}
            >
              {/* clic sur une zone libre = création */}
              {Array.from({ length: Math.floor(totalMin / step) }, (_, i) => dayStart + i * step).map((m) => (
                <div
                  key={`slot-${m}`}
                  className="agenda-slot"
                  style={{ position: 'absolute', top: (m - dayStart) * pxPerMin, height: step * pxPerMin, left: 0, right: 0 }}
                  title={`Créer un rendez-vous à ${minutesToTime(m)}`}
                  onClick={() => onSlot(dateStr, minutesToTime(m))}
                />
              ))}

              {/* pauses / congés / indisponibilités */}
              {dayBlocks.map((b) => {
                const top = (timeToMinutes(b.start_time) - dayStart) * pxPerMin;
                const h = (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)) * pxPerMin;
                if (h <= 0) return null;
                return (
                  <div
                    key={`b-${b.id}`}
                    className="agenda-break"
                    style={{ top, height: h }}
                    title={`${BLOCK_REASONS[b.reason]}${b.note ? ` — ${b.note}` : ''}`}
                  >
                    {BLOCK_REASONS[b.reason]}{b.note ? ` — ${b.note}` : ''}
                  </div>
                );
              })}

              {/* rendez-vous */}
              {dayAppts.map((a) => {
                const startMin = timeToMinutes(a.time);
                const top = (startMin - dayStart) * pxPerMin;
                const h = Math.max(20, Number(a.duration_min) * pxPerMin - 3);
                const meta = statusMeta(a.status);
                const color = a.practitioner?.color || '#4f6bed';
                return (
                  <button
                    key={a.id}
                    type="button"
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(a.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(a); }}
                    onDragEnd={onDragEnd}
                    onClick={(e) => { e.stopPropagation(); onOpen(a); }}
                    className={cx('appt', meta.className === 'is-cancelled' && 'appt--cancelled', dragging === a.id && 'appt--dragging')}
                    style={{
                      top,
                      height: h,
                      background: meta.className === 'is-confirmed' ? '#f2fbf7' : meta.className === 'is-cancelled' ? '#fdeaea' : '#fff',
                      borderColor: meta.className === 'is-cancelled' ? '#f3c6c8' : `${color}44`,
                      borderLeftColor: color,
                    }}
                    title={`${a.patient.full_name} — ${a.time} (${a.duration_min} min) — ${a.practitioner?.full_name} — ${meta.label}`}
                  >
                    <span className="appt__time">{a.time}</span>{' '}
                    <span className="appt__name">{a.patient.full_name}</span>
                    {h > 38 && (
                      <span className="appt__meta">
                        {a.practitioner?.full_name} · {a.duration_min} min · {meta.label}
                      </span>
                    )}
                    {h > 56 && a.type && <span className="appt__meta">{a.type.name}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vue mois                                                            */
/* ------------------------------------------------------------------ */
function MonthView({ anchor, appointments, onOpen, onSlot, canWrite }) {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="agenda">
      <div className="month-grid">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
          <div key={d} className="agenda-head-cell" style={{ textAlign: 'center' }}>{d}</div>
        ))}
        {days.map((dateStr) => {
          const outside = dateStr.slice(0, 7) !== first.slice(0, 7);
          const dayAppts = appointments.filter((a) => a.date === dateStr && a.status !== 'cancelled');
          return (
            <div
              key={dateStr}
              className={cx('month-cell', outside && 'month-cell--outside', isToday(dateStr) && 'month-cell--today')}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => canWrite && onSlot(dateStr)}
            >
              <span className="month-cell__day">
                {Number(dateStr.slice(8, 10))}
                {canWrite && <span className="month-cell__add" title="Créer un rendez-vous">+</span>}
              </span>
              {dayAppts.slice(0, 3).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="month-appt"
                  style={{ borderLeftColor: a.practitioner?.color || '#4f6bed' }}
                  onClick={(e) => { e.stopPropagation(); onOpen(a); }}
                  title={`${a.time} — ${a.patient.full_name} — ${a.practitioner?.full_name}`}
                >
                  {a.time} {a.patient.full_name}
                </button>
              ))}
              {dayAppts.length > 3 && <span className="muted small">+{dayAppts.length - 3} autres</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
