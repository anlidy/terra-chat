import {
  FileEditIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  PresentationIcon,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { Attachment } from "@/lib/types";
import { Loader } from "./elements/loader";
import { CrossSmallIcon } from "./icons";
import { ImageLightbox } from "./image-lightbox";
import { Button } from "./ui/button";

const fileTypeIconMap: Record<string, React.ReactNode> = {
  "application/pdf": <FileTextIcon className="size-5" />,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
    <FileEditIcon className="size-5" />
  ),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
    <FileSpreadsheetIcon className="size-5" />
  ),
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": (
    <PresentationIcon className="size-5" />
  ),
  "text/plain": <FileTextIcon className="size-5" />,
};

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove,
}: {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
}) => {
  const { name, url, contentType } = attachment;
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <>
      <div
        className="group relative size-16 overflow-hidden rounded-lg border bg-muted"
        data-testid="input-attachment-preview"
      >
        {contentType?.startsWith("image") ? (
          <Image
            alt={name ?? "An image attachment"}
            className="size-full cursor-pointer object-cover"
            height={64}
            onClick={() => setLightboxOpen(true)}
            src={url}
            width={64}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-0.5 text-muted-foreground">
            {fileTypeIconMap[contentType] ?? (
              <FileTextIcon className="size-5" />
            )}
            <span className="text-[10px] font-medium">
              {contentTypeToLabel(contentType)}
            </span>
          </div>
        )}

        {isUploading && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/50"
            data-testid="input-attachment-loader"
          >
            <Loader size={16} />
          </div>
        )}

        {onRemove && !isUploading && (
          <Button
            className="absolute top-0.5 right-0.5 size-4 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={onRemove}
            size="sm"
            variant="destructive"
          >
            <CrossSmallIcon size={8} />
          </Button>
        )}

        <div className="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/80 to-transparent px-1 py-0.5 text-[10px] text-white">
          {name}
        </div>
      </div>

      {lightboxOpen && contentType?.startsWith("image") && url && (
        <ImageLightbox
          alt={name ?? "Image"}
          onClose={() => setLightboxOpen(false)}
          src={url}
        />
      )}
    </>
  );
};

function contentTypeToLabel(contentType: string): string {
  const mapping: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "DOCX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "PPTX",
    "text/plain": "TXT",
  };
  return mapping[contentType] ?? "FILE";
}
