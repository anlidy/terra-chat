"use client";

import { XIcon } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect } from "react";

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: overlay click-to-close is standard lightbox UX
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape key handled via document listener
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      role="dialog"
    >
      <button
        aria-label="Close lightbox"
        className="absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-5" />
      </button>
      <Image
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] object-contain"
        height={1440}
        onClick={(e) => e.stopPropagation()}
        src={src}
        unoptimized
        width={1920}
      />
    </div>
  );
}
