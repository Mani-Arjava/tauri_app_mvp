import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage } from "../types/chat";
import { generateId } from "../utils/id";

interface ChatChunkPayload {
  text: string;
  done: boolean;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize ACP connection on mount
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        await invoke("acp_initialize");
        if (!cancelled) setIsConnected(true);
      } catch (e) {
        if (!cancelled) {
          setError(
            `Could not connect to Claude. Either set ANTHROPIC_API_KEY in src-tauri/.env, or install Claude Code CLI and run 'claude login'. Error: ${e}`
          );
        }
      }
    };
    init();

    return () => {
      cancelled = true;
      invoke("acp_shutdown").catch(() => {});
    };
  }, []);

  // Listen for streaming message chunks
  useEffect(() => {
    const unlisten = listen<ChatChunkPayload>(
      "acp:message-chunk",
      (event) => {
        const { text, done } = event.payload;

        if (done) {
          // Mark the current streaming message as complete
          setMessages((prev) =>
            prev.map((msg) =>
              msg.isStreaming ? { ...msg, isStreaming: false } : msg
            )
          );
          setIsLoading(false);
          return;
        }

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.isStreaming) {
            // Append to existing streaming message
            return prev.map((msg, i) =>
              i === prev.length - 1
                ? { ...msg, content: msg.content + text }
                : msg
            );
          } else {
            // Start new assistant message
            return [
              ...prev,
              {
                id: generateId(),
                role: "assistant",
                content: text,
                timestamp: new Date().toISOString(),
                isStreaming: true,
              },
            ];
          }
        });
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for disconnection
  useEffect(() => {
    const unlisten = listen("acp:disconnected", () => {
      setIsConnected(false);
      setIsLoading(false);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!isConnected || isLoading) return;

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
        isStreaming: false,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      try {
        await invoke("acp_send_prompt", { message: text });
      } catch (e) {
        setError(`Failed to send message: ${e}`);
        setIsLoading(false);
      }
    },
    [isConnected, isLoading]
  );

  const cancelResponse = useCallback(async () => {
    try {
      await invoke("acp_cancel");
      setMessages((prev) =>
        prev.map((msg) =>
          msg.isStreaming ? { ...msg, isStreaming: false } : msg
        )
      );
      setIsLoading(false);
    } catch (_) {
      // Ignore cancel errors
    }
  }, []);

  return {
    messages,
    isConnected,
    isLoading,
    error,
    sendMessage,
    cancelResponse,
  };
}
