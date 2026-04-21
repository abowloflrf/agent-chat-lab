"use client";

import { useEffect, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const THEME = "github-light";

export const SHIKI_THEME = THEME;

type Highlighter = HighlighterCore;

let highlighterPromise: Promise<Highlighter> | null = null;

function loadHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import("shiki/themes/github-light.mjs")],
      langs: [
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/c.mjs"),
        import("shiki/langs/cpp.mjs"),
        import("shiki/langs/css.mjs"),
        import("shiki/langs/diff.mjs"),
        import("shiki/langs/dockerfile.mjs"),
        import("shiki/langs/go.mjs"),
        import("shiki/langs/graphql.mjs"),
        import("shiki/langs/html.mjs"),
        import("shiki/langs/ini.mjs"),
        import("shiki/langs/java.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/jsx.mjs"),
        import("shiki/langs/makefile.mjs"),
        import("shiki/langs/markdown.mjs"),
        import("shiki/langs/nginx.mjs"),
        import("shiki/langs/python.mjs"),
        import("shiki/langs/rust.mjs"),
        import("shiki/langs/scss.mjs"),
        import("shiki/langs/shellscript.mjs"),
        import("shiki/langs/sql.mjs"),
        import("shiki/langs/swift.mjs"),
        import("shiki/langs/toml.mjs"),
        import("shiki/langs/tsx.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/vue.mjs"),
        import("shiki/langs/xml.mjs"),
        import("shiki/langs/yaml.mjs"),
        import("shiki/langs/zig.mjs"),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

export function useShikiHighlighter(): Highlighter | null {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHighlighter().then((h) => {
      if (!cancelled) {
        setHighlighter(h);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return highlighter;
}
