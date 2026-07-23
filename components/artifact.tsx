import type { UseChatHelpers } from "@ai-sdk/react";
import { formatDistance } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { useDebounceCallback, useWindowSize } from "usehooks-ts";
import { codeArtifact } from "@/artifacts/code/client";
import { imageArtifact } from "@/artifacts/image/client";
import { sheetArtifact } from "@/artifacts/sheet/client";
import { textArtifact } from "@/artifacts/text/client";
import { useArtifact } from "@/hooks/use-artifact";
import type { Document, Vote } from "@/lib/db/schema";
import type { Attachment, ChatMessage } from "@/lib/types";
import { fetcher } from "@/lib/utils";
import { ArtifactActions } from "./artifact-actions";
import { ArtifactCloseButton } from "./artifact-close-button";
import { ArtifactMessages } from "./artifact-messages";
import { MultimodalInput } from "./multimodal-input";
import { Toolbar } from "./toolbar";
import { Button } from "./ui/button";
import { useSidebar } from "./ui/sidebar";
import { VersionFooter } from "./version-footer";

export const artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact,
];
export type ArtifactKind = (typeof artifactDefinitions)[number]["kind"];

export type UIArtifact = {
  title: string;
  documentId: string;
  kind: ArtifactKind;
  content: string;
  isVisible: boolean;
  status: "streaming" | "idle" | "error";
  errorMessage?: string;
  hasAutoOpened: boolean;
  wasDismissed: boolean;
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
};

