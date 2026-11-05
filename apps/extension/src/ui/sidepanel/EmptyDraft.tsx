import { Shortcut } from '../kit/Kbd';
import type { UiServices } from '../services';
import { useTranslator } from '../shared/i18n';
import { useCaptureShortcut } from './use-shortcut';

/** A lasso around a page fragment: what the first step looks like. */
const LassoArt = () => (
  <svg class="empty-art" width="120" height="84" viewBox="0 0 120 84" aria-hidden="true">
    <rect
      x="14"
      y="14"
      width="92"
      height="60"
      rx="8"
      fill="var(--rl-surface)"
      stroke="var(--rl-border-strong)"
    />
    <rect x="24" y="26" width="34" height="6" rx="3" fill="var(--rl-border-strong)" />
    <rect x="24" y="38" width="52" height="4" rx="2" fill="var(--rl-border)" />
    <rect x="24" y="46" width="44" height="4" rx="2" fill="var(--rl-border)" />
    <rect x="68" y="54" width="28" height="12" rx="4" fill="var(--rl-border-strong)" />
    <path
      d="M58 50c-6-12 6-22 24-21 17 1 26 13 19 24-6 10-24 15-37 9"
      fill="none"
      stroke="var(--rl-brand)"
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <circle cx="64" cy="62" r="3" fill="var(--rl-brand)" />
  </svg>
);

/** What to do before the first step. */
export const EmptyDraft = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const shortcut = useCaptureShortcut(services);
  return (
    <section class="empty" data-testid="empty-draft">
      <LassoArt />
      <h2>{t.text('emptyTitle')}</h2>
      {shortcut === null ? (
        <p class="muted">{t.text('shortcutUnset')}</p>
      ) : (
        <p class="muted">
          {t.text('emptyShortcut')} {shortcut !== undefined && <Shortcut keys={shortcut} />}
        </p>
      )}
      <p class="muted">{t.text('emptyBody')}</p>
      <p class="faint small">{t.text('emptyContextMenu')}</p>
    </section>
  );
};

/** The way to the next step, under the existing ones. */
export const NextStepHint = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const shortcut = useCaptureShortcut(services);
  if (shortcut === undefined) return null;
  return (
    <p class="next-step">
      {shortcut === null ? (
        t.text('shortcutUnset')
      ) : (
        <>
          {t.text('nextStep')} <Shortcut keys={shortcut} /> {t.text('nextStepWhere')}
        </>
      )}
    </p>
  );
};
