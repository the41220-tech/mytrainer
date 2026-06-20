# syntax=docker/dockerfile:1
# 나만의 근력 AI — PlayMCP in KC 배포용 (Git 소스 빌드).
# ⚠️ linux/amd64 고정: KC 요구사항. arm64 이미지는 서버 활성화 실패.

###### 1) Builder: 의존성 설치 + TypeScript 빌드 ######
FROM --platform=linux/amd64 node:20-bookworm-slim AS builder
WORKDIR /app
# better-sqlite3 prebuilt가 없을 때만 쓰이는 네이티브 빌드 도구
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# 의존성 먼저 복사 → 레이어 캐시 활용
COPY package.json package-lock.json ./
RUN npm ci
# 소스 복사 후 빌드 (tsc → dist/)
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

###### 2) Runtime: 산출물 + 프로덕션 의존성만 ######
FROM --platform=linux/amd64 node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    MYTRAINER_DB_PATH=/data/mytrainer.db
WORKDIR /app
COPY package.json package-lock.json ./
# 빌더에서 컴파일된 better-sqlite3 네이티브 바이너리째 복사 → 런타임 재컴파일 불필요
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# dev 의존성 제거(네이티브 바이너리는 유지) + DB 디렉터리 준비
RUN npm prune --omit=dev \
 && mkdir -p /data \
 && chown -R node:node /data /app
USER node
EXPOSE 8080
# Streamable HTTP: POST /mcp · 헬스체크: GET /health · PORT 환경변수로 변경 가능
CMD ["node", "dist/http.js"]
