#!/bin/sh
set -eu

# 检测 "新二进制 + 旧配置" 漂移：SubConverter 镜像更新后，
# Docker 不会把新镜像的 /base 复制进已有命名卷，运行容器会继续沿用旧卷中的
# pref.example.toml（模板、profiles、snippets），健康检查不会告警。
# 本脚本对比镜像自带与运行卷中的 pref.example.toml SHA-256，不一致时以非零退出。
#
# 用法：在项目根目录运行（compose 上下文通过环境变量或默认文件名解析）。
# 也可由 verify-integrated-stack.sh 在集成验证尾部调用（此时卷为新建，应返回 0）。

fail() {
  printf 'SubConverter runtime drift error: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail 'Docker is not available in PATH.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'

image=$(docker compose config --format json 2>/dev/null | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const config = JSON.parse(input);
  const image = config.services?.subconverter?.image;
  if (typeof image !== "string" || !image) process.exit(1);
  process.stdout.write(image);
});
') || fail 'unable to resolve the subconverter image from the compose configuration.'

subconverter_id=$(docker compose ps -q subconverter 2>/dev/null) \
  || fail 'subconverter service is not running.'

# 镜像自带文件：起一个无卷挂载的一次性容器读取，避免运行卷遮蔽镜像内容。
image_file_digest=$(docker run --rm --entrypoint sh "$image" -c \
  'sha256sum /base/pref.example.toml 2>/dev/null | awk "{ print \$1 }"') \
  || fail 'unable to read pref.example.toml from the resolved image.'
[ -n "$image_file_digest" ] || fail 'image does not contain /base/pref.example.toml.'

runtime_file_digest=$(docker compose exec -T subconverter sh -eu -c \
  'sha256sum /base/pref.example.toml | awk "{ print \$1 }"') \
  || fail 'unable to read pref.example.toml from the running container.'
[ -n "$runtime_file_digest" ] || fail 'runtime volume does not contain pref.example.toml.'

if [ "$image_file_digest" != "$runtime_file_digest" ]; then
  fail 'image and runtime volume pref.example.toml differ: the runtime volume keeps the previous image /base content. Stop the stack, remove the subconverter-runtime volume, and start it again so the new image repopulates /base.'
fi

printf 'SubConverter runtime volume matches the resolved image: %s\n' "$image"
