"use client";

import type { DataUIPart } from "ai";
import type React from "react";
import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { CustomUIDataTypes } from "@/lib/types";

type DataPart = DataUIPart<CustomUIDataTypes>;
type DataPartListener = (parts: DataPart[], errorMessage?: string) => void;

type DataStreamContextValue = {
  appendDataPart: (part: DataPart) => void;
  flushDataParts: () => void;
  failDataStream: (errorMessage: string) => void;
  subscribeDataParts: (listener: DataPartListener) => () => void;
};

const DataStreamContext = createContext<DataStreamContextValue | null>(null);

export function DataStreamProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queueRef = useRef<DataPart[]>([]);
  const listenersRef = useRef(new Set<DataPartListener>());
  const frameRef = useRef<number | null>(null);
  const pendingErrorRef = useRef<string>();

  const flushDataParts = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (listenersRef.current.size === 0) {
      return;
    }

    const parts = queueRef.current;
    const errorMessage = pendingErrorRef.current;
    if (parts.length === 0 && !errorMessage) {
      return;
    }

    queueRef.current = [];
    pendingErrorRef.current = undefined;
    for (const listener of listenersRef.current) {
      listener(parts, errorMessage);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        flushDataParts();
      });
    }
  }, [flushDataParts]);

  const appendDataPart = useCallback(
    (part: DataPart) => {
      queueRef.current.push(part);
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const failDataStream = useCallback(
    (errorMessage: string) => {
      pendingErrorRef.current = errorMessage;
      flushDataParts();
    },
    [flushDataParts]
  );

  const subscribeDataParts = useCallback(
    (listener: DataPartListener) => {
      listenersRef.current.add(listener);
      if (queueRef.current.length > 0 || pendingErrorRef.current) {
        scheduleFlush();
      }
      return () => listenersRef.current.delete(listener);
    },
    [scheduleFlush]
  );

  const value = useMemo(
    () => ({
      appendDataPart,
      flushDataParts,
      failDataStream,
      subscribeDataParts,
    }),
    [appendDataPart, failDataStream, flushDataParts, subscribeDataParts]
  );

  return (
    <DataStreamContext.Provider value={value}>
      {children}
    </DataStreamContext.Provider>
  );
}

export function useDataStream() {
  const context = useContext(DataStreamContext);
  if (!context) {
    throw new Error("useDataStream must be used within a DataStreamProvider");
  }
  return context;
}
