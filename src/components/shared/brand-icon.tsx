import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * Local brand/provider icon (SVGs under /public/icons/brands).
 *
 * Central place for rendering static brand marks: uses next/image with
 * fixed dimensions so the linter and layout are both happy, and keeps
 * every call site consistent instead of ad-hoc <img> tags.
 */
export function BrandIcon({
  src,
  alt = '',
  size = 20,
  className,
}: {
  src: string;
  /** Empty for decorative icons (default); set when the icon conveys meaning. */
  alt?: string;
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src={src || '/placeholder.svg'}
      alt={alt}
      width={size}
      height={size}
      className={cn('shrink-0', className)}
    />
  );
}
