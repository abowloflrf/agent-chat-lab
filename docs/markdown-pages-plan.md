# 动态渲染 Markdown 目录为页面实现计划

> 挂载一个 `.md` 文件目录,用户访问时在服务端把对应文件动态渲染成 HTML 页面。
> 本文为设计/实现计划,供后续落地参考;尚未实现。

## 背景与目标

希望支持「挂一个目录(里面都是 `.md`)→ 用户访问某路径时,把对应文件动态渲染成页面」。
本项目已具备实现这件事的几乎全部基础设施:

- **运行时读盘范式**:`lib/ai/skills.ts` 已经在做同样的事——从 volume 挂载的
  `workspace/skills/` 目录,用 `node:fs/promises` 在**请求时**读 `SKILL.md`,目录可用
  `SKILLS_DIR` 环境变量覆盖。md 页面照搬这套即可。
- **完整的 Markdown 渲染管线**:`components/chat-message.tsx:408-427` 里的 `Streamdown`
  已接好 Shiki 代码高亮(`@streamdown/code`)、KaTeX(`@streamdown/math`)、CJK、mermaid,
  以及 `svg` 代码块自定义渲染。md→HTML 这一步在本项目里是经过实战的,直接复用。
- **安全读文件范式**:`lib/artifacts.ts` 已有 `realpath` + `isInsideDirectory`
  (`artifacts.ts:80-114`)的路径穿越防护,可直接复用。
- **standalone + volume**:`next.config.ts` 的 `outputFileTracingExcludes` 已在处理
  「运行时 volume 不被 NFT 追踪进镜像」,新挂的 md 目录加一行排除即可。

已确认的产品定位(本次):

1. **格式范围:仅 `.md`**(不做 `.mdx`,理由见下)。
2. **访问权限:登录后访问**(沿用现有静态密码鉴权,不改 `proxy.ts`)。

## 可行性结论

**完全可行,且改动很小**——内容来源、渲染、安全三块都有现成范式可复用,真正的新增只是
「一个 dynamic catch-all 路由 + 把 Streamdown 渲染配置抽成共享件」。

一个关键澄清:**这里的「静态 HTML」不是 build-time SSG**。挂载目录的内容是运行时可变、
用户可管的,构建时并不知道有哪些文件,所以 `generateStaticParams` 预渲染用不上。正确做法是
**dynamic 路由在请求时读盘 + 服务端渲染 + 缓存**——产出仍是 HTML,只是「首次访问时生成」
而非「构建时生成」,对本用途效果一致。

为什么本次不做 `.mdx`:`.mdx` 内嵌 JSX/组件,需要**运行时编译**(`next-mdx-remote` 之类),
而对「用户可控目录」做运行时 MDX 编译 ≈ 执行任意代码,是实打实的安全风险。纯 `.md` 走
Streamdown 渲染无此问题。若日后内容完全可信再单独评估。

## 关键设计选择

### 1. 内容来源:挂载目录 + 运行时读盘(照搬 skills.ts)

- 默认目录 `workspace/docs/`(与 `workspace/skills` 同级,属用户运行时数据:挂 volume、
  不进 git 与镜像、用户自管),env `DOCS_DIR` 覆盖。
  > 注意与仓库根的 `docs/`(设计笔记)区分:那是源码,不是 volume;本特性读的是 `workspace/docs/`。
- 在 `docker-compose.yml` 增加 volume 挂载(或直接复用 `workspace` 整目录,`workspace/docs`
  天然包含在内,无需新挂)。
- `next.config.ts` 的 `outputFileTracingExcludes` 已含 `./workspace/**/*`,无需改动。

### 2. 路由:dynamic catch-all,运行时渲染

**单一页面路由,无独立内容接口。** 内容来源 / 渲染都收敛在一个页面路由里:server
读文件,把 md 原文当 prop 传给 client 渲染组件,字符串随页面响应(RSC payload)一起
下发。前端依然是渲染方(client 端 Streamdown),只是「干净的 md」是 prop 而非另发一次
fetch 去拉。这样 1 次往返、内容直接进首屏 payload,且路径穿越防护只此一处。

> 已评估并放弃的两个变体:(a)纯客户端壳 + `/api/docs/**` 返回 raw md——多一次往返、
> 安全逻辑两处、首屏闪烁更明显;(b)对外暴露 raw md 接口——仅当 md 要被页面之外的消费者
> (下载 / curl / 其它前端)复用才有价值,本次无此需求。日后若需要,加一个复用同一
> `loadMarkdownDoc` 的只读 route 即可,不影响现有渲染路径。

**文件结构**(URL 前缀 `/docs/**` 当前未被占用):

```
app/docs/
├── page.tsx              # /docs      → 文档索引(readdir 列 *.md)
├── [...slug]/page.tsx    # /docs/**   → 渲染对应 md 文件
└── not-found.tsx         # 文件不存在时的 404(可选,否则回退根 not-found)
```

