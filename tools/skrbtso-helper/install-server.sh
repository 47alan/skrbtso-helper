#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="skrbtso-scrapling-helper"
HELPER_SERVICE="skrbtso-helper"
DEFAULT_INSTALL_DIR="/data/media-stack/skrbtso-helper-repo"
DEFAULT_REPO_URL="https://github.com/47alan/skrbtso-helper.git"
DEFAULT_BRANCH="main"
DEFAULT_DETAIL_WAIT="12"
DEFAULT_TIMEOUT="180"
DEFAULT_MEDIA_STACK_COMPOSE="/data/media-stack/docker-compose.yml"
DEFAULT_MEDIAWARP_NGINX_CONF="/data/media-stack/nginx/conf.d/mediawarp.conf"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo
  echo "==> $*"
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "请使用 root 执行，例如：sudo bash tools/skrbtso-helper/install-server.sh"
  fi
}

install_packages_if_needed() {
  local missing=()
  for cmd in git curl openssl awk; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    return
  fi

  command -v apt-get >/dev/null 2>&1 || die "缺少命令：${missing[*]}，且当前系统没有 apt-get，请先手动安装。"
  info "安装依赖：${missing[*]}"
  apt-get update
  apt-get install -y "${missing[@]}"
}

ensure_docker() {
  command -v docker >/dev/null 2>&1 || die "未找到 docker。请先安装 Docker。"
  docker compose version >/dev/null 2>&1 || die "未找到 docker compose plugin。请先安装 Docker Compose plugin。"
}

prompt_default() {
  local var_name="$1"
  local prompt="$2"
  local default_value="$3"
  local value="${!var_name:-}"

  if [ -n "$value" ]; then
    return
  fi

  if [ -n "$default_value" ]; then
    read -r -p "$prompt [$default_value]: " value
    value="${value:-$default_value}"
  else
    read -r -p "$prompt: " value
  fi

  printf -v "$var_name" "%s" "$value"
}

detect_repo_root() {
  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P || true)"
  local candidate
  candidate="$(cd -- "$script_dir/../.." >/dev/null 2>&1 && pwd -P || true)"

  if [ -f "$candidate/tools/skrbtso_scrapling_helper.py" ] &&
     [ -f "$candidate/tools/skrbtso-helper/Dockerfile" ]; then
    printf "%s" "$candidate"
    return
  fi

  printf ""
}

prepare_repo() {
  local detected_root
  detected_root="$(detect_repo_root)"

  if [ -n "$detected_root" ]; then
    REPO_ROOT="$detected_root"
    return
  fi

  REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
  [ -n "$REPO_URL" ] || die "GitHub 仓库地址不能为空。"
  BRANCH="${BRANCH:-$DEFAULT_BRANCH}"
  prompt_default "INSTALL_DIR" "请输入安装目录" "$DEFAULT_INSTALL_DIR"
  mkdir -p -- "$(dirname -- "$INSTALL_DIR")"

  if [ -d "$INSTALL_DIR/.git" ]; then
    info "更新仓库：$INSTALL_DIR"
    if ! git -C "$INSTALL_DIR" diff --quiet || ! git -C "$INSTALL_DIR" diff --cached --quiet; then
      die "安装目录有未提交改动，请先处理后再继续：$INSTALL_DIR"
    fi
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    if git -C "$INSTALL_DIR" show-ref --verify --quiet "refs/heads/$BRANCH"; then
      git -C "$INSTALL_DIR" checkout "$BRANCH"
    else
      git -C "$INSTALL_DIR" checkout -b "$BRANCH" "origin/$BRANCH"
    fi
    git -C "$INSTALL_DIR" merge --ff-only "origin/$BRANCH"
  elif [ -e "$INSTALL_DIR" ]; then
    die "安装目录已存在但不是 git 仓库：$INSTALL_DIR"
  else
    info "克隆仓库到：$INSTALL_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi

  REPO_ROOT="$INSTALL_DIR"
}

