// Regenerates all static app icons from the single source design below.
//
// Why this exists: the runtime serves only static icon files (favicon.ico,
// apple-icon.png, public/icon-*.png) so switching conversations never re-fetches
// a dynamically generated icon. This script is the *source* of those files —
// edit `renderAppIcon` here, then run `pnpm generate:icons` to re-freeze them.
//
// Renders via next/og (Satori + resvg) in plain Node — no dev server needed.

import og from "next/og.js";
import React from "react";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const { ImageResponse } = og;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const r = (n) => Math.round(n);
// A <div> with the given style and positional children. Falsy children and
// nested arrays (used for conditional groups) are flattened away, so the tree
// matches the equivalent JSX exactly and Satori output is identical.
const div = (style, ...children) =>
  React.createElement("div", { style }, ...children.flat().filter(Boolean));
// Groups siblings without a layout box — mirrors a JSX <>...</> fragment so the
// element tree (and thus Satori's output) matches the original exactly.
const frag = (...children) =>
  React.createElement(React.Fragment, null, ...children);

/** Renders the Agent Chat Lab app icon at the given size. */
function renderAppIcon(size) {
  // Scale factor relative to the 180px "base" design
  const s = size / 180;

  return new ImageResponse(
    div(
      {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, #1b1712, #2a2118)",
        borderRadius: r(40 * s),
        position: "relative",
        overflow: "hidden",
      },
      // Top-left accent glow
      div({
        position: "absolute",
        top: r(-20 * s),
        left: r(-20 * s),
        width: r(100 * s),
        height: r(100 * s),
        borderRadius: "50%",
        background:
          "radial-gradient(circle, rgba(201,106,43,0.4), transparent 70%)",
      }),
      // Bottom-right subtle glow
      div({
        position: "absolute",
        bottom: r(-30 * s),
        right: r(-30 * s),
        width: r(90 * s),
        height: r(90 * s),
        borderRadius: "50%",
        background:
          "radial-gradient(circle, rgba(201,106,43,0.15), transparent 70%)",
      }),
      // Grid pattern overlay
      div({
        position: "absolute",
        inset: 0,
        opacity: 0.06,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
        backgroundSize: `${r(18 * s)}px ${r(18 * s)}px`,
      }),
      // Node dots (only on larger sizes)
      size >= 128 &&
        frag(
          div({
            position: "absolute",
            top: r(32 * s),
            right: r(36 * s),
            width: r(6 * s),
            height: r(6 * s),
            borderRadius: "50%",
            background: "rgba(201,106,43,0.5)",
          }),
          div({
            position: "absolute",
            top: r(22 * s),
            right: r(56 * s),
            width: r(4 * s),
            height: r(4 * s),
            borderRadius: "50%",
            background: "rgba(201,106,43,0.3)",
          }),
          div({
            position: "absolute",
            bottom: r(30 * s),
            left: r(34 * s),
            width: r(5 * s),
            height: r(5 * s),
            borderRadius: "50%",
            background: "rgba(201,106,43,0.35)",
          }),
        ),
      // Main chat bubble
      div(
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: r(6 * s),
        },
        div(
          {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: r(100 * s),
            height: r(76 * s),
            background: "linear-gradient(135deg, #c96a2b, #e0853e)",
            borderRadius: `${r(22 * s)}px ${r(22 * s)}px ${r(22 * s)}px ${r(4 * s)}px`,
            boxShadow: `0 ${r(8 * s)}px ${r(32 * s)}px rgba(201,106,43,0.35), 0 ${r(2 * s)}px ${r(8 * s)}px rgba(0,0,0,0.3)`,
          },
          // Three dots
          div(
            { display: "flex", gap: r(8 * s), alignItems: "center" },
            div({
              width: r(12 * s),
              height: r(12 * s),
              borderRadius: "50%",
              background: "rgba(255,255,255,0.95)",
            }),
            div({
              width: r(12 * s),
              height: r(12 * s),
              borderRadius: "50%",
              background: "rgba(255,255,255,0.65)",
            }),
            div({
              width: r(12 * s),
              height: r(12 * s),
              borderRadius: "50%",
              background: "rgba(255,255,255,0.35)",
            }),
          ),
        ),
        // Accent bar (only on larger sizes)
        size >= 128 &&
          div({
            width: r(40 * s),
            height: Math.max(2, r(3 * s)),
            borderRadius: r(2 * s),
            background:
              "linear-gradient(90deg, rgba(201,106,43,0.7), rgba(201,106,43,0.1))",
          }),
      ),
    ),
    { width: size, height: size },
  );
}

async function renderPng(size) {
  const res = renderAppIcon(size);
  return Buffer.from(await res.arrayBuffer());
}

// Packs PNG buffers into a multi-resolution .ico (PNG-compressed entries).
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + 16 * pngs.length;
  const entries = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8); // image data size
    e.writeUInt32LE(offset, 12); // offset
    offset += buf.length;
    entries.push(e);
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

async function main() {
  const [p16, p32, p48, p180, p192, p512] = await Promise.all(
    [16, 32, 48, 180, 192, 512].map(renderPng),
  );

  const outputs = [
    ["app/favicon.ico", buildIco([
      { size: 16, buf: p16 },
      { size: 32, buf: p32 },
      { size: 48, buf: p48 },
    ])],
    ["app/apple-icon.png", p180],
    ["public/icon-192.png", p192],
    ["public/icon-512.png", p512],
  ];

  for (const [rel, buf] of outputs) {
    writeFileSync(resolve(ROOT, rel), buf);
    console.log(`wrote ${rel} (${buf.length} bytes)`);
  }
}

await main();
