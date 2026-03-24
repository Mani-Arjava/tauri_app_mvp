import type { ChatMessage as ChatMessageType } from "../types/chat";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps): React.JSX.Element {
  return (
    <div className={`chat-message chat-message-${message.role}`}>
      <div className="chat-message-header">
        <span className="chat-message-role">
          {message.role === "user" ? "You" : "Claude"}
        </span>
        <span className="chat-message-time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="chat-message-content">
        {message.content}
        {message.isStreaming && <span className="chat-cursor">|</span>}
      </div>
    </div>
  );
}
