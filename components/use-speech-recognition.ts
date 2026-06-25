"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// Minimal typings for the Web Speech API (not in lib.dom.d.ts).
interface SpeechAlternative {
  readonly transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  readonly [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike {
  readonly results: SpeechResultList;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function subscribeSupport() {
  return () => {};
}

function getSupportSnapshot() {
  return Boolean(getRecognitionCtor());
}

function getServerSupportSnapshot() {
  return false;
}

function cleanupRecognition(rec: SpeechRecognitionLike) {
  rec.onresult = null;
  rec.onerror = null;
  rec.onend = null;
}

/**
 * Wraps the browser-native SpeechRecognition API. `onResult` receives the full
 * transcript accumulated within the current recording session (final + interim);
 * the caller is responsible for merging it onto any pre-existing draft text.
 */
export function useSpeechRecognition({
  lang = "zh-CN",
  onResult,
  onError,
}: {
  lang?: string;
  onResult: (sessionText: string) => void;
  onError?: (code: string) => void;
}) {
  const supported = useSyncExternalStore(
    subscribeSupport,
    getSupportSnapshot,
    getServerSupportSnapshot,
  );
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep latest callbacks in refs so the recognition instance is never stale.
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const start = useCallback(() => {
    if (recRef.current) return; // already listening
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0]?.transcript ?? "";
      }
      onResultRef.current(text);
    };
    rec.onerror = (event) => {
      cleanupRecognition(rec);
      if (recRef.current === rec) {
        recRef.current = null;
      }
      setListening(false);
      onErrorRef.current?.(event.error);
    };
    rec.onend = () => {
      cleanupRecognition(rec);
      if (recRef.current === rec) {
        recRef.current = null;
      }
      setListening(false);
    };
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      cleanupRecognition(rec);
      recRef.current = null;
      setListening(false);
      onErrorRef.current?.("start-failed");
    }
  }, [lang]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const abort = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    cleanupRecognition(rec);
    recRef.current = null;
    setListening(false);
    rec.abort();
  }, []);

  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (!rec) return;
      cleanupRecognition(rec);
      recRef.current = null;
      rec.abort();
    };
  }, []);

  return { supported, listening, start, stop, abort };
}
