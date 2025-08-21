"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import {
  generateUserId,
  generateRandomColor,
  filterProfanity,
} from "@/lib/utils";
import { postAIResponse, AI_BOT } from "@/lib/aiService.js";

export function useChat(roomId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // AI state
  const [aiEnabled, setAiEnabled] = useState(false);
  const aiEnabledRef = useRef(aiEnabled);
  useEffect(() => {
    aiEnabledRef.current = aiEnabled;
  }, [aiEnabled]);

  // User session
  const [userSession, setUserSession] = useState(() => ({
    id: generateUserId(),
    nickname: "Anonymous",
    color: generateRandomColor(),
    lastMessageTime: 0,
  }));

  // Reply state
  const [replyingTo, setReplyingTo] = useState(null);

  const setReplyMessage = useCallback((message) => {
    setReplyingTo(message);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  // Scroll handling
  const messagesEndRef = useRef(null);
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Update nickname
  const setNickname = useCallback((nickname) => {
    setUserSession((prev) => ({
      ...prev,
      nickname: nickname.trim() || "Anonymous",
    }));
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (text, replyTarget = null) => {
      if (!text.trim()) {
        return { success: false, error: "Message cannot be empty" };
      }

      try {
        const filteredText = filterProfanity(text);

        const messageData = {
          text: filteredText,
          nickname: userSession.nickname,
          userId: userSession.id,
          timestamp: serverTimestamp(),
          color: userSession.color,
        };

        if (replyTarget) {
          messageData.replyTo = {
            id: replyTarget.id,
            text: replyTarget.text,
            nickname: replyTarget.nickname,
            userId: replyTarget.userId,
          };
        }

        const docRef = await addDoc(collection(db, roomId), messageData);

        setUserSession((prev) => ({
          ...prev,
          lastMessageTime: Date.now(),
        }));

        // Reset reply state
        setReplyingTo(null);

        // Trigger AI
        const isUserMessage = messageData.userId !== AI_BOT.id;
        if (isUserMessage && aiEnabledRef.current) {
          const sentMessage = {
            id: docRef.id,
            ...messageData,
            timestamp: Date.now(),
          };
          const replyText = replyTarget
            ? `Replying to: ${replyTarget.nickname}: ${replyTarget.text}. `
            : "";
          const questionPrompt = `${replyText}User: ${filteredText}`;
          postAIResponse(questionPrompt, sentMessage, roomId);
        }

        return { success: true };
      } catch (err) {
        console.error("Error sending message:", err);
        if (err.code === "permission-denied") {
          return {
            success: false,
            error: "Permission denied. Please check Firestore security rules.",
          };
        }
        return {
          success: false,
          error: "Failed to send message. Please try again.",
        };
      }
    },
    [userSession, roomId]
  );

  // Subscribe to messages
  useEffect(() => {
    setLoading(true);

    try {
      const q = query(collection(db, roomId), orderBy("timestamp", "asc"));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const newMessages = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              text: data.text,
              nickname: data.nickname,
              userId: data.userId,
              timestamp: data.timestamp
                ? data.timestamp.toMillis()
                : Date.now(),
              color: data.color,
              replyTo: data.replyTo ? { ...data.replyTo } : null,
            };
          });

          setMessages(newMessages);
          setLoading(false);

          // Scroll when new messages come in
          setTimeout(scrollToBottom, 100);
        },
        (err) => {
          console.error("Error fetching messages:", err);
          setError(
            "Failed to load messages. Please check Firestore security rules."
          );
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      console.error("Error setting up message listener:", err);
      setError("Failed to connect to chat. Please check Firebase configuration.");
      setLoading(false);
    }
  }, [roomId, scrollToBottom]);

  return {
    messages,
    loading,
    error,
    userSession,
    sendMessage,
    setNickname,
    messagesEndRef,
    replyingTo,
    setReplyMessage,
    cancelReply,
    aiEnabled,
    setAiEnabled,
  };
}