拆成「索引 + catch-all」两个文件而非用 optional catch-all `[[...slug]]`:索引(列目录)
与渲染(读单文件)是两套逻辑,分开比在一个组件里 `if (slug)` 分叉清爽。catch-all
`[...slug]` 不匹配 `/docs` 本身,故索引必须单独一个 `page.tsx`。

**URL → 文件映射**:

| URL | 命中文件(`DOCS_DIR` 下) | `params.slug` |
|---|---|---|
| `/docs` | 索引页 | — |
| `/docs/getting-started` | `getting-started.md` | `['getting-started']` |
| `/docs/guides/setup` | `guides/setup.md` | `['guides','setup']` |
| `/docs/guides` | `guides/index.md`(目录索引,可选规则) | `['guides']` |
| `/docs/nope` | 不存在 → `notFound()` | `['nope']` |

**catch-all 页面骨架**:

```tsx
// app/docs/[...slug]/page.tsx
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic"; // 运行时读盘;要缓存再换 revalidate

export default async function DocPage({ params }: PageProps<"/docs/[...slug]">) {
  const { slug } = await params;            // Next 16:params 是 Promise
  const doc = await loadMarkdownDoc(slug);  // 安全解析 + 读文件,失败返回 null
  if (!doc) notFound();                     // 复用 Next 的 not-found
  return <MarkdownDocument source={doc.content} />; // client island 渲染
}
```

`PageProps<"/docs/[...slug]">` 是 Next 16 的类型助手,`slug` 自动推成 `string[]`。

**slug → 文件解析规则**(`loadMarkdownDoc(slug: string[])`,在 `lib/markdown-pages.ts`):

1. **URL 不带扩展名**:`slug.join('/') + '.md'`,干净 URL(`/docs/foo` 而非 `/docs/foo.md`)。
2. **支持嵌套目录**:slug 是数组,天然映射子目录。
3. **目录索引(可选)**:`<slug>.md` 不存在且 `<slug>/` 是目录时,回退试 `<slug>/index.md`。
4. **安全兜底**:拼好的路径经 `realpath` + `isInsideDirectory` 校验仍在 `DOCS_DIR` 内
   (复用 `artifacts.ts:80-114`),挡 `..` 与符号链接逃逸;只认 `.md` 扩展名。任何不过关
   返回 `null` → 页面 `notFound()`,不泄露「文件是否存在」之外的信息。

### 3. 渲染:复用 Streamdown 管线

当前 Streamdown 的 plugin/renderer 配置内联在 `chat-message.tsx:411-427`。建议**抽出成共享件**,
chat 与 docs 页面共用同一套渲染:

| 方案 | 说明 | 取舍 |
|---|---|---|
| **(推荐)抽 `<MarkdownDocument>` client 组件** | 把 plugins(code/math/cjk/mermaid)+ 链接渲染封装,server page 读文件后传 `source` | 复用现有实战管线,mermaid/Shiki 主题与聊天一致;mermaid 需客户端,故包一层 client island |
| (备选)server 端直接出 HTML(remark/rehype) | 纯服务端渲染,无 client JS | 更「静态」,但要另搭一套 remark 管线、丢失 mermaid/现有主题一致性,重复造轮子 |

走方案一。注意 docs 页面与聊天的版式/主题:可复用 `app/globals.css` 的 `markdownTextStyles`
(`chat-message.tsx` 已有 user/assistant 两套),docs 用 assistant 那套即可。

### 4. 安全

本特性几乎全部攻击面都在「slug 如何映射到文件」。头号风险是**路径穿越 / 任意文件读取**,
核心防御原则:**不靠字符串归一化,而是「先 `realpath` 落地到真实路径,再判断是否仍在根内」**。

**`loadMarkdownDoc(slug)` 的多层防御**(复用 `artifacts.ts:80-114` 的 `realpath` +
`isInsideDirectory`):

```
1. 逐段校验 slug:任一段为空 / 等于 . 或 .. / 含 "/" "\" 或 null 字节 → 直接拒
2. 拼路径: candidate = resolve(DOCS_DIR, ...slug) + ".md"   ← 强制 .md 后缀
3. real = await realpath(candidate)   ← 解析掉所有符号链接;ENOENT 即 404
4. 断言 isInsideDirectory(realDocsRoot, real)  ← 真实路径必须仍在根内
5. stat 必须是普通文件(排除目录/设备/socket),并加大小上限
任一步失败 → 返回 null → 页面 notFound()
```

第 4 步用的是 **realpath 之后的真实路径**,不是归一化字符串——这是和「只做 `path.normalize`
去 `..`」的本质区别(后者挡不住符号链接)。

