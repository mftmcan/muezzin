import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
  variant?: 'gold' | 'white' | 'navy' | 'dynamic';
  glowColor?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 40, className = '', variant = 'gold', glowColor }) => {
  const colors: Record<string, string[]> = {
    gold: ['#CC9D42', '#B08935'],
    white: ['#FFFFFF', '#F5F5F7'],
    navy: ['#1B3A5C', '#0D1B2A'],
    dynamic: ['currentColor', 'currentColor'],
  };

  const selectedColors = colors[variant] || colors.gold;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-[var(--spatial-shadow)] ${className}`}
    >
      <defs>
        <linearGradient id={`logoGrad-${variant}`} x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop stopColor={selectedColors[0]} />
          <stop offset="1" stopColor={selectedColors[1]} />
        </linearGradient>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="20" result="blur" />
          <feFlood floodColor={glowColor || selectedColors[0]} floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="glow" />
          <feComposite in="SourceGraphic" in2="glow" operator="over" />
        </filter>
      </defs>

      {/* Glow Effect Layer */}
      {glowColor && (
        <path
          d="M120 400V240C120 170 180 120 256 120C332 120 392 170 392 240V400"
          stroke={glowColor}
          strokeWidth="60"
          strokeLinecap="round"
          fill="none"
          opacity="0.15"
          filter="blur(30px)"
        />
      )}

      {/* Mihrap / M Symbol */}
      <path
        d="M120 400V240C120 170 180 120 256 120C332 120 392 170 392 240V400"
        stroke={`url(#logoGrad-${variant})`}
        strokeWidth="42"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M256 400V260" stroke={`url(#logoGrad-${variant})`} strokeWidth="42" strokeLinecap="round" />

      {/* Decorative Dot / Crescent accent */}
      <circle cx="256" cy="185" r="20" fill={`url(#logoGrad-${variant})`} />

      {/* Subtle Bottom Bar */}
      <path d="M160 440H352" stroke={`url(#logoGrad-${variant})`} strokeWidth="8" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
};