function PureArtifact({
  addToolApprovalResponse,
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  sendMessage,
  messages,
  setMessages,
  regenerate,
  votes,
  isReadonly,
  selectedModelId,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  votes: Vote[] | undefined;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  selectedModelId: string;
}) {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();

  const { data: documents, isLoading: isDocumentsFetching } = useSWR<
    Document[]
  >(
    artifact.documentId !== "init" && artifact.status === "idle"
      ? `/api/document?id=${artifact.documentId}`
      : null,
    fetcher
  );

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);

  const { open: isSidebarOpen } = useSidebar();

  useEffect(() => {
    if (artifact.status === "idle" && documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);

      if (mostRecentDocument?.id === artifact.documentId) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);
        setArtifact((currentArtifact) => ({
          ...currentArtifact,
          content: mostRecentDocument.content ?? "",
        }));
      }
    }
  }, [artifact.documentId, artifact.status, documents, setArtifact]);

  const { mutate } = useSWRConfig();
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const activeDocumentIdRef = useRef(artifact.documentId);
  const saveRequestRef = useRef(0);
  const wasVisibleRef = useRef(artifact.isVisible);

  const handleContentChange = useCallback(
    async (updatedContent: string) => {
      const documentId = artifact.documentId;
      if (documentId === "init") {
        return;
      }
      const requestId = ++saveRequestRef.current;
      setSaveState("saving");

      try {
        const response = await fetch(`/api/document?id=${documentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: artifact.title,
            content: updatedContent,
            kind: artifact.kind,
          }),
        });
        if (!response.ok) {
          throw new Error(`Save failed with status ${response.status}`);
        }

        const [savedDocument] = (await response.json()) as Document[];
        if (
          !savedDocument ||
          activeDocumentIdRef.current !== documentId ||
          saveRequestRef.current !== requestId
        ) {
          return;
        }

        setDocument(savedDocument);
        setCurrentVersionIndex((index) => index + 1);
        setSaveState("saved");
        await mutate<Document[]>(
          `/api/document?id=${documentId}`,
          (currentDocuments = []) => [...currentDocuments, savedDocument],
          { revalidate: false }
        );
      } catch (_error) {
        if (
          activeDocumentIdRef.current === documentId &&
          saveRequestRef.current === requestId
        ) {
          setSaveState("error");
        }
      }
    },
    [artifact.documentId, artifact.kind, artifact.title, mutate]
  );

  const debouncedHandleContentChange = useDebounceCallback(
    handleContentChange,
    2000
  );

  const saveContent = useCallback(
    (updatedContent: string, debounce: boolean) => {
      if (document && updatedContent === (document.content ?? "")) {
        return;
      }

      setSaveState("saving");
      if (debounce) {
        debouncedHandleContentChange(updatedContent);
      } else {
        debouncedHandleContentChange.cancel();
        handleContentChange(updatedContent);
      }
    },
    [document, debouncedHandleContentChange, handleContentChange]
  );

  useEffect(() => {
    activeDocumentIdRef.current = artifact.documentId;
    saveRequestRef.current += 1;
    debouncedHandleContentChange.cancel();
    setDocument(null);
    setCurrentVersionIndex(-1);
    setMode("edit");
    setSaveState("idle");

    return () => debouncedHandleContentChange.cancel();
  }, [artifact.documentId, debouncedHandleContentChange]);

  useEffect(() => {
    if (wasVisibleRef.current && !artifact.isVisible) {
      debouncedHandleContentChange.flush();
    }
    wasVisibleRef.current = artifact.isVisible;
  }, [artifact.isVisible, debouncedHandleContentChange]);

  function getDocumentContentById(index: number) {
    if (!documents) {
      return "";
    }
    if (!documents[index]) {
      return "";
    }
    return documents[index].content ?? "";
  }

  const handleVersionChange = (type: "next" | "prev" | "toggle" | "latest") => {
    if (!documents) {
      return;
    }

    if (type === "latest") {
      setCurrentVersionIndex(documents.length - 1);
      setMode("edit");
    }

    if (type === "toggle") {
      setMode((currentMode) => (currentMode === "edit" ? "diff" : "edit"));
    }

    if (type === "prev") {
      if (currentVersionIndex > 0) {
        setCurrentVersionIndex((index) => index - 1);
      }
    } else if (type === "next" && currentVersionIndex < documents.length - 1) {
      setCurrentVersionIndex((index) => index + 1);
    }
  };

  const [isToolbarVisible, setIsToolbarVisible] = useState(false);

  /*
   * NOTE: if there are no documents, or if
   * the documents are being fetched, then
   * we mark it as the current version.
   */

  const isCurrentVersion =
    documents && documents.length > 0
      ? currentVersionIndex === documents.length - 1
      : true;

  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;

  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );

  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }

  useEffect(() => {
    let isActive = true;
    if (artifact.documentId !== "init" && artifactDefinition.initialize) {
      artifactDefinition.initialize({
        documentId: artifact.documentId,
        setMetadata: (value) => {
          if (isActive) {
            setMetadata(value);
          }
        },
      });
    }
    return () => {
      isActive = false;
    };
  }, [artifact.documentId, artifactDefinition, setMetadata]);

  return (
    <AnimatePresence>
      {artifact.isVisible && (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed top-0 left-0 z-50 flex h-dvh w-dvw flex-row bg-transparent"
          data-testid="artifact"
          exit={{ opacity: 0, transition: { duration: 0 } }}
          initial={{ opacity: 1 }}
        >
          {!isMobile && (
            <motion.div
              animate={{ width: windowWidth, right: 0 }}
              className="fixed h-dvh bg-background"
              exit={{
                width: isSidebarOpen ? windowWidth - 256 : windowWidth,
                right: 0,
              }}
              initial={{
                width: isSidebarOpen ? windowWidth - 256 : windowWidth,
                right: 0,
              }}
            />
          )}

          {!isMobile && (
            <motion.div
              animate={{
                opacity: 1,
                x: 0,
                scale: 1,
                transition: {
                  delay: 0.1,
                  type: "spring",
                  stiffness: 300,
                  damping: 30,
                },
              }}
              className="relative h-dvh w-[400px] shrink-0 bg-muted dark:bg-background"
              exit={{
                opacity: 0,
                x: 0,
                scale: 1,
                transition: { duration: 0 },
              }}
              initial={{ opacity: 0, x: 10, scale: 1 }}
            >
              <AnimatePresence>
                {!isCurrentVersion && (
                  <motion.div
                    animate={{ opacity: 1 }}
                    className="absolute top-0 left-0 z-50 h-dvh w-[400px] bg-zinc-900/50"
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                  />
                )}
              </AnimatePresence>

              <div className="flex h-full flex-col items-center justify-between">
                <ArtifactMessages
                  addToolApprovalResponse={addToolApprovalResponse}
                  artifactStatus={artifact.status}
                  chatId={chatId}
                  isReadonly={isReadonly}
                  messages={messages}
                  regenerate={regenerate}
                  setMessages={setMessages}
                  status={status}
                  votes={votes}
                />

                <div className="relative flex w-full flex-row items-end gap-2 px-4 pb-4">
                  <MultimodalInput
                    attachments={attachments}
                    chatId={chatId}
                    className="bg-background dark:bg-muted"
                    input={input}
                    messages={messages}
                    selectedModelId={selectedModelId}
                    sendMessage={sendMessage}
                    setAttachments={setAttachments}
                    setInput={setInput}
                    setMessages={setMessages}
                    status={status}
                    stop={stop}
                  />
                </div>
              </div>
            </motion.div>
          )}

          <motion.div
            animate={
              isMobile
                ? {
                    opacity: 1,
                    x: 0,
                    y: 0,
                    height: windowHeight,
                    width: windowWidth ? windowWidth : "calc(100dvw)",
                    borderRadius: 0,
                    transition: {
                      delay: 0,
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                      duration: 0.8,
                    },
                  }
                : {
                    opacity: 1,
                    x: 400,
                    y: 0,
                    height: windowHeight,
                    width: windowWidth
                      ? windowWidth - 400
                      : "calc(100dvw-400px)",
                    borderRadius: 0,
                    transition: {
                      delay: 0,
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                      duration: 0.8,
                    },
                  }
            }
            className="fixed flex h-dvh flex-col overflow-y-scroll border-zinc-200 bg-background md:border-l dark:border-zinc-700 dark:bg-muted"
            exit={{
              opacity: 0,
              scale: 0.5,
              transition: {
                delay: 0.1,
                type: "spring",
                stiffness: 600,
                damping: 30,
              },
            }}
            initial={
              isMobile
                ? {
                    opacity: 1,
                    x: artifact.boundingBox.left,
                    y: artifact.boundingBox.top,
                    height: artifact.boundingBox.height,
                    width: artifact.boundingBox.width,
                    borderRadius: 50,
                  }
                : {
                    opacity: 1,
                    x: artifact.boundingBox.left,
                    y: artifact.boundingBox.top,
                    height: artifact.boundingBox.height,
                    width: artifact.boundingBox.width,
                    borderRadius: 50,
                  }
            }
          >
            <div className="flex flex-row items-start justify-between p-2">
              <div className="flex flex-row items-start gap-4">
                <ArtifactCloseButton
                  onBeforeClose={debouncedHandleContentChange.flush}
                />

                <div className="flex flex-col">
                  <div className="font-medium">{artifact.title}</div>

                  {artifact.status === "streaming" ? (
                    <div className="text-muted-foreground text-sm">
                      Generating…
                    </div>
                  ) : saveState === "saving" ? (
                    <div className="text-muted-foreground text-sm">Saving…</div>
                  ) : saveState === "error" ? (
                    <div className="text-destructive text-sm">Save failed</div>
                  ) : saveState === "saved" ? (
                    <div className="text-muted-foreground text-sm">Saved</div>
                  ) : document ? (
                    <div className="text-muted-foreground text-sm">
                      {`Updated ${formatDistance(
                        new Date(document.createdAt),
                        new Date(),
                        {
                          addSuffix: true,
                        }
                      )}`}
                    </div>
                  ) : (
                    <div className="mt-2 h-3 w-32 animate-pulse rounded-md bg-muted-foreground/20" />
                  )}
                </div>
              </div>

              <ArtifactActions
                artifact={artifact}
                currentVersionIndex={currentVersionIndex}
                handleVersionChange={handleVersionChange}
                isCurrentVersion={isCurrentVersion}
                metadata={metadata}
                mode={mode}
                setMetadata={setMetadata}
              />
            </div>

            {artifact.status === "error" ? (
              <div
                className="mx-3 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm"
                role="alert"
              >
                <span>
                  {artifact.errorMessage ??
                    "Generation stopped. Partial content was preserved."}
                </span>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      debouncedHandleContentChange.flush();
                      setArtifact((current) => ({
                        ...current,
                        isVisible: false,
                        wasDismissed: true,
                      }));
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={() => {
                      setArtifact((current) => ({
                        ...current,
                        status: "streaming",
                        errorMessage: undefined,
                      }));
                      regenerate();
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="h-full max-w-full! items-center overflow-y-scroll bg-background dark:bg-muted">
              <artifactDefinition.content
                content={
                  isCurrentVersion
                    ? artifact.content
                    : getDocumentContentById(currentVersionIndex)
                }
                currentVersionIndex={currentVersionIndex}
                getDocumentContentById={getDocumentContentById}
                isCurrentVersion={isCurrentVersion}
                isInline={false}
                isLoading={isDocumentsFetching && !artifact.content}
                metadata={metadata}
                mode={mode}
                onSaveContent={saveContent}
                setMetadata={setMetadata}
                status={artifact.status}
                suggestions={[]}
                title={artifact.title}
              />

              <AnimatePresence>
                {isCurrentVersion && (
                  <Toolbar
                    artifactKind={artifact.kind}
                    isToolbarVisible={isToolbarVisible}
                    sendMessage={sendMessage}
                    setIsToolbarVisible={setIsToolbarVisible}
                    setMessages={setMessages}
                    status={status}
                    stop={stop}
                  />
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {!isCurrentVersion && (
                <VersionFooter
                  currentVersionIndex={currentVersionIndex}
                  documents={documents}
                  handleVersionChange={handleVersionChange}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const Artifact = memo(PureArtifact, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.votes !== nextProps.votes) {
    return false;
  }
  if (prevProps.input !== nextProps.input) {
    return false;
  }
  if (prevProps.messages !== nextProps.messages) {
    return false;
  }
  if (prevProps.attachments !== nextProps.attachments) {
    return false;
  }
  if (prevProps.selectedModelId !== nextProps.selectedModelId) {
    return false;
  }
  return true;
});