**攻击走查**(每个 payload 被哪层挡):

| 请求 | 映射结果 | 被哪层挡 |
|---|---|---|
| `/docs/../../etc/passwd` | resolve→`/etc/passwd.md`,realpath 不在根内 | 第 4 步 |
| `/docs/..%2f..%2fetc%2fpasswd` | Next 先解码归一化;残留再走第 1/4 步 | 第 1/4 步 |
| `/docs/secret`(想读非 md) | 强制拼成 `secret.md`,无此文件 | 第 3 步(+ `.md` 后缀) |
| `/docs/foo%00.png` | null 字节 | 第 1 步 |
| 读 `data/app.db` | 永远 append `.md`,且不在根内 | 第 2/4 步 |

`.md` 强制后缀是纵深防御:即便穿越侥幸成功,目标也必须以 `.md` 结尾,读不到
`app.db` / `.env` / `id_rsa` 等敏感文件。

**符号链接逃逸(易漏,单独强调)**:DOCS_DIR 是用户挂载目录,可能含软链
`link.md -> /etc/passwd`——路径里没有 `..`,纯字符串校验完全挡不住。只有 `realpath`
把软链解析到真实目标、再做 inside 判断才能拦。故第 3、4 步顺序不能省、不能换。
`realDocsRoot` 也要在启动时 `realpath` 一次(DOCS_DIR 本身可能是软链),保证「real vs real」对比。

**其它考量**:

- **鉴权**:`/docs/**` 被 `proxy.ts` 的 matcher 覆盖,未登录的页面请求会被 rewrite 到
  `/login`,不 SSR 任何内容,天然成立。(若日后要公开,再在 `proxy.ts:26` 的
  `isPublicRoute` 显式放行 `/docs` 前缀。)
- **DOCS_DIR 是信任边界**:代码只挡「逃出 DOCS_DIR」,**DOCS_DIR 内的一切都会被暴露**。
  故默认值定 `workspace/docs`(而非 `workspace` 根,否则 skills / 产物全暴露),文档需写明
  「别把 DOCS_DIR 指向含敏感文件的目录」。这是配置风险,非代码漏洞。
- **内容 XSS**:md 可能写 `<script>` / `<img onerror>`。复用聊天同款 Streamdown 管线即可
  ——它本就用于渲染**不可信 AI 输出**,默认不渲染原始 HTML。**别为 docs 单独开
  `rehype-raw` / `dangerouslySetInnerHTML`**。(且本场景内容作者≈挂卷运维本人,风险更低。)
- **DoS**:超大 md 整文件读进内存 + 客户端渲染卡顿 → 加文件大小上限(如 1–2 MB),并限制
  slug 深度。
- **索引页信息泄露**:`/docs` 的 `readdir` 只列 `*.md`、只回相对名,不回绝对路径,不递归
  列出不该见的内容。

### 5. 缓存与失效

运行时读盘默认每次请求都读+渲染。文档变动不频繁,可加轻量缓存:

- 以 `slug + 文件 mtime` 为 key 缓存渲染结果(`unstable_cache` 或进程内 Map),mtime 变即失效。
- 或路由段配 `export const revalidate = 60`,容忍 60s 陈旧。
- 起步可先不加缓存(`force-dynamic`),量大再优化。

## 实现步骤

1. `lib/markdown-pages.ts`:`loadMarkdownDoc(slug)` / `listMarkdownDocs()`,内部复用
   `artifacts.ts` 的安全路径解析;`DOCS_DIR` 解析(默认 `workspace/docs`)。
2. 抽 `components/markdown-document.tsx`(client):封装 Streamdown plugins + 链接渲染;
   同步把 `chat-message.tsx` 的内联 plugins 改为引用共享配置(可选,避免两处漂移)。
3. `app/docs/[...slug]/page.tsx`:server 读文件 → `<MarkdownDocument>`;`notFound()` 兜底。
4. (可选)`app/docs/page.tsx`:文档索引页。
5. `workspace/docs/` 放一两个示例 md 验证;`workspace` volume 已挂,无需改 compose。
6. 验证 `pnpm lint && pnpm build`;按 README/CHANGELOG 习惯同步 `TODO.md`/`CHANGELOG.md`。

## 不做 / 风险

- **不做 `.mdx`**(运行时编译 = 任意代码执行,安全风险)。
- **不做 build-time SSG**(目录运行时可变,构建期无从枚举)。
- 资源引用(md 内 `![](./img.png)`):首版不处理本地相对资源,如需再补一条
  `/docs/_assets/**` 的静态文件路由(同样走 `isInsideDirectory` 防护)。
- frontmatter:若 md 带 YAML frontmatter,需决定是解析成标题/元信息还是原样渲染;
  首版可像 `skills.ts` 那样只取 `title`,其余忽略。
