import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { Send, X, Bot, User, Clock, MoreHorizontal } from 'lucide-react';
import { Button } from './Button';
import { askAiAssistant, generateMeetingSummary } from '../services/geminiService';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, isAiQuery?: boolean) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ messages, onSendMessage, isOpen, onClose }) => {
  const [inputText, setInputText] = useState('');
  const [isAiMode, setIsAiMode] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    onSendMessage(inputText, isAiMode);
    setInputText('');
  };

  const handleGenerateSummary = async () => {
    setIsGeneratingSummary(true);
    const summary = await generateMeetingSummary(messages);
    onSendMessage(`Meeting Summary:\n${summary}`, true); // Send as AI message
    setIsGeneratingSummary(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-96 bg-gray-900 border-l border-gray-800 shadow-2xl transform transition-transform duration-300 z-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/95 backdrop-blur">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          Messages
          <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-400">{messages.length}</span>
        </h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X size={20} />
        </Button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2 opacity-50">
            <div className="p-4 bg-gray-800 rounded-full">
              <MoreHorizontal size={32} />
            </div>
            <p>No messages yet</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.senderId === 'local' ? 'items-end' : 'items-start'}`}>
              <div className={`flex items-end gap-2 max-w-[85%] ${msg.senderId === 'local' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.isAi ? 'bg-purple-600' : 'bg-gray-700'}`}>
                  {msg.isAi ? <Bot size={16} /> : <User size={16} />}
                </div>
                <div className={`rounded-2xl px-4 py-2.5 ${
                  msg.isAi 
                    ? 'bg-purple-900/30 border border-purple-700/50 text-purple-100' 
                    : msg.senderId === 'local'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-800 text-gray-200'
                }`}>
                  <div className="flex items-center gap-2 mb-1 opacity-70 text-xs">
                    <span className="font-medium">{msg.senderName}</span>
                    <span>•</span>
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* AI Actions */}
      <div className="px-4 py-2 bg-gray-900/50 border-t border-gray-800 flex gap-2 overflow-x-auto">
        <Button 
          variant="secondary" 
          size="sm" 
          className="whitespace-nowrap text-xs"
          onClick={handleGenerateSummary}
          disabled={isGeneratingSummary || messages.length < 2}
        >
          {isGeneratingSummary ? 'Generating...' : '✨ Summarize Meeting'}
        </Button>
        <Button 
          variant={isAiMode ? 'primary' : 'secondary'} 
          size="sm" 
          className="whitespace-nowrap text-xs opacity-50 cursor-not-allowed"
          onClick={() => {}}
          disabled={true}
          title="Ask AI is currently disabled"
        >
          <Bot size={14} className="mr-1.5" />
          Ask AI (Disabled)
        </Button>
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-4 bg-gray-900 border-t border-gray-800">
        <div className={`relative flex items-center bg-gray-800 rounded-xl border transition-colors ${isAiMode ? 'border-purple-500/50 ring-1 ring-purple-500/20' : 'border-gray-700 focus-within:border-primary-500'}`}>
          <input
            id="chat-input"
            name="message"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={isAiMode ? "Ask Gemini AI..." : "Type a message..."}
            className="flex-1 bg-transparent border-none focus:ring-0 text-white px-4 py-3 placeholder-gray-500"
          />
          <Button 
            type="submit" 
            variant="ghost" 
            size="icon" 
            className={`mr-1 ${isAiMode ? 'text-purple-400 hover:text-purple-300' : 'text-primary-400 hover:text-primary-300'}`}
            disabled={!inputText.trim()}
          >
            <Send size={18} />
          </Button>
        </div>
        {isAiMode && (
          <p className="text-xs text-purple-400 mt-2 ml-1 flex items-center gap-1">
            <Bot size={10} />
            AI Mode active: Your message will be sent to Gemini
          </p>
        )}
      </form>
    </div>
  );
};
