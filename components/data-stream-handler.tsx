"use client";

import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useArtifact } from "@/hooks/use-artifact";
import {
  type ArtifactStreamState,
  reduceArtifactStreamBatch,
} from "@/lib/artifacts/stream-reducer";
import { useDataStream } from "./data-stream-provider";
import { getChatHistoryPaginationKey } from "./sidebar-history";

export function DataStreamHandler() {
  const { subscribeDataParts } = useDataStream();
  const { mutate } = useSWRConfig();
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();
  const stateRef = useRef<ArtifactStreamState>({
    artifact,
    suggestions: metadata?.suggestions ?? [],
  });

  useEffect(() => {
    stateRef.current.artifact = artifact;
    stateRef.current.suggestions = metadata?.suggestions ?? [];
  }, [artifact, metadata]);

  useEffect(
    () =>
      subscribeDataParts((parts, errorMessage) => {
        if (parts.some((part) => part.type === "data-chat-title")) {
          mutate(unstable_serialize(getChatHistoryPaginationKey));
        }

        const previousSuggestions = stateRef.current.suggestions;
        const nextState = reduceArtifactStreamBatch(
          stateRef.current,
          parts,
          errorMessage
        );
        stateRef.current = nextState;
        setArtifact(nextState.artifact);

        if (
          nextState.suggestions !== previousSuggestions ||
          parts.some(
            (part) => part.type === "data-suggestion" || part.type === "data-id"
          )
        ) {
          setMetadata((currentMetadata: Record<string, unknown> | null) => ({
            ...(currentMetadata ?? {}),
            suggestions: nextState.suggestions,
          }));
        }
      }),
    [mutate, setArtifact, setMetadata, subscribeDataParts]
  );

  return null;
}
