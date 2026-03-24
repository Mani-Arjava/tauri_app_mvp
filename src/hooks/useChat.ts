import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage } from "../types/chat";
import { generateId } from "../utils/id";

const SYSTEM_PROMPT = `You are a friendly weather assistant chatbot. You MUST NOT inspect files, run code, use tools, or discuss application internals. You are NOT a coding assistant.

Your expertise is weather, climate, and atmospheric conditions around the world. When asked about weather:
- Provide helpful, conversational responses about weather conditions, forecasts, and climate
- Share interesting weather facts and tips
- If you don't have real-time data, say so and offer general climate info for the location and time of year
- Keep responses concise and easy to read`;

const ROLE_CONTEXT = `[ROLE: You are a weather chatbot. Do NOT inspect code, use tools, or discuss this application. Answer the user's question about weather, climate, or atmospheric conditions conversationally. If you don't have real-time data, provide general climate info for the location and time of year.]`;

interface ChatChunkPayload {
  text: string;
  done: boolean;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const systemPromptDone = useRef(false);
  const swallowingSystemResponse = useRef(false);

  // Initialize ACP connection + send system prompt on mount
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        await invoke("acp_initialize");
        if (cancelled) return;
        setIsConnected(true);

        // Send system prompt silently
        swallowingSystemResponse.current = true;
        await invoke("acp_send_prompt", { message: SYSTEM_PROMPT });
        if (cancelled) return;
        systemPromptDone.current = true;
        swallowingSystemResponse.current = false;
        setIsInitializing(false);
      } catch (e) {
        if (!cancelled) {
          setError(
            `Could not connect to Claude. Either set ANTHROPIC_API_KEY in src-tauri/.env, or install Claude Code CLI and run 'claude login'. Error: ${e}`
          );
          setIsInitializing(false);
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
        // Swallow chunks from the system prompt response
        if (swallowingSystemResponse.current) return;

        const { text, done } = event.payload;

        if (done) {
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
            return prev.map((msg, i) =>
              i === prev.length - 1
                ? { ...msg, content: msg.content + text }
                : msg
            );
          } else {
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
      if (!isConnected || isLoading || isInitializing) return;

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
        await invoke("acp_send_prompt", { message: ROLE_CONTEXT + "\n\n" + text });
      } catch (e) {
        setError(`Failed to send message: ${e}`);
        setIsLoading(false);
      }
    },
    [isConnected, isLoading, isInitializing]
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
    isInitializing,
    isLoading,
    error,
    sendMessage,
    cancelResponse,
  };
}
