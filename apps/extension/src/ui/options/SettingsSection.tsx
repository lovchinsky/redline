import type { ComponentChildren } from 'preact';

/** A settings group: what it is on the left, its controls on the right. */
export const SettingsSection = ({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  description: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
}) => (
  <section class="settings-section" aria-labelledby={`${id}-title`}>
    <div class="settings-intro">
      <h2 id={`${id}-title`}>{title}</h2>
      <p class="muted">{description}</p>
      {actions !== undefined && <div class="settings-actions">{actions}</div>}
    </div>
    <div class="settings-body">{children}</div>
  </section>
);