validate_domain() {
  local domain="$1"
  [[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || return 1
  [[ "$domain" == *.* ]] || return 1
  [[ "$domain" != .* && "$domain" != *. ]] || return 1
}

detect_nginx_service() {
  local services
  services="$(docker compose -f "$MEDIA_STACK_COMPOSE" config --services 2>/dev/null || true)"
  for name in nginx mediawarp nginx-proxy; do
    if printf "%s\n" "$services" | grep -qx "$name"; then
      printf "%s" "$name"
      return
    fi
  done
  printf "nginx"
}

detect_nginx_ssl_value() {
  local directive="$1"
  local conf_file="$2"

  awk -v directive="$directive" '
    /^[[:space:]]*#/ { next }
    {
      line = $0
      sub(/[[:space:]]*#.*/, "", line)
      if (line ~ "^[[:space:]]*" directive "[[:space:]]+") {
        sub("^[[:space:]]*" directive "[[:space:]]+", "", line)
        sub(";[[:space:]]*$", "", line)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
        gsub(/^"/, "", line)
        gsub(/"$/, "", line)
        gsub(/^\047/, "", line)
        gsub(/\047$/, "", line)
        print line
        exit
      }
    }
  ' "$conf_file"
}

write_env_file() {
  local env_file="$1"
  local token="$2"

  cat > "$env_file" <<EOF
SKRBTSO_HELPER_TOKEN=$token
SKRBTSO_HELPER_TIMEOUT=${SKRBTSO_HELPER_TIMEOUT:-$DEFAULT_TIMEOUT}
SKRBTSO_HELPER_DETAIL_WAIT=${SKRBTSO_HELPER_DETAIL_WAIT:-$DEFAULT_DETAIL_WAIT}
SKRBTSO_HELPER_STEALTH_FIRST=${SKRBTSO_HELPER_STEALTH_FIRST:-1}
SKRBTSO_HELPER_FORM_FIRST=${SKRBTSO_HELPER_FORM_FIRST:-1}
SKRBTSO_HELPER_MAX_CONCURRENT=${SKRBTSO_HELPER_MAX_CONCURRENT:-1}
HELPER_DOMAIN=$HELPER_DOMAIN
EOF

  chmod 600 "$env_file"
}

write_media_stack_service() {
  local compose_file="$1"
  local env_file="$2"
  local backup_file="$compose_file.bak.$(date +%Y%m%d_%H%M%S)"
  local service_block
  local tmp_file

  [ -f "$compose_file" ] || die "找不到媒体栈 Compose 文件：$compose_file"
  grep -Eq '^services:[[:space:]]*$' "$compose_file" ||
    die "Compose 文件里没有顶层 services:，无法自动插入 helper 服务。"

  cp "$compose_file" "$backup_file"
  MEDIA_STACK_COMPOSE_BACKUP="$backup_file"

  remove_marked_block "$compose_file" "# BEGIN SKRBTSO HELPER SERVICE" "# END SKRBTSO HELPER SERVICE"

  service_block="$(mktemp)"
  tmp_file="$(mktemp)"

  cat > "$service_block" <<EOF
  # BEGIN SKRBTSO HELPER SERVICE
  $HELPER_SERVICE:
    build:
      context: "$REPO_ROOT"
      dockerfile: tools/skrbtso-helper/Dockerfile
    image: local/skrbtso-scrapling-helper:latest
    container_name: $APP_NAME
    restart: unless-stopped
    shm_size: "1gb"
    env_file:
      - "$env_file"
    environment:
      TZ: Asia/Shanghai
      SKRBTSO_HELPER_HOST: 0.0.0.0
      SKRBTSO_HELPER_PORT: "8787"
      SKRBTSO_HELPER_TIMEOUT: "${SKRBTSO_HELPER_TIMEOUT:-$DEFAULT_TIMEOUT}"
      SKRBTSO_HELPER_DETAIL_WAIT: "${SKRBTSO_HELPER_DETAIL_WAIT:-$DEFAULT_DETAIL_WAIT}"
      SKRBTSO_HELPER_STEALTH_FIRST: "${SKRBTSO_HELPER_STEALTH_FIRST:-1}"
      SKRBTSO_HELPER_FORM_FIRST: "${SKRBTSO_HELPER_FORM_FIRST:-1}"
      SKRBTSO_HELPER_MAX_CONCURRENT: "${SKRBTSO_HELPER_MAX_CONCURRENT:-1}"
    ports:
      - "127.0.0.1:8787:8787"
  # END SKRBTSO HELPER SERVICE
EOF

  if ! awk -v block_file="$service_block" '
    { print }
    /^services:[[:space:]]*$/ && !inserted {
      while ((getline line < block_file) > 0) print line
      close(block_file)
      inserted = 1
    }
    END { if (!inserted) exit 7 }
  ' "$compose_file" > "$tmp_file"; then
    cp "$backup_file" "$compose_file"
    rm -f "$service_block" "$tmp_file"
    die "写入 helper 服务失败，已恢复 Compose 备份。"
  fi

  cat "$tmp_file" > "$compose_file"
  rm -f "$service_block" "$tmp_file"
}

compose_cmd() {
  docker compose -f "$MEDIA_STACK_COMPOSE" "$@"
}

start_helper() {
  info "测试主 Compose 并启动 helper"
  if ! compose_cmd config >/dev/null; then
    if [ -n "${MEDIA_STACK_COMPOSE_BACKUP:-}" ] && [ -f "$MEDIA_STACK_COMPOSE_BACKUP" ]; then
      cp "$MEDIA_STACK_COMPOSE_BACKUP" "$MEDIA_STACK_COMPOSE"
    fi
    die "Docker Compose 配置测试失败，已尝试恢复主 Compose 备份。"
  fi
  compose_cmd up -d --build "$HELPER_SERVICE"
}

health_check() {
  info "本机健康检查"
  for _ in 1 2 3 4 5; do
    if curl -fsS "http://127.0.0.1:8787/health" >/dev/null; then
      echo "health: ok"
      return
    fi
    sleep 2
  done

  echo "health: failed"
  docker logs --tail=80 "$APP_NAME" || true
  die "服务未通过健康检查。"
}

remove_marked_block() {
  local file="$1"
  local begin="${2:-# BEGIN SKRBTSO HELPER}"
  local end="${3:-# END SKRBTSO HELPER}"
  local tmp
  tmp="$(mktemp)"

  awk -v begin="$begin" -v end="$end" '
    index($0, begin) > 0 {skip=1; next}
    index($0, end) > 0 {skip=0; next}
    !skip {print}
  ' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

write_nginx_config() {
  local conf_file="$1"
  local backup_file="$conf_file.bak.$(date +%Y%m%d_%H%M%S)"

  [ -f "$conf_file" ] || die "找不到 Nginx 配置文件：$conf_file"
  cp "$conf_file" "$backup_file"
  NGINX_BACKUP_FILE="$backup_file"

  remove_marked_block "$conf_file"

  cat >> "$conf_file" <<EOF

# BEGIN SKRBTSO HELPER
server {
    listen 80;
    server_name $HELPER_DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name $HELPER_DOMAIN;

    ssl_certificate     $SSL_CERT;
    ssl_certificate_key $SSL_KEY;

    client_max_body_size 0;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 240s;
    proxy_send_timeout 240s;

    location / {
        proxy_pass http://$HELPER_SERVICE:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
# END SKRBTSO HELPER
EOF

  echo "$backup_file"
}

ensure_nginx_running() {
  info "确认 Nginx 服务运行"
  compose_cmd up -d "$NGINX_SERVICE"
}

reload_nginx() {
  info "测试并重载 Nginx"
  if ! compose_cmd exec -T "$NGINX_SERVICE" nginx -t; then
    if [ -n "${NGINX_BACKUP_FILE:-}" ] && [ -f "$NGINX_BACKUP_FILE" ]; then
      cp "$NGINX_BACKUP_FILE" "$MEDIAWARP_NGINX_CONF"
      compose_cmd exec -T "$NGINX_SERVICE" nginx -s reload >/dev/null 2>&1 || true
    fi
    die "Nginx 配置测试失败，已尝试恢复备份。"
  fi

  compose_cmd exec -T "$NGINX_SERVICE" nginx -s reload
}

public_check() {
  info "公网地址检查"
  if curl -fsS --max-time 20 "https://$HELPER_DOMAIN/health" >/dev/null; then
    echo "public health: ok"
  else
    echo "public health: 未通过。若 DNS/证书/反代刚更新，稍后再测："
    echo "  curl https://$HELPER_DOMAIN/health"
  fi
}

write_install_info() {
  local info_file="$1"
  cat > "$info_file" <<EOF
domain=$HELPER_DOMAIN
endpoint=https://$HELPER_DOMAIN/skrbtso/search
token=$HELPER_TOKEN
container=$APP_NAME
service=$HELPER_SERVICE
media_stack_compose=$MEDIA_STACK_COMPOSE
media_stack_compose_backup=${MEDIA_STACK_COMPOSE_BACKUP:-}
nginx_conf=$MEDIAWARP_NGINX_CONF
nginx_backup=${NGINX_BACKUP_FILE:-}
ssl_certificate=$SSL_CERT
ssl_certificate_key=$SSL_KEY
detail_wait=${SKRBTSO_HELPER_DETAIL_WAIT:-$DEFAULT_DETAIL_WAIT}
EOF
  chmod 600 "$info_file"
}

main() {
  need_root
  install_packages_if_needed
  ensure_docker
  prepare_repo

  HELPER_DIR="$REPO_ROOT/tools/skrbtso-helper"
  [ -f "$HELPER_DIR/Dockerfile" ] || die "找不到 Dockerfile：$HELPER_DIR"

  prompt_default "HELPER_DOMAIN" "请输入已经解析好的 helper 域名" ""
  validate_domain "$HELPER_DOMAIN" || die "域名格式无效：$HELPER_DOMAIN"

  prompt_default "MEDIA_STACK_COMPOSE" "请输入媒体栈 docker-compose.yml 路径" "$DEFAULT_MEDIA_STACK_COMPOSE"
  [ -f "$MEDIA_STACK_COMPOSE" ] || die "找不到媒体栈 Compose 文件：$MEDIA_STACK_COMPOSE"

  MEDIA_STACK_DIR="$(cd -- "$(dirname -- "$MEDIA_STACK_COMPOSE")" && pwd -P)"
  MEDIA_STACK_HELPER_ENV="${MEDIA_STACK_HELPER_ENV:-$MEDIA_STACK_DIR/skrbtso-helper.env}"

  prompt_default "MEDIAWARP_NGINX_CONF" "请输入 mediawarp.conf 路径" "$DEFAULT_MEDIAWARP_NGINX_CONF"
  [ -f "$MEDIAWARP_NGINX_CONF" ] || die "找不到 Nginx 配置文件：$MEDIAWARP_NGINX_CONF"

  local detected_nginx_service
  local detected_ssl_cert
  local detected_ssl_key
  detected_nginx_service="$(detect_nginx_service)"
  detected_ssl_cert="$(detect_nginx_ssl_value "ssl_certificate" "$MEDIAWARP_NGINX_CONF")"
  detected_ssl_key="$(detect_nginx_ssl_value "ssl_certificate_key" "$MEDIAWARP_NGINX_CONF")"
  prompt_default "NGINX_SERVICE" "请输入 Nginx 容器在 compose 里的服务名" "$detected_nginx_service"
  prompt_default "SSL_CERT" "请输入 Nginx 容器内 ssl_certificate 路径" "$detected_ssl_cert"
  prompt_default "SSL_KEY" "请输入 Nginx 容器内 ssl_certificate_key 路径" "$detected_ssl_key"
  [ -n "$SSL_CERT" ] || die "ssl_certificate 路径不能为空。"
  [ -n "$SSL_KEY" ] || die "ssl_certificate_key 路径不能为空。"

  HELPER_TOKEN="${HELPER_TOKEN:-$(openssl rand -hex 32)}"

  write_env_file "$MEDIA_STACK_HELPER_ENV" "$HELPER_TOKEN"
  write_media_stack_service "$MEDIA_STACK_COMPOSE" "$MEDIA_STACK_HELPER_ENV"
  start_helper
  health_check
  ensure_nginx_running
  write_nginx_config "$MEDIAWARP_NGINX_CONF" >/dev/null
  reload_nginx
  public_check
  write_install_info "$MEDIA_STACK_DIR/skrbtso-helper.install-info"

  info "安装完成"
  cat <<EOF
服务端容器：$APP_NAME
媒体栈 Compose：$MEDIA_STACK_COMPOSE
媒体栈 Compose 备份：${MEDIA_STACK_COMPOSE_BACKUP:-}
Nginx 配置：$MEDIAWARP_NGINX_CONF
公开地址：https://$HELPER_DOMAIN/skrbtso/search

浏览器脚本设置：
  抓取服务地址：https://$HELPER_DOMAIN/skrbtso/search
  Bearer token: $HELPER_TOKEN

安装信息已保存：
  $MEDIA_STACK_DIR/skrbtso-helper.install-info
EOF
}

main "$@"
