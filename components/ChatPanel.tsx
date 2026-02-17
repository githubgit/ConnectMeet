import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, User } from '../types';
import { Send, Bot, Sparkles, X } from 'lucide-react';
import { Button } from './Button';
import { generateMeetingSummary, askAiAssistant } from '../services/geminiService';

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUser: User;
  onSendMessage: (text: string, isAiQuery?: boolean) => void;
  onClose: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ messages, currentUser, onSendMessage, onClose }) => {
  const [inputValue, setInputValue] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    onSendMessage(inputValue);
    setInputValue('');
  };

  const handleAiSummary = async () => {
    setIsAiLoading(true);
    // Simulate system message
    onSendMessage("Generating meeting summary...", true); // true for 'isAiQuery' simply to skip normal processing if needed, though here we just display it
    
    const summary = await generateMeetingSummary(messages);
    onSendMessage(summary, true); // true acts as "from AI" logic in parent if needed, or we handle it here
    setIsAiLoading(false);
  };

  const handleAiQuery = async () => {
    if (!inputValue.trim()) return;
    const query = inputValue;
    setInputValue('');
    onSendMessage(query); // User's question
    
    setIsAiLoading(true);
    const answer = await askAiAssistant(query, messages);
    onSendMessage(answer, true); // AI's answer
    setIsAiLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 w-full md:w-80 shadow-2xl z-20">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-850">
        <h2 className="font-semibold text-white">In-Call Messages</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={20} />
        </button>
      </div>

      {/* AI Tools */}
      <div className="p-3 bg-gray-850 border-b border-gray-800 grid grid-cols-2 gap-2">
        <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleAiSummary}
            disabled={isAiLoading}
            className="flex items-center gap-2 text-xs"
        >
          <Sparkles size={14} className="text-purple-400" />
          Summary
        </Button>
         <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => setInputValue('@gemini ')}
            disabled={isAiLoading}
            className="flex items-center gap-2 text-xs"
        >
          <Bot size={14} className="text-blue-400" />
          Ask AI
        </Button>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {messages.map((msg) => {
          const isMe = msg.senderId === currentUser.id;
          const isAi = msg.senderName === 'Gemini AI';
          const isSystem = msg.isSystem;

          if (isSystem) {
             return (
                 <div key={msg.id} className="flex justify-center my-2">
                     <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">{msg.text}</span>
                 </div>
             )
          }

          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-medium ${isAi ? 'text-blue-400 flex items-center gap-1' : 'text-gray-400'}`}>
                    {isAi && <Sparkles size={10} />}
                    {msg.senderName}
                </span>
                <span className="text-[10px] text-gray-600">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div 
                className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed ${
                  isMe 
                    ? 'bg-primary-600 text-white rounded-br-none' 
                    : isAi 
                        ? 'bg-gray-800 border border-blue-500/30 text-gray-200 rounded-bl-none shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                        : 'bg-gray-800 text-gray-200 rounded-bl-none'
                }`}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-800 bg-gray-850">
        <div className="relative flex items-center">
            <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    if (inputValue.startsWith('@gemini')) handleAiQuery();
                    else handleSend();
                }
            }}
            placeholder={isAiLoading ? "AI is thinking..." : "Send a message..."}
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-full pl-4 pr-12 py-3 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 placeholder-gray-500"
            disabled={isAiLoading}
            />
            <button 
                onClick={inputValue.startsWith('@gemini') ? handleAiQuery : handleSend}
                disabled={!inputValue.trim() || isAiLoading}
                className="absolute right-2 p-1.5 bg-primary-600 rounded-full text-white hover:bg-primary-500 disabled:opacity-50 disabled:bg-gray-700 transition-colors"
            >
                {inputValue.startsWith('@gemini') ? <Sparkles size={16} /> : <Send size={16} />}
            </button>
        </div>
        <div className="mt-2 text-[10px] text-gray-500 text-center">
            Use "@gemini" to ask the AI assistant directly.
        </div>
      </div>
    </div>
  );
};
