/**
 * Functions injected into the active tab with chrome.scripting.executeScript, ONLY
 * after an explicit click in the popup. They run in the extension's isolated world,
 * so page JavaScript cannot tamper with the prototypes they use.
 *
 * IMPORTANT: each function must be fully self-contained (Chrome serialises it), so
 * helpers are duplicated inside each one on purpose.
 */

export interface FillResult {
  ok: boolean;
  reason?: string;
  filledUsername?: boolean;
  filledPassword?: boolean;
}

/** Fill a username + password into the login form of this frame. */
export function fillLoginInPage(expectedOrigin: string, username: string, password: string): FillResult {
  // Re-check the origin *inside* the page right before filling: the tab may have
  // navigated since the user clicked, and frames from other origins must never get data.
  if (location.origin !== expectedOrigin) return { ok: false, reason: 'origin-mismatch' };

  const isVisible = (el: HTMLInputElement) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && !el.disabled && !el.readOnly;
  };
  const setValue = (el: HTMLInputElement, value: string) => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.blur();
  };
  const textTypes = new Set(['text', 'email', 'tel', '']);
  const inputs = Array.from(document.querySelectorAll('input')).filter(isVisible);
  const passwords = inputs.filter((i) => i.type === 'password');
  const pw = passwords.find((p) => p.autocomplete === 'current-password') ?? passwords[0] ?? null;

  let user: HTMLInputElement | null = inputs.find((i) => i.autocomplete === 'username' && textTypes.has(i.type)) ?? null;
  if (!user) {
    const candidates = inputs.filter((i) => textTypes.has(i.type) && !/search|captcha|otp|code/i.test(`${i.name} ${i.id} ${i.placeholder}`));
    if (pw) {
      // Closest text field before the password field in document order, preferring the same form.
      const before = candidates.filter((c) => c.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
      user = before.filter((c) => c.form === pw.form).pop() ?? before.pop() ?? null;
    } else {
      // Two-step logins (username first, password on the next screen).
      user = candidates.find((c) => /user|email|login|account|name/i.test(`${c.name} ${c.id} ${c.autocomplete} ${c.type}`)) ?? (candidates.length === 1 ? candidates[0]! : null);
    }
  }

  let filledUsername = false;
  let filledPassword = false;
  if (user && username) {
    setValue(user, username);
    filledUsername = true;
  }
  if (pw && password) {
    setValue(pw, password);
    filledPassword = true;
  }
  if (!filledUsername && !filledPassword) return { ok: false, reason: 'no-fields' };
  return { ok: true, filledUsername, filledPassword };
}

/** Fill a newly generated password into all visible password fields (sign-up / change-password forms). */
export function fillNewPasswordInPage(expectedOrigin: string, password: string): FillResult {
  if (location.origin !== expectedOrigin) return { ok: false, reason: 'origin-mismatch' };
  const isVisible = (el: HTMLInputElement) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.disabled && !el.readOnly;
  };
  const fields = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isVisible);
  const targets = fields.filter((f) => f.autocomplete !== 'current-password');
  const list = targets.length ? targets : fields;
  for (const el of list) {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, password);
    else el.value = password;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.blur();
  }
  return list.length ? { ok: true, filledPassword: true } : { ok: false, reason: 'no-fields' };
}

export interface CapturedLogin {
  origin: string;
  title: string;
  username: string;
  password: string;
}

/** Read what the user has typed into the current login form (to save it). Top frame only. */
export function captureLoginFromPage(): CapturedLogin {
  const isVisible = (el: HTMLInputElement) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden';
  };
  const inputs = Array.from(document.querySelectorAll('input')).filter(isVisible);
  const pw = inputs.find((i) => i.type === 'password' && i.value) ?? null;
  const textTypes = new Set(['text', 'email', 'tel', '']);
  let user = inputs.find((i) => i.autocomplete === 'username' && i.value) ?? null;
  if (!user) {
    const filled = inputs.filter((i) => textTypes.has(i.type) && i.value);
    user = pw ? (filled.filter((c) => c.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop() ?? null) : (filled[0] ?? null);
  }
  return { origin: location.origin, title: document.title.slice(0, 100), username: user?.value ?? '', password: pw?.value ?? '' };
}
