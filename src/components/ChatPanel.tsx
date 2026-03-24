import { useState, useRef, useEffect } from "react";
import { useChat } from "../hooks/useChat";
import { ChatMessage } from "./ChatMessage";

export function ChatPanel(): React.JSX.Element {
  const { messages, isConnected, isLoading, error, sendMessage, cancelResponse } =
    useChat();
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

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Claude Chat</h3>
        <span
          className={`chat-status ${isConnected ? "connected" : "disconnected"}`}
        >
          {isConnected ? "Connected" : "Disconnected"}
        </span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask Claude anything about your employees or get help with the app.
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
          placeholder={isConnected ? "Ask Claude..." : "Connecting..."}
          disabled={!isConnected}
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
            disabled={!isConnected || !input.trim()}
            className="chat-send-btn"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
