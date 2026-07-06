# 接入 Excalidraw 只读渲染实现计划

> 在聊天消息里渲染 ```excalidraw 代码块,以手绘风格静态展示 AI 产出的图。本文为设计/实现计划,供后续落地参考;尚未实现。

## 背景与目标

项目已支持在 assistant 消息里渲染 mermaid、SVG、KaTeX,机制是 `components/chat-message.tsx` 中 Streamdown 的 `plugins.renderers` 按代码块语言注入自定义组件——现成范例是 `SvgPreview`(`chat-message.tsx:281`),它拦截 ```svg 代码块、清理后用 `next/image` 展示。

目标:支持 Excalidraw 这类"高级画板"的渲染,让 AI 产出的图以手绘风格呈现。已确认两个产品定位:

1. **交互形态:只读渲染展示**(像 mermaid 一样出图即看,不可编辑)。
2. **内容来源:AI 直接输出 ```excalidraw 代码块(JSON)**。

## 可行性结论

**渲染层很好接,真正的难点在内容来源。**

- 渲染:照搬 `SvgPreview` 的 renderer 注册模式,工程量小。
- 风险:Excalidraw 原生格式是冗长 JSON(每个图形带 `x/y/width/height/seed/version/versionNonce` 等),LLM 不像写 mermaid DSL 那样擅长手写带坐标的场景。要让"AI 直接输出 excalidraw"真正可用,**必须配套 system prompt 引导 + 约定一种对 LLM 友好的精简格式**,且最终效果受模型能力上限制约。

## 关键设计选择

### 1. 渲染方式:`exportToSvg` 导出静态 SVG,而非嵌入实时画板

| 方案 | 说明 | 取舍 |
|---|---|---|
| **(推荐)`exportToSvg()` 转静态 SVG** | 把场景导出成 SVG,复用 `SvgPreview` 的展示外壳(源码/预览切换 + 复制) | 轻量;与现有 mermaid/svg 体验一致;不引入 Excalidraw 整套编辑器 UI CSS(避开与项目 Tailwind / light-only 主题冲突);多图共存也只渲染一次。保留 roughjs 手绘风,仅失去平移/缩放——对只读展示足够 |
| (备选)嵌入 `<Excalidraw viewModeEnabled />` | 挂载实时画板,只读 | 保留平移/缩放;但每张图一个完整 canvas 实例较重,需引入 `@excalidraw/excalidraw/index.css`,样式隔离更麻烦 |

本计划走方案一。

> 注意:即便只用 `exportToSvg`,它仍从 `@excalidraw/excalidraw` 主包导出,**包体积省不掉**(Excalidraw 没有独立的轻量"只渲染"包)。靠 `next/dynamic` 按需懒加载兜住首屏成本。

### 2. 约定对 LLM 友好的 JSON 格式

`@excalidraw/excalidraw` 提供 `convertToExcalidrawElements()`,把 **element skeleton**(精简对象,免去机器字段)补全成完整元素:

```ts
// AI 只需写 skeleton,免写 seed/version/versionNonce 等
convertToExcalidrawElements([
  { type: "rectangle", x: 100, y: 100, width: 160, height: 80, label: { text: "Start" } },
  { type: "diamond",   x: 100, y: 240, width: 160, height: 80, label: { text: "Is it?" } },
  { type: "arrow",     x: 180, y: 180, width: 0, height: 60 },
]);
```

渲染端做**格式自适应**:

- 输入是数组 / `{ elements: [skeleton] }` → 先 `convertToExcalidrawElements` 再导出。
- 输入是完整 `.excalidraw` 文件(`{ type: "excalidraw", version, elements, appState, files }`)→ `elements` 直接用。

## 依赖

- **新增(唯一)**:`@excalidraw/excalidraw`。要用的 `exportToSvg()` 与 `convertToExcalidrawElements()` 都从它导出。
- **沿用已装**:`dompurify`(复用 `sanitizeSvg`)、`next/image`、`next/dynamic`、`streamdown`。
- **不引入**:SVG 清理/尺寸解析复用 `chat-message.tsx` 现有的 `sanitizeSvg`/`parseSvgDimensions`,不加新库。
- **可选、本期不装**:`@excalidraw/mermaid-to-excalidraw`——仅当后续判断"AI 直接写 JSON 产图质量太差",改成"AI 写 mermaid → 转 excalidraw 手绘风"时才需要。

## 改动清单

### 1. 新建 `components/excalidraw-preview.tsx`(`"use client"`)

props 与 `SvgPreview` 对齐:`{ code: string; styles: MarkdownStyles }`。骨架:

```tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
// 注意:不要顶层 import @excalidraw/excalidraw(~2-3MB),改用下方动态 import

