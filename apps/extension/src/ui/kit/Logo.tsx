/** The Redline mark, as on the toolbar icon: a glowing red circle on a dark tile. */
export const Logo = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="5.25" fill="#17181c" />
    <circle
      cx="12"
      cy="12"
      r="6.2"
      fill="none"
      stroke="#e5484d"
      stroke-opacity="0.35"
      stroke-width="3.6"
    />
    <circle cx="12" cy="12" r="6.2" fill="none" stroke="#f0343f" stroke-width="1.9" />
  </svg>
);
