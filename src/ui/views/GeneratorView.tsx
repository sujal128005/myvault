import { ChevronLeft, Copy, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  generatePassword,
  generatorEntropyBits,
  normalizeGeneratorOptions,
  LENGTH_MAX,
  LENGTH_MIN,
  WORDS_MAX,
  WORDS_MIN,
  type GeneratorOptions,
} from '../../core/generator';
import { Segmented, StrengthMeter, Switch } from '../components/primitives';
import { useCopy } from '../hooks';
import { useVault, useVaultData } from '../state';

/** Colour digits and symbols like Apple's generated-password display. */
function Colored({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let i = 0;
  for (const ch of text) {
    const cls = /[0-9]/.test(ch) ? 'd' : /[A-Za-z]/.test(ch) ? '' : 's';
    parts.push(cls ? <span key={i} className={cls}>{ch}</span> : ch);
    i++;
  }
  return <>{parts}</>;
}

export function GeneratorPanel({ onUse, useLabel }: { onUse?: (pw: string) => void; useLabel?: string }) {
  const data = useVaultData();
  const { actions } = useVault();
  const copy = useCopy();
  const [opts, setOpts] = useState<GeneratorOptions>(() => normalizeGeneratorOptions(data.settings.generator));
  const [pw, setPw] = useState(() => generatePassword(opts));
  const regen = useCallback((o: GeneratorOptions) => setPw(generatePassword(o)), []);

  // Persist preferences (debounced) into the encrypted vault settings.
  useEffect(() => {
    const t = setTimeout(() => {
      if (JSON.stringify(opts) !== JSON.stringify(data.settings.generator)) void actions.updateSettings({ generator: opts });
    }, 600);
    return () => clearTimeout(t);
  }, [opts, actions, data.settings.generator]);

  const update = (patch: Partial<GeneratorOptions>) => {
    const next = normalizeGeneratorOptions({ ...opts, ...patch });
    setOpts(next);
    regen(next);
  };
  const bits = generatorEntropyBits(opts);
  const pct = (v: number, lo: number, hi: number) => ({ ['--pct' as string]: `${((v - lo) / (hi - lo)) * 100}%` });
  const toggles: Array<[keyof GeneratorOptions, string]> = [
    ['uppercase', 'Uppercase (A–Z)'],
    ['lowercase', 'Lowercase (a–z)'],
    ['digits', 'Numbers (0–9)'],
    ['symbols', 'Symbols (!@#…)'],
    ['avoidAmbiguous', 'Avoid look-alikes (l, 1, O, 0)'],
  ];
  const enabledSets = (['uppercase', 'lowercase', 'digits', 'symbols'] as const).filter((k) => opts[k]).length;

  return (
    <div>
      <section className="group-section">
        <div className="group gen-output">
          <div className="gen-password" aria-live="polite" data-testid="generated-password">
            <Colored text={pw} />
          </div>
          <div className="gen-meta">
            <StrengthMeter password={pw} compact />
            <span className="badge badge-gray">{bits} bits</span>
          </div>
          <div className="gen-actions">
            <button className="btn btn-secondary" onClick={() => regen(opts)}>
              <RefreshCw /> Regenerate
            </button>
            <button className="btn btn-primary" onClick={() => copy(pw, 'Password')}>
              <Copy /> Copy
            </button>
            {onUse && (
              <button className="btn btn-tinted" onClick={() => onUse(pw)}>
                {useLabel ?? 'Use'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="group-section">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <Segmented
            label="Generator type"
            value={opts.mode}
            onChange={(mode) => update({ mode })}
            options={[
              { value: 'password', label: 'Password' },
              { value: 'passphrase', label: 'Passphrase' },
            ]}
          />
        </div>
        <div className="group">
          {opts.mode === 'password' ? (
            <>
              <div className="row">
                <div className="row-main">
                  <div className="row-label">Length</div>
                  <div className="slider-row">
                    <input
                      className="range"
                      type="range"
                      min={LENGTH_MIN}
                      max={64}
                      value={Math.min(64, opts.length)}
                      style={pct(Math.min(64, opts.length), LENGTH_MIN, 64)}
                      onChange={(e) => update({ length: Number(e.target.value) })}
                      aria-label="Password length"
                    />
                    <input
                      className="input"
                      style={{ width: 70, height: 30, textAlign: 'center' }}
                      type="number"
                      min={LENGTH_MIN}
                      max={LENGTH_MAX}
                      value={opts.length}
                      onChange={(e) => update({ length: Number(e.target.value) })}
                      aria-label="Password length (number)"
                    />
                  </div>
                </div>
              </div>
              {toggles.map(([k, label]) => {
                const isSet = k !== 'avoidAmbiguous';
                const lastOne = isSet && !!opts[k] && enabledSets === 1;
                return (
                  <div className="row" key={k}>
                    <div className="row-main">{label}</div>
                    <Switch checked={!!opts[k]} disabled={lastOne} onChange={(v) => update({ [k]: v } as Partial<GeneratorOptions>)} label={label} />
                  </div>
                );
              })}
            </>
          ) : (
            <>
              <div className="row">
                <div className="row-main">
                  <div className="row-label">Words</div>
                  <div className="slider-row">
                    <input className="range" type="range" min={WORDS_MIN} max={WORDS_MAX} value={opts.words} style={pct(opts.words, WORDS_MIN, WORDS_MAX)} onChange={(e) => update({ words: Number(e.target.value) })} aria-label="Number of words" />
                    <span className="num">{opts.words}</span>
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="row-main">Separator</div>
                <Segmented
                  label="Separator"
                  value={opts.separator}
                  onChange={(separator) => update({ separator })}
                  options={[
                    { value: '-', label: '–' },
                    { value: '.', label: '.' },
                    { value: '_', label: '_' },
                    { value: ' ', label: '␣' },
                  ]}
                />
              </div>
              <div className="row">
                <div className="row-main">Capitalize</div>
                <Switch checked={opts.capitalize} onChange={(capitalize) => update({ capitalize })} label="Capitalize words" />
              </div>
              <div className="row">
                <div className="row-main">Include a number</div>
                <Switch checked={opts.includeNumber} onChange={(includeNumber) => update({ includeNumber })} label="Include a number" />
              </div>
            </>
          )}
        </div>
        <p className="group-footer">
          Generated locally with your device's cryptographically secure random number generator.
          {opts.mode === 'passphrase' && ' Words come from the EFF long wordlist (7,776 words).'}
        </p>
      </section>
    </div>
  );
}

export function GeneratorPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="scroll" style={{ height: '100%' }}>
      <div className="mobile-bar">
        <button className="back" onClick={onBack}>
          <ChevronLeft /> Library
        </button>
      </div>
      <div className="page">
        <header className="page-head">
          <h1>Password Generator</h1>
          <p>Strong, unique passwords and memorable passphrases.</p>
        </header>
        <GeneratorPanel />
      </div>
    </div>
  );
}