export function ExcalidrawPreview({ code, styles }: { code: string; styles: MarkdownStyles }) {
  const [svg, setSvg] = useState<{ src: string; width: number; height: number } | null>(null);
  const [error, setError] = useState(false);

  // 先尝试解析,失败(代码块未闭合 / 非法 JSON)就保持 null → 降级显示源码
  const scene = useMemo(() => {
    try {
      return JSON.parse(code);
    } catch {
      return null;
    }
  }, [code]);

  useEffect(() => {
    if (!scene) return;
    let cancelled = false;
    (async () => {
      try {
        const { exportToSvg, convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
        const rawElements = Array.isArray(scene) ? scene : scene.elements ?? [];
        // skeleton(无 seed/version)走 convert;完整元素直接用。可按字段探测,或统一过 convert
        const elements = convertToExcalidrawElements(rawElements);
        const svgEl = await exportToSvg({
          elements,
          appState: scene.appState ?? {},
          files: scene.files ?? null,
          exportPadding: 16,
        });
        const raw = new XMLSerializer().serializeToString(svgEl);
        const sanitized = sanitizeSvg(raw);            // 复用 chat-message.tsx 的实现
        if (cancelled || !sanitized) return;
        setSvg({
          src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`,
          ...parseSvgDimensions(sanitized),            // 复用 chat-message.tsx 的实现
        });
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [scene]);

  // 未解析成功 / 导出失败 → 降级为源码块(与 mermaid 流式中"先显示源码"一致)
  if (!scene || error) {
    return <SourceFallback code={code} styles={styles} label="EXCALIDRAW" />;
  }
  // 解析成功但 SVG 还没生成 → loading 占位
  if (!svg) {
    return <Skeleton styles={styles} />;
  }
  // 复用 SvgPreview 的外壳:源码/预览切换 + 复制 + <Image unoptimized data-uri>
  return <PreviewShell svg={svg} code={code} styles={styles} label="EXCALIDRAW" />;
}
```

实现要点:
- `sanitizeSvg` / `parseSvgDimensions` 目前是 `chat-message.tsx` 内的局部函数(`:231`、`:241`)。落地时**抽到共享模块**(如 `lib/svg.ts`)供两个组件复用,或把 `SvgPreview` 一并迁出。
- 展示外壳(源码/预览切换 + 复制按钮 + `<Image>`)与 `SvgPreview`(`chat-message.tsx:312-372`)几乎一致,可抽成共享外壳组件,避免重复。
- 流式/容错:`JSON.parse` 失败或 `exportToSvg` 抛错时降级显示源码块,代码块闭合后自动重渲出图。

### 2. 注册 renderer:`components/chat-message.tsx`

在 `markdownPlugins.renderers`(`chat-message.tsx:409`)新增一项,与现有 `svg` 完全同构:

```tsx
// 顶部:整组件依赖浏览器 API,用 dynamic ssr:false 引入
const ExcalidrawPreview = dynamic(
  () => import("@/components/excalidraw-preview").then((m) => m.ExcalidrawPreview),
  { ssr: false },
);

// renderers 数组里追加(现有 svg 项见 :410-415)
{
  language: ["excalidraw"],
  component: ({ code }: { code: string }) => (
    <ExcalidrawPreview code={code} styles={markdownStyles} />
  ),
},
```

> 这是项目里**第一处** `next/dynamic` + `ssr:false` 的用法(现状全部组件直接 `"use client"`,无懒加载先例)。`chat-message.tsx` 本身已是 `"use client"`,可直接用。

### 3. System prompt 引导:`lib/ai/system-prompt.ts`

现状:`system-prompt.ts` 仅 97 行,**没有任何 mermaid/svg 图表引导**——现有图表纯靠模型自发输出。对 excalidraw 这种模型不熟悉的格式,不加引导基本不会主动产出。

追加一段:何时使用 ```excalidraw、约定 skeleton 数组格式、给 1 个最小可渲染示例(如 2 个矩形 + 1 条箭头,带显式 `x/y/width/height`),并提示需自行排布坐标避免重叠。**这是让功能"用得起来"的关键一环**,不是可选项。

### 4. 构建配置(按需):`next.config.ts`

`pnpm build` 若报 Excalidraw 的 ESM/CSS 解析错误,加:

```ts
transpilePackages: ['@excalidraw/excalidraw'],
```

方案一不引入编辑器 UI CSS,正常无需改 `app/globals.css` 的 `@source`(`globals.css:6-7`)。`exportToSvg` 产出的 SVG 内联了样式,基本自包含。

### 5. 文档同步(项目规约)

落地时同一改动内更新:
- `TODO.md`:记录/移除该项。
- `CHANGELOG.md`:一条极简用户向 bullet(如"支持渲染 Excalidraw 图表")。

## 风险与缓解

- **AI 产图质量(最大不确定性)**:模型手写带坐标的 excalidraw 远难于写 mermaid。缓解:skeleton 格式降低难度 + prompt 给清晰示例;并保留"导出失败降级显示源码",坏 JSON 不破坏整条消息渲染。若效果不佳,退路是引入 `@excalidraw/mermaid-to-excalidraw`(AI 写 mermaid、渲染成 excalidraw 手绘风)。
- **包体积(~2-3MB)**:`next/dynamic` + 按需 `import()` 确保不进首屏、不影响未用到该功能的会话;代价是首次用到时有几 MB 下载。
- **SSR**:Excalidraw 纯客户端;`ssr:false` 动态加载规避。
- **样式隔离**:方案一只取导出的 SVG,不挂载 Excalidraw UI,基本无 Tailwind / light-only 主题冲突。

## 验证

1. `pnpm lint && pnpm build`(类型检查 + lint,最低门槛)。
2. `pnpm dev`,在对话里粘贴一段 ```excalidraw skeleton JSON(几个图形 + 箭头):
   - 渲染出手绘风静态图;源码/预览切换与复制可用。
   - 流式过程中(代码块未闭合)显示源码、闭合后自动出图,不报错。
   - 故意贴非法 JSON,确认降级为源码展示、不影响整条消息。
3. 让模型实际生成一个 excalidraw 图(验证 prompt 引导能否真正驱动模型产出可渲染内容),评估产图质量是否达可用预期。

## 关键文件索引

| 用途 | 路径 |
|---|---|
| 消息渲染 / Streamdown renderers 接线 | `components/chat-message.tsx:403-419` |
| 现成范例:SVG 自定义渲染器 | `components/chat-message.tsx:281-373` |
| 待复用/抽出:SVG 清理 + 尺寸解析 | `components/chat-message.tsx:231-274` |
| 系统提示词 | `lib/ai/system-prompt.ts` |
| 构建配置 | `next.config.ts` |
| Tailwind `@source` 扫描 | `app/globals.css:5-7` |

## 参考资料(Excalidraw API 要点)

- **Next.js 集成**:必须客户端渲染,官方推荐 `dynamic(() => import("@excalidraw/excalidraw"), { ssr: false })`;用 `<Excalidraw>` 组件时需 `import "@excalidraw/excalidraw/index.css"`(本方案走 `exportToSvg`,不挂组件,可免)。
- **`exportToSvg({ elements, appState, files, exportPadding })`**:返回 SVG(DOM 元素),用 `XMLSerializer` 序列化为字符串。
- **`convertToExcalidrawElements(skeletons)`**:把精简 skeleton 补全为完整 `ExcalidrawElement[]`。
- **`initialData={{ elements, appState, files }}`**:走备选"嵌入实时画板"方案时用;只读加 `viewModeEnabled`(或 `appState.viewModeEnabled`)。
- 版本:截至撰写,Excalidraw 最新约 `v0.18.x`;落地时核对其对 React 19 / Next 16 的兼容说明。
