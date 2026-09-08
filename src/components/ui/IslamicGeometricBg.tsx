import React from 'react';

/**
 * IslamicGeometricBg — Optimized version.
 * Reduces GPU load by animating the whole SVG instead of 30+ individual groups.
 */
export const IslamicGeometricBg = React.memo(() => {
  return (
    <div className="absolute inset-0 z-0 opacity-10 pointer-events-none overflow-hidden">
      <style>
        {`
 @keyframes geo-simple-spin {
 from { transform: rotate(0deg); }
 to { transform: rotate(360deg); }
 }
 .geo-optimized-svg {
 animation: geo-simple-spin 240s linear infinite;
 transform-origin: center;
 }
 `}
      </style>
      <svg width="100%" height="100%" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="geo-optimized-svg">
        <defs>
          <linearGradient id="gold-shimmer" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#F9E29F" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#D4AF37" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Simplified Outer Pattern */}
        {[...Array(12)].map((_, i) => (
          <g key={`outer-${i}`} transform={`rotate(${i * 30} 100 100)`}>
            <path
              d="M100 10 L115 75 L175 90 L115 105 L100 170 L85 105 L25 90 L85 75 Z"
              stroke="url(#gold-shimmer)"
              strokeWidth="0.2"
              fill="transparent"
            />
          </g>
        ))}

        {/* Simplified Grid */}
        <circle cx="100" cy="100" r="70" stroke="rgba(212, 175, 55, 0.05)" strokeWidth="0.1" />
        <circle cx="100" cy="100" r="40" stroke="rgba(212, 175, 55, 0.05)" strokeWidth="0.1" />
      </svg>

      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--app-bg)]/20 to-[var(--app-bg)]" />
    </div>
  );
});
