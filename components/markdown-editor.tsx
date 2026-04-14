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
};

const editorTheme = EditorView.theme({
  "&": {
    minHeight: "360px",
    height: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    color: "#171717",
    border: "1px solid rgba(23, 23, 23, 0.12)",
    borderRadius: "0.75rem",
    overflow: "hidden",
    fontSize: "14px",
  },
  "&.cm-focused": {
    borderColor: "rgba(201, 106, 43, 0.45)",
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-ibm-plex-mono), monospace",
    lineHeight: "1.65",
    minHeight: "360px",
    padding: "12px 0",
  },
  ".cm-content": {
    caretColor: "#171717",
    padding: "0 14px",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  ".cm-gutters": {
    backgroundColor: "rgba(248, 242, 234, 0.7)",
    borderRight: "1px solid rgba(23, 23, 23, 0.08)",
    color: "#a59a8d",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(201, 106, 43, 0.06)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(201, 106, 43, 0.08)",
    color: "#7b4a26",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(201, 106, 43, 0.18) !important",
  },
  ".cm-placeholder": {
    color: "#a39a90",
  },
});

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
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
          editorTheme,
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
  }, [placeholder]);

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

  return <div ref={containerRef} className="h-full min-h-[360px]" />;
}
