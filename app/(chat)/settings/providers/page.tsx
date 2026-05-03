"use client";

import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ProviderForm } from "./provider-form";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Model = {
  id: string;
  modelId: string;
  displayName: string;
  isEnabled: boolean;
};

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  format: "openai" | "anthropic" | "alibaba";
  isEnabled: boolean;
  modelCount: number;
  models: Model[];
};

export default function ProvidersPage() {
  const { data: providers, mutate } = useSWR<Provider[]>(
    "/api/settings/providers",
    fetcher
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/settings/providers/${id}`, { method: "DELETE" });
      await mutate();
      toast({ type: "success", description: "Provider deleted" });
    } catch {
      toast({ type: "error", description: "Failed to delete provider" });
    }
  }

  if (creating) {
    return (
      <ProviderForm
        onCancel={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          mutate();
        }}
      />
    );
  }

  if (editingId) {
    const provider = providers?.find((p) => p.id === editingId);
    if (provider) {
      return (
        <ProviderForm
          onCancel={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            mutate();
          }}
          provider={provider}
        />
      );
    }
  }

  return (
    <div className="max-w-xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">Providers</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage custom AI providers and models.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="mr-1 size-4" />
          Add Provider
        </Button>
      </div>

      {!providers || providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No custom providers yet. Add one to use your own API keys and
            models.
          </p>
          <Button
            className="mt-4"
            onClick={() => setCreating(true)}
            size="sm"
            variant="outline"
          >
            <Plus className="mr-1 size-4" />
            Add Provider
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          {providers.map((provider) => {
            return (
              // biome-ignore lint/a11y/useSemanticElements: can't use <button> due to nested interactive children
              <div
                className="group flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent"
                key={provider.id}
                onClick={() => setEditingId(provider.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setEditingId(provider.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{provider.name}</p>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                        {provider.format}
                      </span>
                      {!provider.isEnabled && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {provider.modelCount} model
                      {provider.modelCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(provider.id);
                    }}
                    type="button"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
