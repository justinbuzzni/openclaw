# 🧠 AxiomMind Chat UI/UX Revamp - Work Summary

This document outlines the comprehensive UI/UX overhaul performed on the AxiomMind Chat application (`extensions/axiommind/web`). The goal was to transition from a functional prototype to a world-class, premium user experience.

## 🎨 Design Systems & Theme

### 1. Cosmic Dark Theme & Ambient Effects
- **Concept**: Deep space/cosmic aesthetic to align with "AxiomMind" branding.
- **Implementation**:
  - Replaced flat background with a deep `zinc-950` / `black` base.
  - Added **Ambient Background Effects**: Animated, blurred orbs (`primary-600`, `blue-600`) pulsing in the background to create depth.
  - **Typography**: Integrated `Inter` font family for clean, modern readability.

### 2. Glassmorphism Engine
- Adopted a consistent **Glassmorphism** language across the app.
- **Utility Classes**: Created reusable `.glass` and `.glass-panel` utilities in `globals.css`.
  - `backdrop-blur-xl` for heavy blurring.
  - Thin, translucent borders (`border-white/10`) for separation without heavy lines.
  - Subtle gradients (`bg-white/5`) for surface texture.

## 🧩 Component Enhancements

### 1. Layout & Shell (`layout.tsx`, `page.tsx`)
- **Responsive Design**: Moved to a full-screen, app-like layout.
- **Container**: The main chat interface is now a floating glass card with a subtle shadow and border, centered on the screen (on desktop).
- **Transitions**: Smooth entry animations for the entire interface.

### 2. Chat Window Header (`ChatWindow.tsx`)
- **Status Indicators**:
  - Replaced text-based status with visual icons.
  - **Brain Icon**: Pulsing effect when active.
  - **WiFi/Connection**: Dynamic color changes (Green/Amber/Red) based on socket status.
- **Visuals**: Added a "Beta" tag in a glass pill and session key display.

### 3. Message Experience (`MessageList.tsx`)
- **Animations**: Integrated `framer-motion` for:
  - Slide-up and fade-in effects for new messages.
  - Smooth height transitions.
- **bubbles**: 
  - **User**: Gradient background (`from-primary-600 to-primary-700`).
  - **AI**: Glass surface (`bg-surface/80`) with blur.
- **Markdown**: 
  - Enhanced code block styling with Mac-like window controls.
  - Premium blockquote and list styling.
- **Tool Progress**:
  - Redesigned "Tool Use" indicators to be collapsible and less intrusive.
  - Animated "Thinking..." indicators.

### 4. Floating Input Bar (`MessageInput.tsx`)
- **Interaction**: Moved from a fixed bottom bar to a **floating interaction island**.
- **Effects**:
  - **Glow Effect**: Subtle gradient glow when the input is focused (`group-focus-within`).
  - **Connecting State**: Overlay with spinner when the socket is connecting.
- **UX**: Auto-resizing textarea with a dedicated actionable send/stop button.

### 5. Memory Dashboard (`MemoryPanel.tsx`)
- **Concept**: Transformed from a simple list to a **"Memory Bank" Dashboard**.
- **Visual Hierarchy**:
  - Added a "Processing Pipeline" stepper (L0 -> L4) to visualize memory consolidation.
  - "Pending Verification" tasks shown as cards with amber accents.
- **Search**: Premium search bar with glass styling.

### 6. Search Results (`SearchResults.tsx`)
- **Categorization**: Distinct visual styles for different memory types:
  - 📄 **Fact**: Blue
  - ⚖️ **Decision**: Purple
  - 💡 **Insight**: Emerald
  - ✅ **Task**: Amber
  - 🔖 **Reference**: Gray
- **Cards**: Interactive hover effects and cleaner typography.

## 🛠 Technical Stack Updates

- **Styling**: `Tailwind CSS` + `tailwind-merge` + `clsx`
- **Animations**: `framer-motion`
- **Icons**: `lucide-react`
- **Fonts**: `next/font/google` (Inter)

## 📸 Usage

