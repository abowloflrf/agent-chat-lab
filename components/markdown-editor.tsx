"use client";

import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { placeholder as editorPlaceholder } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variant?: "default" | "minimal";
};

const defaultEditorTheme = EditorView.theme({
  "&": {
    minHeight: "360px",
    height: "100%",
    backgroundColor: "var(--glass-bg)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "0.75rem",
    overflow: "hidden",
    fontSize: "14px",
  },
  "&.cm-focused": {
    borderColor: "var(--accent)",
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily:
      'var(--font-ibm-plex-mono), "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", "WenQuanYi Micro Hei", monospace',
    lineHeight: "1.65",
    minHeight: "360px",
    padding: "12px 0",
  },
  ".cm-content": {
    caretColor: "var(--foreground)",
    padding: "0 14px",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--panel)",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--surface-muted)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--surface-muted)",
    color: "var(--accent-strong)",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection-bg) !important",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
  },
});

const minimalEditorTheme = EditorView.theme({
  "&": {
    minHeight: "320px",
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--foreground)",
    border: "none",
    borderRadius: "0",
    overflow: "hidden",
    fontSize: "15px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily:
      'var(--font-ibm-plex-mono), "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", "WenQuanYi Micro Hei", monospace',
    lineHeight: "1.8",
    minHeight: "320px",
    padding: "2px 0 18px",
  },
  ".cm-content": {
    caretColor: "var(--foreground)",
    padding: "0",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--surface-muted)",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection-bg) !important",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
  },
});

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  variant = "default",
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || viewRef.current) {
      return;
    }

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          variant === "minimal" ? minimalEditorTheme : defaultEditorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          placeholder ? editorPlaceholder(placeholder) : [],
        ],
      }),
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [placeholder, variant]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();

    if (currentValue === value) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    });
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={variant === "minimal" ? "h-full min-h-[320px]" : "h-full min-h-[360px]"}
    />
  );
}
