import { ChevronLeft, ChevronRight, Clock, Copy as CopyIcon, ShieldAlert, ShieldCheck, Unlock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { buildHealthReport, type HealthReport } from '../../core/health';
import { STRENGTH_LABELS } from '../../core/strength';
import type { VaultItem } from '../../core/model';
import { Avatar, EmptyState, Spinner } from '../components/primitives';
import { useVaultData } from '../state';
import { relativeTime } from '../util';

type Section = 'weak' | 'reused' | 'old' | 'insecure';

export function HealthPage({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  const data = useVaultData();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [focus, setFocus] = useState<Section | null>(null);
  useEffect(() => {
    let alive = true;
    void buildHealthReport(data.items).then((r) => alive && setReport(r));
    return () => {
      alive = false;
    };
  }, [data.items]);

  const reusedItems = report ? report.reused.flatMap((g) => g.items) : [];
  const color = !report ? 'var(--fill-3)' : report.score >= 80 ? 'var(--green-fill)' : report.score >= 50 ? 'var(--orange-fill)' : 'var(--red-fill)';
  const r = 48;
  const c = 2 * Math.PI * r;

  const list = (title: string, items: Array<{ item: VaultItem; note: string }>, id: Section) =>
    items.length > 0 && (!focus || focus === id) ? (
      <section className="group-section" id={`health-${id}`}>
        <h3 className="group-title">{title}</h3>
        <div className="group">
          {items.map(({ item, note }, idx) => (
            <button key={`${item.id}-${idx}`} className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => onOpen(item.id)}>
              <Avatar item={item} size="sm" />
              <div className="row-main">
                <div style={{ fontWeight: 500 }}>{item.title}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {note}
                </div>
              </div>
              <ChevronRight size={16} className="faint" />
            </button>
          ))}
        </div>
      </section>
    ) : null;

  return (
    <div className="scroll" style={{ height: '100%' }}>
      <div className="mobile-bar">
        <button className="back" onClick={onBack}>
          <ChevronLeft /> Library
        </button>
      </div>
      <div className="page">
        <header className="page-head">
          <h1>Password Health</h1>
          <p>Analysed entirely on this device. No passwords or hashes are sent anywhere.</p>
        </header>
        {!report ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}>
            <Spinner />
          </div>
        ) : report.total === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="Nothing to analyse yet" text="Add some passwords and MyVault will check them for weaknesses and reuse." />
        ) : (
          <>
            <section className="group-section">
              <div className="group health-hero">
                <div className="score-ring">
                  <svg viewBox="0 0 116 116">
                    <circle className="track" cx="58" cy="58" r={r} />
                    <circle className="prog" cx="58" cy="58" r={r} stroke={color} strokeDasharray={c} strokeDashoffset={c * (1 - report.score / 100)} />
                  </svg>
                  <div className="val">{report.score}</div>
                </div>
                <div>
                  <h2 style={{ fontSize: 20 }}>{report.score >= 80 ? 'Looking good' : report.score >= 50 ? 'Room for improvement' : 'Needs attention'}</h2>
                  <p className="muted" style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5 }}>
                    {report.total} password{report.total === 1 ? '' : 's'} checked.{' '}
                    {report.weak.length + reusedItems.length === 0 ? 'Every password is strong and unique.' : 'Fix weak and reused passwords first — they matter most.'}
                  </p>
                </div>
              </div>
            </section>
            <div className="stat-grid">
              <Stat icon={<ShieldAlert />} tone="red" n={report.weak.length} label="Weak" onClick={() => setFocus(focus === 'weak' ? null : 'weak')} active={focus === 'weak'} />
              <Stat icon={<CopyIcon />} tone="orange" n={reusedItems.length} label="Reused" onClick={() => setFocus(focus === 'reused' ? null : 'reused')} active={focus === 'reused'} />
              <Stat icon={<Clock />} tone="blue" n={report.old.length} label="Over a year old" onClick={() => setFocus(focus === 'old' ? null : 'old')} active={focus === 'old'} />
              <Stat icon={<Unlock />} tone="gray" n={report.insecureUrl.length} label="Insecure URL" onClick={() => setFocus(focus === 'insecure' ? null : 'insecure')} active={focus === 'insecure'} />
            </div>
            {list(
              'Weak passwords',
              report.weak.map((w) => ({ item: w.item, note: STRENGTH_LABELS[w.score as 0] ?? 'Weak' })),
              'weak',
            )}
            {list(
              'Reused passwords',
              report.reused.flatMap((g, gi) => g.items.map((item) => ({ item, note: `Group ${gi + 1} · shared by ${g.items.length} items` }))),
              'reused',
            )}
            {list(
              'Old passwords',
              report.old.map((item) => ({ item, note: `Changed ${relativeTime(item.passwordUpdatedAt ?? item.createdAt)}` })),
              'old',
            )}
            {list(
              'Saved for HTTP (not secure)',
              report.insecureUrl.map((item) => ({ item, note: item.urls.find((u) => u.startsWith('http:')) ?? '' })),
              'insecure',
            )}
            <p className="group-footer">
              Breach checking (e.g. Have I Been Pwned) is intentionally not built in, because it requires contacting an external service.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, tone, n, label, onClick, active }: { icon: React.ReactNode; tone: 'red' | 'orange' | 'blue' | 'gray'; n: number; label: string; onClick: () => void; active: boolean }) {
  const bg = { red: 'var(--red-soft)', orange: 'var(--orange-soft)', blue: 'var(--accent-soft)', gray: 'var(--fill)' }[tone];
  const fg = { red: 'var(--red)', orange: 'var(--orange)', blue: 'var(--accent-text)', gray: 'var(--text-2)' }[tone];
  return (
    <button className="stat" onClick={onClick} aria-pressed={active} style={active ? { boxShadow: `0 0 0 2px ${fg}` } : undefined}>
      <div className="stat-ico" style={{ background: bg, color: fg }}>
        {icon}
      </div>
      <div className="stat-num">{n}</div>
      <div className="stat-label">{label}</div>
    </button>
  );
}
