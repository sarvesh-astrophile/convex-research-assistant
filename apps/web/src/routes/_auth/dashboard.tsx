import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { api } from "@convex-research-assistant/backend/convex/_generated/api";
import type { Doc, Id } from "@convex-research-assistant/backend/convex/_generated/dataModel";
import { Bubble, BubbleContent } from "@convex-research-assistant/ui/components/bubble";
import { Button } from "@convex-research-assistant/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@convex-research-assistant/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@convex-research-assistant/ui/components/input-group";
import { Message, MessageContent } from "@convex-research-assistant/ui/components/message";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowUp,
  FileText,
  FlaskConical,
  LoaderCircle,
  MessageSquare,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import UserMenu from "@/components/user-menu";

const dashboardSearchSchema = z.object({
  session: z.string().optional(),
});

export const Route = createFileRoute("/_auth/dashboard")({
  validateSearch: dashboardSearchSchema,
  component: DashboardContent,
});

function DashboardContent() {
  const sessions = useQuery(api.sessions.list);
  const createSession = useMutation(api.sessions.create);
  const renameSession = useMutation(api.sessions.rename);
  const removeSession = useMutation(api.sessions.remove);
  const navigate = Route.useNavigate();
  const { session: selectedSessionId } = Route.useSearch();
  const [isCreating, setIsCreating] = useState(false);

  const selectedSession =
    sessions?.find((session) => session._id === selectedSessionId) ?? sessions?.[0];

  async function handleCreateSession(mode: "chat" | "research" = "chat") {
    setIsCreating(true);
    try {
      const sessionId = await createSession({ mode });
      await navigate({ search: { session: sessionId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a chat.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden bg-[radial-gradient(circle_at_70%_-20%,oklch(0.55_0.16_250/0.12),transparent_42%)] md:grid-cols-[17rem_1fr] md:grid-rows-1">
      <aside className="flex min-h-0 border-b bg-card/70 backdrop-blur md:flex-col md:border-r md:border-b-0">
        <div className="flex w-full items-center justify-between gap-3 border-b p-3 md:p-4">
          <div>
            <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Workspace
            </p>
            <h1 className="mt-1 text-sm font-semibold">Research threads</h1>
          </div>
          <div className="flex gap-1">
            <Button
              size="icon-sm"
              onClick={() => void handleCreateSession("chat")}
              disabled={isCreating}
              aria-label="Create a new chat"
            >
              {isCreating ? <LoaderCircle className="animate-spin" /> : <Plus />}
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => void handleCreateSession("research")}
              disabled={isCreating}
              aria-label="Create a new research session"
              title="New research session"
            >
              <FlaskConical />
            </Button>
          </div>
        </div>

        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto p-2 md:flex-col md:overflow-y-auto">
          {sessions === undefined ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" /> Loading threads
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
              No conversations yet. Start one when you are ready to explore.
            </p>
          ) : (
            sessions.map((session) => (
              <div
                key={session._id}
                className="flex min-w-48 items-center gap-1 border border-transparent text-xs hover:bg-muted md:min-w-0"
              >
                <button
                  type="button"
                  onClick={() => void navigate({ search: { session: session._id } })}
                  aria-current={selectedSession?._id === session._id ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left aria-[current=page]:bg-muted"
                >
                  {session.mode === "research" ? (
                    <FlaskConical className="size-3.5 shrink-0" />
                  ) : (
                    <MessageSquare className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{session.title}</span>
                </button>
                <button
                  type="button"
                  className="px-1"
                  aria-label={`Rename ${session.title}`}
                  onClick={() => {
                    const title = window.prompt("Rename session", session.title);
                    if (title?.trim())
                      void renameSession({ sessionId: session._id, title: title.trim() }).catch(
                        (error: unknown) => toast.error(String(error)),
                      );
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="px-1 text-destructive"
                  aria-label={`Delete ${session.title}`}
                  onClick={() => {
                    if (window.confirm(`Delete ${session.title} and its documents?`))
                      void removeSession({ sessionId: session._id })
                        .then(() => navigate({ search: {} }))
                        .catch((error: unknown) => toast.error(String(error)));
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </nav>

        <div className="hidden items-center justify-between border-t p-3 md:flex">
          <span className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">
            Research assistant
          </span>
          <UserMenu />
        </div>
      </aside>

      <section className="min-h-0 min-w-0">
        {selectedSession ? (
          <ChatSession
            key={selectedSession._id}
            sessionId={selectedSession._id}
            threadId={selectedSession.threadId}
            title={selectedSession.title}
            sessionStatus={selectedSession.status}
            mode={selectedSession.mode}
          />
        ) : (
          <Welcome onCreate={() => void handleCreateSession()} isCreating={isCreating} />
        )}
      </section>
    </main>
  );
}

function Welcome({ onCreate, isCreating }: { onCreate: () => void; isCreating: boolean }) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FlaskConical />
        </EmptyMedia>
        <EmptyTitle>Begin with a question</EmptyTitle>
        <EmptyDescription>
          Create a persistent conversation. Replies stream live and remain here when you return.
        </EmptyDescription>
      </EmptyHeader>
      <Button onClick={onCreate} disabled={isCreating}>
        {isCreating ? <LoaderCircle className="animate-spin" /> : <Plus />}
        New chat
      </Button>
    </Empty>
  );
}

function ChatSession({
  sessionId,
  threadId,
  title,
  sessionStatus,
  mode,
}: {
  sessionId: Id<"researchSessions">;
  threadId: string;
  title: string;
  sessionStatus: Doc<"researchSessions">["status"];
  mode: Doc<"researchSessions">["mode"];
}) {
  const {
    results: messages,
    status,
    loadMore,
  } = useUIMessages(api.chat.listMessages, { threadId }, { initialNumItems: 30, stream: true });
  const sendMessage = useMutation(api.chat.sendMessage).withOptimisticUpdate((store, args) => {
    optimisticallySendMessage(api.chat.listMessages)(store, {
      threadId: args.threadId,
      prompt: args.prompt,
    });
  });
  const sources = useQuery(api.search.listSources, { sessionId });
  const documents = useQuery(api.documents.list, { sessionId });
  const researchRuns = useQuery(api.research.list, { sessionId });
  const budget = useQuery(api.budget.myBudget, { period: new Date().toISOString().slice(0, 7) });
  const uploadUrl = useMutation(api.documents.uploadUrl);
  const attachDocument = useMutation(api.documents.attach);
  const retryDocument = useMutation(api.documents.retry);
  const [isUploading, setIsUploading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const isStreaming = messages.some((message) => message.status === "streaming");
  let latestPromptId: string | undefined;

  async function handleUpload(file: File) {
    if (
      file.type !== "application/pdf" ||
      !file.name.toLowerCase().endsWith(".pdf") ||
      file.size > 25 * 1024 * 1024
    ) {
      toast.error("Select a PDF smaller than 25 MiB.");
      return;
    }
    setIsUploading(true);
    try {
      const url = await uploadUrl({ sessionId });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed.");
      const payload: unknown = await response.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        !("storageId" in payload) ||
        typeof payload.storageId !== "string"
      )
        throw new Error("Upload returned an invalid file ID.");
      await attachDocument({
        sessionId,
        storageId: payload.storageId as Id<"_storage">,
        filename: file.name,
      });
      toast.success("PDF uploaded. Extraction and indexing started.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload PDF.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isSending || isStreaming || sessionStatus === "running") return;

    setPrompt("");
    setIsSending(true);
    try {
      await sendMessage({ sessionId, threadId, prompt: nextPrompt });
    } catch (error) {
      setPrompt(nextPrompt);
      toast.error(error instanceof Error ? error.message : "Could not send the message.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
      <header className="flex items-center justify-between border-b bg-background/70 px-4 py-3 backdrop-blur md:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-[0.65rem] tracking-wide text-muted-foreground uppercase">
            {mode === "research"
              ? "Durable research · Planner → Researchers → Writer → Fact-checker"
              : "Persistent chat · Convex Agent"}
          </p>
          {budget && (
            <p className="text-[0.65rem] text-muted-foreground">
              {budget.period} · ${(budget.spentUsd + budget.reservedUsd).toFixed(3)} / $
              {(budget.capUsd + budget.increaseUsd).toFixed(2)}
            </p>
          )}
        </div>
        {isStreaming && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-foreground" /> Responding
          </span>
        )}
      </header>

      <div className="min-h-0 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-2 border bg-card px-3 py-2 hover:bg-muted">
              {isUploading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {isUploading ? "Uploading…" : "Upload PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={isUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUpload(file);
                  event.target.value = "";
                }}
              />
            </label>
            {documents?.map((doc) => (
              <span
                key={doc._id}
                className="inline-flex max-w-64 items-center gap-1.5 border px-2 py-1.5"
                title={doc.error ?? doc.filename}
              >
                <FileText className="size-3 shrink-0" />
                <span className="truncate">{doc.filename}</span>
                <span
                  className={doc.status === "failed" ? "text-destructive" : "text-muted-foreground"}
                >
                  {doc.status}
                  {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
                </span>
              </span>
            ))}
          </div>
          {documents
            ?.filter((doc) => doc.status === "failed")
            .map((doc) => (
              <p key={doc._id} role="alert" className="text-xs text-destructive">
                {doc.filename}: {doc.error || "PDF processing failed."}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void retryDocument({ documentId: doc._id }).catch((error: unknown) =>
                      toast.error(String(error)),
                    )
                  }
                >
                  Retry PDF
                </Button>
              </p>
            ))}
          {sessionStatus === "failed" && (
            <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              The last response failed. Verify the model configuration, then try your message again.
            </div>
          )}
          {mode === "research" && researchRuns?.[0] && <ResearchTimeline run={researchRuns[0]} />}
          <ReplayPanel sessionId={sessionId} />
          {status === "CanLoadMore" && (
            <Button variant="ghost" size="sm" className="self-center" onClick={() => loadMore(30)}>
              Load earlier messages
            </Button>
          )}
          {messages.length === 0 ? (
            <div className="my-auto flex flex-col items-center py-12 text-center">
              <Sparkles className="mb-4 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">What are you investigating?</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Ask a question or investigate current information with cited web search.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              if (message.role === "user") latestPromptId = message.id;
              const messageSources =
                message.role === "assistant"
                  ? (sources?.filter((source) => source.promptMessageId === latestPromptId) ?? [])
                  : [];
              return <ChatMessage key={message.key} message={message} sources={messageSources} />;
            })
          )}
        </div>
      </div>

      <div className="border-t bg-background/80 p-3 backdrop-blur md:p-5">
        <form onSubmit={(event) => void handleSubmit(event)} className="mx-auto max-w-3xl">
          <InputGroup className="border-border bg-card shadow-sm">
            <InputGroupTextarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              disabled={isSending || isStreaming || sessionStatus === "running"}
              maxLength={20_000}
              rows={3}
              placeholder={
                sessionStatus === "running"
                  ? "Research is running..."
                  : "Ask the research assistant..."
              }
              aria-label="Message"
            />
            <InputGroupAddon align="block-end" className="justify-between">
              <span>Enter to send · Shift+Enter for a new line</span>
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                disabled={!prompt.trim() || isSending || isStreaming || sessionStatus === "running"}
                aria-label="Send message"
              >
                {isSending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </div>
  );
}

function ReplayPanel({ sessionId }: { sessionId: Id<"researchSessions"> }) {
  const requests = useQuery(api.replay.myRequests);
  const models = useQuery(api.replay.comparisonModels);
  const compare = useAction(api.replay.compare);
  const [requestId, setRequestId] = useState("");
  const [modelId, setModelId] = useState("");
  const [comparison, setComparison] = useState<{
    text: string;
    costUsd: number;
    latencyMs: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  if (!models?.length || !requests?.length) return null;
  return (
    <details className="border bg-card p-3 text-xs">
      <summary className="cursor-pointer font-semibold">
        Compare a recorded request with another model
      </summary>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setLoading(true);
          try {
            setComparison(await compare({ sessionId, requestId, modelId }));
          } catch (error) {
            toast.error(String(error));
          } finally {
            setLoading(false);
          }
        }}
      >
        <select
          aria-label="Recorded request"
          className="border bg-background p-2"
          value={requestId}
          onChange={(event) => setRequestId(event.target.value)}
          required
        >
          <option value="">Choose a request</option>
          {requests.map((request) => (
            <option key={request._id} value={request._id}>
              {request.model} · {new Date(request._creationTime).toLocaleString()}
            </option>
          ))}
        </select>
        <select
          aria-label="Comparison model"
          className="border bg-background p-2"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          required
        >
          <option value="">Choose a model</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={loading}>
          Replay and compare
        </Button>
      </form>
      {comparison && (
        <div className="mt-3">
          <p>
            Cost ${comparison.costUsd.toFixed(4)} · {comparison.latencyMs}ms
          </p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap">{comparison.text}</pre>
        </div>
      )}
    </details>
  );
}

function ResearchTimeline({ run }: { run: Doc<"researchRuns"> }) {
  const artifacts = useQuery(api.research.artifacts, { runId: run._id });
  const cancelRun = useMutation(api.research.cancelRun);
  const retryRun = useMutation(api.research.retryRun);
  const phases = ["planning", "researching", "writing", "verifying", "completed"];
  const currentIndex = run.status === "pending" ? -1 : phases.indexOf(run.status);
  return (
    <details className="border bg-card p-3 text-xs" open={run.status !== "completed"}>
      <summary className="cursor-pointer font-semibold">Research · {run.status}</summary>
      <ol className="mt-3 grid gap-2 sm:grid-cols-5">
        {phases.map((phase, index) => (
          <li
            key={phase}
            className={index <= currentIndex ? "text-foreground" : "text-muted-foreground"}
          >
            {index < currentIndex || run.status === "completed" ? "✓ " : "○ "}
            {phase}
          </li>
        ))}
      </ol>
      {run.error && (
        <p role="alert" className="mt-2 text-destructive">
          {run.error}
        </p>
      )}
      {artifacts?.map((artifact) => (
        <details key={artifact._id} className="mt-2 border-t pt-2">
          <summary className="cursor-pointer font-medium">{artifact.kind}</summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(artifact.payload, null, 2)}
          </pre>
        </details>
      ))}
      {!["completed", "failed", "cancelled"].includes(run.status) && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() =>
            void cancelRun({ runId: run._id }).catch((error: unknown) => toast.error(String(error)))
          }
        >
          Cancel run
        </Button>
      )}
      {run.status === "failed" && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() =>
            void retryRun({ runId: run._id }).catch((error: unknown) => toast.error(String(error)))
          }
        >
          Retry run
        </Button>
      )}
    </details>
  );
}

function ChatMessage({ message, sources }: { message: UIMessage; sources: Doc<"sources">[] }) {
  const isUser = message.role === "user";
  const [visibleText] = useSmoothText(message.text, {
    startStreaming: message.status === "streaming",
  });

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <Bubble align={isUser ? "end" : "start"} variant={isUser ? "secondary" : "ghost"}>
          <BubbleContent className="max-w-2xl whitespace-pre-wrap text-sm leading-6">
            {visibleText || (message.status === "streaming" ? "Thinking..." : "")}
          </BubbleContent>
        </Bubble>
        {sources.length > 0 && message.status !== "streaming" && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="Sources">
            {sources.map((source) =>
              source.url ? (
                <a
                  key={source._id}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border bg-card p-3 text-xs hover:bg-muted"
                >
                  <strong className="block truncate">
                    [{source.index}] {source.title}
                  </strong>
                  <span className="mt-1 block line-clamp-2 text-muted-foreground">
                    {source.snippet}
                  </span>
                </a>
              ) : (
                <div key={source._id} className="border bg-card p-3 text-xs">
                  <strong className="block truncate">
                    [{source.index}] {source.title} · p. {source.pageStart}
                    {source.pageEnd !== source.pageStart ? `–${source.pageEnd}` : ""}
                  </strong>
                  <span className="mt-1 block line-clamp-2 text-muted-foreground">
                    {source.snippet}
                  </span>
                </div>
              ),
            )}
          </div>
        )}
        {message.status === "failed" && (
          <p className="text-xs text-destructive">
            This response failed. Try sending your message again.
          </p>
        )}
      </MessageContent>
    </Message>
  );
}
