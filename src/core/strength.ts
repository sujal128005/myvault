/**
 * Password strength via zxcvbn-ts (dictionary + pattern based estimator).
 * Loaded lazily so the large dictionaries are not part of the first paint.
 * Runs entirely locally — no breach-API lookups are made.
 */
export interface Strength {
  /** 0 (very weak) – 4 (very strong) */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** log10 of estimated guesses */
  guessesLog10: number;
  crackTime: string;
  warning: string;
  suggestions: string[];
}

export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

type Zxcvbn = typeof import('@zxcvbn-ts/core').zxcvbn;
let loader: Promise<Zxcvbn> | null = null;

export function loadStrengthEstimator(): Promise<Zxcvbn> {
  if (!loader) {
    loader = (async () => {
      const [core, common, en] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
        import('@zxcvbn-ts/language-en'),
      ]);
      core.zxcvbnOptions.setOptions({
        translations: en.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...en.dictionary },
      });
      return core.zxcvbn;
    })();
    loader.catch(() => {
      loader = null;
    });
  }
  return loader;
}

export async function estimateStrength(password: string, userInputs: string[] = []): Promise<Strength> {
  const zxcvbn = await loadStrengthEstimator();
  // zxcvbn is O(n²) in places; cap the analysed length (long passwords are strong anyway).
  const r = zxcvbn(password.slice(0, 100), userInputs.filter(Boolean).slice(0, 20));
  const score = r.score as Strength['score'];
  return {
    score,
    label: STRENGTH_LABELS[score],
    guessesLog10: r.guessesLog10,
    crackTime: String(r.crackTimesDisplay.offlineSlowHashing1e4PerSecond),
    warning: r.feedback.warning ?? '',
    suggestions: r.feedback.suggestions ?? [],
  };
}
