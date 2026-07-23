"use client";

import equal from "fast-deep-equal";
import Image from "next/image";
import {
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import useSWR from "swr";
import { useArtifact } from "@/hooks/use-artifact";
import type { Document } from "@/lib/db/schema";
import { cn, fetcher } from "@/lib/utils";
import type { ArtifactKind, UIArtifact } from "./artifact";
import { DocumentToolCall, DocumentToolResult } from "./document";
import { InlineDocumentSkeleton } from "./document-skeleton";
import { Response } from "./elements/response";
import { FileIcon, FullscreenIcon, ImageIcon, LoaderIcon } from "./icons";

type DocumentPreviewProps = {
  isReadonly: boolean;
  result?: any;
  args?: any;
};

export function DocumentPreview({
  isReadonly,
  result,
  args,
}: DocumentPreviewProps) {
  const { artifact, setArtifact } = useArtifact();

  const { data: documents, isLoading: isDocumentsFetching } = useSWR<
    Document[]
  >(result ? `/api/document?id=${result.id}` : null, fetcher);

  const previewDocument = useMemo(() => documents?.[0], [documents]);
  const hitboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const boundingBox = hitboxRef.current?.getBoundingClientRect();

    if (artifact.documentId && boundingBox) {
      setArtifact((currentArtifact) => ({
        ...currentArtifact,
        boundingBox: {
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
        },
      }));
    }
  }, [artifact.documentId, setArtifact]);

  if (artifact.isVisible) {
    if (result) {
      return (
        <DocumentToolResult
          isReadonly={isReadonly}
          result={{ id: result.id, title: result.title, kind: result.kind }}
          type="create"
        />
      );
    }

    if (args) {
      return (
        <DocumentToolCall
          args={{ title: args.title, kind: args.kind }}
          isReadonly={isReadonly}
          type="create"
        />
      );
    }
  }

  const isCurrentStream =
    artifact.documentId !== "init" &&
    (!result?.id || artifact.documentId === result.id) &&
    artifact.status !== "idle";
  const document: Document | null = isCurrentStream
    ? {
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content,
        id: artifact.documentId,
        createdAt: new Date(),
        userId: "noop",
      }
    : (previewDocument ?? null);

  if (!document && isDocumentsFetching) {
    return <LoadingSkeleton artifactKind={result?.kind ?? args?.kind} />;
  }

  if (!document) {
    return <LoadingSkeleton artifactKind={artifact.kind} />;
  }

  return (
    <div className="relative w-full max-w-[450px] cursor-pointer">
      <HitboxLayer
        hitboxRef={hitboxRef}
        result={result}
        setArtifact={setArtifact}
      />
      <DocumentHeader
        kind={document.kind}
        status={isCurrentStream ? artifact.status : "idle"}
        title={document.title}
      />
      <DocumentContent
        document={document}
        status={isCurrentStream ? artifact.status : "idle"}
      />
    </div>
  );
}

const LoadingSkeleton = ({ artifactKind }: { artifactKind: ArtifactKind }) => (
  <div className="w-full max-w-[450px]">
    <div className="flex h-[57px] flex-row items-center justify-between gap-2 rounded-t-2xl border border-b-0 p-4 dark:border-zinc-700 dark:bg-muted">
      <div className="flex flex-row items-center gap-3">
        <div className="text-muted-foreground">
          <div className="size-4 animate-pulse rounded-md bg-muted-foreground/20" />
        </div>
        <div className="h-4 w-24 animate-pulse rounded-lg bg-muted-foreground/20" />
      </div>
      <div>
        <FullscreenIcon />
      </div>
    </div>
    {artifactKind === "image" ? (
      <div className="overflow-y-scroll rounded-b-2xl border border-t-0 bg-muted dark:border-zinc-700">
        <div className="h-[257px] w-full animate-pulse bg-muted-foreground/20" />
      </div>
    ) : (
      <div className="overflow-y-scroll rounded-b-2xl border border-t-0 bg-muted p-8 pt-4 dark:border-zinc-700">
        <InlineDocumentSkeleton />
      </div>
    )}
  </div>
);

