# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend
ARG NPM_REGISTRY=https://registry.npmjs.org/
WORKDIR /build
COPY package*.json ./
COPY ssg/package*.json ./ssg/
RUN --mount=type=cache,id=ky-play-npm,target=/root/.npm,sharing=locked \
    npm config set registry "${NPM_REGISTRY}" \
    && npm ci --ignore-scripts --prefer-offline --verbose \
    && npm --prefix ssg ci --prefer-offline --verbose
COPY scripts/prepare-emulatorjs.mjs ./scripts/
COPY ssg/licenses/emulatorjs.json ./ssg/licenses/
ARG EMULATORJS_ARCHIVE_URL=https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.2.3/4.2.3.7z
RUN --mount=type=cache,id=ky-play-emulatorjs,target=/build/temp/cache/emulatorjs,sharing=locked \
    node scripts/prepare-emulatorjs.mjs
COPY ssg/ ./ssg/
COPY scripts/ ./scripts/
ARG VITE_WEB_URL=
ARG VITE_CLIENT_DOWNLOAD_URL=
ARG VITE_API_LATEST=https://github.com/kuangye-team/ky-play/releases/latest/download/latest.json
ARG VITE_EMULATOR_CDN_URL=
RUN --mount=type=cache,id=ky-play-emulatorjs,target=/build/temp/cache/emulatorjs,sharing=locked \
    EMULATORJS_ARCHIVE_URL="${EMULATORJS_ARCHIVE_URL}" VITE_EMULATOR_CDN_URL="${VITE_EMULATOR_CDN_URL}" npm --prefix ssg run build

FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /build/ssg/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
