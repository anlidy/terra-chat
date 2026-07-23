import cn from "classnames";
import type { UIArtifact } from "./artifact";
import { LoaderIcon } from "./icons";

type ImageEditorProps = {
  title: string;
  content: string;
  isCurrentVersion: boolean;
  currentVersionIndex: number;
  status: UIArtifact["status"];
  isInline: boolean;
};

export function ImageEditor({
  title,
  content,
  status,
  isInline,
}: ImageEditorProps) {
  return (
    <div
      className={cn("flex w-full flex-row items-center justify-center", {
        "h-[calc(100dvh-60px)]": !isInline,
        "h-[200px]": isInline,
      })}
      data-testid={status === "idle" ? undefined : "artifact-streaming-preview"}
    >
      {content ? (
        <picture>
          <img
            alt={title}
            className={cn("h-fit w-full max-w-[800px]", {
              "p-0 md:p-20": !isInline,
            })}
            src={`data:image/png;base64,${content}`}
          />
        </picture>
      ) : status === "streaming" ? (
        <div className="flex flex-row items-center gap-4">
          {!isInline && (
            <div className="animate-spin">
              <LoaderIcon />
            </div>
          )}
          <div>Generating Image...</div>
        </div>
      ) : (
        <div className="text-destructive">Image generation interrupted</div>
      )}
    </div>
  );
}
