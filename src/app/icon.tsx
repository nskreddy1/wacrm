import { ImageResponse } from 'next/og';

// Axon favicon — monochrome geometric "A" signal mark on a dark
// rounded square, matching `src/components/brand/axon-logo.tsx`.
// Next.js renders this at build time and auto-injects
// <link rel="icon"> into <head>.

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#111827', // monochrome charcoal
        borderRadius: 7,
      }}
    >
      <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
        <path
          d="M6 40 L20 12 a4.5 4.5 0 0 1 8 0 L42 40"
          stroke="#ffffff"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15.5 31 H32.5"
          stroke="#ffffff"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx="24" cy="11" r="5" fill="#ffffff" />
      </svg>
    </div>,
    { ...size }
  );
}