const PureHitboxLayer = ({
  hitboxRef,
  result,
  setArtifact,
}: {
  hitboxRef: React.RefObject<HTMLDivElement>;
  result: any;
  setArtifact: (
    updaterFn: UIArtifact | ((currentArtifact: UIArtifact) => UIArtifact)
  ) => void;
}) => {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const boundingBox = event.currentTarget.getBoundingClientRect();

      setArtifact((artifact) =>
        artifact.status !== "idle" && artifact.documentId === result?.id
          ? { ...artifact, isVisible: true }
          : {
              ...artifact,
              title: result.title,
              documentId: result.id,
              kind: result.kind,
              content: "",
              errorMessage: undefined,
              hasAutoOpened: false,
              wasDismissed: false,
              isVisible: true,
              boundingBox: {
                left: boundingBox.x,
                top: boundingBox.y,
                width: boundingBox.width,
                height: boundingBox.height,
              },
            }
      );
    },
    [setArtifact, result]
  );

  return (
    <div
      aria-hidden="true"
      className="absolute top-0 left-0 z-10 size-full rounded-xl"
      onClick={handleClick}
      ref={hitboxRef}
      role="presentation"
    >
      <div className="flex w-full items-center justify-end p-4">
        <div className="absolute top-[13px] right-[9px] rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700">
          <FullscreenIcon />
        </div>
      </div>
    </div>
  );
};

const HitboxLayer = memo(PureHitboxLayer, (prevProps, nextProps) => {
  if (!equal(prevProps.result, nextProps.result)) {
    return false;
  }
  return true;
});

const PureDocumentHeader = ({
  title,
  kind,
  status,
}: {
  title: string;
  kind: ArtifactKind;
  status: UIArtifact["status"];
}) => (
  <div className="flex flex-row items-start justify-between gap-2 rounded-t-2xl border border-b-0 p-4 sm:items-center dark:border-zinc-700 dark:bg-muted">
    <div className="flex flex-row items-start gap-3 sm:items-center">
      <div className="text-muted-foreground">
        {status === "streaming" ? (
          <div className="animate-spin">
            <LoaderIcon />
          </div>
        ) : kind === "image" ? (
          <ImageIcon />
        ) : (
          <FileIcon />
        )}
      </div>
      <div className="-translate-y-1 sm:translate-y-0">
        <div className="font-medium">{title}</div>
        {status === "error" ? (
          <div className="text-destructive text-xs">Generation interrupted</div>
        ) : null}
      </div>
    </div>
    <div className="w-8" />
  </div>
);

const DocumentHeader = memo(PureDocumentHeader, (prevProps, nextProps) => {
  if (prevProps.title !== nextProps.title) {
    return false;
  }
  if (prevProps.status !== nextProps.status) {
    return false;
  }

  return true;
});

const DocumentContent = ({
  document,
  status,
}: {
  document: Document;
  status: UIArtifact["status"];
}) => {
  const containerClassName = cn(
    "h-[257px] overflow-y-scroll rounded-b-2xl border border-t-0 dark:border-zinc-700 dark:bg-muted",
    {
      "p-4 sm:px-14 sm:py-16": document.kind === "text",
      "p-0": document.kind === "code",
    }
  );

  return (
    <div className={containerClassName}>
      {document.kind === "text" ? (
        <Response className="prose prose-sm dark:prose-invert" mode="static">
          {document.content ?? ""}
        </Response>
      ) : document.kind === "code" ? (
        <pre className="min-h-full overflow-auto bg-zinc-950 p-4 text-zinc-100 text-xs">
          <code>{document.content ?? ""}</code>
        </pre>
      ) : document.kind === "sheet" ? (
        <pre className="min-h-full overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">
          {document.content ?? ""}
        </pre>
      ) : document.kind === "image" ? (
        document.content ? (
          <Image
            alt={document.title}
            className="h-full w-full object-contain"
            height={257}
            src={`data:image/png;base64,${document.content}`}
            unoptimized
            width={450}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {status === "error"
              ? "Image generation interrupted"
              : "Generating image…"}
          </div>
        )
      ) : null}
    </div>
  );
};
