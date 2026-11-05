/** The Redline mark, as on the toolbar icon: a glowing red lasso ring on a dark tile. */
export const Logo = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="6" fill="#17181c" />
    <ellipse
      cx="12"
      cy="12"
      rx="6.6"
      ry="5.8"
      fill="none"
      stroke="#e5484d"
      stroke-opacity="0.35"
      stroke-width="4.2"
    />
    <ellipse cx="12" cy="12" rx="6.6" ry="5.8" fill="none" stroke="#ff5a5f" stroke-width="2" />
  </svg>
);
