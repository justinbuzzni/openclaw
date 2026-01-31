import { atom } from "jotai";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// 메시지 목록
export const messagesAtom = atom<Message[]>([]);

// 연결 상태
export const connectionStatusAtom = atom<ConnectionStatus>("disconnected");

// 입력 중인 메시지
export const inputMessageAtom = atom<string>("");

// 메시지 추가 액션
export const addMessageAtom = atom(null, (get, set, message: Omit<Message, "id" | "timestamp">) => {
  const messages = get(messagesAtom);
  const newMessage: Message = {
    ...message,
    id: crypto.randomUUID(),
    timestamp: new Date(),
  };
  set(messagesAtom, [...messages, newMessage]);
});

// 메시지 전송 액션
export const sendMessageAtom = atom(null, (get, set, content: string) => {
  if (!content.trim()) return;

  // 사용자 메시지 추가
  set(addMessageAtom, { role: "user", content });

  // 입력 초기화
  set(inputMessageAtom, "");

  // TODO: 게이트웨이로 메시지 전송
});