The application now defaults to **Dark Mode** for the best visual experience. The interface is fully responsive, hiding the Memory Panel on smaller screens to focus on the chat experience.

---

## 🔧 Troubleshooting & Deployment Guide

### 문제 상황 (Issues Encountered)

UI 변경 후 `http://127.0.0.1:18789/ax`에서 변경사항이 반영되지 않는 문제 발생.

#### 1. Dark Mode CSS Variables 미적용
- **증상**: `tailwind.config.ts`에 `darkMode: "class"` 설정했으나 dark mode 스타일이 적용되지 않음
- **원인**: `globals.css`의 CSS 변수가 `@media (prefers-color-scheme: dark)`를 사용하고 있었음
- **문제 코드**:
  ```css
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #030712;
      /* ... */
    }
  }
  ```

#### 2. Gateway가 Old CSS 파일 서빙
- **증상**: 새 빌드 후에도 브라우저가 old CSS hash (`6b63fe5b5ec762e4.css`)를 로드
- **원인**: Gateway가 static 파일을 서빙하는 위치가 3곳 존재:
  1. Local source: `/workspace/opensource/openclaw/extensions/axiommind/web/out/`
  2. npm global install: `~/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/extensions/axiommind/web/out/`
  3. **Plugin install (실제 사용됨)**: `~/.openclaw/extensions/plugin-axiommind/web/out/`

### 해결 방법 (Solutions)

#### 1. CSS Variables 수정
`globals.css`에서 media query를 `.dark` class selector로 변경:

```css
/* Before (Wrong) */
@media (prefers-color-scheme: dark) {
  :root {
    --background: #030712;
  }
}

/* After (Correct) */
.dark {
  --background: #030712;
}
```

#### 2. 올바른 위치에 빌드 파일 배포

```bash
# 1. Next.js 빌드
cd extensions/axiommind/web
pnpm build

# 2. Plugin 설치 위치에 복사 (이게 핵심!)
rm -rf ~/.openclaw/extensions/plugin-axiommind/web/out
cp -r ./out ~/.openclaw/extensions/plugin-axiommind/web/

# 3. Gateway 재시작
pkill -9 -f openclaw-gateway
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
```

### 다음부터 해야할 것 (Future Workflow)

#### UI 변경 후 배포 체크리스트

1. **Tailwind + CSS Variables 일치 확인**
   - `tailwind.config.ts`의 `darkMode` 설정 확인
   - `globals.css`의 CSS 변수가 같은 방식 사용하는지 확인
   - `darkMode: "class"` → `.dark { }` selector 사용
   - `darkMode: "media"` → `@media (prefers-color-scheme: dark)` 사용

2. **빌드 및 배포**
   ```bash
   # 빌드
   cd extensions/axiommind/web && pnpm build

   # Plugin 위치에 복사 (중요!)
   cp -r ./out ~/.openclaw/extensions/plugin-axiommind/web/

   # Gateway 재시작
   pkill -9 -f openclaw-gateway && openclaw gateway run --bind loopback --port 18789 --force
   ```

3. **CSS 파일 확인**
   ```bash
   # 새 CSS hash 확인
   ls ~/.openclaw/extensions/plugin-axiommind/web/out/_next/static/css/

   # 브라우저 DevTools Network 탭에서 로드되는 CSS 파일명 확인
   ```

4. **캐시 무효화**
   - 브라우저에서 `?v=N` 쿼리 파라미터 추가하여 캐시 우회
   - 예: `http://127.0.0.1:18789/ax?v=2`

### Static Files 서빙 구조

```
Gateway 실행 시 Plugin 로드 순서:
1. ~/.openclaw/extensions/plugin-axiommind/ (설치된 플러그인)
   └── web/out/ ← Gateway가 실제로 서빙하는 위치

2. npm global install (참조용)
   └── extensions/axiommind/web/out/

3. Local source (개발용)
   └── extensions/axiommind/web/out/
```

> **핵심**: Gateway는 `~/.openclaw/extensions/plugin-axiommind/web/out/`에서 static 파일을 서빙합니다.
> UI 변경 후 반드시 이 위치에 빌드 파일을 복사해야 합니다.
