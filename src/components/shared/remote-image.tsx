import { cn } from '@/lib/utils';

/**
 * Remote image from an arbitrary, untrusted host (WhatsApp/Twilio CDN
 * avatars, inbound message media, …).
 *
 * next/image requires every remote host to be allow-listed in
 * next.config, which is impossible for user-generated media URLs — so
 * this is the single, documented place where a plain <img> is allowed.
 * Every dynamic-media call site must use this component instead of
 * scattering ad-hoc <img> tags (static local brand art should use
 * BrandIcon / next/image instead).
 */
export function RemoteImage({
  src,
  alt,
  className,
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  onError?: () => void;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts can't be allow-listed for next/image
    <img
      src={src || '/placeholder.svg'}
      alt={alt}
      className={cn(className)}
      onError={onError}
    />
  );
}
