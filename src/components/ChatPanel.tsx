import { useState, useRef, useEffect } from "react";
import { useChat } from "../hooks/useChat";
import { ChatMessage } from "./ChatMessage";

const SUGGESTIONS = [
  "What's the weather like in Tokyo right now?",
  "Should I bring an umbrella in London this week?",
  "What's the best time to visit Iceland?",
  "How does El Nino affect global weather?",
];

export function ChatPanel(): React.JSX.Element {
  const {
    messages,
    isConnected,
    isInitializing,
    isLoading,
    error,
    sendMessage,
    cancelResponse,
  } = useChat();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput("");
  };

  const handleSuggestion = (text: string) => {
    sendMessage(text);
  };

  return (
    <div className="weather-chat">
      <div className="chat-header">
        <h1>Weather Chatbot</h1>
        <span
          className={`chat-status ${isConnected ? "connected" : "disconnected"}`}
        >
          {isConnected ? "Connected" : "Disconnected"}
        </span>
      </div>

      <div className="chat-messages">
        {isInitializing && (
          <div className="chat-init">
            <div className="chat-spinner" />
            <p>Setting up your weather assistant...</p>
          </div>
        )}

        {!isInitializing && messages.length === 0 && (
          <div className="chat-empty">
            <p className="chat-empty-title">Ask me about the weather!</p>
            <p className="chat-empty-subtitle">Try one of these:</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="chat-suggestion-chip"
                  onClick={() => handleSuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isInitializing
              ? "Setting up..."
              : isConnected
                ? "Ask about the weather..."
                : "Connecting..."
          }
          disabled={!isConnected || isInitializing}
          className="chat-input"
        />
        {isLoading ? (
          <button
            type="button"
            onClick={cancelResponse}
            className="chat-cancel-btn"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!isConnected || isInitializing || !input.trim()}
            className="chat-send-btn"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
