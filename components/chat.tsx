"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { ChatHeader } from "@/components/chat-header";
import { SparklesIcon } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import type { Vote } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { cn, fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "./artifact";
import { ChatSideContainer } from "./chat-side-container";
import { useDataStream } from "./data-stream-provider";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "./toast";
import type { VisibilityType } from "./visibility-selector";

function WelcomeSection() {
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? "";
  const userName = userEmail.split("@")[0] || "there";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Top Bar with Relay */}
      <div className="mb-6 border-b border-border pb-4">
        <div className="flex items-center justify-center gap-2">
          <h1 className="bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text font-bold text-4xl tracking-tight text-transparent drop-shadow-sm">
            Relay
          </h1>
        </div>
      </div>

      {/* Welcome Message */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <SparklesIcon size={20} />
          <h2 className="font-semibold text-2xl text-foreground">
            Hey {userName.charAt(0).toUpperCase() + userName.slice(1)}!
          </h2>
        </div>
        <p className="text-muted-foreground text-lg">
          Here are some interesting stories for you today.
        </p>
      </div>

      {/* Static Introductory Text */}
      <div className="rounded-lg border border-border bg-muted/30 p-6">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Welcome to Relay! This is where you'll discover personalized content
          tailored to your interests. We're working on bringing you the latest
          stories and insights that matter most to you. Stay tuned for updates as
          we continue to build out this experience.
        </p>
      </div>
    </div>
  );
}

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
  initialLastContext?: AppUsage;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>("");
  const [usage, setUsage] = useState<AppUsage | undefined>(initialLastContext);
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      if (dataPart.type === "data-usage") {
        setUsage(dataPart.data);
      }
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        // Check if it's a credit card error
        if (
          error.message?.includes("AI Gateway requires a valid credit card")
        ) {
          setShowCreditCardAlert(true);
        } else {
          toast({
            type: "error",
            description: error.message,
          });
        }
      }
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Vote[]>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher
  );

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const [isChatMinimized, setIsChatMinimized] = useState(false);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          selectedVisibilityType={initialVisibilityType}
        />

        {/* Main content area - available for other purposes */}
        <div
          className={cn(
            "flex-1 overflow-auto transition-[padding] duration-300 ease-in-out",
            isChatMinimized ? "pr-[3rem]" : "pr-[28rem]"
          )}
        >
          {/* Welcome Section */}
          <WelcomeSection />
        </div>
      </div>

      {/* Chat Side Container */}
      <ChatSideContainer
        attachments={attachments}
        chatId={id}
        input={input}
        isArtifactVisible={isArtifactVisible}
        isMinimized={isChatMinimized}
        isReadonly={isReadonly}
        messages={messages}
        onMinimizedChange={setIsChatMinimized}
        onModelChange={setCurrentModelId}
        regenerate={regenerate}
        selectedModelId={currentModelId}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        status={status}
        stop={stop}
        usage={usage}
        votes={votes}
      />

      <Artifact
        attachments={attachments}
        chatId={id}
        input={input}
        isReadonly={isReadonly}
        messages={messages}
        regenerate={regenerate}
        selectedModelId={currentModelId}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        status={status}
        stop={stop}
        votes={votes}
      />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open(
                  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                  "_blank"
                );
                window.location.href = "/";
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
